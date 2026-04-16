from __future__ import annotations

import hashlib
from decimal import Decimal

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from receipts.models import Receipt
from projects.models import (
    Agreement,
    DrawRequest,
    ExternalPaymentRecord,
    Homeowner,
    Invoice,
    PublicContractorLead,
)
from projects.models_attachments import AgreementAttachment
from projects.models_project_intake import ProjectIntake
from projects.serializers.base import AgreementDetailPublicSerializer
from projects.services.bid_workflow import (
    bid_next_action,
    bid_status_label,
    bid_status_group,
    format_money,
    infer_project_class,
    normalize_bid_status,
    parse_money_like_text,
    project_class_label,
    promote_public_lead_to_agreement,
)
from projects.services.bid_notifications import create_bid_outcome_notifications

PORTAL_TOKEN_SALT = "myhomebro.customer-portal"
PORTAL_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14


def _safe_text(value) -> str:
    return ("" if value is None else str(value)).strip()


def _safe_dt(value):
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _comparison_key(*parts) -> str:
    text = "|".join(_safe_text(part).lower() for part in parts if _safe_text(part))
    return hashlib.sha1(text.encode("utf-8")).hexdigest() if text else ""


def _request_identity_from_intake(intake) -> tuple[str, str, str]:
    linked_agreement = getattr(intake, "agreement", None)
    agreement_project = getattr(linked_agreement, "project", None)
    project_title = (
        _safe_text(getattr(intake, "ai_project_title", ""))
        or _safe_text(getattr(intake, "accomplishment_text", ""))
        or _safe_text(getattr(agreement_project, "title", None))
        or f"Request #{getattr(intake, 'id', '')}"
    )
    request_address = ", ".join(
        part
        for part in [
            _safe_text(getattr(intake, "project_address_line1", "")),
            _safe_text(getattr(intake, "project_address_line2", "")),
            _safe_text(getattr(intake, "project_city", "")),
            _safe_text(getattr(intake, "project_state", "")),
            _safe_text(getattr(intake, "project_postal_code", "")),
        ]
        if part
    )
    project_class = _safe_text(getattr(intake, "project_class", "")) or infer_project_class(
        getattr(intake, "customer_name", ""),
        getattr(intake, "accomplishment_text", ""),
    )
    return project_title, request_address, project_class


def _request_identity_from_lead(lead) -> tuple[str, str, str]:
    source_intake = getattr(lead, "source_intake", None)
    analysis = getattr(lead, "ai_analysis", None) or {}
    request_title = ""
    if source_intake is not None:
        source_agreement = getattr(source_intake, "agreement", None)
        source_project = getattr(source_agreement, "project", None)
        request_title = _safe_text(getattr(source_project, "title", ""))
        if not request_title:
            request_title = _safe_text(getattr(source_intake, "ai_project_title", ""))
    if not request_title:
        request_title = (
            _safe_text(analysis.get("suggested_title"))
            or _safe_text(getattr(lead, "project_type", ""))
            or _safe_text(getattr(lead, "project_description", ""))
            or f"Bid #{getattr(lead, 'id', '')}"
        )
    request_address = ", ".join(
        part
        for part in [
            _safe_text(getattr(source_intake, "project_address_line1", "")) if source_intake else _safe_text(getattr(lead, "project_address", "")),
            _safe_text(getattr(source_intake, "project_address_line2", "")) if source_intake else "",
            _safe_text(getattr(source_intake, "project_city", "")) if source_intake else _safe_text(getattr(lead, "city", "")),
            _safe_text(getattr(source_intake, "project_state", "")) if source_intake else _safe_text(getattr(lead, "state", "")),
            _safe_text(getattr(source_intake, "project_postal_code", "")) if source_intake else _safe_text(getattr(lead, "zip_code", "")),
        ]
        if part
    )
    project_class = _safe_text(getattr(getattr(lead, "converted_agreement", None), "project_class", "")) or infer_project_class(
        getattr(lead, "project_type", ""),
        getattr(lead, "project_description", ""),
        getattr(lead, "preferred_timeline", ""),
        getattr(lead, "budget_text", ""),
    )
    return request_title, request_address, project_class


