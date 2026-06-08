from __future__ import annotations

import hashlib
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from receipts.models import Receipt
from projects.models import (
    Agreement,
    AgreementFundingLink,
    Contractor,
    DrawRequest,
    DrawRequestStatus,
    ExpenseRequest,
    ExternalPaymentRecord,
    Homeowner,
    Invoice,
    Milestone,
    MilestoneComment,
    Notification,
    Project,
    PublicContractorLead,
)
from projects.models_attachments import AgreementAttachment
from projects.models_customer_portal import CustomerRequest, PropertyDocument, PropertyPhoto, PropertyProfile, SmartNotification, SmartNotificationEvent
from projects.models_contractor_discovery import ContractorDiscoveryInvite, ContractorOpportunity
from projects.models_dispute import Dispute
from projects.models_maintenance import MaintenanceWorkOrder
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
from projects.services.escrow_reimbursements import approve_reimbursement, deny_reimbursement, escrow_ledger, serialize_ledger
from projects.services.smart_notifications import create_smart_notification
from projects.services.maintenance_work_orders import customer_visible_work_order_queryset
from projects.services.marketplace_permissions import contractor_marketplace_action_block_reason
from projects.services.workflow_notifications import notify_dispute_event

PORTAL_TOKEN_SALT = "myhomebro.customer-portal"
PORTAL_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14
User = get_user_model()


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
    if source_intake is None and analysis.get("source_intake_id"):
        source_intake = ProjectIntake.objects.filter(pk=analysis.get("source_intake_id")).first()
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
            CustomerRequest.objects.filter(customer_email__iexact=email).exists(),
            PropertyProfile.objects.filter(customer_email__iexact=email).exists(),
        ]
    )


def _primary_homeowner_for_email(email: str):
    return Homeowner.objects.filter(email__iexact=email).order_by("-updated_at", "-created_at").first()


def _get_or_create_homeowner_for_email(email: str):
    normalized_email = email.lower().strip()
    homeowner = _primary_homeowner_for_email(normalized_email)
    if homeowner:
        return homeowner
    return Homeowner.objects.create(
        full_name=normalized_email,
        email=normalized_email,
        status="active",
    )


def _profile_address_from_homeowner(homeowner) -> dict:
    if not homeowner:
        return {}
    return {
        "address_line1": _safe_text(getattr(homeowner, "street_address", "")),
        "address_line2": _safe_text(getattr(homeowner, "address_line_2", "")),
        "city": _safe_text(getattr(homeowner, "city", "")),
        "state": _safe_text(getattr(homeowner, "state", "")),
        "postal_code": _safe_text(getattr(homeowner, "zip_code", "")),
    }


def _profile_address_from_project(project) -> dict:
    if not project:
        return {}
    return {
        "address_line1": _safe_text(getattr(project, "project_street_address", "")),
        "address_line2": _safe_text(getattr(project, "project_address_line_2", "")),
        "city": _safe_text(getattr(project, "project_city", "")),
        "state": _safe_text(getattr(project, "project_state", "")),
        "postal_code": _safe_text(getattr(project, "project_zip_code", "")),
    }


def _get_or_create_property_profile(email: str) -> PropertyProfile:
    normalized_email = email.lower().strip()
    profile = (
        PropertyProfile.objects.filter(customer_email__iexact=normalized_email, is_primary=True)
        .order_by("-updated_at", "-id")
        .first()
        or PropertyProfile.objects.filter(customer_email__iexact=normalized_email).order_by("-updated_at", "-id").first()
    )
    if profile:
        return profile

    homeowner = _primary_homeowner_for_email(normalized_email)
    project = (
        Project.objects.select_related("homeowner")
        .filter(homeowner__email__iexact=normalized_email)
        .order_by("-updated_at", "-id")
        .first()
    )
    address = _profile_address_from_project(project) or _profile_address_from_homeowner(homeowner)
    display_name = _safe_text(getattr(project, "title", "")) or "Primary Property"
    return PropertyProfile.objects.create(
        homeowner=homeowner,
        customer_email=normalized_email,
        display_name=display_name,
        is_primary=True,
        **address,
    )


def _property_profiles_for_email(email: str):
    normalized_email = email.lower().strip()
    if not PropertyProfile.objects.filter(customer_email__iexact=normalized_email).exists():
        _get_or_create_property_profile(normalized_email)
    return PropertyProfile.objects.filter(customer_email__iexact=normalized_email).order_by("-is_primary", "-updated_at", "-id")


def _property_profile_payload_from_profile(profile: PropertyProfile) -> dict:
    address = ", ".join(
        part
        for part in [
            _safe_text(profile.address_line1),
            _safe_text(profile.address_line2),
            _safe_text(profile.city),
            _safe_text(profile.state),
            _safe_text(profile.postal_code),
        ]
        if part
    )
    documents = [
        {
            "id": f"property-document-{row.id}",
            "title": _safe_text(row.title) or "Property document",
            "type_label": _safe_text(row.document_type) or "Property Document",
            "filename": _safe_text(getattr(getattr(row, "file", None), "name", "")).rsplit("/", 1)[-1],
            "date": _safe_dt(row.uploaded_at),
            "url": _safe_text(getattr(getattr(row, "file", None), "url", "")),
        }
        for row in PropertyDocument.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id")
    ]
    photos = [
        {
            "id": f"property-photo-{row.id}",
            "title": _safe_text(row.title) or "Property photo",
            "type_label": "Property Photo",
            "filename": _safe_text(getattr(getattr(row, "photo", None), "name", "")).rsplit("/", 1)[-1],
            "date": _safe_dt(row.uploaded_at),
            "url": _safe_text(getattr(getattr(row, "photo", None), "url", "")),
        }
        for row in PropertyPhoto.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id")
    ]
    return {
        "id": profile.id,
        "customer_email": _safe_text(profile.customer_email),
        "display_name": _safe_text(profile.display_name),
        "property_type": _safe_text(profile.property_type),
        "property_type_label": profile.get_property_type_display(),
        "address_line1": _safe_text(profile.address_line1),
        "address_line2": _safe_text(profile.address_line2),
        "city": _safe_text(profile.city),
        "state": _safe_text(profile.state),
        "postal_code": _safe_text(profile.postal_code),
        "address": address,
        "year_built": profile.year_built,
        "square_feet": profile.square_feet,
        "notes": _safe_text(profile.notes),
        "is_primary": bool(getattr(profile, "is_primary", False)),
        "documents": documents,
        "photos": photos,
        "updated_at": _safe_dt(profile.updated_at),
    }


def _property_profile_payload(email: str, property_id: int | None = None) -> dict:
    profiles = list(_property_profiles_for_email(email))
    selected = None
    if property_id:
        selected = next((profile for profile in profiles if profile.id == property_id), None)
    if selected is None:
        selected = profiles[0] if profiles else _get_or_create_property_profile(email)
    return _property_profile_payload_from_profile(selected)


def _property_profiles_payload(email: str) -> list[dict]:
    return [_property_profile_payload_from_profile(profile) for profile in _property_profiles_for_email(email)]


def _property_profile_for_email_or_404(email: str, property_id):
    if not property_id:
        return _get_or_create_property_profile(email)
    return get_object_or_404(PropertyProfile, pk=property_id, customer_email__iexact=email.lower().strip())


def _customer_request_status_label(value: str) -> str:
    return _safe_text(value).replace("_", " ").title() or "Submitted"


def _customer_request_rows(email: str) -> list[dict]:
    rows = []
    for request_row in CustomerRequest.objects.select_related("converted_project", "property_profile").filter(
        customer_email__iexact=email
    ).order_by("-created_at", "-id"):
        rows.append(
            {
                "id": f"customer-request-{request_row.id}",
                "request_id": request_row.id,
                "source_kind": "customer_request",
                "project_title": _safe_text(request_row.title),
                "project_address": ", ".join(
                    part
                    for part in [
                        _safe_text(request_row.address_line1),
                        _safe_text(request_row.address_line2),
                        _safe_text(request_row.city),
                        _safe_text(request_row.state),
                        _safe_text(request_row.postal_code),
                    ]
                    if part
                ),
                "request_type": _safe_text(request_row.request_type),
                "request_type_label": request_row.get_request_type_display(),
                "status": _safe_text(request_row.status),
                "status_label": _customer_request_status_label(request_row.status),
                "latest_activity": _safe_dt(request_row.updated_at or request_row.created_at),
                "latest_activity_label": "Updated",
                "bids_count": 0,
                "agreement_id": None,
                "agreement_token": "",
                "action_label": "View Request",
                "action_target": "",
                "notes": _safe_text(request_row.description),
                "urgency": _safe_text(request_row.urgency),
                "preferred_timeline": _safe_text(request_row.preferred_timeline),
                "converted_project_id": getattr(request_row.converted_project, "id", None),
                "property_id": getattr(getattr(request_row, "property_profile", None), "id", None),
                "property_name": _safe_text(getattr(getattr(request_row, "property_profile", None), "display_name", "")),
            }
        )
    return rows


def _request_rows(email: str, *, bid_rows: list[dict] | None = None) -> list[dict]:
    rows = _customer_request_rows(email)
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
        source_intake = _source_intake_from_bid_lead(lead)
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
        public_profile = getattr(lead, "public_profile", None)
        milestone_rows = [
            row
            for row in (analysis.get("milestones") or [])
            if isinstance(row, dict) and _safe_text(row.get("title") or row.get("name"))
        ]
        service_area = ", ".join(
            part
            for part in [
                _safe_text(getattr(contractor, "city", "")) or _safe_text(getattr(public_profile, "city", "")),
                _safe_text(getattr(contractor, "state", "")) or _safe_text(getattr(public_profile, "state", "")),
            ]
            if part
        )
        warranty_summary = (
            _safe_text(analysis.get("warranty_summary"))
            or _safe_text(analysis.get("warranty"))
            or _safe_text(analysis.get("warranty_text"))
            or _safe_text(getattr(linked_agreement, "warranty_text_snapshot", ""))
            or _safe_text(getattr(linked_agreement, "warranty_type", ""))
        )
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
                "contractor_business_name": _safe_text(getattr(contractor, "business_name", "")) or _contractor_name(contractor),
                "contractor_contact_name": _safe_text(getattr(contractor, "contact_name", "")) or _safe_text(getattr(getattr(contractor, "user", None), "get_full_name", lambda: "")()),
                "contractor_verified": bool(
                    contractor
                    and getattr(contractor, "marketplace_verification_status", "")
                    == Contractor.MARKETPLACE_VERIFIED
                ),
                "contractor_preferred": bool(
                    contractor
                    and getattr(contractor, "marketplace_verification_status", "")
                    == Contractor.MARKETPLACE_VERIFIED
                    and getattr(contractor, "marketplace_preferred", False)
                ),
                "service_area": service_area or _safe_text(getattr(lead, "city", "")),
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
                    for row in milestone_rows[:3]
                ],
                "milestone_count": len(milestone_rows),
                "warranty_summary": warranty_summary,
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


