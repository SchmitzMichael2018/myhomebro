from __future__ import annotations

import json
import logging
import re
from decimal import Decimal
from html import escape
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Milestone
from projects.models_amendment_request import AmendmentRequest, AmendmentRequestAttachment, apply_descoped_milestone_hold
from projects.models_project_activity import ProjectActivityEvent
from projects.services.project_activity import create_project_activity_event, mark_activity_viewed
from projects.services.invites_delivery import send_postmark_email
from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms, send_sms_opt_in_request
from projects.services.amendments import mark_agreement_amended
from projects.services.agreement_fee_allocation import refresh_agreement_fee_allocations
from projects.utils.accounts import get_contractor_for_user


logger = logging.getLogger(__name__)


COUNTER_ATTACHMENT_ALLOWED_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
COUNTER_ATTACHMENT_ALLOWED_EXTENSIONS = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".txt",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
}


class ContractorAgreementAmendmentRequestSerializer(serializers.Serializer):
    change_type = serializers.ChoiceField(choices=[choice[0] for choice in AmendmentRequest.ChangeType.choices])
    requested_change = serializers.CharField()
    reason = serializers.CharField()
    affected_milestone_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=True)
    proposed_value_change = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    revised_project_value = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    attachment_note = serializers.CharField(required=False, allow_blank=True)
    milestone_draft = serializers.JSONField(required=False)