def _customer_bid_status_label(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "expired":
        return "Not Selected"
    return bid_status_label(normalized)


def _customer_bid_status_note(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "expired":
        return "Another contractor was selected for this project."
    if normalized == "declined":
        return "This bid was declined."
    return ""


def _portal_frontend_base() -> str:
    base = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "") or getattr(settings, "FRONTEND_URL", "")
    return str(base or "").rstrip("/")


def _portal_url(token: str) -> str:
    base = _portal_frontend_base() or ""
    return f"{base}/portal/{token}" if base else f"/portal/{token}"


def _portal_token(email: str) -> str:
    return signing.dumps({"email": email.lower().strip()}, salt=PORTAL_TOKEN_SALT)


def _unsign_portal_token(token: str) -> str:
    data = signing.loads(token, salt=PORTAL_TOKEN_SALT, max_age=PORTAL_TOKEN_MAX_AGE_SECONDS)
    email = _safe_text(data.get("email")).lower()
    if not email:
        raise signing.BadSignature("Missing email.")
    return email


def _agreement_customer_email(agreement) -> str:
    homeowner = getattr(agreement, "homeowner", None)
    if homeowner and getattr(homeowner, "email", None):
        return _safe_text(homeowner.email).lower()
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project else None
    if project_homeowner and getattr(project_homeowner, "email", None):
        return _safe_text(project_homeowner.email).lower()
    return ""


def _agreement_title(agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", None))
        or _safe_text(getattr(agreement, "title", None))
        or _safe_text(getattr(agreement, "project_title", None))
        or f"Agreement #{getattr(agreement, 'id', '')}"
    )


def _contractor_name(contractor) -> str:
    if not contractor:
        return "Your contractor"
    return (
        _safe_text(getattr(contractor, "business_name", None))
        or _safe_text(getattr(contractor, "name", None))
        or _safe_text(getattr(getattr(contractor, "user", None), "get_full_name", lambda: "")())
        or _safe_text(getattr(contractor, "email", None))
        or "Your contractor"
    )


def _agreement_public_data(agreement, request=None) -> dict:
    data = AgreementDetailPublicSerializer(agreement, context={"request": request}).data
    project = getattr(agreement, "project", None)
    contractor = getattr(agreement, "contractor", None)
    homeowner = getattr(agreement, "homeowner", None)
    data.update(
        {
            "agreement_token": str(getattr(agreement, "homeowner_access_token", "") or ""),
            "project_title": _agreement_title(agreement),
            "contractor_name": _contractor_name(contractor),
            "homeowner_name": _safe_text(getattr(homeowner, "full_name", None))
            or _safe_text(getattr(homeowner, "company_name", None))
            or _safe_text(getattr(homeowner, "email", None))
            or "Customer",
            "project_class": _safe_text(getattr(agreement, "project_class", "")),
            "project_class_label": project_class_label(getattr(agreement, "project_class", "")),
            "pdf_url": (
                f"/api/projects/agreements/access/{agreement.homeowner_access_token}/pdf/"
                if getattr(agreement, "homeowner_access_token", None)
                else ""
            ),
            "details_url": (
                f"/agreements/magic/{agreement.homeowner_access_token}"
                if getattr(agreement, "homeowner_access_token", None)
                else ""
            ),
            "project_number": _safe_text(getattr(project, "number", "")),
            "is_fully_signed": bool(
                getattr(agreement, "signed_by_contractor", False)
                and getattr(agreement, "signed_by_homeowner", False)
            ),
        }
    )
    return data


def _agreement_pdf_url(agreement) -> str:
    token = getattr(agreement, "homeowner_access_token", None)
    if not token:
        return ""
    return f"/api/projects/agreements/access/{token}/pdf/"


def _request_has_records(email: str) -> bool:
    email = email.lower().strip()
    return any(
        [
            Homeowner.objects.filter(email__iexact=email).exists(),
            ProjectIntake.objects.filter(customer_email__iexact=email).exists(),
            PublicContractorLead.objects.filter(email__iexact=email).exists(),
            Agreement.objects.filter(Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)).exists(),
            Invoice.objects.filter(Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)).exists(),
            DrawRequest.objects.filter(Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)).exists(),
        ]
    )