def _bid_comparisons(request_rows: list[dict], bid_rows: list[dict]) -> list[dict]:
    request_by_key = {
        _safe_text(row.get("comparison_key")): row
        for row in request_rows
        if _safe_text(row.get("comparison_key"))
    }
    grouped: dict[str, list[dict]] = {}
    for bid in bid_rows:
        key = _safe_text(bid.get("comparison_key"))
        if not key:
            continue
        grouped.setdefault(key, []).append(bid)

    comparisons = []
    for key, bids in grouped.items():
        request_row = request_by_key.get(key, {})
        awarded = next((bid for bid in bids if bid.get("is_awarded") or bid.get("linked_agreement_id")), None)
        comparisons.append(
            {
                "comparison_key": key,
                "request_id": request_row.get("request_id") or request_row.get("id") or "",
                "project_title": request_row.get("project_title") or (bids[0].get("project_title") if bids else ""),
                "project_address": request_row.get("project_address") or (bids[0].get("request_address") if bids else ""),
                "bid_count": len(bids),
                "status": "awarded" if awarded else "open",
                "awarded_bid_id": awarded.get("id") if awarded else "",
                "awarded_contractor": awarded.get("contractor_name") if awarded else "",
                "agreement_id": awarded.get("linked_agreement_id") if awarded else None,
                "agreement_token": awarded.get("linked_agreement_token") if awarded else "",
                "bids": bids,
            }
        )
    comparisons.sort(key=lambda row: (row.get("status") != "open", row.get("project_title") or ""))
    return comparisons


def _agreements(email: str, request=None) -> list[dict]:
    agreements = list(
        Agreement.objects.select_related("project", "contractor", "homeowner").filter(
            Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)
        ).order_by("-updated_at", "-id")
    )
    rows = []
    for agreement in agreements:
        visible_reason = _agreement_customer_visible_reason(agreement, email)
        if not visible_reason:
            continue
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
                "payment_mode_label": _safe_text(getattr(agreement, "payment_mode", "")).replace("_", " ").title(),
                "total_cost": _safe_text(getattr(agreement, "total_cost", "")),
                "description": _safe_text(getattr(agreement, "description", "")),
                "warranty_type": _safe_text(getattr(agreement, "warranty_type", "")),
                "warranty_text": _safe_text(getattr(agreement, "warranty_text_snapshot", "")),
                "customer_visible_reason": visible_reason,
            }
        )
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return rows


def _agreement_customer_visible_reason(agreement, email: str) -> str:
    normalized_email = email.lower().strip()
    status_value = _safe_text(getattr(agreement, "status", "")).lower()
    project = getattr(agreement, "project", None)

    if ProjectIntake.objects.filter(agreement=agreement, customer_email__iexact=normalized_email).exists():
        return "customer_request"
    if PublicContractorLead.objects.filter(converted_agreement=agreement, email__iexact=normalized_email).exists():
        return "bid_customer_review"
    if getattr(agreement, "signed_by_homeowner", False):
        return "customer_signed"
    if getattr(agreement, "signed_by_contractor", False):
        return "awaiting_signature"
    if status_value in {"signed", "funded", "in_progress", "completed", "cancelled"}:
        return f"{status_value}_agreement"
    if Invoice.objects.filter(agreement=agreement).exists():
        return "payment_visible"
    if DrawRequest.objects.filter(agreement=agreement).exists():
        return "draw_visible"
    if Dispute.objects.filter(agreement=agreement, is_archived=False).exists():
        return "dispute_visible"
    if SmartNotification.objects.filter(
        recipient_email__iexact=normalized_email,
        agreement=agreement,
    ).exists():
        return "notification_visible"
    if getattr(agreement, "pdf_file", None) and getattr(agreement.pdf_file, "name", ""):
        return "document_visible"
    if AgreementAttachment.objects.filter(agreement=agreement, visible_to_homeowner=True).exists():
        return "document_visible"
    if project is not None:
        project_status = _safe_text(getattr(project, "status", "")).lower()
        if project_status in {"signed", "funded", "in_progress", "completed", "cancelled"}:
            return f"{project_status}_project"
        if SmartNotification.objects.filter(
            recipient_email__iexact=normalized_email,
            project=project,
        ).exists():
            return "notification_visible"
    return ""


def _project_customer_visible_reason(project, agreement, email: str) -> str:
    if agreement is not None:
        return _agreement_customer_visible_reason(agreement, email)
    normalized_email = email.lower().strip()
    status_value = _safe_text(getattr(project, "status", "")).lower()
    if status_value in {"signed", "funded", "in_progress", "completed", "cancelled"}:
        return f"{status_value}_project"
    if SmartNotification.objects.filter(
        recipient_email__iexact=normalized_email,
        project=project,
    ).exists():
        return "notification_visible"
    return ""


def _projects(email: str) -> list[dict]:
    projects = list(
        Project.objects.select_related("homeowner", "contractor").filter(
            homeowner__email__iexact=email
        ).order_by("-updated_at", "-id")
    )
    agreements_by_project = {
        agreement.project_id: agreement
        for agreement in Agreement.objects.select_related("project", "contractor", "homeowner").filter(
            Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)
        )
    }
    rows = []
    for project in projects:
        agreement = agreements_by_project.get(project.id)
        visible_reason = _project_customer_visible_reason(project, agreement, email)
        if not visible_reason:
            continue
        milestone_rows = []
        if agreement:
            milestone_rows = [
                {
                    "id": milestone.id,
                    "title": _safe_text(getattr(milestone, "title", "")),
                    "status": "completed" if getattr(milestone, "completed", False) else "active",
                    "amount": _safe_text(getattr(milestone, "amount", "")),
                    "due_date": _safe_dt(getattr(milestone, "due_date", None) or getattr(milestone, "completion_date", None)),
                }
                for milestone in Milestone.objects.filter(agreement=agreement).order_by("order", "id")[:8]
            ]
        rows.append(
            {
                "id": project.id,
                "project_number": _safe_text(project.number),
                "title": _safe_text(project.title),
                "description": _safe_text(project.description),
                "status": _safe_text(project.status),
                "status_label": _safe_text(project.status).replace("_", " ").title() or "Project",
                "address": ", ".join(
                    part
                    for part in [
                        _safe_text(project.project_street_address),
                        _safe_text(project.project_address_line_2),
                        _safe_text(project.project_city),
                        _safe_text(project.project_state),
                        _safe_text(project.project_zip_code),
                    ]
                    if part
                ),
                "contractor_name": _contractor_name(getattr(project, "contractor", None)),
                "agreement_id": getattr(agreement, "id", None),
                "agreement_token": _safe_text(getattr(agreement, "homeowner_access_token", "")) if agreement else "",
                "agreement_url": f"/agreements/magic/{agreement.homeowner_access_token}" if agreement else "",
                "total_cost": _safe_text(getattr(agreement, "total_cost", "")) if agreement else "",
                "milestones": milestone_rows,
                "updates": _project_messages(agreement) if agreement else [],
                "updated_at": _safe_dt(getattr(project, "updated_at", None) or getattr(project, "created_at", None)),
                "customer_visible_reason": visible_reason,
            }
        )
    return rows


def _portal_dispute_public_url(dispute) -> str:
    if not dispute or not getattr(dispute, "public_token", None):
        return ""
    return f"/disputes/{dispute.id}?token={dispute.public_token}"


def _portal_dispute_status(dispute) -> tuple[str, str]:
    if not dispute:
        return "none", "No dispute"
    value = _safe_text(getattr(dispute, "status", "open")).lower()
    if value in {"initiated", "open"}:
        return value or "open", "Dispute opened"
    return value, value.replace("_", " ").title()


def _draw_dispute(draw):
    if not draw:
        return None
    return (
        Dispute.objects.filter(
            agreement=getattr(draw, "agreement", None),
            description__icontains=f"draw_id={draw.id}",
        )
        .order_by("-created_at", "-id")
        .first()
    )


