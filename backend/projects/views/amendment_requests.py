from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Milestone
from projects.models_amendment_request import AmendmentRequest, AmendmentRequestAttachment, apply_descoped_milestone_hold
from projects.models_project_activity import ProjectActivityEvent
from projects.services.project_activity import create_project_activity_event, mark_activity_viewed
from projects.utils.accounts import get_contractor_for_user


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


class ContractorAgreementAmendmentRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        agreement = _contractor_agreement_for_user(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = ContractorAgreementAmendmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
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
            metadata={"change_type": change_type},
        )
        return Response(
            {
                "ok": True,
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
        amendment.mark_responded(
            response_state=response_state,
            actor=request.user,
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
                uploaded_by=request.user,
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
            actor=request.user,
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