def _request_rows(email: str, *, bid_rows: list[dict] | None = None) -> list[dict]:
    rows = []
    bid_counts: dict[str, int] = {}
    agreement_by_key: dict[str, dict[str, str | int]] = {}
    if bid_rows:
        for row in bid_rows:
            key = _safe_text(row.get("comparison_key", ""))
            if not key:
                continue
            bid_counts[key] = bid_counts.get(key, 0) + 1
            if key not in agreement_by_key and row.get("linked_agreement_id"):
                agreement_by_key[key] = {
                    "agreement_id": row.get("linked_agreement_id"),
                    "agreement_token": _safe_text(row.get("linked_agreement_token", "")),
                }

    leads = list(
        PublicContractorLead.objects.select_related(
            "contractor",
            "public_profile",
            "source_intake",
            "source_intake__agreement",
        ).filter(
            Q(email__iexact=email) | Q(source_intake__customer_email__iexact=email)
        ).order_by("-created_at", "-id")
    )
    intakes = list(
        ProjectIntake.objects.select_related("agreement", "public_lead", "contractor").filter(
            customer_email__iexact=email
        ).order_by("-created_at", "-id")
    )

    for intake in intakes:
        request_status = _safe_text(getattr(intake, "status", "")).lower()
        linked_agreement = getattr(intake, "agreement", None)
        project_title, request_address, project_class = _request_identity_from_intake(intake)
        comparison_key = _comparison_key(email, request_address, project_class)
        comparison_agreement = agreement_by_key.get(comparison_key, {})
        latest_activity = (
            getattr(intake, "converted_at", None)
            or getattr(intake, "analyzed_at", None)
            or getattr(intake, "submitted_at", None)
            or getattr(intake, "updated_at", None)
            or getattr(intake, "created_at", None)
        )
        related_bids = sum(1 for lead in leads if getattr(getattr(lead, "source_intake", None), "id", None) == intake.id)
        rows.append(
            {
                "id": f"intake-{intake.id}",
                "request_id": intake.id,
                "project_title": project_title,
                "project_address": request_address,
                "project_class": project_class,
                "project_class_label": project_class_label(project_class),
                "comparison_key": comparison_key,
                "status": request_status,
                "status_label": (
                    "Converted"
                    if request_status == "converted"
                    else "Submitted"
                    if request_status == "submitted"
                    else "Draft"
                    if request_status == "draft"
                    else "Analyzed"
                    if request_status == "analyzed"
                    else "In Progress"
                ),
                "latest_activity": _safe_dt(latest_activity),
                "latest_activity_label": (
                    "Converted"
                    if request_status == "converted"
                    else "Submitted"
                    if request_status == "submitted"
                    else "Analyzed"
                    if request_status == "analyzed"
                    else "Updated"
                ),
                "bids_count": bid_counts.get(comparison_key, related_bids),
                "agreement_id": getattr(linked_agreement, "id", None) or comparison_agreement.get("agreement_id"),
                "agreement_token": str(getattr(linked_agreement, "homeowner_access_token", "") or "")
                or _safe_text(comparison_agreement.get("agreement_token", "")),
                "action_label": (
                    "Open Agreement"
                    if linked_agreement or comparison_agreement.get("agreement_token")
                    else "Compare bids"
                    if bid_counts.get(comparison_key, related_bids) > 1
                    else "View Request"
                ),
                "action_target": (
                    f"/agreements/magic/{getattr(linked_agreement, 'homeowner_access_token', '') or _safe_text(comparison_agreement.get('agreement_token', ''))}"
                    if linked_agreement or comparison_agreement.get("agreement_token")
                    else ""
                ),
                "notes": _safe_text(getattr(intake, "accomplishment_text", "")),
            }
        )

    rows.sort(key=lambda row: row.get("latest_activity") or "", reverse=True)
    return rows