def _payments(email: str, request=None) -> list[dict]:
    rows = []
    invoices = list(
        Invoice.objects.select_related("agreement", "agreement__project", "agreement__homeowner", "agreement__contractor").prefetch_related("receipt").filter(
            Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)
        ).order_by("-created_at", "-id")
    )
    draws = list(
        DrawRequest.objects.select_related("agreement", "agreement__project", "agreement__homeowner", "agreement__contractor").prefetch_related("external_payment_records").filter(
            Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email)
        ).order_by("-created_at", "-id")
    )
    reimbursements = list(
        ExpenseRequest.objects.select_related("agreement", "agreement__project", "agreement__homeowner", "agreement__contractor", "milestone")
        .prefetch_related("attachments")
        .filter(
            request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
            is_archived=False,
        )
        .filter(Q(agreement__homeowner__email__iexact=email) | Q(agreement__project__homeowner__email__iexact=email))
        .order_by("-created_at", "-id")
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
                "record_id": invoice.id,
                "record_type": "invoice",
                "record_type_label": "Invoice",
                "project_title": _agreement_title(agreement),
                "contractor_name": _contractor_name(getattr(agreement, "contractor", None)),
                "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
                "payment_mode_label": _safe_text(getattr(agreement, "payment_mode", "")).replace("_", " ").title(),
                "amount": _safe_text(getattr(invoice, "amount", "")),
                "amount_label": f"${Decimal(str(getattr(invoice, 'amount', 0) or 0)):.2f}",
                "status": _safe_text(getattr(invoice, "status", "")).lower(),
                "status_label": status_text,
                "dispute_status": "Dispute opened" if getattr(invoice, "disputed", False) or _safe_text(getattr(invoice, "status", "")).lower() == "disputed" else "No dispute",
                "dispute_url": "",
                "date": _safe_dt(
                    getattr(invoice, "escrow_released_at", None)
                    or getattr(invoice, "direct_pay_paid_at", None)
                    or getattr(invoice, "approved_at", None)
                    or getattr(invoice, "created_at", None)
                ),
                "reference": _safe_text(getattr(invoice, "invoice_number", "")),
                "due_date": _safe_dt(getattr(invoice, "due_date", None)),
                "invoice_number": _safe_text(getattr(invoice, "invoice_number", "")),
                "agreement_id": getattr(agreement, "id", None),
                "action_target": f"/invoice/{invoice.public_token}",
                "receipt_url": _safe_text(getattr(getattr(receipt, "pdf_file", None), "url", "")),
                "notes": "Escrow release" if getattr(invoice, "escrow_released", False) else "Direct pay" if getattr(invoice, "direct_pay_paid_at", None) else "",
            }
        )

    for draw in draws:
        agreement = getattr(draw, "agreement", None)
        dispute = _draw_dispute(draw)
        dispute_status, dispute_status_label = _portal_dispute_status(dispute)
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
                "record_id": draw.id,
                "record_type": "draw_request",
                "record_type_label": "Draw",
                "project_title": _agreement_title(agreement),
                "contractor_name": _contractor_name(getattr(agreement, "contractor", None)),
                "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
                "payment_mode_label": _safe_text(getattr(agreement, "payment_mode", "")).replace("_", " ").title(),
                "amount": _safe_text(getattr(draw, "net_amount", "")),
                "amount_label": f"${Decimal(str(getattr(draw, 'net_amount', 0) or 0)):.2f}",
                "status": _safe_text(getattr(draw, "status", "")).lower(),
                "status_label": status_text,
                "dispute_status": dispute_status,
                "dispute_status_label": dispute_status_label,
                "dispute_url": _portal_dispute_public_url(dispute),
                "date": _safe_dt(getattr(draw, "paid_at", None) or getattr(draw, "released_at", None) or getattr(draw, "created_at", None)),
                "reference": _safe_text(getattr(draw, "stripe_transfer_id", "")) or _safe_text(getattr(external_payment, "reference_number", "")),
                "agreement_id": getattr(agreement, "id", None),
                "action_target": f"/draws/magic/{draw.public_token}",
                "receipt_url": _safe_text(getattr(getattr(external_payment, "proof_file", None), "url", "")),
                "notes": "Released draw" if getattr(draw, "released_at", None) else "",
            }
        )

    for reimbursement in reimbursements:
        agreement = getattr(reimbursement, "agreement", None)
        status_value = _safe_text(getattr(reimbursement, "status", "")).lower()
        try:
            ledger_payload = serialize_ledger(escrow_ledger(agreement, exclude_reimbursement_id=reimbursement.id)) if agreement else None
        except Exception:
            ledger_payload = None
        receipt_url = _safe_text(getattr(getattr(reimbursement, "receipt", None), "url", ""))
        if not receipt_url:
            first_attachment = None
            try:
                first_attachment = reimbursement.attachments.first()
            except Exception:
                first_attachment = None
            receipt_url = _safe_text(getattr(getattr(first_attachment, "file", None), "url", ""))
        rows.append(
            {
                "id": f"reimbursement-{reimbursement.id}",
                "record_id": reimbursement.id,
                "record_type": "reimbursement",
                "record_type_label": "Reimbursement",
                "project_title": _agreement_title(agreement),
                "contractor_name": _contractor_name(getattr(agreement, "contractor", None)),
                "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
                "payment_mode_label": "Escrow",
                "amount": _safe_text(getattr(reimbursement, "amount", "")),
                "amount_label": f"${Decimal(str(getattr(reimbursement, 'amount', 0) or 0)):.2f}",
                "status": status_value,
                "status_label": _safe_text(getattr(reimbursement, "get_status_display", lambda: "")()) or status_value.replace("_", " ").title(),
                "dispute_status": "No dispute",
                "dispute_status_label": "No dispute",
                "date": _safe_dt(
                    getattr(reimbursement, "released_at", None)
                    or getattr(reimbursement, "approved_at", None)
                    or getattr(reimbursement, "submitted_at", None)
                    or getattr(reimbursement, "created_at", None)
                ),
                "reference": f"Expense #{reimbursement.id}",
                "agreement_id": getattr(agreement, "id", None),
                "milestone_title": _safe_text(getattr(getattr(reimbursement, "milestone", None), "title", "")),
                "action_target": "",
                "receipt_url": receipt_url,
                "notes": _safe_text(getattr(reimbursement, "notes_to_homeowner", "")) or _safe_text(getattr(reimbursement, "description", "")),
                "category": _safe_text(getattr(reimbursement, "category", "")),
                "escrow_ledger": ledger_payload,
                "can_approve": status_value in {ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER},
                "can_deny": status_value in {ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.PENDING_RELEASE},
                "approve_url": f"/api/projects/customer-portal/{{token}}/reimbursements/{reimbursement.id}/approve/",
                "deny_url": f"/api/projects/customer-portal/{{token}}/reimbursements/{reimbursement.id}/deny/",
            }
        )

    rows.sort(key=lambda row: row.get("date") or "", reverse=True)
    return rows


def _maintenance_work_order_rows(email: str, request=None) -> list[dict]:
    rows = []
    for work_order in customer_visible_work_order_queryset(email).order_by("-scheduled_date", "-created_at", "-id"):
        agreement = getattr(work_order, "maintenance_agreement", None)
        project = getattr(agreement, "project", None) if agreement else None
        contractor = getattr(work_order, "contractor", None)
        property_profile = getattr(work_order, "property_profile", None)
        source_milestone = getattr(work_order, "source_milestone", None)
        attachment_rows = []
        for attachment in getattr(work_order, "attachments", []).all():
            file_obj = getattr(attachment, "file", None)
            attachment_rows.append(
                {
                    "id": attachment.id,
                    "title": _safe_text(attachment.original_name) or "Work order attachment",
                    "filename": _safe_text(getattr(file_obj, "name", "")).rsplit("/", 1)[-1],
                    "url": _safe_text(getattr(file_obj, "url", "")),
                    "date": _safe_dt(getattr(attachment, "uploaded_at", None)),
                }
            )
        rows.append(
            {
                "id": work_order.id,
                "agreement_id": getattr(agreement, "id", None),
                "project_id": getattr(project, "id", None),
                "project_title": _agreement_title(agreement) if agreement else "Maintenance service",
                "contractor_name": _contractor_name(contractor),
                "property_id": getattr(property_profile, "id", None),
                "property_name": _safe_text(getattr(property_profile, "display_name", "")) or _safe_text(getattr(property_profile, "address_line1", "")),
                "title": _safe_text(work_order.title),
                "description": _safe_text(work_order.description),
                "scheduled_date": _safe_dt(work_order.scheduled_date),
                "completed_at": _safe_dt(work_order.completed_at),
                "status": _safe_text(work_order.status),
                "status_label": work_order.get_status_display(),
                "notes": _safe_text(work_order.notes),
                "generated_from_schedule": bool(work_order.generated_from_schedule),
                "source_milestone_id": getattr(source_milestone, "id", None),
                "service_period_start": _safe_dt(getattr(source_milestone, "service_period_start", None)),
                "service_period_end": _safe_dt(getattr(source_milestone, "service_period_end", None)),
                "attachments": attachment_rows,
            }
        )
    return rows


def _documents(email: str, request=None) -> list[dict]:
    rows = []
    profile = _get_or_create_property_profile(email)
    for document in PropertyDocument.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id"):
        rows.append(
            {
                "id": f"property-document-{document.id}",
                "title": _safe_text(document.title) or "Property document",
                "type_label": _safe_text(document.document_type) or "Property Document",
                "project_title": _safe_text(profile.display_name) or "Property Profile",
                "filename": _safe_text(getattr(getattr(document, "file", None), "name", "")).rsplit("/", 1)[-1],
                "date": _safe_dt(document.uploaded_at),
                "url": _safe_text(getattr(getattr(document, "file", None), "url", "")),
                "agreement_id": None,
            }
        )
    for photo in PropertyPhoto.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id"):
        rows.append(
            {
                "id": f"property-photo-{photo.id}",
                "title": _safe_text(photo.title) or "Property photo",
                "type_label": "Property Photo",
                "project_title": _safe_text(profile.display_name) or "Property Profile",
                "filename": _safe_text(getattr(getattr(photo, "photo", None), "name", "")).rsplit("/", 1)[-1],
                "date": _safe_dt(photo.uploaded_at),
                "url": _safe_text(getattr(getattr(photo, "photo", None), "url", "")),
                "agreement_id": None,
            }
        )
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
                    "filename": _safe_text(getattr(getattr(agreement, "pdf_file", None), "name", "")).rsplit("/", 1)[-1],
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
                    "filename": _safe_text(getattr(getattr(attachment, "file", None), "name", "")).rsplit("/", 1)[-1],
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
                    "filename": _safe_text(getattr(getattr(invoice, "pdf_file", None), "name", "")).rsplit("/", 1)[-1],
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
                    "filename": _safe_text(getattr(getattr(receipt, "pdf_file", None), "name", "")).rsplit("/", 1)[-1],
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
    _ensure_portal_workflow_notifications(email)
    bid_rows = _bid_rows(email)
    request_rows = _request_rows(email, bid_rows=bid_rows)
    bid_comparison_rows = _bid_comparisons(request_rows, bid_rows)
    project_rows = _projects(email)
    agreement_rows = _agreements(email, request=request)
    payment_rows = _payments(email, request=request)
    maintenance_work_order_rows = _maintenance_work_order_rows(email, request=request)
    document_rows = _documents(email, request=request)
    property_profile = _property_profile_payload(email)
    property_profiles = _property_profiles_payload(email)

    summary = {
        "active_requests": sum(1 for row in request_rows if row.get("status") not in {"converted", "converted_to_project", "archived", "closed"}),
        "active_projects": len(project_rows),
        "bids_received": len(bid_rows),
        "active_agreements": sum(1 for row in agreement_rows if row.get("status") not in {"archived", "cancelled"}),
        "payments": len(payment_rows),
        "documents": len(document_rows),
        "maintenance_work_orders": len(maintenance_work_order_rows),
    }

    return {
        "customer": {
            "name": _customer_name(email),
            "email": email,
            **_customer_profile_payload(email),
        },
        "account": _customer_account_payload(email),
        "summary": summary,
        "requests": request_rows,
        "bid_comparisons": bid_comparison_rows,
        "projects": project_rows,
        "bids": bid_rows,
        "agreements": agreement_rows,
        "payments": payment_rows,
        "maintenance_work_orders": maintenance_work_order_rows,
        "documents": document_rows,
        "property_profile": property_profile,
        "property_profiles": property_profiles,
        "notifications": _smart_notification_rows(email),
    }