class ContractorAgreementAmendmentImproveView(APIView):
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        requested_change = serializers.CharField()
        reason = serializers.CharField(required=False, allow_blank=True)
        affected_milestone_title = serializers.CharField(required=False, allow_blank=True)
        current_change_type = serializers.ChoiceField(
            choices=[choice[0] for choice in AmendmentRequest.ChangeType.choices],
            required=False,
        )

    def post(self, request, agreement_id: int):
        agreement = _contractor_agreement_for_user(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        original = serializer.validated_data["requested_change"].strip()
        reason = serializer.validated_data.get("reason", "").strip()
        affected_milestone = serializer.validated_data.get("affected_milestone_title", "").strip()
        combined = " ".join(part for part in [original, reason] if part)
        text = combined.lower()
        suggested = serializer.validated_data.get("current_change_type") or AmendmentRequest.ChangeType.OTHER
        if re.search(r"\b(remove|omit|delete|descope|de-scope|credit)\b", text):
            suggested = AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK
        elif re.search(r"\b(date|delay|schedule|timeline|week|month|day|start|finish)\b", text):
            suggested = AmendmentRequest.ChangeType.DATE_CHANGE
        elif re.search(r"\b(price|cost|amount|allowance|budget|increase|decrease|\$)\b", text):
            suggested = AmendmentRequest.ChangeType.AMOUNT_CHANGE
        elif re.search(r"\b(scope|material|product|damage|remediation|repair|replace|add|change)\b", text):
            suggested = AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE

        clean = re.sub(r"\s+", " ", original).rstrip(".")
        reason_clean = re.sub(r"\s+", " ", reason).rstrip(".")
        is_water_remediation = bool(re.search(r"\b(water damage|water remediation|mold|pipe leak|leak)\b", text))
        if is_water_remediation:
            milestone_title = "Water Damage Remediation"
            scope = (
                "Repair or coordinate repair of the identified leak; dry the affected area; "
                "remove or treat mold-contaminated materials as required; repair or replace "
                "damaged wood and related materials within the approved amendment scope; and "
                "document the completed remediation before concealed work resumes."
            )
            completion = (
                "Complete when the leak source is repaired, affected materials are dry, required "
                "mold treatment and approved material repairs are complete, the area is ready for "
                "the next trade, and dated completion photos or specialist documentation are provided."
            )
        else:
            milestone_title = {
                AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK: "Scope Removal",
                AmendmentRequest.ChangeType.DATE_CHANGE: "Schedule Adjustment",
                AmendmentRequest.ChangeType.AMOUNT_CHANGE: "Price Adjustment",
                AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE: "Additional Scope of Work",
            }.get(suggested, "Agreement Change")
            scope = clean[:1].upper() + clean[1:] + "."
            if reason_clean:
                scope += f" Required because: {reason_clean}."
            completion = (
                "Complete when the approved changed work is finished, any required inspection or "
                "supporting documentation is provided, and the result is ready for customer review."
            )
        questions = []
        if len(combined) < 60:
            questions.append("What exact work, location, material, or milestone is affected?")
        if suggested == AmendmentRequest.ChangeType.AMOUNT_CHANGE and not re.search(r"\$|\b\d+(\.\d+)?\b", text):
            questions.append("What price adjustment is proposed, if known?")
        if suggested == AmendmentRequest.ChangeType.DATE_CHANGE and not re.search(r"\b\d|date|week|month|day\b", text):
            questions.append("What start, finish, or duration change is proposed?")
        evidence = {
            AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE: "Add photos of the condition, product details, or a specialist estimate when available.",
            AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK: "Add a revised scope or identify the milestones and amounts to be removed.",
            AmendmentRequest.ChangeType.AMOUNT_CHANGE: "Add an estimate, quote, receipt, or written price basis.",
            AmendmentRequest.ChangeType.DATE_CHANGE: "Add delivery dates, availability notes, or other schedule support.",
        }.get(suggested, "Add relevant photos, estimates, documents, or project notes.")
        placement = f"Before {affected_milestone}" if affected_milestone else "Before the next affected milestone"
        improved_description = f"{milestone_title}: {scope}"
        return Response({
            "detail": "Amendment request improved.",
            "original_request": original,
            "suggested_change_type": suggested,
            "suggested_change_type_label": AmendmentRequest.ChangeType(suggested).label,
            "improved_description": improved_description,
            "improved_reason": reason_clean[:1].upper() + reason_clean[1:] + "." if reason_clean else "",
            "milestone_draft": {
                "title": milestone_title,
                "scope": scope,
                "completion_criteria": completion,
                "recommended_placement": placement,
                "schedule_confirmation": "Contractor must confirm any added duration and revised dates.",
                "price_confirmation": "Contractor must enter and confirm the amendment amount before it is sent for approval.",
            },
            "clarification_questions": questions[:3],
            "evidence_note": evidence,
            "source": "ai_advisory",
        })


class AmendmentRequestResponseSerializer(serializers.Serializer):
    response_state = serializers.ChoiceField(
        choices=[
            AmendmentRequest.ResponseState.ACCEPTED,
            AmendmentRequest.ResponseState.REJECTED,
            AmendmentRequest.ResponseState.COUNTERED,
        ]
    )
    response_note = serializers.CharField(required=False, allow_blank=True)
    counter_proposal = serializers.JSONField(required=False)


def serialize_amendment_attachment(attachment: AmendmentRequestAttachment, request=None) -> dict:
    file_obj = getattr(attachment, "file", None)
    url = ""
    try:
        if file_obj and getattr(file_obj, "url", ""):
            url = request.build_absolute_uri(file_obj.url) if request is not None else file_obj.url
    except Exception:
        url = ""
    return {
        "id": attachment.id,
        "filename": attachment.original_filename or Path(getattr(file_obj, "name", "") or "attachment").name,
        "content_type": attachment.content_type or "",
        "size": attachment.size or 0,
        "uploaded_at": attachment.uploaded_at.isoformat() if attachment.uploaded_at else "",
        "url": url,
        "uploaded_by": attachment.uploaded_by_id,
    }


def validate_counter_attachment(uploaded) -> str | None:
    name = getattr(uploaded, "name", "") or ""
    size = int(getattr(uploaded, "size", 0) or 0)
    content_type = str(getattr(uploaded, "content_type", "") or "").lower()
    ext = Path(name).suffix.lower()
    max_bytes = int(getattr(settings, "AMENDMENT_COUNTER_ATTACHMENT_MAX_BYTES", 10 * 1024 * 1024))
    if size <= 0:
        return "Attachment is empty."
    if size > max_bytes:
        return f"{name or 'Attachment'} is too large."
    if ext and ext not in COUNTER_ATTACHMENT_ALLOWED_EXTENSIONS:
        return f"{name or 'Attachment'} has an unsupported file type."
    if content_type and content_type not in COUNTER_ATTACHMENT_ALLOWED_TYPES:
        return f"{name or 'Attachment'} has an unsupported file type."
    return None


def response_payload_from_request(request) -> dict:
    if hasattr(request.data, "get"):
        data = {key: request.data.get(key) for key in request.data.keys()}
    else:
        data = dict(request.data)
    proposal = data.get("counter_proposal")
    if isinstance(proposal, str):
        try:
            data["counter_proposal"] = json.loads(proposal) if proposal.strip() else {}
        except json.JSONDecodeError:
            data["counter_proposal"] = None
    return data


def _contractor_agreement_for_user(user, agreement_id: int) -> Agreement | None:
    contractor = get_contractor_for_user(user)
    if contractor is None:
        return None
    return Agreement.objects.select_related("contractor", "homeowner", "project").filter(id=agreement_id, contractor=contractor).first()


def _notify_homeowner_of_amendment_request(*, request, agreement: Agreement, amendment: AmendmentRequest, dedupe_suffix: str = "", send_email: bool = True) -> dict:
    homeowner = getattr(agreement, "homeowner", None)
    contractor = getattr(agreement, "contractor", None)
    customer_name = getattr(homeowner, "full_name", "") or "Homeowner"
    customer_email = str(getattr(homeowner, "email", "") or "").strip()
    customer_phone = str(getattr(homeowner, "phone_number", "") or "").strip()
    contractor_name = (
        getattr(contractor, "business_name", "")
        or getattr(contractor, "full_name", "")
        or "Your contractor"
    )
    project_title = (
        getattr(agreement, "project_title", "")
        or getattr(getattr(agreement, "project", None), "title", "")
        or f"Agreement #{agreement.id}"
    )
    requested_changes = amendment.requested_changes or {}
    requested_change = str(requested_changes.get("requested_change") or "").strip()
    proposed_amount = str(requested_changes.get("proposed_value_change") or "").strip()
    amount_line = f"Proposed price adjustment: ${Decimal(proposed_amount):,.2f}\n" if proposed_amount else "Proposed price adjustment: To be determined\n"
    request_site_url = request.build_absolute_uri("/") if request is not None else ""
    site_url = (getattr(settings, "MHB_SITE_URL", "") or getattr(settings, "SITE_URL", "") or request_site_url).rstrip("/")
    portal_token = signing.dumps(
        {"email": customer_email.lower()},
        salt="myhomebro.customer-portal",
    ) if customer_email else ""
    review_url = (
        f"{site_url}/portal/{portal_token}?workspace=projects&agreement={agreement.id}&change_request={amendment.id}"
        if portal_token
        else f"{site_url}/portal"
    )
    subject = f"Change request for {project_title} — review requested"
    text_body = (
        f"Hi {customer_name},\n\n"
        f"{contractor_name} submitted a change request for {project_title}.\n\n"
        f"Requested change: {requested_change}\n"
        f"Reason: {amendment.justification}\n"
        f"{amount_line}\n"
        f"Review the request in your MyHomeBro workspace:\n{review_url}\n\n"
        "The signed agreement remains unchanged until the amendment is approved and signed."
    )
    html_body = (
        "<div style='font-family:Arial,sans-serif;line-height:1.55;color:#172033'>"
        f"<h2>Change request for {escape(project_title)}</h2>"
        f"<p>Hi {escape(customer_name)},</p>"
        f"<p><strong>{escape(contractor_name)}</strong> submitted a change request for your review.</p>"
        f"<p><strong>Requested change:</strong><br>{escape(requested_change)}</p>"
        f"<p><strong>Reason:</strong><br>{escape(amendment.justification)}</p>"
        f"<p><strong>Proposed price adjustment:</strong> {('$' + format(Decimal(proposed_amount), ',.2f')) if proposed_amount else 'To be determined'}</p>"
        f"<p><a href='{escape(review_url)}' style='display:inline-block;background:#1769e0;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px;font-weight:bold'>Review Change Request</a></p>"
        "<p style='color:#526079;font-size:13px'>The signed agreement remains unchanged until the amendment is approved and signed.</p>"
        "</div>"
    )

    email_result = {"status": "not_available", "sent": False, "detail": "Customer email is not available."}
    if customer_email and send_email:
        try:
            sent, detail = send_postmark_email(
                to_email=customer_email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
            )
            email_result = {"status": "sent" if sent else "failed", "sent": bool(sent), "detail": detail}
        except Exception as exc:  # pragma: no cover - provider safety net
            logger.exception("Amendment request email failed for agreement %s", agreement.id)
            email_result = {"status": "failed", "sent": False, "detail": str(exc)}

    sms_result = {"status": "not_available", "sent": False, "detail": "Customer phone is not available."}
    if customer_phone:
        try:
            raw_sms = send_compliant_sms(
                customer_phone,
                f"MyHomeBro: {contractor_name} submitted a change request for {project_title}. Review it here: {review_url}",
                related_object=agreement,
                category="customer_care",
                dedupe_key=f"amendment-request:{amendment.id}{dedupe_suffix}",
            )
            sms_result = {
                "status": raw_sms.get("status") or ("sent" if raw_sms.get("ok") else "failed"),
                "sent": bool(raw_sms.get("ok")),
                "detail": raw_sms.get("detail") or "",
                "reason_code": raw_sms.get("reason_code") or "",
            }
            if raw_sms.get("reason_code") == "no_consent":
                opt_in = send_sms_opt_in_request(
                    phone_number=customer_phone,
                    company_name=contractor_name,
                    contractor=contractor,
                    dedupe_key=f"amendment-opt-in:{amendment.id}",
                )
                if opt_in.get("ok") or opt_in.get("status") == "duplicate" or opt_in.get("reason_code") == "consent_pending":
                    sms_result = {
                        "status": "consent_pending",
                        "sent": False,
                        "detail": "Opt-in request sent. Waiting for the customer to reply YES.",
                        "reason_code": "consent_pending",
                    }
        except Exception as exc:  # pragma: no cover - provider safety net
            logger.exception("Amendment request SMS failed for agreement %s", agreement.id)
            sms_result = {"status": "failed", "sent": False, "detail": str(exc)}
    return {"email": email_result, "sms": sms_result, "attempted_at": timezone.now().isoformat()}


def release_pending_amendment_sms(phone_number: str, *, message_sid: str = "") -> int:
    """Send queued amendment review links after an affirmative SMS opt-in."""
    normalized = normalize_phone_to_e164(phone_number)
    if not normalized:
        return 0
    sent = 0
    pending = AmendmentRequest.objects.select_related(
        "agreement", "agreement__homeowner", "agreement__contractor", "agreement__project"
    ).filter(response_state=AmendmentRequest.ResponseState.PENDING).order_by("-created_at")[:200]
    for amendment in pending:
        delivery = dict((amendment.requested_changes or {}).get("notification_delivery") or {})
        if (delivery.get("sms") or {}).get("status") != "consent_pending":
            continue
        homeowner_phone = getattr(getattr(amendment.agreement, "homeowner", None), "phone_number", "")
        if normalize_phone_to_e164(homeowner_phone) != normalized:
            continue
        released = _notify_homeowner_of_amendment_request(
            request=None,
            agreement=amendment.agreement,
            amendment=amendment,
            dedupe_suffix=f":opt-in:{message_sid or timezone.now().timestamp()}",
            send_email=False,
        )
        sms_result = released.get("sms") or {}
        requested_changes = dict(amendment.requested_changes or {})
        requested_changes["notification_delivery"] = {
            **delivery,
            "sms": sms_result,
            "attempted_at": released.get("attempted_at"),
        }
        amendment.requested_changes = requested_changes
        amendment.save(update_fields=["requested_changes", "updated_at"])
        sent += int(bool(sms_result.get("sent")))
    return sent


class ContractorAmendmentNotifyView(APIView):
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        proposed_value_change = serializers.DecimalField(
            max_digits=12,
            decimal_places=2,
            required=False,
            allow_null=True,
        )

    def post(self, request, request_id: int):
        contractor = get_contractor_for_user(request.user)
        amendment = get_object_or_404(
            AmendmentRequest.objects.select_related(
                "agreement",
                "agreement__contractor",
                "agreement__homeowner",
                "agreement__project",
            ),
            id=request_id,
            agreement__contractor=contractor,
            initiated_by_role="contractor",
        )
        if amendment.status == AmendmentRequest.Status.CLOSED:
            return Response({"detail": "This change request is closed."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested_changes = amendment.requested_changes or {}
        if "proposed_value_change" in serializer.validated_data:
            amount = serializer.validated_data.get("proposed_value_change")
            requested_changes["proposed_value_change"] = "" if amount is None else str(amount)
        amendment.requested_changes = requested_changes
        amendment.save(update_fields=["requested_changes", "updated_at"])

        notifications = _notify_homeowner_of_amendment_request(
            request=request,
            agreement=amendment.agreement,
            amendment=amendment,
            dedupe_suffix=f":manual:{timezone.now().timestamp()}",
        )
        amendment.requested_changes = {
            **(amendment.requested_changes or {}),
            "notification_delivery": notifications,
        }
        amendment.save(update_fields=["requested_changes", "updated_at"])
        create_project_activity_event(
            agreement=amendment.agreement,
            event_type="amendment_delivered",
            object_type="amendment_request",
            object_id=amendment.id,
            title="Change request notification sent",
            body="Customer notification delivery was requested by the contractor.",
            actor=request.user,
            actor_role="contractor",
            recipient_role="homeowner",
            delivered=bool(notifications["email"]["sent"] or notifications["sms"]["sent"]),
            metadata={"notification_delivery": notifications},
        )
        return Response({"ok": True, "notifications": notifications}, status=status.HTTP_200_OK)


class ContractorAgreementAmendmentRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        agreement = _contractor_agreement_for_user(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = ContractorAgreementAmendmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        files = (
            request.FILES.getlist("attachments")
            or request.FILES.getlist("files")
            or request.FILES.getlist("file")
        )
        if len(files) > 5:
            return Response({"attachments": "Upload up to 5 supporting files."}, status=status.HTTP_400_BAD_REQUEST)
        attachment_errors = [error for uploaded in files if (error := validate_counter_attachment(uploaded))]
        if attachment_errors:
            return Response({"attachments": attachment_errors}, status=status.HTTP_400_BAD_REQUEST)
        existing = (
            AmendmentRequest.objects.filter(agreement=agreement)
            .exclude(status=AmendmentRequest.Status.CLOSED)
            .order_by("-created_at", "-id")
            .first()
        )
        if existing:
            return Response({"detail": "An amendment request is already open.", "amendment_request_id": existing.id}, status=status.HTTP_200_OK)

        change_type = serializer.validated_data["change_type"]
        original_project_value = Decimal(str(getattr(agreement, "total_cost", 0) or 0)).quantize(Decimal("0.01"))
        escrow_funded_amount = Decimal(str(getattr(agreement, "escrow_funded_amount", 0) or 0)).quantize(Decimal("0.01"))
        revised_project_value = serializer.validated_data.get("revised_project_value")
        estimated_surplus = Decimal("0.00")
        eligibility = AmendmentRequest.RefundEligibilityStatus.NOT_APPLICABLE
        if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK:
            eligibility = AmendmentRequest.RefundEligibilityStatus.ELIGIBLE_AFTER_SIGNED
            if revised_project_value is not None:
                revised_project_value = Decimal(str(revised_project_value)).quantize(Decimal("0.01"))
                estimated_surplus = max(escrow_funded_amount - revised_project_value, Decimal("0.00"))
            else:
                eligibility = AmendmentRequest.RefundEligibilityStatus.ESTIMATE_ONLY

        amendment = AmendmentRequest.objects.create(
            agreement=agreement,
            requested_by=request.user,
            initiated_by_role="contractor",
            change_type=change_type,
            requested_changes={
                "requested_change": serializer.validated_data["requested_change"],
                "attachment_note": serializer.validated_data.get("attachment_note", ""),
                "proposed_value_change": str(serializer.validated_data.get("proposed_value_change") or ""),
                "milestone_draft": serializer.validated_data.get("milestone_draft") or {},
                "requested_on_amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
            },
            justification=serializer.validated_data["reason"],
            original_project_value=original_project_value if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            revised_project_value=revised_project_value if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            escrow_funded_amount=escrow_funded_amount if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            estimated_refundable_escrow_surplus=estimated_surplus,
            refund_eligibility_status=eligibility,
        )
        if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK:
            ids = set()
            for value in serializer.validated_data.get("affected_milestone_ids") or []:
                try:
                    ids.add(int(value))
                except Exception:
                    pass
            affected = Milestone.objects.filter(agreement=agreement, id__in=ids)
            amendment.affected_milestones.set(affected)
            apply_descoped_milestone_hold(amendment)

        created_attachments = [
            AmendmentRequestAttachment.objects.create(
                amendment_request=amendment,
                agreement=agreement,
                file=uploaded,
                original_filename=getattr(uploaded, "name", "") or "",
                content_type=getattr(uploaded, "content_type", "") or "",
                size=int(getattr(uploaded, "size", 0) or 0),
                uploaded_by=request.user,
                response_state=AmendmentRequest.ResponseState.PENDING,
            )
            for uploaded in files
        ]

        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_created",
            object_type="amendment_request",
            object_id=amendment.id,
            title="Contractor submitted amendment request",
            body=amendment.justification,
            actor=request.user,
            actor_role="contractor",
            recipient_role="homeowner",
            delivered=True,
            metadata={
                "change_type": change_type,
                "attachment_count": len(created_attachments),
                "attachments": [
                    serialize_amendment_attachment(attachment, request=request)
                    for attachment in created_attachments
                ],
            },
        )
        notifications = _notify_homeowner_of_amendment_request(
            request=request,
            agreement=agreement,
            amendment=amendment,
        )
        amendment.requested_changes = {
            **(amendment.requested_changes or {}),
            "notification_delivery": notifications,
        }
        amendment.save(update_fields=["requested_changes", "updated_at"])
        return Response(
            {
                "ok": True,
                "notifications": notifications,
                "amendment_request": {
                    "id": amendment.id,
                    "status": amendment.status,
                    "status_label": amendment.get_status_display(),
                    "response_state": amendment.response_state,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class AmendmentRequestResponseView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, request_id: int):
        amendment = get_object_or_404(
            AmendmentRequest.objects.select_related("agreement", "agreement__contractor"),
            id=request_id,
        )
        agreement = amendment.agreement
        contractor = get_contractor_for_user(request.user) if request.user.is_authenticated else None
        is_contractor = bool(contractor and getattr(agreement, "contractor_id", None) == contractor.id)
        homeowner_email = (getattr(getattr(agreement, "homeowner", None), "email", "") or "").lower()
        portal_email = ""
        portal_token = str(request.data.get("portal_token") or "").strip() if hasattr(request.data, "get") else ""
        if portal_token:
            try:
                portal_payload = signing.loads(portal_token, salt="myhomebro.customer-portal", max_age=60 * 60 * 24 * 14)
                portal_email = str(portal_payload.get("email") or "").strip().lower()
            except (signing.BadSignature, signing.SignatureExpired):
                return Response({"detail": "This customer portal link is invalid or expired."}, status=status.HTTP_403_FORBIDDEN)
        is_homeowner = bool(
            getattr(request.user, "email", "").lower() == homeowner_email
            or (portal_email and portal_email == homeowner_email)
        )
        if not (is_contractor or is_homeowner or (request.user.is_authenticated and request.user.is_staff)):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        files = (
            request.FILES.getlist("attachments")
            or request.FILES.getlist("files")
            or request.FILES.getlist("file")
        )
        serializer = AmendmentRequestResponseSerializer(data=response_payload_from_request(request))
        serializer.is_valid(raise_exception=True)
        response_state = serializer.validated_data["response_state"]
        response_note = serializer.validated_data.get("response_note", "")
        if files and not is_contractor:
            return Response({"detail": "Only the agreement contractor can upload counter-proposal attachments."}, status=status.HTTP_403_FORBIDDEN)
        if files and response_state != AmendmentRequest.ResponseState.COUNTERED:
            return Response({"attachments": "Attachments are only supported for contractor counter-proposals."}, status=status.HTTP_400_BAD_REQUEST)
        attachment_errors = [error for uploaded in files if (error := validate_counter_attachment(uploaded))]
        if attachment_errors:
            return Response({"attachments": attachment_errors}, status=status.HTTP_400_BAD_REQUEST)
        if response_state == AmendmentRequest.ResponseState.REJECTED and not response_note.strip():
            return Response({"response_note": "Provide a reason before rejecting this amendment request."}, status=status.HTTP_400_BAD_REQUEST)
        actor = request.user if request.user.is_authenticated else None
        amendment.mark_responded(
            response_state=response_state,
            actor=actor,
            note=response_note,
            counter_proposal=serializer.validated_data.get("counter_proposal"),
        )
        created_attachments = [
            AmendmentRequestAttachment.objects.create(
                amendment_request=amendment,
                agreement=agreement,
                file=uploaded,
                original_filename=getattr(uploaded, "name", "") or "",
                content_type=getattr(uploaded, "content_type", "") or "",
                size=int(getattr(uploaded, "size", 0) or 0),
                uploaded_by=actor,
                response_state=response_state,
            )
            for uploaded in files
        ]
        attachment_metadata = [
            serialize_amendment_attachment(attachment, request=request)
            for attachment in created_attachments
        ]
        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_responded",
            object_type="amendment_request",
            object_id=amendment.id,
            title=f"Amendment {amendment.get_response_state_display().lower()}",
            body=amendment.response_note,
            actor=actor,
            actor_role="contractor" if is_contractor else "homeowner",
            recipient_role="homeowner" if is_contractor else "contractor",
            delivered=True,
            responded=True,
            resolved=amendment.response_state in {AmendmentRequest.ResponseState.ACCEPTED, AmendmentRequest.ResponseState.REJECTED},
            metadata={
                "response_state": amendment.response_state,
                "attachment_count": len(attachment_metadata),
                "attachments": attachment_metadata,
            },
        )
        return Response(
            {
                "ok": True,
                "amendment_request": {
                    "id": amendment.id,
                    "status": amendment.status,
                    "status_label": amendment.get_status_display(),
                    "response_state": amendment.response_state,
                    "response_label": amendment.get_response_state_display(),
                },
            },
            status=status.HTTP_200_OK,
        )


class ContractorAmendmentApplyView(APIView):
    """Convert an accepted change request into an editable agreement amendment."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, request_id: int):
        amendment = get_object_or_404(
            AmendmentRequest.objects.select_for_update().select_related("agreement", "agreement__contractor", "agreement__project"),
            id=request_id,
        )
        agreement = amendment.agreement
        contractor = get_contractor_for_user(request.user)
        if not contractor or getattr(agreement, "contractor_id", None) != contractor.id:
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        if amendment.response_state != AmendmentRequest.ResponseState.ACCEPTED:
            return Response(
                {"detail": "The customer must accept this change request before it can become an amendment."},
                status=status.HTTP_409_CONFLICT,
            )

        requested_changes = dict(amendment.requested_changes or {})
        applied_milestone_id = requested_changes.get("applied_milestone_id")
        if applied_milestone_id:
            milestone = Milestone.objects.filter(id=applied_milestone_id, agreement=agreement).first()
            return Response(
                {
                    "ok": True,
                    "already_applied": True,
                    "agreement_id": agreement.id,
                    "milestone_id": getattr(milestone, "id", None),
                    "amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
                    "next_url": f"/app/agreements/{agreement.id}/wizard?step=2",
                },
                status=status.HTTP_200_OK,
            )

        milestone_draft = requested_changes.get("milestone_draft") or {}
        title = str(milestone_draft.get("title") or "").strip()
        scope = str(milestone_draft.get("scope") or requested_changes.get("requested_change") or "").strip()
        completion_criteria = str(milestone_draft.get("completion_criteria") or "").strip()
        raw_amount = requested_changes.get("proposed_value_change")
        try:
            amount = Decimal(str(raw_amount or "0")).quantize(Decimal("0.01"))
        except Exception:
            amount = Decimal("0.00")
        if not title or not scope:
            return Response(
                {"detail": "Add a proposed milestone title and scope before preparing the amendment."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if amount <= 0:
            return Response(
                {"detail": "Add a positive price adjustment before preparing this added-work milestone."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_amendment_number = int(getattr(agreement, "amendment_number", 0) or 0)
        mark_agreement_amended(
            agreement,
            actor=request.user,
            reason=f"accepted-change-request-{amendment.id}",
        )
        agreement.amendment_number = current_amendment_number + 1
        agreement.status = "draft"
        if hasattr(agreement, "escrow_funded"):
            agreement.escrow_funded = False
        if hasattr(agreement, "amended_at"):
            agreement.amended_at = timezone.now()
        if hasattr(agreement, "last_amend_reason"):
            agreement.last_amend_reason = f"accepted-change-request-{amendment.id}"
        agreement.save()

        milestones = list(Milestone.objects.select_for_update().filter(agreement=agreement).order_by("order", "id"))
        next_unfinished = next((row for row in milestones if not row.completed), None)
        insert_order = next_unfinished.order if next_unfinished else ((milestones[-1].order + 1) if milestones else 1)
        for row in sorted((row for row in milestones if row.order >= insert_order), key=lambda item: item.order, reverse=True):
            row.order += 1
            row.save(update_fields=["order"])

        description = scope
        if completion_criteria:
            description = f"{scope}\n\nCompletion criteria: {completion_criteria}"
        milestone = Milestone.objects.create(
            agreement=agreement,
            order=insert_order,
            title=title,
            description=description,
            amount=amount,
            amendment_number_snapshot=agreement.amendment_number,
        )
        agreement.total_cost = Milestone.objects.filter(agreement=agreement).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
        agreement.save(update_fields=["total_cost", "updated_at"])
        refresh_agreement_fee_allocations(agreement)

        requested_changes.update(
            {
                "applied_milestone_id": milestone.id,
                "applied_amendment_number": agreement.amendment_number,
                "applied_at": timezone.now().isoformat(),
                "applied_by_user_id": request.user.id,
            }
        )
        amendment.requested_changes = requested_changes
        amendment.save(update_fields=["requested_changes", "updated_at"])
        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_resolved",
            object_type="amendment_request",
            object_id=amendment.id,
            title="Accepted change added to amendment draft",
            body=f"Milestone {insert_order}: {title} was added for ${amount:.2f} and requires amended signatures before funding.",
            actor=request.user,
            actor_role="contractor",
            recipient_role="homeowner",
            delivered=True,
            resolved=False,
            metadata={"milestone_id": milestone.id, "amendment_number": agreement.amendment_number},
        )
        return Response(
            {
                "ok": True,
                "already_applied": False,
                "agreement_id": agreement.id,
                "milestone_id": milestone.id,
                "milestone_order": milestone.order,
                "amendment_number": agreement.amendment_number,
                "additional_escrow_required": f"{amount:.2f}",
                "next_url": f"/app/agreements/{agreement.id}/wizard?step=2",
            },
            status=status.HTTP_201_CREATED,
        )


class AmendmentRequestViewedView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id: int):
        amendment = get_object_or_404(
            AmendmentRequest.objects.select_related("agreement", "agreement__contractor"),
            id=request_id,
        )
        agreement = amendment.agreement
        contractor = get_contractor_for_user(request.user)
        is_contractor = bool(contractor and getattr(agreement, "contractor_id", None) == contractor.id)
        homeowner_email = (getattr(getattr(agreement, "homeowner", None), "email", "") or "").lower()
        is_homeowner = bool(getattr(request.user, "email", "").lower() == homeowner_email)
        if not (is_contractor or is_homeowner or request.user.is_staff):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        viewer_role = "contractor" if is_contractor else "homeowner"
        marked = mark_activity_viewed(
            object_type="amendment_request",
            object_id=amendment.id,
            viewer=request.user,
            viewer_role=viewer_role,
        )
        exists = ProjectActivityEvent.objects.filter(
            object_type="amendment_request",
            object_id=str(amendment.id),
            event_type=ProjectActivityEvent.EventType.AMENDMENT_VIEWED,
            actor_role=viewer_role,
        ).exists()
        if not exists:
            create_project_activity_event(
                agreement=agreement,
                event_type=ProjectActivityEvent.EventType.AMENDMENT_VIEWED,
                object_type="amendment_request",
                object_id=amendment.id,
                title="Amendment viewed",
                body="The amendment request was opened for review.",
                actor=request.user,
                actor_role=viewer_role,
                recipient_role="homeowner" if is_contractor else "contractor",
                delivered=True,
                metadata={"change_type": amendment.change_type, "marked_existing_events": marked},
            )
        return Response({"ok": True, "viewed": True, "marked": marked}, status=status.HTTP_200_OK)