def _bid_rows(email: str) -> list[dict]:
    rows = []
    leads = list(
        PublicContractorLead.objects.select_related(
            "contractor",
            "public_profile",
            "converted_agreement",
            "source_intake",
            "source_intake__agreement",
        ).filter(
            Q(email__iexact=email) | Q(source_intake__customer_email__iexact=email)
        ).order_by("-created_at", "-id")
    )
    seen = set()
    for lead in leads:
        linked_agreement = getattr(lead, "converted_agreement", None)
        source_intake = getattr(lead, "source_intake", None)
        key = ("lead", lead.id)
        if key in seen:
            continue
        seen.add(key)
        status = normalize_bid_status(
            raw_status=getattr(lead, "status", ""),
            has_agreement=bool(getattr(linked_agreement, "id", None)),
            record_kind="lead",
        )
        analysis = getattr(lead, "ai_analysis", None) or {}
        request_title, request_address, request_project_class = _request_identity_from_lead(lead)
        comparison_key = _comparison_key(email, request_address, request_project_class)
        bid_amount = (
            getattr(linked_agreement, "total_cost", None)
            or parse_money_like_text(getattr(lead, "budget_text", ""))
            or parse_money_like_text(analysis.get("suggested_total_price"))
        )
        submitted_at = getattr(lead, "accepted_at", None) or getattr(lead, "converted_at", None) or getattr(lead, "created_at", None)
        contractor = getattr(lead, "contractor", None)
        rows.append(
            {
                "id": f"lead-{lead.id}",
                "bid_id": lead.id,
                "source_kind": "lead",
                "source_kind_label": "Lead",
                "source_id": lead.id,
                "source_reference": f"Lead #{lead.id}",
                "project_title": request_title,
                "project_address": request_address,
                "contractor_name": _contractor_name(contractor),
                "project_class": _safe_text(getattr(linked_agreement, "project_class", "")) or infer_project_class(
                    getattr(lead, "project_type", ""),
                    getattr(lead, "project_description", ""),
                    getattr(lead, "preferred_timeline", ""),
                    getattr(lead, "budget_text", ""),
                ),
                "project_class_label": project_class_label(
                    request_project_class
                ),
                "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
                "bid_amount_label": f"${bid_amount:,.2f}" if bid_amount is not None else "—",
                "submitted_at": _safe_dt(submitted_at),
                "status": status,
                "status_label": _customer_bid_status_label(status),
                "status_group": bid_status_group(status),
                "status_note": _customer_bid_status_note(status),
                "linked_agreement_id": getattr(linked_agreement, "id", None),
                "linked_agreement_token": str(getattr(linked_agreement, "homeowner_access_token", "") or ""),
                "comparison_key": comparison_key,
                "request_title": request_title,
                "request_address": request_address,
                "proposal_summary": _safe_text(analysis.get("suggested_description"))
                or _safe_text(getattr(lead, "project_description", "")),
                "timeline": _safe_text(getattr(lead, "preferred_timeline", "")),
                "payment_structure_summary": (
                    "Agreement ready"
                    if getattr(linked_agreement, "id", None)
                    else "Bid summary"
                ),
                "milestone_preview": [
                    _safe_text(row.get("title") or row.get("name"))
                    for row in (analysis.get("milestones") or [])[:3]
                    if isinstance(row, dict) and _safe_text(row.get("title") or row.get("name"))
                ],
                "next_action": bid_next_action(
                    status=status,
                    linked_agreement_id=getattr(linked_agreement, "id", None),
                    source_kind="lead",
                ),
                "notes": _safe_text(getattr(lead, "project_description", "")),
                "can_accept": not bool(getattr(linked_agreement, "id", None)) and status not in {"awarded", "expired", "declined"},
                "is_awarded": status == "awarded",
            }
        )

    rows.sort(key=lambda row: row.get("submitted_at") or "", reverse=True)
    return rows