def _customer_profile_payload(email: str) -> dict:
    homeowner = _primary_homeowner_for_email(email)
    user = User.objects.filter(email__iexact=email).first()
    return {
        "full_name": _safe_text(getattr(homeowner, "full_name", "")) or _safe_text(getattr(user, "get_full_name", lambda: "")()),
        "phone_number": _safe_text(getattr(homeowner, "phone_number", "")),
        "address_line1": _safe_text(getattr(homeowner, "street_address", "")),
        "address_line2": _safe_text(getattr(homeowner, "address_line_2", "")),
        "city": _safe_text(getattr(homeowner, "city", "")),
        "state": _safe_text(getattr(homeowner, "state", "")),
        "postal_code": _safe_text(getattr(homeowner, "zip_code", "")),
    }


def _customer_account_payload(email: str) -> dict:
    user = User.objects.filter(email__iexact=email).first()
    return {
        "email": email,
        "has_user": bool(user),
        "has_usable_password": bool(user and user.has_usable_password()),
        "portal_token": _portal_token(email),
    }


def _smart_notification_rows(email: str) -> list[dict]:
    return [
        {
            "id": row.id,
            "event_type": _safe_text(row.event_type),
            "channel": _safe_text(row.channel),
            "status": _safe_text(row.status),
            "title": _safe_text(row.title),
            "message": _safe_text(row.message),
            "action_url": _safe_text(row.action_url),
            "created_at": _safe_dt(row.created_at),
        }
        for row in SmartNotification.objects.filter(recipient_email__iexact=email).order_by("-created_at", "-id")[:20]
    ]


def _smart_notification_belongs_to_email(notification: SmartNotification, email: str) -> bool:
    normalized_email = email.lower().strip()
    if _safe_text(notification.recipient_email).lower() != normalized_email:
        return False
    if notification.property_profile_id and _safe_text(getattr(notification.property_profile, "customer_email", "")).lower() != normalized_email:
        return False
    if notification.customer_request_id and _safe_text(getattr(notification.customer_request, "customer_email", "")).lower() != normalized_email:
        return False
    linked_project = getattr(notification, "project", None)
    linked_agreement = getattr(notification, "agreement", None)
    linked_invoice = getattr(notification, "invoice", None)
    linked_milestone = getattr(notification, "milestone", None)
    linked_draw = getattr(notification, "draw_request", None)
    if linked_invoice is not None:
        linked_agreement = getattr(linked_invoice, "agreement", None) or linked_agreement
    if linked_milestone is not None:
        linked_agreement = getattr(linked_milestone, "agreement", None) or linked_agreement
    if linked_draw is not None:
        linked_agreement = getattr(linked_draw, "agreement", None) or linked_agreement
    if linked_agreement is not None:
        return _agreement_customer_email(linked_agreement) == normalized_email
    if linked_project is not None:
        return _project_customer_email(linked_project) == normalized_email
    return True


def _ensure_portal_workflow_notifications(email: str) -> None:
    normalized_email = email.lower().strip()
    profile = _get_or_create_property_profile(normalized_email)
    homeowner = _primary_homeowner_for_email(normalized_email)
    agreements = list(
        Agreement.objects.select_related("project", "contractor", "homeowner").filter(
            Q(homeowner__email__iexact=normalized_email) | Q(project__homeowner__email__iexact=normalized_email)
        )
    )

    for agreement in agreements:
        project = getattr(agreement, "project", None)
        project_title = _agreement_title(agreement)
        if getattr(agreement, "signed_by_contractor", False) and not getattr(agreement, "signed_by_homeowner", False):
            create_smart_notification(
                event_type=SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE,
                recipient_email=normalized_email,
                homeowner=getattr(agreement, "homeowner", None) or homeowner,
                contractor=getattr(agreement, "contractor", None),
                project=project,
                agreement=agreement,
                property_profile=profile,
                action_url=f"/agreements/magic/{agreement.homeowner_access_token}",
                context={
                    "project_title": project_title,
                    "dedupe_key": f"agreement_needs_signature:{agreement.id}",
                },
            )
        if (
            getattr(agreement, "signed_by_contractor", False)
            and getattr(agreement, "signed_by_homeowner", False)
            and not getattr(agreement, "escrow_funded", False)
            and _safe_text(getattr(agreement, "payment_mode", "")).lower() != "direct"
        ):
            create_smart_notification(
                event_type=SmartNotificationEvent.ESCROW_NEEDS_FUNDING,
                recipient_email=normalized_email,
                homeowner=getattr(agreement, "homeowner", None) or homeowner,
                contractor=getattr(agreement, "contractor", None),
                project=project,
                agreement=agreement,
                property_profile=profile,
                action_url=f"/agreements/magic/{agreement.homeowner_access_token}",
                context={
                    "project_title": project_title,
                    "dedupe_key": f"escrow_needs_funding:{agreement.id}",
                },
            )

    milestones = Milestone.objects.select_related("agreement", "agreement__project", "agreement__homeowner").filter(
        Q(agreement__homeowner__email__iexact=normalized_email) | Q(agreement__project__homeowner__email__iexact=normalized_email)
    )
    for milestone in milestones:
        if _safe_text(getattr(milestone, "subcontractor_completion_status", "")).lower() != "submitted_for_review":
            continue
        agreement = getattr(milestone, "agreement", None)
        create_smart_notification(
            event_type=SmartNotificationEvent.MILESTONE_NEEDS_APPROVAL,
            recipient_email=normalized_email,
            homeowner=getattr(agreement, "homeowner", None) or homeowner,
            contractor=getattr(agreement, "contractor", None),
            project=getattr(agreement, "project", None),
            agreement=agreement,
            milestone=milestone,
            property_profile=profile,
            action_url=f"/agreements/magic/{agreement.homeowner_access_token}" if agreement else "",
            context={
                "project_title": _agreement_title(agreement) if agreement else "",
                "milestone_title": _safe_text(getattr(milestone, "title", "")) or f"Milestone {getattr(milestone, 'order', '')}",
                "dedupe_key": f"milestone_needs_approval:{milestone.id}",
            },
        )

    invoices = Invoice.objects.select_related("agreement", "agreement__project", "agreement__homeowner").filter(
        Q(agreement__homeowner__email__iexact=normalized_email) | Q(agreement__project__homeowner__email__iexact=normalized_email)
    )
    for invoice in invoices:
        paid_at = getattr(invoice, "direct_pay_paid_at", None) or getattr(invoice, "escrow_released_at", None) or getattr(invoice, "approved_at", None)
        if _safe_text(getattr(invoice, "status", "")).lower() != "paid" and not paid_at:
            continue
        agreement = getattr(invoice, "agreement", None)
        create_smart_notification(
            event_type=SmartNotificationEvent.PAYMENT_RECEIVED,
            recipient_email=normalized_email,
            homeowner=getattr(agreement, "homeowner", None) or homeowner,
            contractor=getattr(agreement, "contractor", None),
            project=getattr(agreement, "project", None),
            agreement=agreement,
            invoice=invoice,
            property_profile=profile,
            action_url=f"/agreements/magic/{agreement.homeowner_access_token}" if agreement else "",
            context={
                "project_title": _agreement_title(agreement) if agreement else "",
                "dedupe_key": f"payment_received:invoice:{invoice.id}",
            },
        )

    for customer_request in CustomerRequest.objects.select_related("homeowner", "property_profile").filter(
        customer_email__iexact=normalized_email,
        status=CustomerRequest.STATUS_MARKETPLACE_READY,
    ):
        create_smart_notification(
            event_type=SmartNotificationEvent.REQUEST_MARKETPLACE_READY,
            recipient_email=normalized_email,
            homeowner=getattr(customer_request, "homeowner", None) or homeowner,
            customer_request=customer_request,
            property_profile=getattr(customer_request, "property_profile", None) or profile,
            context={
                "request_title": customer_request.title,
                "dedupe_key": f"request_marketplace_ready:{customer_request.id}",
            },
        )


def _project_customer_email(project, agreement=None) -> str:
    homeowner = getattr(project, "homeowner", None)
    if homeowner and getattr(homeowner, "email", None):
        return _safe_text(getattr(homeowner, "email", "")).lower()
    if agreement is not None:
        agreement_homeowner = getattr(agreement, "homeowner", None)
        if agreement_homeowner and getattr(agreement_homeowner, "email", None):
            return _safe_text(getattr(agreement_homeowner, "email", "")).lower()
    return ""


def _project_agreement(project):
    try:
        return (
            Agreement.objects.select_related("project", "contractor", "homeowner")
            .filter(project=project)
            .first()
        )
    except Exception:
        return None


def _project_photo_rows(agreement) -> list[dict]:
    if not agreement:
        return []
    rows = []
    for attachment in AgreementAttachment.objects.select_related("agreement", "uploaded_by").filter(
        agreement=agreement,
        visible_to_homeowner=True,
    ).order_by("-uploaded_at", "-id"):
        file_obj = getattr(attachment, "file", None)
        try:
            file_url = getattr(file_obj, "url", "") or ""
        except Exception:
            file_url = ""
        rows.append(
            {
                "id": attachment.id,
                "title": _safe_text(getattr(attachment, "title", "")) or "Project photo",
                "category": _safe_text(getattr(attachment, "category", "")) or "OTHER",
                "url": file_url,
                "uploaded_at": _safe_dt(getattr(attachment, "uploaded_at", None)),
                "uploaded_by": _safe_text(getattr(getattr(attachment, "uploaded_by", None), "get_full_name", lambda: "")())
                or _safe_text(getattr(getattr(attachment, "uploaded_by", None), "email", "")),
            }
        )
    return rows


def _project_timeline_rows(agreement) -> list[dict]:
    if not agreement:
        return []
    rows = []
    milestones = Milestone.objects.filter(agreement=agreement).order_by("order", "id")
    for milestone in milestones:
        status = "completed" if getattr(milestone, "completed", False) else "in_progress"
        if getattr(milestone, "subcontractor_completion_status", "") == "submitted_for_review":
            status = "awaiting_review"
        elif getattr(milestone, "is_invoiced", False) and not getattr(milestone, "completed", False):
            status = "invoiced"
        elif getattr(milestone, "is_late", False):
            status = "overdue"
        rows.append(
            {
                "id": milestone.id,
                "order": milestone.order,
                "title": _safe_text(getattr(milestone, "title", "")) or f"Milestone {milestone.order}",
                "description": _safe_text(getattr(milestone, "description", "")),
                "amount": str(getattr(milestone, "amount", "") or "0.00"),
                "amount_label": f"${Decimal(str(getattr(milestone, 'amount', 0) or 0)):.2f}",
                "start_date": _safe_dt(getattr(milestone, "start_date", None)),
                "completion_date": _safe_dt(getattr(milestone, "completion_date", None)),
                "status": status,
                "status_label": (
                    "Awaiting Review"
                    if status == "awaiting_review"
                    else "Overdue"
                    if status == "overdue"
                    else "Invoiced"
                    if status == "invoiced"
                    else "Completed"
                    if status == "completed"
                    else "In Progress"
                ),
                "completed": bool(getattr(milestone, "completed", False)),
                "is_invoiced": bool(getattr(milestone, "is_invoiced", False)),
                "has_comments": bool(getattr(milestone, "comments", None) and milestone.comments.exists()),
            }
        )
    return rows


def _project_payment_rows(agreement) -> tuple[dict, list[dict], list[dict]]:
    if not agreement:
        return {"items": [], "summary": {}}, [], []

    invoices = list(
        Invoice.objects.select_related("agreement", "agreement__project", "agreement__homeowner")
        .filter(agreement=agreement)
        .order_by("-created_at", "-id")
    )
    draws = list(
        DrawRequest.objects.select_related("agreement", "agreement__project", "agreement__homeowner")
        .filter(agreement=agreement)
        .order_by("-created_at", "-id")
    )

    invoice_rows = []
    approved_unpaid = None
    for invoice in invoices:
        status = _safe_text(getattr(invoice, "status", "")).lower()
        paid = bool(getattr(invoice, "escrow_released", False) or getattr(invoice, "direct_pay_paid_at", None) or status == "paid")
        approved = status == "approved"
        if approved and not paid and approved_unpaid is None:
            approved_unpaid = invoice
        invoice_rows.append(
            {
                "id": invoice.id,
                "type": "invoice",
                "label": f"Invoice {getattr(invoice, 'invoice_number', invoice.id)}",
                "amount": str(getattr(invoice, "amount", "") or "0.00"),
                "amount_label": f"${Decimal(str(getattr(invoice, 'amount', 0) or 0)):.2f}",
                "status": "paid" if paid else status or "pending",
                "status_label": "Paid" if paid else _safe_text(getattr(invoice, "status", "")).replace("_", " ").title() or "Pending",
                "date": _safe_dt(getattr(invoice, "escrow_released_at", None) or getattr(invoice, "direct_pay_paid_at", None) or getattr(invoice, "approved_at", None) or getattr(invoice, "created_at", None)),
                "link": f"/invoice/{invoice.public_token}",
                "notes": "Escrow release" if getattr(invoice, "escrow_released", False) else "Direct pay" if getattr(invoice, "direct_pay_paid_at", None) else "",
            }
        )

    draw_rows = []
    awaiting_review = None
    for draw in draws:
        status = _safe_text(getattr(draw, "status", "")).lower()
        if status in {"submitted", "changes_requested"} and awaiting_review is None:
            awaiting_review = draw
        draw_rows.append(
            {
                "id": draw.id,
                "type": "draw",
                "label": f"Draw {getattr(draw, 'draw_number', draw.id)}",
                "amount": str(getattr(draw, "net_amount", "") or "0.00"),
                "amount_label": f"${Decimal(str(getattr(draw, 'net_amount', 0) or 0)):.2f}",
                "status": status or "draft",
                "status_label": _safe_text(getattr(draw, "status", "")).replace("_", " ").title() or "Pending",
                "date": _safe_dt(getattr(draw, "released_at", None) or getattr(draw, "paid_at", None) or getattr(draw, "created_at", None)),
                "link": f"/draws/magic/{draw.public_token}",
                "notes": "Awaiting release" if status == "approved" else "Released" if getattr(draw, "released_at", None) else "",
            }
        )

    escrow_total = Decimal(str(getattr(agreement, "total_cost", 0) or 0))
    escrow_funded = bool(getattr(agreement, "escrow_funded", False))
    paid_total = sum(
        Decimal(str(row["amount"] or "0.00"))
        for row in invoice_rows
        if row.get("status") == "paid"
    )
    summary = {
        "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
        "payment_mode_label": "Escrow" if _safe_text(getattr(agreement, "payment_mode", "")) == "escrow" else "Direct Pay",
        "agreement_total": str(escrow_total),
        "agreement_total_label": f"${escrow_total:,.2f}",
        "escrow_funded": escrow_funded,
        "escrow_funded_label": "Funded" if escrow_funded else "Waiting for funding",
        "remaining_to_fund": str(max(Decimal("0.00"), escrow_total - paid_total if escrow_total else Decimal("0.00"))),
        "remaining_to_fund_label": f"${max(Decimal('0.00'), escrow_total - paid_total if escrow_total else Decimal('0.00')):,.2f}",
        "invoice_count": len(invoice_rows),
        "draw_count": len(draw_rows),
        "approved_unpaid_invoice_id": getattr(approved_unpaid, "id", None),
        "awaiting_review_draw_id": getattr(awaiting_review, "id", None),
    }
    return summary, invoice_rows, draw_rows


def _project_messages(agreement) -> list[dict]:
    if not agreement:
        return []
    comments = (
        MilestoneComment.objects.select_related("milestone", "author")
        .filter(milestone__agreement=agreement)
        .order_by("-created_at", "-id")[:6]
    )
    rows = []
    for comment in comments:
        milestone = getattr(comment, "milestone", None)
        rows.append(
            {
                "id": comment.id,
                "milestone_id": getattr(milestone, "id", None),
                "milestone_title": _safe_text(getattr(milestone, "title", "")) or "Milestone update",
                "author": _safe_text(getattr(getattr(comment, "author", None), "get_full_name", lambda: "")())
                or _safe_text(getattr(getattr(comment, "author", None), "email", ""))
                or "Team member",
                "body": _safe_text(getattr(comment, "content", "")),
                "created_at": _safe_dt(getattr(comment, "created_at", None)),
            }
        )
    return rows


def _project_activity(agreement, milestone_rows, payment_summary, invoice_rows, draw_rows, message_rows) -> list[dict]:
    if not agreement:
        return []

    activity = []
    if getattr(agreement, "signed_at_homeowner", None):
        activity.append(
            {
                "id": f"agreement-signed-{agreement.id}",
                "category": "agreement_signed",
                "title": "Agreement signed",
                "body": "Your agreement is signed and ready for the next project step.",
                "tone": "emerald",
                "created_at": _safe_dt(getattr(agreement, "signed_at_homeowner", None)),
                "link": getattr(agreement, "homeowner_access_token", None) and f"/agreements/magic/{agreement.homeowner_access_token}" or "",
            }
        )
    if payment_summary.get("escrow_funded"):
        activity.append(
            {
                "id": f"escrow-funded-{agreement.id}",
                "category": "escrow_funded",
                "title": "Escrow funded",
                "body": "Your funding deposit is in place.",
                "tone": "emerald",
                "created_at": _safe_dt(getattr(agreement, "updated_at", None)),
                "link": "",
            }
        )
    for row in milestone_rows:
        if row.get("completed"):
            activity.append(
                {
                    "id": f"milestone-completed-{row['id']}",
                    "category": "milestone_completed",
                    "title": f"{row['title']} completed",
                    "body": row.get("description") or "Milestone completed.",
                    "tone": "emerald",
                    "created_at": row.get("completion_date") or row.get("start_date"),
                    "link": "",
                }
            )
        elif row.get("status") == "awaiting_review":
            activity.append(
                {
                    "id": f"milestone-review-{row['id']}",
                    "category": "milestone_pending_approval",
                    "title": f"{row['title']} awaiting review",
                    "body": "Your contractor has requested review for this milestone.",
                    "tone": "amber",
                    "created_at": row.get("completion_date") or row.get("start_date"),
                    "link": "",
                }
            )
    for row in invoice_rows:
        if row.get("status") == "approved":
            activity.append(
                {
                    "id": f"invoice-approved-{row['id']}",
                    "category": "invoice_approved",
                    "title": f"{row['label']} approved",
                    "body": f"{row.get('amount_label')} is ready for payment.",
                    "tone": "blue",
                    "created_at": row.get("date"),
                    "link": row.get("link", ""),
                }
            )
        elif row.get("status") == "paid":
            activity.append(
                {
                    "id": f"invoice-paid-{row['id']}",
                    "category": "payment_released",
                    "title": f"{row['label']} paid",
                    "body": f"{row.get('amount_label')} has been released.",
                    "tone": "emerald",
                    "created_at": row.get("date"),
                    "link": row.get("link", ""),
                }
            )
    for row in draw_rows:
        if row.get("status") in {"submitted", "changes_requested"}:
            activity.append(
                {
                    "id": f"draw-review-{row['id']}",
                    "category": "milestone_pending_approval",
                    "title": f"{row['label']} needs review",
                    "body": "A draw request is ready for approval.",
                    "tone": "amber",
                    "created_at": row.get("date"),
                    "link": row.get("link", ""),
                }
            )
        elif row.get("status") == "released":
            activity.append(
                {
                    "id": f"draw-released-{row['id']}",
                    "category": "payment_released",
                    "title": f"{row['label']} released",
                    "body": f"{row.get('amount_label')} has been released.",
                    "tone": "emerald",
                    "created_at": row.get("date"),
                    "link": row.get("link", ""),
                }
            )

    for row in message_rows:
        activity.append(
            {
                "id": f"message-{row['id']}",
                "category": "message",
                "title": row.get("milestone_title") or "Project message",
                "body": row.get("body") or "",
                "tone": "slate",
                "created_at": row.get("created_at"),
                "link": "",
            }
        )

    activity.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return activity[:12]