def _agreements(email: str, request=None) -> list[dict]:
    agreements = list(
        Agreement.objects.select_related("project", "contractor", "homeowner").filter(
            Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)
        ).order_by("-updated_at", "-id")
    )
    rows = []
    for agreement in agreements:
        contractor = getattr(agreement, "contractor", None)
        homeowner = getattr(agreement, "homeowner", None)
        rows.append(
            {
                "id": agreement.id,
                "project_title": _agreement_title(agreement),
                "contractor_name": _contractor_name(contractor),
                "homeowner_name": _safe_text(getattr(homeowner, "full_name", "")) or "Customer",
                "project_class": _safe_text(getattr(agreement, "project_class", "")),
                "project_class_label": project_class_label(getattr(agreement, "project_class", "")),
                "status": _safe_text(getattr(agreement, "status", "draft")).lower(),
                "status_label": _safe_text(getattr(agreement, "status", "draft")).replace("_", " ").title(),
                "is_fully_signed": bool(
                    getattr(agreement, "signed_by_contractor", False)
                    and getattr(agreement, "signed_by_homeowner", False)
                ),
                "signed_by_contractor": bool(getattr(agreement, "signed_by_contractor", False)),
                "signed_by_homeowner": bool(getattr(agreement, "signed_by_homeowner", False)),
                "agreement_token": str(getattr(agreement, "homeowner_access_token", "") or ""),
                "action_label": "View Agreement",
                "action_target": f"/agreements/magic/{agreement.homeowner_access_token}",
                "pdf_url": _agreement_pdf_url(agreement),
                "updated_at": _safe_dt(getattr(agreement, "updated_at", None) or getattr(agreement, "created_at", None)),
                "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
                "total_cost": _safe_text(getattr(agreement, "total_cost", "")),
            }
        )
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return rows