def _project_next_action(agreement, milestone_rows, payment_summary, invoice_rows, draw_rows) -> dict:
    if not agreement:
        return {
            "title": "Your project is getting set up",
            "body": "Your contractor is preparing the agreement and project details.",
            "label": "Open Agreement",
            "tone": "slate",
            "url": "",
        }

    agreement_signed = bool(getattr(agreement, "is_fully_signed", False) or (
        getattr(agreement, "signed_by_contractor", False) and getattr(agreement, "signed_by_homeowner", False)
    ))
    agreement_url = _safe_text(getattr(agreement, "homeowner_access_token", "")) and f"/agreements/magic/{agreement.homeowner_access_token}" or ""

    if not agreement_signed:
        return {
            "title": "Review and sign your agreement",
            "body": "Please review the agreement, then sign to keep the project moving.",
            "label": "Accept & Sign",
            "tone": "amber",
            "url": agreement_url,
        }

    if _safe_text(getattr(agreement, "payment_mode", "")) == "escrow" and not payment_summary.get("escrow_funded"):
        funding_link = ""
        try:
            funding = (
                AgreementFundingLink.objects.filter(
                    agreement=agreement,
                    is_active=True,
                    used_at__isnull=True,
                )
                .order_by("-created_at", "-id")
                .first()
            )
            if funding:
                funding_link = f"/public-fund/{funding.token}"
        except Exception:
            funding_link = ""
        return {
            "title": "Fund the deposit",
            "body": "Your project is ready for escrow funding so work can begin.",
            "label": "Fund Deposit",
            "tone": "blue",
            "url": funding_link,
        }

    awaiting_review = next((row for row in milestone_rows if row.get("status") == "awaiting_review"), None)
    if awaiting_review:
        return {
            "title": f"Review {awaiting_review['title']}",
            "body": "Your contractor has a milestone ready for your review.",
            "label": "Review Milestone",
            "tone": "amber",
            "url": "",
        }

    approved_invoice = next((row for row in invoice_rows if row.get("status") == "approved"), None)
    if approved_invoice:
        return {
            "title": f"Pay {approved_invoice['label']}",
            "body": "An approved invoice is ready for payment.",
            "label": "Pay Invoice",
            "tone": "blue",
            "url": approved_invoice.get("link", ""),
        }

    pending_draw = next((row for row in draw_rows if row.get("status") in {"submitted", "changes_requested"}), None)
    if pending_draw:
        return {
            "title": f"Review {pending_draw['label']}",
            "body": "There is a draw request waiting for review.",
            "label": "Review Draw",
            "tone": "amber",
            "url": pending_draw.get("link", ""),
        }

    if all(row.get("completed") for row in milestone_rows) and milestone_rows:
        review_url = ""
        try:
            contractor = getattr(agreement, "contractor", None)
            profile = getattr(contractor, "public_profile", None) if contractor else None
            if profile and getattr(profile, "slug", ""):
                review_url = f"/contractors/{profile.slug}?review=1"
        except Exception:
            review_url = ""
        return {
            "title": "Your project looks complete",
            "body": "If everything looks good, you can leave a review for your contractor.",
            "label": "Leave Review",
            "tone": "emerald",
            "url": review_url,
        }

    return {
        "title": "Track your project progress",
        "body": "Review the timeline, messages, and recent updates at a glance.",
        "label": "View Timeline",
        "tone": "slate",
        "url": "",
    }