def _payments(email: str, request=None) -> list[dict]:
    rows = []
    invoices = list(
        Invoice.objects.select_related("agreement", "agreement__project", "agreement__homeowner").prefetch_related("receipt").filter(
            Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)
        ).order_by("-created_at", "-id")
    )
    draws = list(
        DrawRequest.objects.select_related("agreement", "agreement__project", "agreement__homeowner").prefetch_related("external_payment_records").filter(
            Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)
        ).order_by("-created_at", "-id")
    )

    for invoice in invoices:
        agreement = getattr(invoice, "agreement", None)
        status_text = (
            "Paid"
            if getattr(invoice, "escrow_released", False) or getattr(invoice, "direct_pay_paid_at", None) or str(getattr(invoice, "status", "")).lower() == "paid"
            else _safe_text(getattr(invoice, "status", "")).replace("_", " ").title() or "Pending"
        )
        receipt = getattr(invoice, "receipt", None)
        rows.append(
            {
                "id": f"invoice-{invoice.id}",
                "record_type": "invoice",
                "record_type_label": "Invoice",
                "project_title": _agreement_title(agreement),
                "amount": _safe_text(getattr(invoice, "amount", "")),
                "amount_label": f"${Decimal(str(getattr(invoice, 'amount', 0) or 0)):.2f}",
                "status": _safe_text(getattr(invoice, "status", "")).lower(),
                "status_label": status_text,
                "date": _safe_dt(
                    getattr(invoice, "escrow_released_at", None)
                    or getattr(invoice, "direct_pay_paid_at", None)
                    or getattr(invoice, "approved_at", None)
                    or getattr(invoice, "created_at", None)
                ),
                "reference": _safe_text(getattr(invoice, "invoice_number", "")),
                "agreement_id": getattr(agreement, "id", None),
                "action_target": f"/invoice/{invoice.public_token}",
                "receipt_url": _safe_text(getattr(getattr(receipt, "pdf_file", None), "url", "")),
                "notes": "Escrow release" if getattr(invoice, "escrow_released", False) else "Direct pay" if getattr(invoice, "direct_pay_paid_at", None) else "",
            }
        )

    for draw in draws:
        agreement = getattr(draw, "agreement", None)
        status_text = (
            "Paid"
            if getattr(draw, "paid_at", None) or getattr(draw, "status", "") in {"paid", "released"}
            else _safe_text(getattr(draw, "status", "")).replace("_", " ").title() or "Pending"
        )
        external_payment = None
        try:
            external_payment = draw.external_payment_records.filter(status="verified").first()
        except Exception:
            external_payment = None
        rows.append(
            {
                "id": f"draw-{draw.id}",
                "record_type": "draw_request",
                "record_type_label": "Draw",
                "project_title": _agreement_title(agreement),
                "amount": _safe_text(getattr(draw, "net_amount", "")),
                "amount_label": f"${Decimal(str(getattr(draw, 'net_amount', 0) or 0)):.2f}",
                "status": _safe_text(getattr(draw, "status", "")).lower(),
                "status_label": status_text,
                "date": _safe_dt(getattr(draw, "paid_at", None) or getattr(draw, "released_at", None) or getattr(draw, "created_at", None)),
                "reference": _safe_text(getattr(draw, "stripe_transfer_id", "")) or _safe_text(getattr(external_payment, "reference_number", "")),
                "agreement_id": getattr(agreement, "id", None),
                "action_target": f"/draws/magic/{draw.public_token}",
                "receipt_url": _safe_text(getattr(getattr(external_payment, "proof_file", None), "url", "")),
                "notes": "Released draw" if getattr(draw, "released_at", None) else "",
            }
        )

    rows.sort(key=lambda row: row.get("date") or "", reverse=True)
    return rows