def _project_dashboard_payload(project, agreement, request=None) -> dict:
    milestones = _project_timeline_rows(agreement)
    payment_summary, invoice_rows, draw_rows = _project_payment_rows(agreement)
    message_rows = _project_messages(agreement)
    photo_rows = _project_photo_rows(agreement)
    activity_rows = _project_activity(agreement, milestones, payment_summary, invoice_rows, draw_rows, message_rows)
    next_action = _project_next_action(agreement, milestones, payment_summary, invoice_rows, draw_rows)

    contractor = getattr(project, "contractor", None)
    profile = getattr(contractor, "public_profile", None) if contractor else None
    contractor_rating = {
        "average_rating": getattr(contractor, "average_rating", None),
        "review_count": int(getattr(contractor, "review_count", 0) or 0),
        "display_label": "New on MyHomeBro" if int(getattr(contractor, "review_count", 0) or 0) <= 0 else f"{float(getattr(contractor, 'average_rating', 0) or 0):.2f} average rating",
    }

    agreement_token = str(getattr(agreement, "homeowner_access_token", "") or "")
    agreement_url = f"/agreements/magic/{agreement_token}" if agreement_token else ""
    funding_link = ""
    try:
        funding = (
            AgreementFundingLink.objects.filter(
                agreement=agreement,
                is_active=True,
                used_at__isnull=True,
            )
            .order_by("-created_at", "-id")
            .first()
        )
        if funding:
            funding_link = f"/public-fund/{funding.token}"
    except Exception:
        funding_link = ""

    return {
        "project": {
            "id": project.id,
            "number": _safe_text(getattr(project, "number", "")),
            "title": _safe_text(getattr(project, "title", "")),
            "description": _safe_text(getattr(project, "description", "")),
            "status": _safe_text(getattr(project, "status", "")),
            "status_label": _safe_text(getattr(project, "status", "")).replace("_", " ").title() or "Project",
            "address": ", ".join(
                part
                for part in [
                    _safe_text(getattr(project, "project_street_address", "")),
                    _safe_text(getattr(project, "project_address_line_2", "")),
                    _safe_text(getattr(project, "project_city", "")),
                    _safe_text(getattr(project, "project_state", "")),
                    _safe_text(getattr(project, "project_zip_code", "")),
                ]
                if part
            ),
        },
        "hero": {
            "project_title": _safe_text(getattr(project, "title", "")),
            "project_number": _safe_text(getattr(project, "number", "")),
            "contractor_name": _contractor_name(contractor),
            "contractor_email": _safe_text(getattr(getattr(contractor, "user", None), "email", ""))
            or _safe_text(getattr(contractor, "email", "")),
            "contractor_rating": contractor_rating,
            "status_label": _safe_text(getattr(project, "status", "")).replace("_", " ").title() or "Project",
            "payment_mode_label": payment_summary.get("payment_mode_label", "Escrow"),
            "summary": _safe_text(getattr(agreement, "description", "")) or _safe_text(getattr(project, "description", "")),
            "agreement_url": agreement_url,
            "funding_url": funding_link,
            "public_profile_url": (
                request.build_absolute_uri(profile.public_url_path)
                if request and profile and getattr(profile, "public_url_path", "")
                else _safe_text(getattr(profile, "public_url_path", ""))
            ),
        },
        "next_action": next_action,
        "timeline": milestones,
        "payments": {
            "summary": payment_summary,
            "invoice_rows": invoice_rows,
            "draw_rows": draw_rows,
        },
        "messages": {
            "items": message_rows,
            "latest": message_rows[:3],
        },
        "photos": photo_rows,
        "agreement": {
            "id": getattr(agreement, "id", None),
            "title": _agreement_title(agreement),
            "status": _safe_text(getattr(agreement, "status", "")).replace("_", " ").title() or "Agreement",
            "status_key": _safe_text(getattr(agreement, "status", "")).lower(),
            "project_class_label": project_class_label(getattr(agreement, "project_class", "")),
            "payment_mode_label": payment_summary.get("payment_mode_label", "Escrow"),
            "payment_structure_label": _safe_text(getattr(agreement, "payment_structure", "")).replace("_", " ").title() or "Simple",
            "total_cost_label": f"${Decimal(str(getattr(agreement, 'total_cost', 0) or 0)):,.2f}",
            "agreement_url": agreement_url,
            "pdf_url": _agreement_pdf_url(agreement),
            "funding_url": funding_link,
        },
        "notifications": activity_rows,
        "review": {
            "eligible": bool(all(row.get("completed") for row in milestones) and milestones),
            "message": "Leave a review when the work is finished and everything looks good.",
            "url": (
                request.build_absolute_uri(f"/contractors/{profile.slug}?review=1")
                if request and profile and getattr(profile, "slug", "")
                else _safe_text(getattr(profile, "public_url_path", "")) + "?review=1"
                if profile and getattr(profile, "slug", "")
                else ""
            ),
        },
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


def _source_intake_from_bid_lead(lead):
    source_intake = getattr(lead, "source_intake", None)
    if source_intake is not None:
        return source_intake
    analysis = getattr(lead, "ai_analysis", None) or {}
    source_intake_id = analysis.get("source_intake_id")
    if not source_intake_id:
        return None
    return ProjectIntake.objects.filter(pk=source_intake_id).first()


def _awardable_bid_group(*, email: str, lead, source_intake) -> tuple[str, list[PublicContractorLead]]:
    _, accepted_address, accepted_class = _request_identity_from_lead(lead)
    accepted_key = _comparison_key(email, accepted_address, accepted_class)
    candidates = list(
        PublicContractorLead.objects.select_related("source_intake", "converted_agreement").filter(
            Q(email__iexact=email) | Q(source_intake__customer_email__iexact=email)
        ).exclude(pk=lead.pk)
    )
    if source_intake is not None:
        candidates.extend(
            PublicContractorLead.objects.select_related("source_intake", "converted_agreement").filter(
                ai_analysis__source_intake_id=getattr(source_intake, "id", None)
            ).exclude(pk=lead.pk)
        )
    seen = set()
    grouped = []
    for competitor in candidates:
        if competitor.pk in seen:
            continue
        seen.add(competitor.pk)
        _, competitor_address, competitor_class = _request_identity_from_lead(competitor)
        competitor_key = _comparison_key(email, competitor_address, competitor_class)
        competitor_source_intake = _source_intake_from_bid_lead(competitor)
        if competitor_key == accepted_key or (
            source_intake is not None
            and competitor_source_intake is not None
            and competitor_source_intake.id == source_intake.id
        ):
            grouped.append(competitor)
    return accepted_key, grouped


def _sync_marketplace_award_operational_statuses(*, lead, source_intake, agreement, competing_leads):
    contractor = getattr(lead, "contractor", None)
    analysis = getattr(lead, "ai_analysis", None) or {}
    if source_intake is not None:
        selected_opportunities = ContractorOpportunity.objects.filter(intake_request=source_intake)
        if contractor is not None:
            selected_opportunities.filter(directory_entry__claimed_by_contractor=contractor).update(
                status=ContractorOpportunity.STATUS_CONVERTED,
                accepted_at=timezone.now(),
                accepted_by_contractor=contractor,
                converted_customer=getattr(agreement, "homeowner", None),
                converted_agreement=agreement,
                updated_at=timezone.now(),
            )
        selected_opportunities.exclude(converted_agreement=agreement).exclude(
            status__in=[ContractorOpportunity.STATUS_DECLINED, ContractorOpportunity.STATUS_EXPIRED]
        ).update(status=ContractorOpportunity.STATUS_EXPIRED, updated_at=timezone.now())

        invite_id = analysis.get("marketplace_invite_id")
        if invite_id:
            ContractorDiscoveryInvite.objects.filter(pk=invite_id, public_intake=source_intake).update(
                status=ContractorDiscoveryInvite.STATUS_RESPONDED,
                response_at=timezone.now(),
                agreement=agreement,
                updated_at=timezone.now(),
            )
        ContractorDiscoveryInvite.objects.filter(public_intake=source_intake).exclude(pk=invite_id).exclude(
            status__in=[
                ContractorDiscoveryInvite.STATUS_DECLINED,
                ContractorDiscoveryInvite.STATUS_EXPIRED,
                ContractorDiscoveryInvite.STATUS_OPTED_OUT,
            ]
        ).update(status=ContractorDiscoveryInvite.STATUS_EXPIRED, updated_at=timezone.now())

    for competitor in competing_leads:
        if competitor.status not in {PublicContractorLead.STATUS_ACCEPTED, PublicContractorLead.STATUS_REJECTED}:
            competitor.status = PublicContractorLead.STATUS_CLOSED
            competitor.save(update_fields=["status", "updated_at"])


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
            portal_login_url = f"{_portal_frontend_base() or 'https://www.myhomebro.com'}/portal"
            subject = "Your MyHomeBro Customer Portal Access Link"
            text_body = (
                "Hello,\n\n"
                "Your secure MyHomeBro Customer Portal is ready.\n\n"
                "Access:\n"
                "- Projects and milestones\n"
                "- Payments and invoices\n"
                "- Documents and warranties\n"
                "- Property records and project history\n\n"
                f"Access Customer Portal:\n{link}\n\n"
                "If you did not request this link, you may safely ignore this email.\n\n"
                "Returning customer?\n"
                f"You can log in directly at:\n{portal_login_url}\n\n"
                "-- MyHomeBro"
            )
            html_body = (
                "<p>Hello,</p>"
                "<p>Your secure MyHomeBro Customer Portal is ready.</p>"
                "<p>Access:</p>"
                "<ul>"
                "<li>Projects and milestones</li>"
                "<li>Payments and invoices</li>"
                "<li>Documents and warranties</li>"
                "<li>Property records and project history</li>"
                "</ul>"
                f"<p><a href=\"{link}\" style=\"display:inline-block;background:#fbbf24;color:#0f172a;"
                "padding:12px 18px;border-radius:12px;font-weight:700;text-decoration:none;\">"
                "Access Customer Portal</a></p>"
                "<p>If you did not request this link, you may safely ignore this email.</p>"
                "<p>Returning customer?</p>"
                f"<p>You can log in directly at:<br><a href=\"{portal_login_url}\">{portal_login_url}</a></p>"
                "<p>-- MyHomeBro</p>"
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


class CustomerPortalAccountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        email = _safe_text(getattr(request.user, "email", "")).lower()
        if not email:
            return Response({"detail": "Your account does not have an email address."}, status=status.HTTP_400_BAD_REQUEST)
        if not _request_has_records(email):
            return Response({"detail": "No customer records are connected to this account email yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalCreatePasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        if attrs.get("password") != attrs.get("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        email = self.context.get("email") or ""
        user = User.objects.filter(email__iexact=email).first()
        validate_password(attrs["password"], user=user)
        return attrs


class CustomerPortalCreatePasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        if not _request_has_records(email):
            return Response({"detail": "No customer records are connected to this email."}, status=status.HTTP_404_NOT_FOUND)

        serializer = CustomerPortalCreatePasswordSerializer(data=request.data, context={"email": email})
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.create_user(email=email, password=serializer.validated_data["password"])
        else:
            user.set_password(serializer.validated_data["password"])
            if not user.is_active:
                user.is_active = True
            user.save(update_fields=["password", "is_active"])

        return Response(
            {
                "ok": True,
                "detail": "Password created. You can log in with this email next time.",
                "portal": _build_customer_portal_payload(email, request=request),
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


class CustomerPortalNotificationMarkReadView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, notification_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        notification = get_object_or_404(
            SmartNotification.objects.select_related(
                "property_profile",
                "customer_request",
                "project",
                "project__homeowner",
                "agreement",
                "agreement__homeowner",
                "agreement__project",
                "agreement__project__homeowner",
                "invoice",
                "invoice__agreement",
                "invoice__agreement__homeowner",
                "invoice__agreement__project",
                "invoice__agreement__project__homeowner",
                "milestone",
                "milestone__agreement",
                "milestone__agreement__homeowner",
                "milestone__agreement__project",
                "milestone__agreement__project__homeowner",
                "draw_request",
                "draw_request__agreement",
                "draw_request__agreement__homeowner",
                "draw_request__agreement__project",
                "draw_request__agreement__project__homeowner",
            ),
            pk=notification_id,
        )
        if not _smart_notification_belongs_to_email(notification, email):
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        if notification.status != SmartNotification.STATUS_READ:
            notification.status = SmartNotification.STATUS_READ
            notification.read_at = timezone.now()
            notification.save(update_fields=["status", "read_at"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalRequestSerializer(serializers.Serializer):
    property_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    request_type = serializers.ChoiceField(choices=[choice[0] for choice in CustomerRequest.REQUEST_TYPE_CHOICES])
    title = serializers.CharField(max_length=200)
    description = serializers.CharField()
    urgency = serializers.CharField(max_length=32, required=False, allow_blank=True)
    preferred_timeline = serializers.CharField(max_length=120, required=False, allow_blank=True)
    address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    state = serializers.CharField(max_length=60, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=24, required=False, allow_blank=True)
    status = serializers.ChoiceField(
        choices=[CustomerRequest.STATUS_DRAFT, CustomerRequest.STATUS_SUBMITTED],
        required=False,
    )


class CustomerPortalRequestCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile = _property_profile_for_email_or_404(email, data.get("property_id"))
        homeowner = _primary_homeowner_for_email(email)
        address_defaults = {
            "address_line1": data.get("address_line1") or profile.address_line1,
            "address_line2": data.get("address_line2") or profile.address_line2,
            "city": data.get("city") or profile.city,
            "state": data.get("state") or profile.state,
            "postal_code": data.get("postal_code") or profile.postal_code,
        }
        customer_request = CustomerRequest.objects.create(
            homeowner=homeowner,
            property_profile=profile,
            customer_email=email.lower().strip(),
            request_type=data["request_type"],
            status=data.get("status") or CustomerRequest.STATUS_SUBMITTED,
            title=data["title"],
            description=data["description"],
            urgency=data.get("urgency", ""),
            preferred_timeline=data.get("preferred_timeline", ""),
            **address_defaults,
        )
        create_smart_notification(
            event_type=SmartNotificationEvent.CUSTOMER_REQUEST_SUBMITTED,
            recipient_email=email,
            homeowner=homeowner,
            customer_request=customer_request,
            property_profile=profile,
            context={
                "request_title": customer_request.title,
                "request_type": customer_request.get_request_type_display(),
                "status": customer_request.status,
            },
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)


class CustomerPortalPropertyProfileSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    display_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    property_type = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyProfile.PROPERTY_TYPE_CHOICES],
        required=False,
    )
    address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    state = serializers.CharField(max_length=60, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=24, required=False, allow_blank=True)
    year_built = serializers.IntegerField(required=False, allow_null=True, min_value=1600, max_value=2200)
    square_feet = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=1000000)
    notes = serializers.CharField(required=False, allow_blank=True)
    is_primary = serializers.BooleanField(required=False)


class CustomerPortalProfileSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    state = serializers.CharField(max_length=50, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=20, required=False, allow_blank=True)


class CustomerPortalProfileView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        homeowner = _get_or_create_homeowner_for_email(email)

        field_map = {
            "full_name": "full_name",
            "phone_number": "phone_number",
            "address_line1": "street_address",
            "address_line2": "address_line_2",
            "city": "city",
            "state": "state",
            "postal_code": "zip_code",
        }
        update_fields = []
        for source, target in field_map.items():
            if source not in data:
                continue
            setattr(homeowner, target, data[source])
            update_fields.append(target)
        if update_fields:
            update_fields.append("updated_at")
            homeowner.save(update_fields=sorted(set(update_fields)))
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalPropertyProfileView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalPropertyProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        homeowner = _primary_homeowner_for_email(email)
        should_be_primary = bool(data.pop("is_primary", False)) or not PropertyProfile.objects.filter(customer_email__iexact=email).exists()
        data.pop("id", None)
        profile = PropertyProfile.objects.create(
            homeowner=homeowner,
            customer_email=email.lower().strip(),
            is_primary=should_be_primary,
            **data,
        )
        if profile.is_primary:
            PropertyProfile.objects.filter(customer_email__iexact=email).exclude(pk=profile.pk).update(is_primary=False)
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalPropertyProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        profile = _property_profile_for_email_or_404(email, data.pop("id", None))
        make_primary = data.pop("is_primary", None)
        for field, value in serializer.validated_data.items():
            if field in {"id", "is_primary"}:
                continue
            setattr(profile, field, value if value is not None else None)
        if make_primary is not None:
            profile.is_primary = bool(make_primary)
        profile.save()
        if profile.is_primary:
            PropertyProfile.objects.filter(customer_email__iexact=email).exclude(pk=profile.pk).update(is_primary=False)
        create_smart_notification(
            event_type=SmartNotificationEvent.PROPERTY_PROFILE_UPDATED,
            recipient_email=email,
            homeowner=profile.homeowner,
            property_profile=profile,
            context={
                "property_name": profile.display_name or "Property profile",
                "property_address": ", ".join(
                    part
                    for part in [profile.address_line1, profile.city, profile.state, profile.postal_code]
                    if _safe_text(part)
                ),
            },
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalPropertyUploadView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, token: str, upload_kind: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        if upload_kind not in {"documents", "photos"}:
            return Response({"detail": "Unsupported upload type."}, status=status.HTTP_404_NOT_FOUND)

        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            files = list(request.FILES.values())
            uploaded_file = files[0] if files else None
        if uploaded_file is None:
            return Response({"detail": "Please attach a file."}, status=status.HTTP_400_BAD_REQUEST)

        profile = _get_or_create_property_profile(email)
        title = _safe_text(request.data.get("title")) or _safe_text(getattr(uploaded_file, "name", "")) or "Property file"
        if upload_kind == "photos":
            PropertyPhoto.objects.create(
                property_profile=profile,
                title=title,
                photo=uploaded_file,
            )
        else:
            PropertyDocument.objects.create(
                property_profile=profile,
                title=title,
                document_type=_safe_text(request.data.get("document_type")) or "Property Document",
                file=uploaded_file,
            )

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)


class CustomerProjectDashboardView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def _resolve_project(self, project_id: int, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            raise PermissionError("This project link has expired.")
        except signing.BadSignature:
            raise PermissionError("Invalid project link.")

        project = get_object_or_404(Project.objects.select_related("contractor", "homeowner"), pk=project_id)
        agreement = _project_agreement(project)
        customer_email = _project_customer_email(project, agreement)
        if not customer_email or customer_email != email.lower().strip():
            raise LookupError("This project link does not match your records.")
        if not _project_customer_visible_reason(project, agreement, email):
            raise LookupError("This project is not visible in your customer portal.")
        return project, agreement, email

    def get(self, request, project_id: int):
        token = _safe_text(request.query_params.get("token", ""))
        if not token:
            return Response({"detail": "Missing token."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            project, agreement, _email = self._resolve_project(project_id, token)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(_project_dashboard_payload(project, agreement, request=request), status=status.HTTP_200_OK)

    def post(self, request, project_id: int):
        token = _safe_text(request.query_params.get("token", ""))
        if not token:
            return Response({"detail": "Missing token."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            project, agreement, _email = self._resolve_project(project_id, token)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)

        if agreement is None:
            return Response({"detail": "This project is not ready for uploads yet."}, status=status.HTTP_400_BAD_REQUEST)

        files = []
        if hasattr(request, "FILES"):
            files = request.FILES.getlist("files") or request.FILES.getlist("file")
            if not files:
                files = list(request.FILES.values())
        if not files:
            return Response({"detail": "Please attach at least one file."}, status=status.HTTP_400_BAD_REQUEST)

        uploaded = []
        for index, uploaded_file in enumerate(files, start=1):
            base_name = _safe_text(getattr(uploaded_file, "name", "")) or f"Photo {index}"
            title = _safe_text(request.data.get("title", "")) or base_name.rsplit(".", 1)[0] or f"Photo {index}"
            attachment = AgreementAttachment.objects.create(
                agreement=agreement,
                title=title,
                category=AgreementAttachment.CATEGORY_OTHER,
                file=uploaded_file,
                visible_to_homeowner=True,
                ack_required=False,
                uploaded_by=None,
            )
            uploaded.append(
                {
                    "id": attachment.id,
                    "title": attachment.title,
                    "category": attachment.category,
                    "url": _safe_text(getattr(getattr(attachment, "file", None), "url", "")),
                    "uploaded_at": _safe_dt(getattr(attachment, "uploaded_at", None)),
                }
            )

        payload = _project_dashboard_payload(project, agreement, request=request)
        payload["uploaded"] = uploaded
        return Response(payload, status=status.HTTP_201_CREATED)


class CustomerPortalDrawDisputeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalDrawDisputeView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, draw_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalDrawDisputeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        draw = get_object_or_404(
            DrawRequest.objects.select_related(
                "agreement",
                "agreement__homeowner",
                "agreement__project",
                "agreement__project__homeowner",
            ).prefetch_related("line_items", "line_items__milestone"),
            pk=draw_id,
        )
        agreement = getattr(draw, "agreement", None)
        if not agreement or _agreement_customer_email(agreement) != email.lower().strip():
            return Response({"detail": "Draw request not found."}, status=status.HTTP_404_NOT_FOUND)

        if _safe_text(getattr(draw, "status", "")).lower() in {DrawRequestStatus.RELEASED, DrawRequestStatus.PAID}:
            return Response({"detail": "This payment has already been completed and cannot be disputed from the portal."}, status=status.HTTP_400_BAD_REQUEST)

        reason = serializer.validated_data["reason"].strip()
        description = serializer.validated_data.get("description", "").strip()
        milestone = None
        try:
            first_line = draw.line_items.filter(milestone__isnull=False).first()
            milestone = getattr(first_line, "milestone", None) if first_line else None
        except Exception:
            milestone = None

        source_line = f"[Portal Source] draw_id={draw.id} draw_number={getattr(draw, 'draw_number', '')}"
        full_description = "\n\n".join(part for part in [description, source_line] if part)

        with transaction.atomic():
            existing = (
                Dispute.objects.select_for_update()
                .filter(
                    agreement=agreement,
                    milestone=milestone,
                    initiator="homeowner",
                    status__in=["initiated", "open", "under_review"],
                    description__icontains=f"draw_id={draw.id}",
                )
                .order_by("-created_at", "-id")
                .first()
            )
            if existing:
                dispute = existing
            else:
                dispute = Dispute.objects.create(
                    agreement=agreement,
                    milestone=milestone,
                    initiator="homeowner",
                    reason=reason,
                    description=full_description,
                    status="open",
                    escrow_frozen=True,
                )
                dispute.set_response_deadline_now()
                dispute.save(update_fields=[
                    "public_token",
                    "response_due_at",
                    "deadline_hours",
                    "deadline_tier",
                    "last_activity_at",
                    "status",
                    "escrow_frozen",
                    "updated_at",
                ])
                try:
                    notify_dispute_event(
                        dispute=dispute,
                        event_type=Notification.EVENT_DISPUTE_OPENED,
                        actor_user=None,
                    )
                except Exception:
                    pass

            draw.homeowner_acted_at = timezone.now()
            draw.homeowner_review_notes = "\n\n".join(part for part in [draw.homeowner_review_notes, f"Dispute opened: {reason}", description] if _safe_text(part))
            draw.save(update_fields=["homeowner_acted_at", "homeowner_review_notes", "updated_at"])

        public_url = f"/disputes/{dispute.id}?token={dispute.public_token}"
        portal_payload = _build_customer_portal_payload(email, request=request)
        return Response(
            {
                "ok": True,
                "dispute": {
                    "id": dispute.id,
                    "status": dispute.status,
                    "status_label": _safe_text(dispute.status).replace("_", " ").title(),
                    "public_token": dispute.public_token,
                    "public_url": public_url,
                    "reason": dispute.reason,
                },
                "portal": portal_payload,
            },
            status=status.HTTP_201_CREATED,
        )


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
        source_intake = _source_intake_from_bid_lead(lead)
        if _safe_text(getattr(lead, "email", "")).lower() != email and _safe_text(getattr(source_intake, "customer_email", "")).lower() != email:
            return Response({"detail": "You can only choose bids for your own request."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            lead = (
                PublicContractorLead.objects.select_for_update()
                .select_related("contractor", "contractor__user", "converted_homeowner", "converted_agreement")
                .get(pk=lead.pk)
            )
            source_intake = _source_intake_from_bid_lead(lead)
            if _safe_text(getattr(lead, "email", "")).lower() != email and _safe_text(getattr(source_intake, "customer_email", "")).lower() != email:
                return Response({"detail": "You can only choose bids for your own request."}, status=status.HTTP_403_FORBIDDEN)

            already_linked = bool(getattr(lead, "converted_agreement_id", None))
            blocked_statuses = {
                PublicContractorLead.STATUS_REJECTED,
                PublicContractorLead.STATUS_CLOSED,
                PublicContractorLead.STATUS_ARCHIVED,
            }
            if not already_linked and lead.status in blocked_statuses:
                return Response({"detail": "This bid is no longer available for award."}, status=status.HTTP_400_BAD_REQUEST)
            contractor = getattr(lead, "contractor", None)
            contractor_user = getattr(contractor, "user", None)
            if not already_linked and contractor_user is not None and not getattr(contractor_user, "is_active", True):
                return Response({"detail": "This contractor is not currently eligible for new marketplace awards."}, status=status.HTTP_400_BAD_REQUEST)
            analysis = getattr(lead, "ai_analysis", None) or {}
            marketplace_bid = bool(
                analysis.get("marketplace_request")
                or (source_intake is not None and getattr(source_intake, "post_submit_flow", "") == "multi_contractor")
            )
            if marketplace_bid and not already_linked:
                block_reason = contractor_marketplace_action_block_reason(contractor)
                if block_reason:
                    return Response({"detail": block_reason}, status=status.HTTP_400_BAD_REQUEST)

            _, competing_group = _awardable_bid_group(email=email, lead=lead, source_intake=source_intake)
            already_awarded = [
                competitor for competitor in competing_group
                if getattr(competitor, "converted_agreement_id", None)
                or competitor.status == PublicContractorLead.STATUS_ACCEPTED
            ]
            if not already_linked and already_awarded:
                return Response({"detail": "This marketplace request has already been awarded."}, status=status.HTTP_409_CONFLICT)

            homeowner = getattr(lead, "converted_homeowner", None)
            agreement, created = promote_public_lead_to_agreement(lead=lead, homeowner=homeowner)
            _sync_marketplace_award_operational_statuses(
                lead=lead,
                source_intake=source_intake,
                agreement=agreement,
                competing_leads=competing_group,
            )

            create_bid_outcome_notifications(
                accepted_lead=lead,
                agreement=agreement,
                competing_leads=competing_group,
            )

        return Response(
            {
                "ok": True,
                "created": created,
                "award_status": "agreement_draft_created",
                "banner": "Agreement draft created from awarded marketplace bid.",
                "agreement_id": getattr(agreement, "id", None),
                "project_id": getattr(getattr(agreement, "project", None), "id", None),
                "detail_url": f"/agreements/magic/{agreement.homeowner_access_token}",
                "wizard_url": f"/app/agreements/{agreement.id}/wizard?step=1",
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalReimbursementApproveView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, reimbursement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "Portal link expired."}, status=status.HTTP_401_UNAUTHORIZED)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_401_UNAUTHORIZED)

        expense = get_object_or_404(
            ExpenseRequest.objects.select_related("agreement", "agreement__homeowner", "agreement__project"),
            pk=reimbursement_id,
            request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
            is_archived=False,
        )
        if _agreement_customer_email(expense.agreement) != email:
            return Response({"detail": "You can only approve reimbursement requests for your own project."}, status=status.HTTP_403_FORBIDDEN)
        try:
            expense = approve_reimbursement(expense, reviewed_by=request.user if getattr(request.user, "is_authenticated", False) else None)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": "Reimbursement approved and queued for escrow release.",
                "reimbursement_id": expense.id,
                "status": expense.status,
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalReimbursementDenyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, reimbursement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "Portal link expired."}, status=status.HTTP_401_UNAUTHORIZED)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_401_UNAUTHORIZED)

        reason = _safe_text(request.data.get("denial_reason") or request.data.get("reason"))
        if not reason:
            return Response({"detail": "Please provide a reason for denying this reimbursement."}, status=status.HTTP_400_BAD_REQUEST)
        expense = get_object_or_404(
            ExpenseRequest.objects.select_related("agreement", "agreement__homeowner", "agreement__project"),
            pk=reimbursement_id,
            request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
            is_archived=False,
        )
        if _agreement_customer_email(expense.agreement) != email:
            return Response({"detail": "You can only deny reimbursement requests for your own project."}, status=status.HTTP_403_FORBIDDEN)
        try:
            expense = deny_reimbursement(
                expense,
                reviewed_by=request.user if getattr(request.user, "is_authenticated", False) else None,
                reason=reason,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": "Reimbursement denied.",
                "reimbursement_id": expense.id,
                "status": expense.status,
                "denial_reason": expense.denial_reason,
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