def _documents(email: str, request=None) -> list[dict]:
    rows = []
    agreements = Agreement.objects.select_related("project", "contractor", "homeowner").filter(
        Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)
    )
    for agreement in agreements:
        agreement_title = _agreement_title(agreement)
        if getattr(agreement, "pdf_file", None) and getattr(agreement.pdf_file, "name", ""):
            rows.append(
                {
                    "id": f"agreement-pdf-{agreement.id}",
                    "title": f"{agreement_title} agreement PDF",
                    "type_label": "Agreement PDF",
                    "project_title": agreement_title,
                    "date": _safe_dt(getattr(agreement, "updated_at", None) or getattr(agreement, "created_at", None)),
                    "url": _safe_text(getattr(agreement.pdf_file, "url", "")),
                    "agreement_id": agreement.id,
                }
            )

        attachments = AgreementAttachment.objects.select_related("agreement").filter(
            agreement=agreement,
            visible_to_homeowner=True,
        ).order_by("-uploaded_at", "-id")
        for attachment in attachments:
            rows.append(
                {
                    "id": f"attachment-{attachment.id}",
                    "title": _safe_text(getattr(attachment, "title", "")) or "Attachment",
                    "type_label": _safe_text(getattr(attachment, "category", "")) or "Attachment",
                    "project_title": agreement_title,
                    "date": _safe_dt(getattr(attachment, "uploaded_at", None)),
                    "url": _safe_text(getattr(getattr(attachment, "file", None), "url", "")),
                    "agreement_id": agreement.id,
                }
            )

    invoices = Invoice.objects.select_related("agreement", "agreement__project", "agreement__homeowner").filter(
        Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)
    )
    for invoice in invoices:
        if getattr(invoice, "pdf_file", None) and getattr(invoice.pdf_file, "name", ""):
            rows.append(
                {
                    "id": f"invoice-pdf-{invoice.id}",
                    "title": f"Invoice {invoice.invoice_number} PDF",
                    "type_label": "Invoice PDF",
                    "project_title": _agreement_title(invoice.agreement),
                    "date": _safe_dt(getattr(invoice, "created_at", None)),
                    "url": _safe_text(getattr(invoice.pdf_file, "url", "")),
                    "agreement_id": getattr(invoice.agreement, "id", None),
                }
            )
        receipt = getattr(invoice, "receipt", None)
        if receipt and getattr(receipt, "pdf_file", None) and getattr(receipt.pdf_file, "name", ""):
            rows.append(
                {
                    "id": f"receipt-pdf-{receipt.id}",
                    "title": f"Receipt {getattr(receipt, 'receipt_number', receipt.id)} PDF",
                    "type_label": "Receipt PDF",
                    "project_title": _agreement_title(invoice.agreement),
                    "date": _safe_dt(getattr(receipt, "created_at", None)),
                    "url": _safe_text(getattr(receipt.pdf_file, "url", "")),
                    "agreement_id": getattr(invoice.agreement, "id", None),
                }
            )

    rows.sort(key=lambda row: row.get("date") or "", reverse=True)
    deduped = []
    seen = set()
    for row in rows:
        key = (row.get("title"), row.get("url"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _customer_name(email: str) -> str:
    homeowner = (
        Homeowner.objects.filter(email__iexact=email)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    if homeowner:
        return _safe_text(getattr(homeowner, "company_name", "")) or _safe_text(getattr(homeowner, "full_name", "")) or email
    request_row = (
        ProjectIntake.objects.filter(customer_email__iexact=email)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    if request_row:
        return _safe_text(getattr(request_row, "customer_name", "")) or email
    lead = PublicContractorLead.objects.filter(email__iexact=email).order_by("-updated_at", "-created_at").first()
    if lead:
        return _safe_text(getattr(lead, "full_name", "")) or email
    return email


def _build_customer_portal_payload(email: str, request=None) -> dict:
    bid_rows = _bid_rows(email)
    request_rows = _request_rows(email, bid_rows=bid_rows)
    agreement_rows = _agreements(email, request=request)
    payment_rows = _payments(email, request=request)
    document_rows = _documents(email, request=request)

    summary = {
        "active_requests": sum(1 for row in request_rows if row.get("status") not in {"converted", "archived"}),
        "bids_received": len(bid_rows),
        "active_agreements": sum(1 for row in agreement_rows if row.get("status") not in {"archived", "cancelled"}),
        "payments": len(payment_rows),
        "documents": len(document_rows),
    }

    return {
        "customer": {
            "name": _customer_name(email),
            "email": email,
        },
        "summary": summary,
        "requests": request_rows,
        "bids": bid_rows,
        "agreements": agreement_rows,
        "payments": payment_rows,
        "documents": document_rows,
    }


def _find_customer_bid_record(*, email: str, bid_key: str):
    key = _safe_text(bid_key)
    if not key:
        raise signing.BadSignature("Missing bid key.")

    if "-" not in key:
        raise signing.BadSignature("Invalid bid key.")

    prefix, raw_id = key.split("-", 1)
    try:
        record_id = int(raw_id)
    except Exception as exc:
        raise signing.BadSignature("Invalid bid key.") from exc

    if prefix == "lead":
        return get_object_or_404(
            PublicContractorLead.objects.select_related(
                "contractor",
                "public_profile",
                "converted_agreement",
                "source_intake",
                "source_intake__agreement",
            ),
            pk=record_id,
        )

    raise signing.BadSignature("Invalid bid key.")


class CustomerPortalRequestLinkSerializer(serializers.Serializer):
    email = serializers.EmailField()


class CustomerPortalRequestLinkView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = CustomerPortalRequestLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].lower().strip()
        link_sent = False

        if _request_has_records(email):
            token = _portal_token(email)
            link = _portal_url(token)
            subject = "Your MyHomeBro Records link"
            text_body = (
                f"Hello,\n\n"
                f"Your secure MyHomeBro records portal is ready:\n{link}\n\n"
                "This link lets you review your requests, bids, agreements, payments, and documents.\n"
                "If you did not request this link, you can ignore this email.\n\n"
                "— MyHomeBro"
            )
            html_body = (
                f"<p>Hello,</p>"
                f"<p>Your secure MyHomeBro records portal is ready:</p>"
                f"<p><a href=\"{link}\">{link}</a></p>"
                "<p>This link lets you review your requests, bids, agreements, payments, and documents.</p>"
                "<p>If you did not request this link, you can ignore this email.</p>"
                "<p>— MyHomeBro</p>"
            )
            send_mail(
                subject,
                text_body,
                getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com"),
                [email],
                html_message=html_body,
                fail_silently=False,
            )
            link_sent = True

        return Response(
            {
                "ok": True,
                "detail": "If we found records for that email, we sent a secure portal link.",
                "link_sent": link_sent,
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalBidAcceptView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, bid_key: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        lead = _find_customer_bid_record(email=email, bid_key=bid_key)
        source_intake = getattr(lead, "source_intake", None)
        if _safe_text(getattr(lead, "email", "")).lower() != email and _safe_text(getattr(source_intake, "customer_email", "")).lower() != email:
            return Response({"detail": "You can only choose bids for your own request."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            homeowner = getattr(lead, "converted_homeowner", None)
            agreement, created = promote_public_lead_to_agreement(lead=lead, homeowner=homeowner)
            _, accepted_address, accepted_class = _request_identity_from_lead(lead)

            accepted_key = _comparison_key(email, accepted_address, accepted_class)
            competing_bids = list(
                PublicContractorLead.objects.select_related("source_intake", "converted_agreement").filter(
                    Q(email__iexact=email) | Q(source_intake__customer_email__iexact=email)
                ).exclude(pk=lead.pk)
            )
            competing_group = []
            for competitor in competing_bids:
                _, competitor_address, competitor_class = _request_identity_from_lead(competitor)
                competitor_key = _comparison_key(email, competitor_address, competitor_class)
                if competitor_key != accepted_key:
                    continue
                if competitor.status not in {PublicContractorLead.STATUS_ACCEPTED, PublicContractorLead.STATUS_REJECTED}:
                    competitor.status = PublicContractorLead.STATUS_CLOSED
                    competitor.save(update_fields=["status", "updated_at"])
                competing_group.append(competitor)

            create_bid_outcome_notifications(
                accepted_lead=lead,
                agreement=agreement,
                competing_leads=competing_group,
            )

        return Response(
            {
                "ok": True,
                "created": created,
                "agreement_id": getattr(agreement, "id", None),
                "project_id": getattr(getattr(agreement, "project", None), "id", None),
                "detail_url": f"/agreements/magic/{agreement.homeowner_access_token}",
                "wizard_url": f"/app/agreements/{agreement.id}/wizard?step=1",
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class AgreementMagicAccessView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        agreement = get_object_or_404(
            Agreement.objects.select_related("project", "contractor", "homeowner"),
            homeowner_access_token=token,
        )
        return Response(_agreement_public_data(agreement, request=request), status=status.HTTP_200_OK)


class AgreementMagicPdfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        agreement = get_object_or_404(
            Agreement.objects.select_related("project", "contractor", "homeowner"),
            homeowner_access_token=token,
        )
        pdf_file = getattr(agreement, "pdf_file", None)
        if not pdf_file or not getattr(pdf_file, "name", ""):
            return Response({"detail": "PDF not available."}, status=status.HTTP_404_NOT_FOUND)
        try:
            pdf_path = getattr(pdf_file, "path", None)
            if pdf_path:
                from projects.services.http_range import ranged_file_response

                return ranged_file_response(
                    request,
                    pdf_path,
                    content_type="application/pdf",
                    filename=f"agreement_{agreement.id}.pdf",
                    inline=True,
                )
            from django.http import FileResponse

            return FileResponse(pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
            return Response({"detail": "PDF not available."}, status=status.HTTP_404_NOT_FOUND)
