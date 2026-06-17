from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
from io import BytesIO
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from receipts.models import Receipt
from projects.models import (
    Agreement,
    AgreementFundingLink,
    Contractor,
    ContractorReview,
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
from projects.models_customer_portal import (
    CustomerNotificationCleanupPreference,
    CustomerPortalUploadSession,
    CustomerRequest,
    NotificationRule,
    PropertyDocument,
    PropertyDocumentExtraction,
    PropertyHomeSystem,
    PropertyHomeSystemRecommendationPreference,
    PropertyManagementCompany,
    PropertyManagementStaffMembership,
    PropertyVendor,
    PropertyWorkOrderActivity,
    PropertyWorkOrderAttachment,
    PropertyWorkOrder,
    PropertyUnit,
    PropertyPhoto,
    PropertyProfile,
    SmartNotification,
    SmartNotificationEvent,
    Tenant,
    TenantMaintenanceRequest,
    TenantMaintenanceRequestAttachment,
    Tenancy,
)
from projects.services.customer_notification_cleanup import (
    cleanup_preferences_for_email,
    cleanup_preferences_payload,
    next_cleanup_run_at,
)
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorDiscoveryInvite, ContractorOpportunity
from projects.models_dispute import Dispute
from projects.models_amendment_request import AmendmentRequest, AmendmentRequestAttachment, apply_descoped_milestone_hold
from projects.models_customer_refund_request import CustomerRefundRequest
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
from projects.services.contractor_reviews import review_eligibility, serialize_review, submit_customer_review
from projects.services.smart_notifications import create_smart_notification
from projects.services.notification_center import create_notification
from projects.services.maintenance_work_orders import customer_visible_work_order_queryset
from projects.services.marketplace_permissions import contractor_marketplace_action_block_reason
from projects.services.contractor_opportunities import create_or_update_opportunity_from_selection
from projects.services.property_intelligence import build_property_intelligence
from projects.services.home_system_reminders import build_home_system_reminder
from projects.services.customer_lifecycle import sync_customer_request_agreement_links
from projects.services.home_system_document_extraction import extract_home_system_document
from projects.services.customer_portal_supplies import (
    build_home_system_supply_recommendations,
    build_project_material_recommendations,
)
from projects.services.property_management import (
    company_payload,
    create_or_sync_company_from_homeowner,
    homeowner_is_property_management_company,
    managed_properties_for_company,
    units_for_property,
)
from projects.services.recommendations import build_customer_recommendations
from projects.services.workflow_notifications import notify_dispute_event
from projects.services.customer_portal_status import build_customer_payment_model, enrich_customer_portal_rows
from projects.services.project_activity import create_project_activity_event, serialize_project_activity_events
from projects.services.ai.project_understanding import understand_project_request

PORTAL_TOKEN_SALT = "myhomebro.customer-portal"
PORTAL_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14
TENANT_MAINTENANCE_TOKEN_SALT = "myhomebro.tenant-maintenance-request"
TENANT_MAINTENANCE_VERIFICATION_SALT = "myhomebro.tenant-maintenance-verification"
TENANT_MAINTENANCE_VERIFICATION_MAX_AGE_SECONDS = 60 * 30
TENANT_MAINTENANCE_VERIFICATION_FAILURE_DETAIL = "We could not verify those details. Check the information and try again."
TENANT_MAINTENANCE_ATTACHMENT_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
TENANT_MAINTENANCE_ATTACHMENT_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/octet-stream",
}
TENANT_MAINTENANCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
TENANT_MAINTENANCE_ATTACHMENT_MAX_COUNT = 5
HOME_SYSTEM_SCAN_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
HOME_SYSTEM_SCAN_DOCUMENT_TYPES = {
    "Equipment Label",
    "Receipt",
    "Invoice",
    "Warranty",
    "Manual",
    "Service Record",
    "Other",
}
HOME_SYSTEM_SCAN_UPLOAD_SOURCES = {
    PropertyDocument.UPLOAD_SOURCE_PORTAL_DESKTOP,
    PropertyDocument.UPLOAD_SOURCE_QR_MOBILE_WEB,
    PropertyDocument.UPLOAD_SOURCE_MOBILE_APP,
}
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


def _serialize_document_extraction(document: PropertyDocument) -> dict:
    try:
        extraction = getattr(document, "extraction", None)
    except PropertyDocumentExtraction.DoesNotExist:
        extraction = None
    if not extraction:
        return {
            "status": "",
            "document_classification": "",
            "suggested_fields": {},
            "reviewed_at": "",
            "applied_at": "",
            "error_message": "",
        }
    return {
        "id": extraction.id,
        "status": _safe_text(extraction.extraction_status),
        "document_classification": _safe_text(extraction.document_classification),
        "suggested_fields": extraction.suggested_fields or {},
        "reviewed_at": _safe_dt(extraction.reviewed_at),
        "applied_at": _safe_dt(extraction.applied_at),
        "error_message": _safe_text(extraction.error_message),
    }


def _property_document_payload(row: PropertyDocument, *, include_record_id: bool = False) -> dict:
    payload = {
        "id": f"property-document-{row.id}",
        "title": _safe_text(row.title) or "Property document",
        "type_label": _safe_text(row.document_type) or "Property Document",
        "filename": _safe_text(getattr(getattr(row, "file", None), "name", "")).rsplit("/", 1)[-1],
        "date": _safe_dt(row.uploaded_at),
        "url": _safe_text(getattr(getattr(row, "file", None), "url", "")),
        "upload_source": _safe_text(getattr(row, "upload_source", "")),
        "extraction": _serialize_document_extraction(row),
    }
    if include_record_id:
        payload["record_id"] = row.id
    return payload


def _property_management_company_ref(company: PropertyManagementCompany | None) -> dict | None:
    if company is None:
        return None
    return {
        "id": company.id,
        "name": _safe_text(company.name),
        "is_active": bool(company.is_active),
    }


def _property_unit_payload(unit: PropertyUnit) -> dict:
    return {
        "id": unit.id,
        "unit_label": _safe_text(unit.unit_label),
        "unit_type": _safe_text(unit.unit_type),
        "unit_type_label": unit.get_unit_type_display(),
        "status": _safe_text(unit.status),
        "status_label": unit.get_status_display(),
        "access_notes": _safe_text(unit.access_notes),
        "notes": _safe_text(unit.notes),
        "updated_at": _safe_dt(unit.updated_at),
    }


def _tenancy_payload(tenancy: Tenancy) -> dict:
    tenant = tenancy.tenant
    unit = tenancy.unit
    return {
        "id": tenancy.id,
        "tenant_id": tenant.id,
        "first_name": _safe_text(tenant.first_name),
        "last_name": _safe_text(tenant.last_name),
        "name": _safe_text(getattr(tenant, "display_name", "")),
        "email": _safe_text(tenant.email),
        "phone": _safe_text(tenant.phone),
        "tenant_status": _safe_text(tenant.status),
        "tenant_status_label": tenant.get_status_display(),
        "status": _safe_text(tenancy.status),
        "status_label": tenancy.get_status_display(),
        "property_profile_id": tenancy.property_profile_id,
        "unit_id": tenancy.unit_id,
        "unit_label": _safe_text(getattr(unit, "unit_label", "")) if unit else "",
        "unit": _property_unit_payload(unit) if unit else None,
        "move_in_date": tenancy.move_in_date.isoformat() if tenancy.move_in_date else "",
        "move_out_date": tenancy.move_out_date.isoformat() if tenancy.move_out_date else "",
        "emergency_contact_name": _safe_text(tenant.emergency_contact_name),
        "emergency_contact_phone": _safe_text(tenant.emergency_contact_phone),
        "maintenance_access_enabled": bool(tenant.maintenance_access_enabled),
        "portal_enabled": bool(tenant.portal_enabled),
        "notes": _safe_text(tenancy.notes or tenant.notes),
        "tenant_notes": _safe_text(tenant.notes),
        "tenancy_notes": _safe_text(tenancy.notes),
        "updated_at": _safe_dt(max(tenant.updated_at, tenancy.updated_at)),
    }


def _tenant_payloads_for_property(property_profile: PropertyProfile | None) -> list[dict]:
    if property_profile is None:
        return []
    rows = (
        Tenancy.objects.select_related("tenant", "unit", "property_profile")
        .filter(property_profile=property_profile)
        .order_by("unit__unit_label", "tenant__last_name", "tenant__first_name", "id")
    )
    return [_tenancy_payload(row) for row in rows]


def _tenant_maintenance_request_token(property_profile: PropertyProfile, unit: PropertyUnit | None = None) -> str:
    payload = {"property_id": property_profile.id}
    if unit is not None:
        payload["unit_id"] = unit.id
    return signing.dumps(payload, salt=TENANT_MAINTENANCE_TOKEN_SALT)


def _tenant_maintenance_uploaded_files(request) -> list:
    files = []
    for key in ["attachments", "files", "file"]:
        files.extend(request.FILES.getlist(key))
    if not files:
        files = list(request.FILES.values())
    unique = []
    seen = set()
    for uploaded_file in files:
        identity = id(uploaded_file)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(uploaded_file)
    return unique


def _property_work_order_uploaded_files(request) -> list:
    files = []
    for key in ["completion_attachments", "attachments", "files", "file"]:
        files.extend(request.FILES.getlist(key))
    if not files:
        files = list(request.FILES.values())
    unique = []
    seen = set()
    for uploaded_file in files:
        identity = id(uploaded_file)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(uploaded_file)
    return unique


def _validate_tenant_maintenance_attachment(uploaded_file) -> None:
    filename = _safe_text(getattr(uploaded_file, "name", ""))
    extension = f".{filename.rsplit('.', 1)[-1].lower()}" if "." in filename else ""
    content_type = _safe_text(getattr(uploaded_file, "content_type", "")).lower()
    size = int(getattr(uploaded_file, "size", 0) or 0)
    max_bytes = int(getattr(settings, "TENANT_MAINTENANCE_ATTACHMENT_MAX_BYTES", TENANT_MAINTENANCE_ATTACHMENT_MAX_BYTES))
    if extension not in TENANT_MAINTENANCE_ATTACHMENT_ALLOWED_EXTENSIONS:
        raise serializers.ValidationError("Unsupported file type. Upload JPG, PNG, WEBP, or PDF.")
    if content_type and content_type not in TENANT_MAINTENANCE_ATTACHMENT_ALLOWED_CONTENT_TYPES:
        raise serializers.ValidationError("Unsupported file type. Upload JPG, PNG, WEBP, or PDF.")
    if size > max_bytes:
        raise serializers.ValidationError(f"Attachment is too large. Upload files up to {max_bytes // (1024 * 1024)} MB.")


def _validate_tenant_maintenance_attachments(files: list) -> None:
    max_count = int(getattr(settings, "TENANT_MAINTENANCE_ATTACHMENT_MAX_COUNT", TENANT_MAINTENANCE_ATTACHMENT_MAX_COUNT))
    if len(files) > max_count:
        raise serializers.ValidationError(f"Upload up to {max_count} attachments.")
    for uploaded_file in files:
        _validate_tenant_maintenance_attachment(uploaded_file)


def _validate_property_work_order_attachments(files: list) -> None:
    _validate_tenant_maintenance_attachments(files)


def _tenant_maintenance_attachment_payload(attachment: TenantMaintenanceRequestAttachment) -> dict:
    file_obj = getattr(attachment, "file", None)
    url = ""
    try:
        url = file_obj.url if file_obj else ""
    except Exception:
        url = ""
    content_type = _safe_text(attachment.content_type)
    return {
        "id": attachment.id,
        "filename": _safe_text(attachment.original_filename) or _safe_text(getattr(file_obj, "name", "")).rsplit("/", 1)[-1],
        "content_type": content_type,
        "size_bytes": int(attachment.size_bytes or 0),
        "url": url,
        "is_image": content_type.startswith("image/"),
        "created_at": _safe_dt(attachment.created_at),
    }


def _resolve_tenant_maintenance_token(token: str):
    try:
        payload = signing.loads(token, salt=TENANT_MAINTENANCE_TOKEN_SALT, max_age=PORTAL_TOKEN_MAX_AGE_SECONDS)
    except signing.SignatureExpired:
        return None, None, Response({"detail": "This maintenance request link has expired."}, status=status.HTTP_403_FORBIDDEN)
    except signing.BadSignature:
        return None, None, Response({"detail": "Invalid maintenance request link."}, status=status.HTTP_403_FORBIDDEN)
    property_id = payload.get("property_id") if isinstance(payload, dict) else None
    unit_id = payload.get("unit_id") if isinstance(payload, dict) else None
    property_profile = get_object_or_404(PropertyProfile.objects.select_related("managed_by_company"), pk=property_id)
    if not getattr(property_profile, "managed_by_company_id", None):
        return None, None, Response({"detail": "This property is not accepting tenant maintenance requests yet."}, status=status.HTTP_404_NOT_FOUND)
    unit = None
    if unit_id:
        unit = get_object_or_404(PropertyUnit.objects.filter(property_profile=property_profile), pk=unit_id)
    return property_profile, unit, None


def _tenant_maintenance_request_payload(row: TenantMaintenanceRequest) -> dict:
    property_profile = getattr(row, "property_profile", None)
    unit = getattr(row, "unit", None)
    tenant = getattr(row, "tenant", None)
    submitted_name = _safe_text(row.submitted_by_name) or _safe_text(getattr(tenant, "display_name", ""))
    active_work_order = (
        PropertyWorkOrder.objects.filter(source_tenant_request=row, status__in=PropertyWorkOrder.ACTIVE_STATUSES)
        .order_by("-created_at", "-id")
        .first()
    )
    return {
        "id": row.id,
        "reference": f"TMR-{row.id:06d}",
        "property_profile_id": getattr(property_profile, "id", None),
        "property_name": _safe_text(getattr(property_profile, "display_name", "")),
        "unit_id": getattr(unit, "id", None),
        "unit_label": _safe_text(getattr(unit, "unit_label", "")) if unit else "",
        "tenant_id": getattr(tenant, "id", None),
        "tenant_name": _safe_text(getattr(tenant, "display_name", "")),
        "submitted_by_name": submitted_name,
        "submitted_by_email": _safe_text(row.submitted_by_email),
        "submitted_by_phone": _safe_text(row.submitted_by_phone),
        "category": _safe_text(row.category),
        "category_label": row.get_category_display(),
        "urgency": _safe_text(row.urgency),
        "urgency_label": row.get_urgency_display(),
        "title": _safe_text(row.title),
        "description": _safe_text(row.description),
        "permission_to_enter": bool(row.permission_to_enter),
        "pets_present": bool(row.pets_present),
        "preferred_access_times": _safe_text(row.preferred_access_times),
        "status": _safe_text(row.status),
        "status_label": row.get_status_display(),
        "manager_notes": _safe_text(row.manager_notes),
        "reviewed_by": _safe_text(row.reviewed_by),
        "reviewed_at": _safe_dt(row.reviewed_at),
        "work_order_id": getattr(active_work_order, "id", None),
        "work_order_number": _safe_text(getattr(active_work_order, "work_order_number", "")),
        "converted_to_work_order": active_work_order is not None,
        "can_create_work_order": row.status == TenantMaintenanceRequest.STATUS_APPROVED and active_work_order is None,
        "attachments": [_tenant_maintenance_attachment_payload(attachment) for attachment in row.attachments.all()],
        "attachment_count": row.attachments.count(),
        "created_at": _safe_dt(row.created_at),
        "updated_at": _safe_dt(row.updated_at),
    }


def _property_work_order_payload(row: PropertyWorkOrder) -> dict:
    property_profile = getattr(row, "property_profile", None)
    unit = getattr(row, "unit", None)
    tenant = getattr(row, "tenant", None)
    assigned = getattr(row, "assigned_staff_member", None)
    assigned_vendor = getattr(row, "assigned_vendor", None)
    assigned_contractor = getattr(row, "assigned_contractor", None)
    source_request = getattr(row, "source_tenant_request", None)
    source_attachments = []
    if source_request is not None:
        source_attachments = [_tenant_maintenance_attachment_payload(attachment) for attachment in source_request.attachments.all()]
    completion_attachments = [_property_work_order_attachment_payload(attachment) for attachment in row.attachments.all()]
    activities = [_property_work_order_activity_payload(activity) for activity in row.activities.all()]
    return {
        "id": row.id,
        "work_order_number": _safe_text(row.work_order_number) or f"PWO-{row.id:06d}",
        "reference": _safe_text(row.work_order_number) or f"PWO-{row.id:06d}",
        "property_management_company_id": row.property_management_company_id,
        "property_profile_id": row.property_profile_id,
        "property_name": _safe_text(getattr(property_profile, "display_name", "")),
        "unit_id": row.unit_id,
        "unit_label": _safe_text(getattr(unit, "unit_label", "")) if unit else "",
        "tenant_id": row.tenant_id,
        "tenant_name": _safe_text(getattr(tenant, "display_name", "")) if tenant else "",
        "source_tenant_request_id": row.source_tenant_request_id,
        "source_tenant_request_reference": f"TMR-{source_request.id:06d}" if source_request else "",
        "title": _safe_text(row.title),
        "description": _safe_text(row.description),
        "category": _safe_text(row.category),
        "category_label": row.get_category_display(),
        "priority": _safe_text(row.priority),
        "priority_label": row.get_priority_display(),
        "status": _safe_text(row.status),
        "status_label": row.get_status_display(),
        "assignment_type": _safe_text(row.assignment_type),
        "assignment_type_label": row.get_assignment_type_display(),
        "assigned_staff_member_id": row.assigned_staff_member_id,
        "assigned_staff_member_name": _safe_text(getattr(assigned, "name", "")) if assigned else "",
        "assigned_staff_member_email": _safe_text(getattr(assigned, "email", "")) if assigned else "",
        "assigned_vendor_id": row.assigned_vendor_id,
        "assigned_vendor_name": _safe_text(getattr(assigned_vendor, "name", "")) if assigned_vendor else "",
        "assigned_vendor_trade_category": _safe_text(getattr(assigned_vendor, "trade_category", "")) if assigned_vendor else "",
        "assigned_vendor_email": _safe_text(getattr(assigned_vendor, "email", "")) if assigned_vendor else "",
        "assigned_vendor_phone": _safe_text(getattr(assigned_vendor, "phone", "")) if assigned_vendor else "",
        "assigned_contractor_id": row.assigned_contractor_id,
        "assigned_contractor_name": _safe_text(getattr(assigned_contractor, "business_name", "")) or _safe_text(getattr(assigned_contractor, "company_name", "")) if assigned_contractor else "",
        "marketplace_status": _safe_text(row.marketplace_status),
        "marketplace_status_label": row.get_marketplace_status_display(),
        "marketplace_sent_at": _safe_dt(row.marketplace_sent_at),
        "marketplace_response_at": _safe_dt(row.marketplace_response_at),
        "marketplace_opportunity_count": row.contractor_opportunities.count() if getattr(row, "pk", None) else 0,
        "scheduled_for": _safe_dt(row.scheduled_for),
        "started_at": _safe_dt(row.started_at),
        "completed_at": _safe_dt(row.completed_at),
        "closed_at": _safe_dt(row.closed_at),
        "internal_notes": _safe_text(row.internal_notes),
        "completion_notes": _safe_text(row.completion_notes),
        "created_by": _safe_text(row.created_by),
        "source_attachments": source_attachments,
        "completion_attachments": completion_attachments,
        "activities": activities,
        "timeline": activities,
        "attachment_count": len(source_attachments) + len(completion_attachments),
        "completion_attachment_count": len(completion_attachments),
        "created_at": _safe_dt(row.created_at),
        "updated_at": _safe_dt(row.updated_at),
    }


def _property_work_order_activity_payload(activity: PropertyWorkOrderActivity) -> dict:
    return {
        "id": activity.id,
        "activity_type": _safe_text(activity.activity_type),
        "activity_type_label": activity.get_activity_type_display(),
        "message": _safe_text(activity.message),
        "actor": _safe_text(activity.actor),
        "created_at": _safe_dt(activity.created_at),
    }


def _property_work_order_attachment_payload(attachment: PropertyWorkOrderAttachment) -> dict:
    file_obj = getattr(attachment, "file", None)
    url = ""
    try:
        url = file_obj.url if file_obj else ""
    except Exception:
        url = ""
    content_type = _safe_text(attachment.content_type)
    return {
        "id": attachment.id,
        "filename": _safe_text(attachment.original_filename) or _safe_text(getattr(file_obj, "name", "")).rsplit("/", 1)[-1],
        "content_type": content_type,
        "size_bytes": int(attachment.size_bytes or 0),
        "uploaded_by": _safe_text(attachment.uploaded_by),
        "attachment_type": _safe_text(attachment.attachment_type),
        "attachment_type_label": attachment.get_attachment_type_display(),
        "url": url,
        "is_image": content_type.startswith("image/"),
        "created_at": _safe_dt(attachment.created_at),
    }


def _property_work_order_add_activity(row: PropertyWorkOrder, activity_type: str, message: str, actor: str = "") -> PropertyWorkOrderActivity:
    return PropertyWorkOrderActivity.objects.create(
        work_order=row,
        activity_type=activity_type,
        message=_safe_text(message),
        actor=_safe_text(actor).lower(),
    )


PROPERTY_WORK_ORDER_ALLOWED_TRANSITIONS = {
    PropertyWorkOrder.STATUS_OPEN: {
        PropertyWorkOrder.STATUS_OPEN,
        PropertyWorkOrder.STATUS_SCHEDULED,
        PropertyWorkOrder.STATUS_IN_PROGRESS,
        PropertyWorkOrder.STATUS_WAITING,
        PropertyWorkOrder.STATUS_CANCELLED,
    },
    PropertyWorkOrder.STATUS_SCHEDULED: {
        PropertyWorkOrder.STATUS_SCHEDULED,
        PropertyWorkOrder.STATUS_IN_PROGRESS,
        PropertyWorkOrder.STATUS_WAITING,
        PropertyWorkOrder.STATUS_COMPLETED,
        PropertyWorkOrder.STATUS_CANCELLED,
    },
    PropertyWorkOrder.STATUS_IN_PROGRESS: {
        PropertyWorkOrder.STATUS_IN_PROGRESS,
        PropertyWorkOrder.STATUS_WAITING,
        PropertyWorkOrder.STATUS_COMPLETED,
        PropertyWorkOrder.STATUS_CANCELLED,
    },
    PropertyWorkOrder.STATUS_WAITING: {
        PropertyWorkOrder.STATUS_WAITING,
        PropertyWorkOrder.STATUS_SCHEDULED,
        PropertyWorkOrder.STATUS_IN_PROGRESS,
        PropertyWorkOrder.STATUS_CANCELLED,
    },
    PropertyWorkOrder.STATUS_COMPLETED: {
        PropertyWorkOrder.STATUS_COMPLETED,
        PropertyWorkOrder.STATUS_CLOSED,
    },
    PropertyWorkOrder.STATUS_CLOSED: {PropertyWorkOrder.STATUS_CLOSED},
    PropertyWorkOrder.STATUS_CANCELLED: {PropertyWorkOrder.STATUS_CANCELLED},
}


def _property_work_orders_for_property(property_profile: PropertyProfile | None) -> list[dict]:
    if property_profile is None:
        return []
    rows = (
        PropertyWorkOrder.objects.select_related(
            "property_management_company",
            "property_profile",
            "unit",
            "tenant",
            "assigned_staff_member",
            "assigned_vendor",
            "assigned_contractor",
            "source_tenant_request",
        )
        .prefetch_related("source_tenant_request__attachments", "attachments", "activities")
        .filter(property_profile=property_profile)
        .order_by("-created_at", "-id")
    )
    return [_property_work_order_payload(row) for row in rows]


def _property_work_orders_for_email(email: str) -> list[dict]:
    company = create_or_sync_company_from_homeowner(_primary_homeowner_for_email(email))
    if company is None:
        return []
    property_ids = list(
        PropertyProfile.objects.filter(customer_email__iexact=email.lower().strip(), managed_by_company=company).values_list("id", flat=True)
    )
    if not property_ids:
        return []
    rows = (
        PropertyWorkOrder.objects.select_related(
            "property_management_company",
            "property_profile",
            "unit",
            "tenant",
            "assigned_staff_member",
            "assigned_vendor",
            "assigned_contractor",
            "source_tenant_request",
        )
        .prefetch_related("source_tenant_request__attachments", "attachments", "activities")
        .filter(property_profile_id__in=property_ids)
        .order_by("-created_at", "-id")
    )
    return [_property_work_order_payload(row) for row in rows]


def _tenant_maintenance_requests_for_property(property_profile: PropertyProfile | None) -> list[dict]:
    if property_profile is None:
        return []
    rows = (
        TenantMaintenanceRequest.objects.select_related("property_profile", "unit", "tenant")
        .prefetch_related("attachments")
        .filter(property_profile=property_profile)
        .order_by("-created_at", "-id")
    )
    return [_tenant_maintenance_request_payload(row) for row in rows]


def _tenant_maintenance_requests_for_email(email: str) -> list[dict]:
    company = create_or_sync_company_from_homeowner(_primary_homeowner_for_email(email))
    if company is None:
        return []
    property_ids = list(
        PropertyProfile.objects.filter(customer_email__iexact=email.lower().strip(), managed_by_company=company).values_list("id", flat=True)
    )
    if not property_ids:
        return []
    rows = (
        TenantMaintenanceRequest.objects.select_related("property_profile", "unit", "tenant")
        .prefetch_related("attachments")
        .filter(property_profile_id__in=property_ids)
        .order_by("-created_at", "-id")
    )
    return [_tenant_maintenance_request_payload(row) for row in rows]


def _tenant_maintenance_context_payload(property_profile: PropertyProfile, unit: PropertyUnit | None = None, *, include_units: bool = False) -> dict:
    units = []
    if include_units:
        units = [
            _property_unit_payload(row)
            for row in PropertyUnit.objects.filter(property_profile=property_profile).exclude(status=PropertyUnit.STATUS_INACTIVE).order_by("unit_label", "id")
        ]
    return {
        "property": {
            "id": property_profile.id,
            "display_name": _safe_text(property_profile.display_name) or "Managed property",
        },
        "unit": _property_unit_payload(unit) if unit else None,
        "units": units,
        "categories": [{"value": value, "label": label} for value, label in TenantMaintenanceRequest.CATEGORY_CHOICES],
        "urgencies": [{"value": value, "label": label} for value, label in TenantMaintenanceRequest.URGENCY_CHOICES],
    }


def _tenant_maintenance_save_request(
    *,
    property_profile: PropertyProfile,
    unit: PropertyUnit | None,
    tenant: Tenant | None,
    data: dict,
    files: list,
) -> TenantMaintenanceRequest:
    row = TenantMaintenanceRequest.objects.create(
        property_profile=property_profile,
        unit=unit,
        tenant=tenant,
        submitted_by_name=_safe_text(data.get("submitted_by_name")),
        submitted_by_email=_safe_text(data.get("submitted_by_email")).lower(),
        submitted_by_phone=_safe_text(data.get("submitted_by_phone")),
        category=data["category"],
        urgency=data.get("urgency") or TenantMaintenanceRequest.URGENCY_NORMAL,
        title=data["title"],
        description=data["description"],
        permission_to_enter=bool(data.get("permission_to_enter", False)),
        pets_present=bool(data.get("pets_present", False)),
        preferred_access_times=_safe_text(data.get("preferred_access_times")),
    )
    for uploaded_file in files:
        TenantMaintenanceRequestAttachment.objects.create(
            tenant_request=row,
            file=uploaded_file,
            original_filename=_safe_text(getattr(uploaded_file, "name", "")),
            content_type=_safe_text(getattr(uploaded_file, "content_type", "")),
            size_bytes=int(getattr(uploaded_file, "size", 0) or 0),
            uploaded_by_name=_safe_text(data.get("submitted_by_name")),
            uploaded_by_email=_safe_text(data.get("submitted_by_email")).lower(),
        )
    return row


def _tenant_for_maintenance_submission(property_profile: PropertyProfile, unit: PropertyUnit | None, email: str) -> Tenant | None:
    normalized = _safe_text(email).lower()
    if not normalized:
        return None
    queryset = Tenancy.objects.select_related("tenant").filter(
        property_profile=property_profile,
        tenant__email__iexact=normalized,
        status__in=[Tenancy.STATUS_PENDING, Tenancy.STATUS_ACTIVE],
    )
    if unit is not None:
        queryset = queryset.filter(Q(unit=unit) | Q(unit__isnull=True))
    return getattr(queryset.order_by("-updated_at", "-id").first(), "tenant", None)


def _digits_only(value: str) -> str:
    return re.sub(r"\D+", "", _safe_text(value))


def _generic_tenant_maintenance_verification_failure() -> Response:
    return Response({"detail": TENANT_MAINTENANCE_VERIFICATION_FAILURE_DETAIL}, status=status.HTTP_400_BAD_REQUEST)


def _tenant_maintenance_verification_rate_limited(request) -> bool:
    ident = _safe_text(request.META.get("REMOTE_ADDR")) or "unknown"
    key = f"tenant-maintenance-verify:{ident}"
    attempts = int(cache.get(key, 0) or 0)
    if attempts >= 10:
        return True
    cache.set(key, attempts + 1, 5 * 60)
    return False


def _property_verification_candidates(query: str):
    normalized = _safe_text(query)
    if not normalized:
        return PropertyProfile.objects.none()
    return (
        PropertyProfile.objects.select_related("managed_by_company")
        .filter(managed_by_company__isnull=False, managed_by_company__is_active=True)
        .filter(
            Q(display_name__icontains=normalized)
            | Q(address_line1__icontains=normalized)
            | Q(address_line2__icontains=normalized)
            | Q(city__icontains=normalized)
            | Q(state__icontains=normalized)
            | Q(postal_code__icontains=normalized)
        )
    )


def _tenant_contact_matches(tenant: Tenant, contact: str) -> bool:
    normalized = _safe_text(contact)
    if not normalized:
        return False
    if "@" in normalized and _safe_text(tenant.email).lower() == normalized.lower():
        return True
    contact_digits = _digits_only(normalized)
    return bool(contact_digits and _digits_only(tenant.phone) == contact_digits)


def _verify_tenant_maintenance_identity(*, property_query: str, unit_label: str, tenant_last_name: str, contact: str) -> Tenancy | None:
    if not all([_safe_text(property_query), _safe_text(unit_label), _safe_text(tenant_last_name), _safe_text(contact)]):
        return None
    property_profiles = _property_verification_candidates(property_query)
    rows = (
        Tenancy.objects.select_related("tenant", "property_profile", "unit", "property_profile__managed_by_company")
        .filter(
            property_profile__in=property_profiles,
            unit__unit_label__iexact=_safe_text(unit_label),
            unit__status=PropertyUnit.STATUS_ACTIVE,
            status=Tenancy.STATUS_ACTIVE,
            tenant__status=Tenant.STATUS_ACTIVE,
            tenant__last_name__iexact=_safe_text(tenant_last_name),
            tenant__maintenance_access_enabled=True,
            property_profile__managed_by_company__is_active=True,
        )
        .order_by("id")
    )
    matches = [row for row in rows if _tenant_contact_matches(row.tenant, contact)]
    if len(matches) != 1:
        return None
    return matches[0]


def _resolve_verified_tenant_maintenance_token(token: str):
    try:
        payload = signing.loads(
            token,
            salt=TENANT_MAINTENANCE_VERIFICATION_SALT,
            max_age=TENANT_MAINTENANCE_VERIFICATION_MAX_AGE_SECONDS,
        )
    except signing.SignatureExpired:
        return None, Response({"detail": "This verification has expired. Please verify your unit again."}, status=status.HTTP_403_FORBIDDEN)
    except signing.BadSignature:
        return None, _generic_tenant_maintenance_verification_failure()
    tenancy_id = payload.get("tenancy_id") if isinstance(payload, dict) else None
    tenancy = (
        Tenancy.objects.select_related("tenant", "property_profile", "unit", "property_profile__managed_by_company")
        .filter(
            pk=tenancy_id,
            status=Tenancy.STATUS_ACTIVE,
            tenant__status=Tenant.STATUS_ACTIVE,
            tenant__maintenance_access_enabled=True,
            unit__status=PropertyUnit.STATUS_ACTIVE,
            property_profile__managed_by_company__isnull=False,
            property_profile__managed_by_company__is_active=True,
        )
        .first()
    )
    if tenancy is None:
        return None, _generic_tenant_maintenance_verification_failure()
    return tenancy, None



def _property_management_staff_payload(member: PropertyManagementStaffMembership) -> dict:
    return {
        "id": member.id,
        "name": _safe_text(member.name),
        "email": _safe_text(member.email),
        "phone": _safe_text(member.phone),
        "role": _safe_text(member.role),
        "role_label": member.get_role_display(),
        "status": _safe_text(member.status),
        "status_label": member.get_status_display(),
        "created_at": _safe_dt(member.created_at),
        "updated_at": _safe_dt(member.updated_at),
    }


def _property_management_team_payload(company: PropertyManagementCompany | None) -> list[dict]:
    if company is None:
        return []
    rows = PropertyManagementStaffMembership.objects.filter(company=company).order_by("name", "email", "id")
    return [_property_management_staff_payload(member) for member in rows]


def _property_vendor_payload(vendor: PropertyVendor) -> dict:
    return {
        "id": vendor.id,
        "name": _safe_text(vendor.name),
        "trade_category": _safe_text(vendor.trade_category),
        "email": _safe_text(vendor.email),
        "phone": _safe_text(vendor.phone),
        "website": _safe_text(vendor.website),
        "notes": _safe_text(vendor.notes),
        "status": _safe_text(vendor.status),
        "status_label": vendor.get_status_display(),
        "created_at": _safe_dt(vendor.created_at),
        "updated_at": _safe_dt(vendor.updated_at),
    }


def _property_vendor_rows(company: PropertyManagementCompany | None) -> list[dict]:
    if company is None:
        return []
    rows = PropertyVendor.objects.filter(property_management_company=company).order_by("name", "id")
    return [_property_vendor_payload(vendor) for vendor in rows]


def _property_management_company_for_email_or_response(email: str):
    homeowner = _primary_homeowner_for_email(email)
    if not homeowner_is_property_management_company(homeowner):
        return None, Response(
            {"detail": "This action is available only for property management company accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )
    company = create_or_sync_company_from_homeowner(homeowner)
    if company is None:
        return None, Response(
            {"detail": "This action is available only for property management company accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return company, None


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
    documents = [_property_document_payload(row) for row in PropertyDocument.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id")]
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
    home_systems = [
        _property_home_system_payload(row)
        for row in PropertyHomeSystem.objects.select_related(
            "linked_agreement",
            "linked_agreement__project",
            "linked_customer_request",
        )
        .prefetch_related("linked_documents")
        .filter(property_profile=profile, is_archived=False)
        .order_by("system_type", "custom_name", "id")
    ]
    unit_rows = list(units_for_property(profile))
    units = []
    for unit in unit_rows:
        unit_payload = _property_unit_payload(unit)
        unit_payload["tenant_maintenance_request_token"] = _tenant_maintenance_request_token(profile, unit)
        units.append(unit_payload)
    tenants = _tenant_payloads_for_property(profile)
    tenant_maintenance_requests = _tenant_maintenance_requests_for_property(profile)
    property_work_orders = _property_work_orders_for_property(profile)
    managed_by_company = _property_management_company_ref(getattr(profile, "managed_by_company", None))
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
        "bedrooms": profile.bedrooms,
        "bathrooms": str(profile.bathrooms) if profile.bathrooms is not None else None,
        "notes": _safe_text(profile.notes),
        "is_primary": bool(getattr(profile, "is_primary", False)),
        "documents": documents,
        "photos": photos,
        "home_systems": home_systems,
        "managed_by_company": managed_by_company,
        "managed_by_company_id": managed_by_company["id"] if managed_by_company else None,
        "tenant_maintenance_request_token": _tenant_maintenance_request_token(profile),
        "units": units,
        "unit_count": len(units),
        "tenants": tenants,
        "tenant_count": len(tenants),
        "tenant_maintenance_requests": tenant_maintenance_requests,
        "tenant_maintenance_request_count": len(tenant_maintenance_requests),
        "work_orders": property_work_orders,
        "work_order_count": len(property_work_orders),
        "updated_at": _safe_dt(profile.updated_at),
    }


def _property_home_system_payload(system: PropertyHomeSystem) -> dict:
    reminder = build_home_system_reminder(system)
    supply_recommendations = _home_system_supply_recommendation_payloads(system)
    linked_documents = [_property_document_payload(document, include_record_id=True) for document in system.linked_documents.all()]
    linked_agreement = getattr(system, "linked_agreement", None)
    linked_request = getattr(system, "linked_customer_request", None)
    linked_projects = []
    if linked_agreement:
        linked_projects.append(
            {
                "id": getattr(linked_agreement, "project_id", None),
                "agreement_id": linked_agreement.id,
                "title": _agreement_title(linked_agreement),
                "contractor_name": _contractor_name(getattr(linked_agreement, "contractor", None)),
                "url": f"/agreements/magic/{linked_agreement.homeowner_access_token}" if getattr(linked_agreement, "homeowner_access_token", "") else "",
            }
        )
    linked_requests = []
    if linked_request:
        linked_requests.append(
            {
                "id": linked_request.id,
                "title": _safe_text(getattr(linked_request, "project_title", "")) or _safe_text(getattr(linked_request, "title", "")) or "Request",
                "status": _safe_text(getattr(linked_request, "status", "")),
                "status_label": _customer_request_status_label(getattr(linked_request, "status", "")),
            }
        )
    lifecycle = _home_system_lifecycle_payload(
        system=system,
        reminder=reminder,
        linked_request=linked_request,
        linked_agreement=linked_agreement,
    )
    return {
        "id": system.id,
        "display_name": system.display_name,
        "system_type": _safe_text(system.system_type),
        "system_type_label": system.get_system_type_display(),
        "custom_name": _safe_text(system.custom_name),
        "manufacturer": _safe_text(system.manufacturer),
        "model_number": _safe_text(system.model_number),
        "serial_number": _safe_text(system.serial_number),
        "install_date": _safe_dt(system.install_date),
        "last_service_date": _safe_dt(system.last_service_date),
        "warranty_start_date": _safe_dt(system.warranty_start_date),
        "warranty_expiration_date": _safe_dt(system.warranty_expiration_date),
        "expected_lifespan_years": system.expected_lifespan_years,
        "condition": _safe_text(system.condition),
        "condition_label": system.get_condition_display(),
        "notes": _safe_text(system.notes),
        "service_provider": _safe_text(system.service_provider),
        "maintenance_status": reminder.maintenance_status,
        "priority": reminder.priority,
        "next_recommended_service_date": _safe_dt(reminder.next_recommended_service_date),
        "days_until_due": reminder.days_until_due,
        "reminder_reason": reminder.reminder_reason,
        "recommended_action": reminder.recommended_action,
        "service_interval_months": reminder.service_interval_months,
        "reminder_source": reminder.reminder_source,
        "reminders_enabled": bool(system.reminders_enabled),
        "email_reminders_enabled": bool(system.email_reminders_enabled),
        "sms_reminders_enabled": bool(system.sms_reminders_enabled),
        "reminder_lead_days": system.reminder_lead_days,
        "reminder_frequency": _safe_text(system.reminder_frequency),
        "reminder_generated_at": _safe_dt(system.reminder_generated_at),
        "last_notified_at": _safe_dt(system.last_notified_at),
        "next_notification_at": _safe_dt(system.next_notification_at),
        "reminder_delivery_status": _safe_text(system.reminder_delivery_status),
        "reminder_channel": _safe_text(system.reminder_channel),
        "reminder_sent_at": _safe_dt(system.reminder_sent_at),
        "resolved_at": _safe_dt(system.resolved_at),
        "dismissed_until": _safe_dt(system.dismissed_until),
        "linked_documents": linked_documents,
        "linked_projects": linked_projects,
        "linked_requests": linked_requests,
        "linked_records_count": len(linked_documents) + len(linked_projects) + len(linked_requests),
        "supply_recommendations": supply_recommendations,
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_customer_request_id": getattr(linked_request, "id", None),
        "lifecycle": lifecycle,
        "created_at": _safe_dt(system.created_at),
        "updated_at": _safe_dt(system.updated_at),
    }


def _home_system_recommendation_key(system: PropertyHomeSystem, recommendation: dict) -> str:
    raw_key = _safe_text(recommendation.get("recommendation_key")) or _safe_text(recommendation.get("id"))
    if raw_key:
        return raw_key[:160]
    title = _safe_text(recommendation.get("title")) or _safe_text(recommendation.get("supply_name")) or _safe_text(recommendation.get("kind")) or "recommendation"
    normalized = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "recommendation"
    return f"system-{system.id}-{normalized}"[:160]


def _home_system_supply_recommendation_payloads(system: PropertyHomeSystem) -> list[dict]:
    recommendations = build_home_system_supply_recommendations([system])
    ignored_keys = set(
        PropertyHomeSystemRecommendationPreference.objects.filter(
            property_profile=system.property_profile,
            home_system=system,
            status=PropertyHomeSystemRecommendationPreference.STATUS_IGNORED,
        ).values_list("recommendation_key", flat=True)
    )
    rows = []
    for recommendation in recommendations:
        key = _home_system_recommendation_key(system, recommendation)
        rows.append(
            {
                **recommendation,
                "recommendation_key": key,
                "is_ignored": key in ignored_keys,
            }
        )
    return rows


def _home_system_recommendation_or_404(email: str, system_id: int, recommendation_key: str) -> tuple[PropertyHomeSystem, str]:
    system = _home_system_for_email_or_404(email, system_id)
    normalized_key = _safe_text(recommendation_key)
    if not normalized_key:
        raise Http404("Recommendation not found.")
    keys = {
        _home_system_recommendation_key(system, recommendation)
        for recommendation in build_home_system_supply_recommendations([system])
    }
    if normalized_key not in keys:
        raise Http404("Recommendation not found.")
    return system, normalized_key


def _home_system_lifecycle_payload(*, system: PropertyHomeSystem, reminder, linked_request=None, linked_agreement=None) -> dict:
    now = timezone.now()
    work_order_filter = Q(home_system=system)
    if linked_agreement is not None:
        work_order_filter |= Q(
            maintenance_agreement=linked_agreement,
            property_profile=system.property_profile,
            home_system__isnull=True,
        )
    work_order_qs = MaintenanceWorkOrder.objects.filter(work_order_filter)
    work_orders = list(work_order_qs.select_related("maintenance_agreement", "contractor").order_by("-scheduled_date", "-id")[:5])
    completed = next((row for row in work_orders if row.status == MaintenanceWorkOrder.STATUS_COMPLETED), None)
    in_progress = next((row for row in work_orders if row.status == MaintenanceWorkOrder.STATUS_IN_PROGRESS), None)
    scheduled = next((row for row in work_orders if row.status == MaintenanceWorkOrder.STATUS_SCHEDULED), None)
    request_status = _safe_text(getattr(linked_request, "status", ""))
    matching_counts = _customer_request_matching_counts(linked_request) if linked_request is not None else {"total": 0}
    if system.dismissed_until and system.dismissed_until > now:
        key, label = "dismissed", "Dismissed"
    elif completed is not None:
        key, label = "completed", "Completed"
    elif in_progress is not None:
        key, label = "in_progress", "In Progress"
    elif scheduled is not None:
        key, label = "scheduled", "Scheduled"
    elif linked_agreement is not None:
        key, label = "agreement_created", "Agreement Created"
    elif linked_request is not None and matching_counts["total"] > 0:
        key, label = "sent_to_contractors", "Sent to Contractors"
    elif linked_request is not None and request_status not in {CustomerRequest.STATUS_CANCELLED, CustomerRequest.STATUS_CLOSED}:
        key, label = "service_requested", "Service Requested"
    elif reminder.maintenance_status in {"overdue", "due_soon", "warranty_expired", "warranty_expiring", "lifespan_attention"}:
        reminder_labels = {
            "overdue": "Maintenance Past Due",
            "due_soon": "Due Soon",
            "warranty_expired": "Warranty Attention",
            "warranty_expiring": "Warranty Expiring",
            "lifespan_attention": "Nearing End of Life",
        }
        key, label = reminder.maintenance_status, reminder_labels.get(reminder.maintenance_status, "Needs Attention")
    else:
        key, label = "current", "Current"
    current_work_order = completed or in_progress or scheduled
    return {
        "state": key,
        "label": label,
        "linked_request_id": getattr(linked_request, "id", None),
        "linked_request_status": request_status,
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_work_order_id": getattr(current_work_order, "id", None),
        "linked_work_order_status": _safe_text(getattr(current_work_order, "status", "")),
        "scheduled_date": _safe_dt(getattr(current_work_order, "scheduled_date", None)),
        "completed_at": _safe_dt(getattr(current_work_order, "completed_at", None)),
        "next_action": _home_system_lifecycle_next_action(key),
    }


def _home_system_lifecycle_next_action(state: str) -> str:
    return {
        "dismissed": "Reminder paused until the selected date.",
        "service_requested": "Open the linked request to find or contact a contractor.",
        "sent_to_contractors": "Watch for contractor responses.",
        "agreement_created": "Open the linked agreement for next steps.",
        "scheduled": "Review the scheduled service visit.",
        "in_progress": "Wait for the contractor to complete the service.",
        "completed": "Service is recorded for this system.",
        "overdue": "Create a service request or mark the system serviced if work is already done.",
        "due_soon": "Plan upcoming service.",
        "warranty_expiring": "Review warranty coverage.",
        "warranty_expired": "Review warranty records.",
        "lifespan_attention": "Plan replacement or inspection.",
        "current": "No maintenance action is needed right now.",
    }.get(state, "Review this system record.")


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


def _customer_request_payment_preference_to_intake(value: str) -> str:
    mapping = {
        CustomerRequest.PAYMENT_PREFERENCE_ESCROW: "escrow",
        CustomerRequest.PAYMENT_PREFERENCE_DIRECT: "direct",
        CustomerRequest.PAYMENT_PREFERENCE_DISCUSS: "discuss",
        CustomerRequest.PAYMENT_PREFERENCE_UNSURE: "discuss",
    }
    return mapping.get(_safe_text(value), "discuss")


def _customer_request_project_mode_to_intake(value: str) -> str:
    mapping = {
        CustomerRequest.PROJECT_MODE_FULL_SERVICE: "full_service",
        CustomerRequest.PROJECT_MODE_DIY_ASSIST: "assisted_diy",
        CustomerRequest.PROJECT_MODE_INSPECTION_ONLY: "inspection_only",
        CustomerRequest.PROJECT_MODE_NOT_SURE: "full_service",
    }
    return mapping.get(_safe_text(value), "full_service")


def _customer_request_matching_counts(request_row) -> dict:
    source_intake = getattr(request_row, "source_intake", None)
    if not source_intake:
        return {"opportunities": 0, "invites": 0, "leads": 0, "total": 0}
    opportunities = ContractorOpportunity.objects.filter(intake_request=source_intake).count()
    invites = ContractorDiscoveryInvite.objects.filter(public_intake=source_intake).count()
    leads = PublicContractorLead.objects.filter(source_intake=source_intake).count()
    return {"opportunities": opportunities, "invites": invites, "leads": leads, "total": opportunities + invites + leads}


def _customer_request_can_edit(request_row) -> bool:
    if getattr(request_row, "converted_project_id", None):
        return False
    if _safe_text(getattr(request_row, "status", "")) in {
        CustomerRequest.STATUS_CLOSED,
        CustomerRequest.STATUS_CANCELLED,
        CustomerRequest.STATUS_CONVERTED_TO_PROJECT,
    }:
        return False
    return _customer_request_matching_counts(request_row)["total"] == 0


def _customer_request_cancel_state(request_row) -> tuple[bool, str]:
    status_value = _safe_text(getattr(request_row, "status", "")).lower()
    if getattr(request_row, "converted_project_id", None) or status_value == CustomerRequest.STATUS_CONVERTED_TO_PROJECT:
        return False, "This request already has an agreement. Use the agreement workflow for changes."
    if status_value == CustomerRequest.STATUS_CLOSED:
        return False, "This request is closed."
    if status_value == CustomerRequest.STATUS_CANCELLED:
        return False, "This request is already cancelled."
    if status_value == CustomerRequest.STATUS_MATCHED:
        return False, "A contractor has already been selected. Review the contractor response or agreement workflow before cancelling."
    return True, ""


def _customer_request_can_delete(request_row) -> bool:
    if getattr(request_row, "converted_project_id", None):
        return False
    if _safe_text(getattr(request_row, "status", "")).lower() in {
        CustomerRequest.STATUS_ROUTED,
        CustomerRequest.STATUS_MATCHED,
        CustomerRequest.STATUS_CONVERTED_TO_PROJECT,
        CustomerRequest.STATUS_CLOSED,
        CustomerRequest.STATUS_CANCELLED,
    }:
        return False
    if getattr(request_row, "source_intake_id", None):
        return False
    return _customer_request_matching_counts(request_row)["total"] == 0


def _customer_request_workflow_status(request_row, *, bids_count: int = 0) -> tuple[str, str, str]:
    if getattr(request_row, "converted_project_id", None):
        return "agreement_created", "Agreement Created", "Open the linked agreement when you are ready."
    status_value = _safe_text(getattr(request_row, "status", "")).lower()
    if status_value == CustomerRequest.STATUS_CANCELLED:
        return "cancelled", "Cancelled", "This request was cancelled and will not be sent to contractors."
    if status_value == CustomerRequest.STATUS_CLOSED:
        return "closed", "Closed", "This request is closed."
    if bids_count > 0:
        return "contractor_response_received", "Contractor Response Received", "Review contractor responses and choose how to proceed."
    matching_counts = _customer_request_matching_counts(request_row)
    if matching_counts["total"] > 0 or status_value == CustomerRequest.STATUS_ROUTED:
        count = matching_counts["total"]
        label = f"Sent to {count} Contractor{'s' if count != 1 else ''}" if count else "Sent to Contractors"
        return "sent_to_contractors", label, "Wait for contractor responses or continue reviewing this request."
    if getattr(request_row, "source_intake_id", None) or status_value == CustomerRequest.STATUS_MARKETPLACE_READY:
        return "contractor_matching", "Contractor Matching", "Review local contractor matches and select who should receive this request."
    if status_value == CustomerRequest.STATUS_DRAFT:
        return "private_draft", "Private Draft", "Edit the request, then save it when you are ready."
    return "reviewing_request", "Reviewing Request", "Edit the request or find contractors when you are ready."


def _customer_request_source_intake_payload(request_row) -> dict:
    source_intake = getattr(request_row, "source_intake", None)
    if not source_intake:
        return {}
    return {
        "id": source_intake.id,
        "token": _safe_text(getattr(source_intake, "share_token", "")),
        "status": _safe_text(getattr(source_intake, "status", "")),
        "post_submit_flow": _safe_text(getattr(source_intake, "post_submit_flow", "")),
    }


def _customer_request_routed_contractors(source_intake) -> list[dict]:
    if not source_intake:
        return []
    rows = []
    for opportunity in (
        ContractorOpportunity.objects.select_related("directory_entry", "directory_entry__claimed_by_contractor")
        .filter(intake_request=source_intake)
        .order_by("-selected_at", "-id")
    ):
        payload = _selected_contractor_from_opportunity(opportunity)
        if payload:
            payload["id"] = f"opportunity-{opportunity.id}"
            rows.append(payload)
    for invite in (
        ContractorDiscoveryInvite.objects.select_related("directory_listing", "contractor")
        .filter(public_intake=source_intake)
        .order_by("-created_at", "-id")
    ):
        listing = getattr(invite, "directory_listing", None)
        contractor = getattr(invite, "contractor", None)
        rows.append(
            {
                "id": f"invite-{invite.id}",
                "source": "contractor_discovery_invite",
                "business_name": _safe_text(getattr(contractor, "business_name", "")) or _safe_text(getattr(listing, "business_name", "")) or "Selected contractor",
                "phone": _safe_text(getattr(invite, "destination_phone", "")) or _safe_text(getattr(listing, "phone_number", "")),
                "email": _safe_text(getattr(invite, "destination_email", "")) or _safe_text(getattr(listing, "email", "")),
                "location": _safe_text(getattr(listing, "formatted_address", "")) or _compact_address(getattr(listing, "city", ""), getattr(listing, "state", "")),
                "status": _safe_text(getattr(invite, "status", "")),
                "status_label": _customer_request_status_label(getattr(invite, "status", "")),
                "selection_method": "Sent from Customer Portal",
                "selected_at": _safe_dt(getattr(invite, "created_at", None)),
                "invited_at": _safe_dt(getattr(invite, "sent_at", None) or getattr(invite, "created_at", None)),
            }
        )
    return rows


def _compact_address(*parts) -> str:
    return ", ".join(_safe_text(part) for part in parts if _safe_text(part))


def _request_detail_field(label: str, value) -> dict | None:
    text = _safe_text(value)
    if not text:
        return None
    return {"label": label, "value": text}


def _request_activity_item(title: str, when, description: str = "", *, status: str = "") -> dict | None:
    if not when:
        return None
    return {
        "title": title,
        "description": _safe_text(description),
        "status": _safe_text(status),
        "occurred_at": _safe_dt(when),
    }


def _lead_homeowner_status_label(lead) -> str:
    if not lead:
        return "Not sent"
    if getattr(lead, "converted_agreement_id", None):
        return "Agreement created"
    status_value = _safe_text(getattr(lead, "status", "")).lower()
    labels = {
        PublicContractorLead.STATUS_NEW: "Sent to contractor",
        PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE: "Awaiting customer response",
        PublicContractorLead.STATUS_READY_FOR_REVIEW: "Ready for review",
        PublicContractorLead.STATUS_FOLLOW_UP: "Follow-up needed",
        PublicContractorLead.STATUS_ACCEPTED: "Accepted by contractor",
        PublicContractorLead.STATUS_REJECTED: "Declined by contractor",
        PublicContractorLead.STATUS_CONTACTED: "Contractor contacted",
        PublicContractorLead.STATUS_QUALIFIED: "Qualified",
        PublicContractorLead.STATUS_CLOSED: "Closed",
        PublicContractorLead.STATUS_ARCHIVED: "Archived",
    }
    return labels.get(status_value, _customer_request_status_label(status_value))


def _contractor_profile_url(public_profile) -> str:
    if not public_profile:
        return ""
    try:
        return _safe_text(public_profile.public_url_path)
    except Exception:
        return ""


def _selected_contractor_from_lead(lead) -> dict | None:
    if not lead:
        return None
    contractor = getattr(lead, "contractor", None)
    public_profile = getattr(lead, "public_profile", None)
    service_area = _compact_address(
        getattr(public_profile, "service_area_text", ""),
        _compact_address(getattr(public_profile, "city", ""), getattr(public_profile, "state", "")),
    )
    if not service_area:
        service_area = _compact_address(getattr(contractor, "city", ""), getattr(contractor, "state", ""))
    trade_values = []
    for value in [
        getattr(lead, "project_type", ""),
        ", ".join(getattr(public_profile, "specialties", []) or []),
        ", ".join(getattr(public_profile, "work_types", []) or []),
    ]:
        text = _safe_text(value)
        if text and text not in trade_values:
            trade_values.append(text)
    return {
        "source": "public_lead",
        "business_name": _safe_text(getattr(public_profile, "business_name_public", ""))
        or _safe_text(getattr(contractor, "business_name", ""))
        or "Selected contractor",
        "contact_name": _safe_text(getattr(contractor, "contact_name", ""))
        or _safe_text(getattr(lead, "full_name", "")),
        "phone": _safe_text(getattr(public_profile, "phone_public", "")) or _safe_text(getattr(contractor, "phone", "")),
        "email": _safe_text(getattr(public_profile, "email_public", "")) or _safe_text(getattr(getattr(contractor, "user", None), "email", "")),
        "location": _compact_address(getattr(public_profile, "city", ""), getattr(public_profile, "state", "")),
        "service_area": service_area,
        "trade": ", ".join(trade_values),
        "profile_url": _contractor_profile_url(public_profile),
        "rating": "",
        "review_count": 0,
        "status": _safe_text(getattr(lead, "status", "")),
        "status_label": _lead_homeowner_status_label(lead),
        "selection_method": "Selected during intake",
        "selected_at": _safe_dt(getattr(lead, "created_at", None)),
        "invited_at": _safe_dt(getattr(lead, "created_at", None)),
        "viewed_at": "",
        "accepted_at": _safe_dt(getattr(lead, "accepted_at", None)),
        "converted_at": _safe_dt(getattr(lead, "converted_at", None)),
    }


def _selected_contractor_from_opportunity(opportunity) -> dict | None:
    if not opportunity:
        return None
    directory_entry = getattr(opportunity, "directory_entry", None)
    contractor = getattr(directory_entry, "claimed_by_contractor", None)
    status_value = _safe_text(getattr(opportunity, "status", ""))
    status_label = _customer_request_status_label(status_value)
    if getattr(opportunity, "converted_agreement_id", None):
        status_label = "Agreement created"
    return {
        "source": "contractor_opportunity",
        "business_name": _safe_text(getattr(directory_entry, "business_name", "")) or "Selected contractor",
        "contact_name": _safe_text(getattr(contractor, "contact_name", "")),
        "phone": _safe_text(getattr(directory_entry, "phone_number", "")) or _safe_text(getattr(contractor, "phone", "")),
        "email": _safe_text(getattr(directory_entry, "email", "")) or _safe_text(getattr(getattr(contractor, "user", None), "email", "")),
        "location": _safe_text(getattr(directory_entry, "formatted_address", ""))
        or _compact_address(getattr(directory_entry, "city", ""), getattr(directory_entry, "state", "")),
        "service_area": _compact_address(getattr(directory_entry, "city", ""), getattr(directory_entry, "state", "")),
        "trade": _safe_text(getattr(directory_entry, "primary_trade", "")),
        "profile_url": _safe_text(getattr(directory_entry, "website_url", "")),
        "rating": getattr(directory_entry, "google_rating", None),
        "review_count": getattr(directory_entry, "google_review_count", 0),
        "status": status_value,
        "status_label": status_label,
        "selection_method": "Selected during intake",
        "selected_at": _safe_dt(getattr(opportunity, "selected_at", None)),
        "invited_at": _safe_dt(getattr(opportunity, "created_at", None)),
        "viewed_at": "",
        "accepted_at": _safe_dt(getattr(opportunity, "accepted_at", None)),
        "converted_at": "",
    }


def _selected_contractor_for_intake(intake, leads: list | None = None) -> dict | None:
    lead = getattr(intake, "public_lead", None)
    if not lead and leads:
        lead = next(
            (row for row in leads if getattr(getattr(row, "source_intake", None), "id", None) == getattr(intake, "id", None)),
            None,
        )
    if lead:
        return _selected_contractor_from_lead(lead)
    opportunity = (
        ContractorOpportunity.objects.select_related("directory_entry", "directory_entry__claimed_by_contractor")
        .filter(intake_request=intake)
        .order_by("-selected_at", "-id")
        .first()
    )
    if opportunity:
        return _selected_contractor_from_opportunity(opportunity)
    contractor = getattr(intake, "contractor", None)
    if contractor:
        return {
            "source": "contractor",
            "business_name": _safe_text(getattr(contractor, "business_name", "")) or "Selected contractor",
            "contact_name": _safe_text(getattr(contractor, "contact_name", "")),
            "phone": _safe_text(getattr(contractor, "phone", "")),
            "email": _safe_text(getattr(getattr(contractor, "user", None), "email", "")),
            "location": _compact_address(getattr(contractor, "city", ""), getattr(contractor, "state", "")),
            "service_area": _compact_address(getattr(contractor, "city", ""), getattr(contractor, "state", "")),
            "trade": "",
            "profile_url": "",
            "rating": "",
            "review_count": 0,
            "status": "selected",
            "status_label": "Selected",
            "selection_method": "Selected during intake",
            "selected_at": _safe_dt(getattr(intake, "created_at", None)),
            "invited_at": "",
            "viewed_at": "",
            "accepted_at": "",
            "converted_at": "",
        }
    return None


def _request_linked_work_payload(agreement=None, project=None) -> dict | None:
    agreement = agreement or None
    project = project or getattr(agreement, "project", None)
    if not agreement and not project:
        return None
    return {
        "agreement_id": getattr(agreement, "id", None),
        "agreement_token": _safe_text(getattr(agreement, "homeowner_access_token", "")),
        "agreement_url": f"/agreements/magic/{getattr(agreement, 'homeowner_access_token', '')}"
        if getattr(agreement, "homeowner_access_token", None)
        else "",
        "project_id": getattr(project, "id", None),
        "project_title": _safe_text(getattr(project, "title", "")),
        "status": _safe_text(getattr(agreement, "status", "")) or _safe_text(getattr(project, "status", "")),
        "status_label": _customer_request_status_label(
            _safe_text(getattr(agreement, "status", "")) or _safe_text(getattr(project, "status", ""))
        ),
    }


def _customer_request_activity(request_row) -> list[dict]:
    source_intake = getattr(request_row, "source_intake", None)
    linked_system = getattr(request_row, "linked_home_system", None)
    linked_agreement = getattr(source_intake, "agreement", None) or getattr(linked_system, "linked_agreement", None)
    matching_counts = _customer_request_matching_counts(request_row)
    items = [
        _request_activity_item("Request saved", getattr(request_row, "created_at", None), "Saved in your Customer Portal."),
        _request_activity_item("Request updated", getattr(request_row, "updated_at", None), "Request details were updated."),
    ]
    if linked_system is not None:
        items.append(
            _request_activity_item(
                "Linked to home system",
                getattr(request_row, "created_at", None),
                f"Connected to {linked_system.display_name}.",
                status="home_system",
            )
        )
    if source_intake:
        items.append(
            _request_activity_item(
                "Contractor matching started",
                getattr(source_intake, "created_at", None),
                "Local contractor matching was opened for this request.",
                status="matching",
            )
        )
    if matching_counts["total"]:
        items.append(
            _request_activity_item(
                "Request sent to contractors",
                getattr(source_intake, "updated_at", None) if source_intake else getattr(request_row, "updated_at", None),
                f"Sent to {matching_counts['total']} contractor{'s' if matching_counts['total'] != 1 else ''}.",
                status="routed",
            )
        )
    if getattr(request_row, "converted_project_id", None) or linked_agreement is not None:
        items.append(
            _request_activity_item(
                "Agreement created",
                getattr(linked_agreement, "created_at", None) or getattr(request_row, "updated_at", None),
                "This request is linked to an agreement.",
                status="converted",
            )
        )
    if linked_system is not None:
        work_orders = MaintenanceWorkOrder.objects.filter(
            Q(home_system=linked_system) | Q(maintenance_agreement=linked_agreement, property_profile=linked_system.property_profile, home_system__isnull=True)
        ).order_by("-scheduled_date", "-id")
        scheduled = work_orders.filter(status=MaintenanceWorkOrder.STATUS_SCHEDULED).first()
        in_progress = work_orders.filter(status=MaintenanceWorkOrder.STATUS_IN_PROGRESS).first()
        completed = work_orders.filter(status=MaintenanceWorkOrder.STATUS_COMPLETED).first()
        if scheduled is not None:
            items.append(
                _request_activity_item(
                    "Service scheduled",
                    getattr(scheduled, "scheduled_date", None),
                    scheduled.title,
                    status="scheduled",
                )
            )
        if in_progress is not None:
            items.append(
                _request_activity_item(
                    "Service in progress",
                    getattr(in_progress, "updated_at", None),
                    in_progress.title,
                    status="in_progress",
                )
            )
        if completed is not None:
            items.append(
                _request_activity_item(
                    "Service completed",
                    getattr(completed, "completed_at", None),
                    completed.title,
                    status="completed",
                )
            )
    if getattr(request_row, "cancelled_at", None):
        items.append(
            _request_activity_item(
                "Request cancelled",
                getattr(request_row, "cancelled_at", None),
                _safe_text(getattr(request_row, "cancellation_reason", "")) or "Cancelled by homeowner.",
                status="cancelled",
            )
        )
    seen = set()
    timeline = []
    for item in items:
        if not item:
            continue
        key = (item["title"], item["occurred_at"])
        if key in seen:
            continue
        seen.add(key)
        timeline.append(item)
    return timeline


def _sync_customer_request_source_intake(customer_request: CustomerRequest) -> ProjectIntake:
    source_intake = getattr(customer_request, "source_intake", None)
    profile = getattr(customer_request, "property_profile", None)
    homeowner = getattr(customer_request, "homeowner", None) or _primary_homeowner_for_email(customer_request.customer_email)
    address_line1 = _safe_text(getattr(customer_request, "address_line1", "")) or _safe_text(getattr(profile, "address_line1", ""))
    address_line2 = _safe_text(getattr(customer_request, "address_line2", "")) or _safe_text(getattr(profile, "address_line2", ""))
    city = _safe_text(getattr(customer_request, "city", "")) or _safe_text(getattr(profile, "city", ""))
    state_value = _safe_text(getattr(customer_request, "state", "")) or _safe_text(getattr(profile, "state", ""))
    postal_code = _safe_text(getattr(customer_request, "postal_code", "")) or _safe_text(getattr(profile, "postal_code", ""))
    defaults = {
        "homeowner": homeowner,
        "initiated_by": "homeowner",
        "status": "analyzed",
        "lead_source": "landing_page",
        "customer_name": _safe_text(getattr(homeowner, "full_name", "")) or _safe_text(getattr(homeowner, "name", "")),
        "customer_email": _safe_text(customer_request.customer_email).lower(),
        "customer_phone": _safe_text(getattr(homeowner, "phone_number", "")),
        "customer_address_line1": address_line1,
        "customer_address_line2": address_line2,
        "customer_city": city,
        "customer_state": state_value,
        "customer_postal_code": postal_code,
        "project_class": "residential",
        "project_mode": _customer_request_project_mode_to_intake(customer_request.project_mode),
        "property_type": _safe_text(getattr(profile, "property_type", "")),
        "desired_timing_text": _safe_text(customer_request.preferred_timeline),
        "payment_preference": _customer_request_payment_preference_to_intake(customer_request.payment_preference),
        "project_address_line1": address_line1,
        "project_address_line2": address_line2,
        "project_city": city,
        "project_state": state_value,
        "project_postal_code": postal_code,
        "accomplishment_text": _safe_text(customer_request.description),
        "ai_project_title": _safe_text(customer_request.title),
        "ai_project_type": _safe_text(customer_request.project_type or customer_request.project_category),
        "ai_project_subtype": _safe_text(customer_request.project_subtype),
        "ai_description": _safe_text(customer_request.description),
        "ai_analysis_payload": {
            "source_customer_request_id": customer_request.id,
            "project_title": _safe_text(customer_request.title),
            "project_type": _safe_text(customer_request.project_type or customer_request.project_category),
            "project_subtype": _safe_text(customer_request.project_subtype),
            "description": _safe_text(customer_request.description),
            "urgency": _safe_text(customer_request.urgency),
            "payment_preference": _safe_text(customer_request.payment_preference),
        },
        "analyzed_at": timezone.now(),
    }
    if source_intake is None:
        source_intake = ProjectIntake.objects.create(**defaults)
        source_intake.ensure_share_token(save=True)
        customer_request.source_intake = source_intake
        if customer_request.status == CustomerRequest.STATUS_SUBMITTED:
            customer_request.status = CustomerRequest.STATUS_MARKETPLACE_READY
        customer_request.save(update_fields=["source_intake", "status", "updated_at"])
        return source_intake

    for field, value in defaults.items():
        setattr(source_intake, field, value)
    source_intake.ensure_share_token(save=False)
    source_intake.save()
    return source_intake


def _notify_contractors_request_cancelled(customer_request: CustomerRequest) -> int:
    source_intake = getattr(customer_request, "source_intake", None)
    if not source_intake:
        return 0
    notified = 0
    contractor_ids = set()
    title = "Customer request cancelled"
    body = f"{customer_request.title} was cancelled by the customer."
    link = "/app/bids"
    for opportunity in (
        ContractorOpportunity.objects.select_related("directory_entry__claimed_by_contractor")
        .filter(intake_request=source_intake)
        .exclude(status__in=[ContractorOpportunity.STATUS_CONVERTED, ContractorOpportunity.STATUS_EXPIRED])
    ):
        contractor = getattr(getattr(opportunity, "directory_entry", None), "claimed_by_contractor", None)
        if contractor and contractor.id not in contractor_ids:
            notification, _created = create_notification(
                contractor=contractor,
                category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
                title=title,
                body=body,
                link=link,
            )
            if notification is not None:
                contractor_ids.add(contractor.id)
                notified += 1
        if opportunity.status != ContractorOpportunity.STATUS_CONVERTED:
            opportunity.status = ContractorOpportunity.STATUS_EXPIRED
            opportunity.save(update_fields=["status", "updated_at"])

    for invite in (
        ContractorDiscoveryInvite.objects.select_related("contractor")
        .filter(public_intake=source_intake)
        .exclude(
            status__in=[
                ContractorDiscoveryInvite.STATUS_RESPONDED,
                ContractorDiscoveryInvite.STATUS_DECLINED,
                ContractorDiscoveryInvite.STATUS_EXPIRED,
                ContractorDiscoveryInvite.STATUS_OPTED_OUT,
            ]
        )
    ):
        contractor = getattr(invite, "contractor", None)
        if contractor and contractor.id not in contractor_ids:
            notification, _created = create_notification(
                contractor=contractor,
                category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
                title=title,
                body=body,
                link=link,
            )
            if notification is not None:
                contractor_ids.add(contractor.id)
                notified += 1
        invite.status = ContractorDiscoveryInvite.STATUS_EXPIRED
        invite.save(update_fields=["status", "updated_at"])

    PublicContractorLead.objects.filter(source_intake=source_intake).exclude(
        status__in=[PublicContractorLead.STATUS_ACCEPTED, PublicContractorLead.STATUS_REJECTED, PublicContractorLead.STATUS_CLOSED]
    ).update(status=PublicContractorLead.STATUS_CLOSED)
    return notified


def _intake_activity(intake, selected_contractor: dict | None = None, agreement=None) -> list[dict]:
    items = [
        _request_activity_item("Request started", getattr(intake, "created_at", None), "The project request was started."),
        _request_activity_item("Request submitted", getattr(intake, "submitted_at", None), "The request was submitted."),
        _request_activity_item("AI project details prepared", getattr(intake, "analyzed_at", None), "Project title, type, and scope were prepared for review."),
    ]
    if selected_contractor:
        items.append(
            _request_activity_item(
                "Contractor selected",
                selected_contractor.get("selected_at"),
                selected_contractor.get("business_name", "A contractor was selected."),
                status=selected_contractor.get("status_label", ""),
            )
        )
        items.append(
            _request_activity_item(
                "Contractor accepted",
                selected_contractor.get("accepted_at"),
                selected_contractor.get("business_name", "The contractor accepted the request."),
                status="accepted",
            )
        )
    items.append(
        _request_activity_item(
            "Agreement draft created",
            getattr(intake, "converted_at", None) or getattr(agreement, "created_at", None),
            "This request was converted into an agreement draft.",
            status="converted",
        )
    )
    seen = set()
    timeline = []
    for item in items:
        if not item:
            continue
        key = (item["title"], item["occurred_at"])
        if key in seen:
            continue
        seen.add(key)
        timeline.append(item)
    return timeline


def _customer_request_refine_fallback(description: str) -> str:
    text = re.sub(r"\s+", " ", _safe_text(description))
    if not text:
        return ""
    for pattern in [
        r"^(?:i\s+)?(?:am\s+)?looking to\s+",
        r"^(?:i\s+)?(?:am\s+)?wanting to\s+",
        r"^(?:we\s+)?need to\s+",
        r"^(?:i\s+)?need to\s+",
        r"^(?:i\s+)?want to\s+",
        r"^(?:we\s+)?want to\s+",
        r"^(?:would\s+like\s+to)\s+",
        r"^(?:hoping to)\s+",
        r"^(?:looking for)\s+",
        r"^(?:help with)\s+",
    ]:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    text = text.strip(" -:;,.") or _safe_text(description)
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    if text and text[-1] not in ".!?":
        text += "."
    return text


def _request_lifecycle_payload(request_row, *, source_intake=None, linked_agreement=None, matching_counts=None) -> dict:
    if linked_agreement is not None:
        return {"state": "agreement_created", "label": "Agreement Created", "next_action": "Open the linked agreement for next steps."}
    if getattr(request_row, "converted_project_id", None) or request_row.status == CustomerRequest.STATUS_CONVERTED_TO_PROJECT:
        return {"state": "agreement_created", "label": "Agreement Created", "next_action": "Open the linked project or agreement."}
    if matching_counts and matching_counts.get("total", 0) > 0:
        return {"state": "sent_to_contractors", "label": "Sent to Contractors", "next_action": "Watch for contractor responses."}
    if source_intake is not None:
        return {"state": "reviewing", "label": "Reviewing Request", "next_action": "Find or select contractors when ready."}
    if request_row.status == CustomerRequest.STATUS_CANCELLED:
        return {"state": "closed", "label": "Closed", "next_action": "This request is cancelled."}
    if request_row.status == CustomerRequest.STATUS_CLOSED:
        return {"state": "closed", "label": "Closed", "next_action": "This request is closed."}
    if request_row.status == CustomerRequest.STATUS_DRAFT:
        return {"state": "draft", "label": "Draft", "next_action": "Finish and submit this request."}
    return {"state": "requested", "label": "Requested", "next_action": "Review the request or find a contractor."}


def _customer_request_rows(email: str) -> list[dict]:
    rows = []
    for request_row in CustomerRequest.objects.select_related(
        "converted_project",
        "property_profile",
        "source_intake",
        "source_intake__agreement",
        "linked_home_system",
        "linked_home_system__linked_agreement",
    ).filter(
        customer_email__iexact=email
    ).order_by("-created_at", "-id"):
        project_type = _safe_text(getattr(request_row, "project_type", "")) or _safe_text(getattr(request_row, "project_category", ""))
        project_subtype = _safe_text(getattr(request_row, "project_subtype", ""))
        project_scope = _safe_text(request_row.description)
        property_profile = getattr(request_row, "property_profile", None)
        project_address = _compact_address(
            getattr(request_row, "address_line1", ""),
            getattr(request_row, "address_line2", ""),
            getattr(request_row, "city", ""),
            getattr(request_row, "state", ""),
            getattr(request_row, "postal_code", ""),
        )
        linked_project = getattr(request_row, "converted_project", None)
        project_class = infer_project_class(project_type, project_scope, getattr(request_row, "preferred_timeline", ""), "")
        comparison_key = _comparison_key(email, project_address, project_class)
        source_intake = getattr(request_row, "source_intake", None)
        routed_contractors = _customer_request_routed_contractors(source_intake)
        workflow_key, workflow_label, next_action = _customer_request_workflow_status(
            request_row,
            bids_count=0,
        )
        can_edit = _customer_request_can_edit(request_row)
        matching_counts = _customer_request_matching_counts(request_row)
        can_cancel, cancel_lock_reason = _customer_request_cancel_state(request_row)
        can_delete = _customer_request_can_delete(request_row)
        linked_system = getattr(request_row, "linked_home_system", None)
        recommendation_payload = _customer_request_recommendation_payload(request_row)
        linked_agreement = getattr(source_intake, "agreement", None) or getattr(linked_system, "linked_agreement", None)
        lifecycle = _request_lifecycle_payload(
            request_row,
            source_intake=source_intake,
            linked_agreement=linked_agreement,
            matching_counts=matching_counts,
        )
        rows.append(
            {
                "id": f"customer-request-{request_row.id}",
                "request_id": request_row.id,
                "source_kind": "customer_request",
                "source_kind_label": "Customer Portal Request",
                "request_source": "Customer Portal",
                "request_source_label": "Customer Portal",
                "project_title": _safe_text(request_row.title),
                "project_scope": project_scope,
                "original_description": project_scope,
                "ai_enhanced_description": "",
                "ai_generated_title": "",
                "ai_generated_type": "",
                "ai_generated_subtype": "",
                "project_type": project_type,
                "project_subtype": project_subtype,
                "project_address": project_address,
                "project_class": project_class,
                "project_class_label": project_class_label(project_class),
                "comparison_key": comparison_key,
                "request_type": _safe_text(request_row.request_type),
                "request_type_label": request_row.get_request_type_display(),
                "project_mode": _safe_text(getattr(request_row, "project_mode", "")),
                "project_mode_label": request_row.get_project_mode_display() if getattr(request_row, "project_mode", "") else "",
                "project_category": _safe_text(getattr(request_row, "project_category", "")),
                "payment_preference": _safe_text(getattr(request_row, "payment_preference", "")),
                "payment_preference_label": request_row.get_payment_preference_display()
                if getattr(request_row, "payment_preference", "")
                else "",
                "status": _safe_text(request_row.status),
                "status_label": workflow_label,
                "workflow_status": workflow_key,
                "workflow_status_label": workflow_label,
                "lifecycle": lifecycle,
                "lifecycle_status": lifecycle["state"],
                "lifecycle_status_label": lifecycle["label"],
                "can_edit": can_edit,
                "edit_lock_reason": "" if can_edit else "Editing is locked after a request is sent to contractors or converted to an agreement.",
                "can_cancel": can_cancel,
                "cancel_lock_reason": cancel_lock_reason,
                "can_delete": can_delete,
                "delete_lock_reason": "" if can_delete else "Delete is only available before a request is sent to contractors.",
                "cancelled_at": _safe_dt(getattr(request_row, "cancelled_at", None)),
                "cancellation_reason": _safe_text(getattr(request_row, "cancellation_reason", "")),
                "contractor_matching_started": bool(source_intake),
                "source_intake_id": getattr(source_intake, "id", None),
                "source_intake_token": _safe_text(getattr(source_intake, "share_token", "")),
                "source_intake": _customer_request_source_intake_payload(request_row),
                "routed_contractor_count": matching_counts["total"],
                "routed_contractors": routed_contractors,
                "routed_at": _safe_dt(getattr(source_intake, "post_submit_flow_selected_at", None) or getattr(source_intake, "updated_at", None)) if matching_counts["total"] else "",
                "latest_activity": _safe_dt(request_row.updated_at or request_row.created_at),
                "created_at": _safe_dt(request_row.created_at),
                "updated_at": _safe_dt(request_row.updated_at),
                "latest_activity_label": "Updated",
                "bids_count": 0,
                "agreement_id": getattr(linked_agreement, "id", None),
                "agreement_token": _safe_text(getattr(linked_agreement, "homeowner_access_token", "")),
                "action_label": "View Request",
                "action_target": "",
                "current_next_action": next_action,
                "conversion_status": "Converted" if getattr(request_row, "converted_project_id", None) else workflow_label,
                "notes": project_scope,
                "urgency": _safe_text(request_row.urgency),
                "preferred_timeline": _safe_text(request_row.preferred_timeline),
                "timeline_label": _safe_text(request_row.preferred_timeline),
                "budget_preference": "",
                "materials_preferences": "",
                "scheduling_access_notes": "",
                "special_instructions": "" if recommendation_payload else _safe_text(getattr(request_row, "internal_notes", "")),
                "homeowner_name": "",
                "homeowner_email": _safe_text(getattr(request_row, "customer_email", "")),
                "homeowner_phone": "",
                "converted_project_id": getattr(request_row.converted_project, "id", None),
                "linked_home_system_id": getattr(linked_system, "id", None),
                "linked_home_system_name": _safe_text(getattr(linked_system, "display_name", "")) if linked_system else "",
                "recommendation_key": _safe_text(recommendation_payload.get("recommendation_key")),
                "recommendation_title": _safe_text(recommendation_payload.get("recommendation_title")),
                "recommendation_context": recommendation_payload.get("context", {}) if recommendation_payload else {},
                "linked_agreement_id": getattr(linked_agreement, "id", None),
                "property_id": getattr(property_profile, "id", None),
                "property_name": _safe_text(getattr(property_profile, "display_name", "")),
                "property_profile": {
                    "id": getattr(property_profile, "id", None),
                    "display_name": _safe_text(getattr(property_profile, "display_name", "")),
                    "property_type_label": getattr(property_profile, "get_property_type_display", lambda: "")(),
                    "address": _safe_text(getattr(property_profile, "address", "")) or project_address,
                }
                if property_profile
                else {},
                "detail_fields": [
                    field
                    for field in [
                        _request_detail_field("Project Type", project_type),
                        _request_detail_field("Project Subtype", project_subtype),
                        _request_detail_field("Timeline", getattr(request_row, "preferred_timeline", "")),
                        _request_detail_field("Urgency", getattr(request_row, "urgency", "")),
                        _request_detail_field("Payment Preference", request_row.get_payment_preference_display() if getattr(request_row, "payment_preference", "") else ""),
                    ]
                    if field
                ],
                "selected_contractor": routed_contractors[0] if routed_contractors else None,
                "photos": [],
                "documents": [],
                "activity_timeline": _customer_request_activity(request_row),
                "linked_work": _request_linked_work_payload(agreement=linked_agreement, project=linked_project),
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
        for row in rows:
            if row.get("source_kind") != "customer_request":
                continue
            key = _safe_text(row.get("comparison_key", ""))
            if not key:
                continue
            count = bid_counts.get(key, 0)
            if count:
                row["bids_count"] = count
                if not row.get("linked_work"):
                    customer_request = CustomerRequest.objects.filter(pk=row.get("request_id")).select_related("source_intake", "converted_project").first()
                    if customer_request is not None:
                        workflow_key, workflow_label, next_action = _customer_request_workflow_status(
                            customer_request,
                            bids_count=count,
                        )
                        row["workflow_status"] = workflow_key
                        row["workflow_status_label"] = workflow_label
                        row["status_label"] = workflow_label
                        row["current_next_action"] = next_action

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
        ).filter(source_customer_requests__isnull=True).order_by("-created_at", "-id")
    )

    for intake in intakes:
        request_status = _safe_text(getattr(intake, "status", "")).lower()
        linked_agreement = getattr(intake, "agreement", None)
        project_title, request_address, project_class = _request_identity_from_intake(intake)
        comparison_key = _comparison_key(email, request_address, project_class)
        comparison_agreement = agreement_by_key.get(comparison_key, {})
        selected_contractor = _selected_contractor_for_intake(intake, leads)
        analysis = getattr(intake, "ai_analysis_payload", None) or {}
        ai_timeline = (
            f"{intake.ai_project_timeline_days} days"
            if getattr(intake, "ai_project_timeline_days", None)
            else ""
        )
        ai_budget = format_money(getattr(intake, "ai_project_budget", None)) if getattr(intake, "ai_project_budget", None) else ""
        project_type = _safe_text(getattr(intake, "ai_project_type", "")) or _safe_text(getattr(intake, "property_type", "")) or project_class_label(project_class)
        project_subtype = _safe_text(getattr(intake, "ai_project_subtype", ""))
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
                "source_kind": "project_intake",
                "source_kind_label": "Public Intake Request",
                "request_source": _safe_text(intake.get_lead_source_display()),
                "request_source_label": _safe_text(intake.get_lead_source_display()),
                "project_title": project_title,
                "project_scope": _safe_text(getattr(intake, "accomplishment_text", "")),
                "original_description": _safe_text(getattr(intake, "accomplishment_text", "")),
                "ai_enhanced_description": _safe_text(getattr(intake, "ai_description", "")),
                "ai_generated_title": _safe_text(getattr(intake, "ai_project_title", "")),
                "ai_generated_type": _safe_text(getattr(intake, "ai_project_type", "")),
                "ai_generated_subtype": _safe_text(getattr(intake, "ai_project_subtype", "")),
                "project_type": project_type,
                "project_subtype": project_subtype,
                "project_address": request_address,
                "project_class": project_class,
                "project_class_label": project_class_label(project_class),
                "project_mode": _safe_text(getattr(intake, "project_mode", "")),
                "project_mode_label": intake.get_project_mode_display() if getattr(intake, "project_mode", "") else "",
                "request_type": _safe_text(getattr(intake, "post_submit_flow", "")),
                "request_type_label": intake.get_post_submit_flow_display() if getattr(intake, "post_submit_flow", "") else "",
                "project_category": _safe_text(getattr(intake, "property_type", "")),
                "payment_preference": _safe_text(getattr(intake, "payment_preference", "")),
                "payment_preference_label": intake.get_payment_preference_display() if getattr(intake, "payment_preference", "") else "",
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
                "current_next_action": (
                    "Open linked agreement"
                    if linked_agreement or comparison_agreement.get("agreement_token")
                    else "Compare contractor responses"
                    if bid_counts.get(comparison_key, related_bids) > 1
                    else "Review request details"
                ),
                "conversion_status": "Agreement draft created" if linked_agreement or comparison_agreement.get("agreement_token") else "Not converted yet",
                "notes": _safe_text(getattr(intake, "accomplishment_text", "")),
                "urgency": _safe_text(analysis.get("urgency") or analysis.get("priority")),
                "preferred_timeline": _safe_text(getattr(intake, "desired_timing_text", "")) or ai_timeline,
                "timeline_label": _safe_text(getattr(intake, "desired_timing_text", "")) or ai_timeline,
                "budget_preference": _safe_text(getattr(intake, "budget_range_text", "")) or ai_budget,
                "materials_preferences": _safe_text(analysis.get("materials_preferences") or analysis.get("materials") or analysis.get("material_preferences")),
                "scheduling_access_notes": _safe_text(analysis.get("scheduling_access_notes") or analysis.get("access_notes") or getattr(intake, "desired_timing_text", "")),
                "special_instructions": _safe_text(getattr(intake, "homeowner_participation_notes", ""))
                or _safe_text(getattr(intake, "homeowner_task_summary", ""))
                or _safe_text(getattr(intake, "homeowner_assistance_summary", "")),
                "homeowner_name": _safe_text(getattr(intake, "customer_name", "")),
                "homeowner_email": _safe_text(getattr(intake, "customer_email", "")),
                "homeowner_phone": _safe_text(getattr(intake, "customer_phone", "")),
                "property_profile": {},
                "property_name": "",
                "detail_fields": [
                    field
                    for field in [
                        _request_detail_field("Project Type", project_type),
                        _request_detail_field("Project Subtype", project_subtype),
                        _request_detail_field("Project Mode", intake.get_project_mode_display() if getattr(intake, "project_mode", "") else ""),
                        _request_detail_field("Timeline", _safe_text(getattr(intake, "desired_timing_text", "")) or ai_timeline),
                        _request_detail_field("Budget", _safe_text(getattr(intake, "budget_range_text", "")) or ai_budget),
                        _request_detail_field("Payment Preference", intake.get_payment_preference_display() if getattr(intake, "payment_preference", "") else ""),
                    ]
                    if field
                ],
                "selected_contractor": selected_contractor,
                "photos": [
                    {
                        "id": f"intake-photo-{photo.id}",
                        "title": _safe_text(getattr(photo, "caption", "")) or _safe_text(getattr(photo, "original_name", "")) or "Project photo",
                        "filename": _safe_text(getattr(photo, "original_name", "")) or _safe_text(getattr(getattr(photo, "image", None), "name", "")).rsplit("/", 1)[-1],
                        "url": _safe_text(getattr(getattr(photo, "image", None), "url", "")),
                        "uploaded_at": _safe_dt(getattr(photo, "uploaded_at", None)),
                    }
                    for photo in getattr(intake, "clarification_photos", []).all()
                ]
                if hasattr(getattr(intake, "clarification_photos", None), "all")
                else [],
                "documents": [],
                "activity_timeline": _intake_activity(intake, selected_contractor, linked_agreement),
                "linked_work": _request_linked_work_payload(linked_agreement or None),
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
                "contractor_rating": round(float(getattr(contractor, "average_rating", 0) or 0), 2) if contractor and int(getattr(contractor, "review_count", 0) or 0) else None,
                "contractor_review_count": int(getattr(contractor, "review_count", 0) or 0) if contractor else 0,
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
                "escrow_funded": bool(getattr(agreement, "escrow_funded", False)),
                "escrow_funded_amount": _safe_text(getattr(agreement, "escrow_funded_amount", "")),
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
                    "amendment_review_status": _safe_text(getattr(milestone, "amendment_review_status", "")),
                    "amendment_review_request_id": getattr(milestone, "amendment_review_request_id", None),
                    "materials_hint": _safe_text(getattr(milestone, "materials_hint", "")),
                }
                for milestone in Milestone.objects.filter(agreement=agreement).order_by("order", "id")[:8]
            ]
        row = {
            "id": project.id,
            "project_number": _safe_text(project.number),
            "title": _safe_text(project.title),
            "description": _safe_text(project.description),
            "project_type": _safe_text(getattr(agreement, "project_type", "")) or _safe_text(getattr(project, "project_type", "")),
            "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")) or _safe_text(getattr(project, "project_subtype", "")),
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
            "escrow_funded": bool(getattr(agreement, "escrow_funded", False)) if agreement else False,
            "escrow_funded_amount": _safe_text(getattr(agreement, "escrow_funded_amount", "")) if agreement else "",
            "milestones": milestone_rows,
            "updates": _project_messages(agreement) if agreement else [],
            "updated_at": _safe_dt(getattr(project, "updated_at", None) or getattr(project, "created_at", None)),
            "customer_visible_reason": visible_reason,
            "review": _portal_review_state(agreement, email) if agreement else {
                "eligible": False,
                "reason": "Agreement is not ready for review yet.",
                "message": "Share feedback about your project experience.",
                "existing_review": None,
                "submitted": False,
                "agreement_id": None,
            },
        }
        row["suggested_materials"] = build_project_material_recommendations(row, milestone_rows)
        rows.append(row)
    return rows


def _portal_review_state(agreement, email: str) -> dict:
    eligibility = review_eligibility(agreement, email)
    existing = eligibility.get("existing_review")
    return {
        "eligible": bool(eligibility.get("eligible")),
        "reason": _safe_text(eligibility.get("reason")),
        "message": "Share feedback about your project experience.",
        "existing_review": existing,
        "submitted": bool(existing),
        "agreement_id": getattr(agreement, "id", None) if agreement else None,
    }


def _portal_dispute_public_url(dispute) -> str:
    if not dispute or not getattr(dispute, "public_token", None):
        return ""
    return f"/disputes/{dispute.id}?token={dispute.public_token}"


def _portal_dispute_status(dispute) -> tuple[str, str]:
    if not dispute:
        return "none", "No dispute"
    value = _safe_text(getattr(dispute, "status", "open")).lower()
    resolution_type = _safe_text(getattr(dispute, "resolution_type", "")).lower()
    if resolution_type:
        return value or "resolved", "Resolution recorded"
    if getattr(dispute, "escrow_frozen", False):
        return value or "open", "Escrow hold active"
    if value in {"initiated", "open"}:
        return value or "open", "Dispute opened"
    if value == "under_review":
        return value, "Under review"
    return value, value.replace("_", " ").title()


def _portal_dispute_metadata(dispute) -> dict:
    if not dispute:
        return {
            "dispute_escrow_hold_active": False,
            "dispute_resolution_type": "",
            "dispute_financial_disposition": "",
            "dispute_next_action": "",
        }
    status = _safe_text(getattr(dispute, "status", "")).lower()
    resolution_type = _safe_text(getattr(dispute, "resolution_type", "")).lower()
    financial_disposition = _safe_text(getattr(dispute, "financial_disposition", "")).lower()
    homeowner_response = _safe_text(getattr(dispute, "homeowner_response", ""))
    contractor_response = _safe_text(getattr(dispute, "contractor_response", ""))
    if resolution_type:
        next_action = "Resolution recorded"
    elif getattr(dispute, "escrow_frozen", False):
        next_action = "Track issue status"
    elif status == "under_review":
        next_action = "Under review"
    elif not homeowner_response:
        next_action = "Awaiting your response"
    elif not contractor_response:
        next_action = "Awaiting contractor response"
    else:
        next_action = "Under review"
    return {
        "dispute_escrow_hold_active": bool(getattr(dispute, "escrow_frozen", False)),
        "dispute_resolution_type": resolution_type,
        "dispute_financial_disposition": financial_disposition,
        "dispute_next_action": next_action,
    }


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
        invoice_amount = _invoice_amount(invoice)
        invoice_status = _safe_text(getattr(invoice, "status", "")).lower()
        invoice_paid = bool(
            getattr(invoice, "escrow_released", False)
            or getattr(invoice, "direct_pay_paid_at", None)
            or invoice_status == "paid"
        )
        status_text = (
            "Paid"
            if invoice_paid
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
                "amount": str(invoice_amount),
                "amount_label": f"${invoice_amount:.2f}",
                "status": invoice_status,
                "status_label": status_text,
                "released_to_contractor": bool(getattr(invoice, "escrow_released", False)),
                "customer_payment_recorded": bool(getattr(invoice, "direct_pay_paid_at", None)),
                "escrow_funding_record": False,
                "is_actionable": bool(invoice_amount > Decimal("0.00") and not invoice_paid),
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
                "notes": "No payment required" if invoice_amount <= Decimal("0.00") else "Escrow release" if getattr(invoice, "escrow_released", False) else "Direct pay" if getattr(invoice, "direct_pay_paid_at", None) else "",
            }
        )

    for draw in draws:
        agreement = getattr(draw, "agreement", None)
        dispute = _draw_dispute(draw)
        dispute_status, dispute_status_label = _portal_dispute_status(dispute)
        dispute_metadata = _portal_dispute_metadata(dispute)
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
                "released_to_contractor": bool(getattr(draw, "paid_at", None) or getattr(draw, "released_at", None) or getattr(draw, "status", "") in {"paid", "released"}),
                "customer_payment_recorded": False,
                "escrow_funding_record": False,
                "dispute_status": dispute_status,
                "dispute_status_label": dispute_status_label,
                "dispute_url": _portal_dispute_public_url(dispute),
                **dispute_metadata,
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
                "released_to_contractor": bool(getattr(reimbursement, "released_at", None) or status_value == ExpenseRequest.Status.RELEASED),
                "customer_payment_recorded": False,
                "escrow_funding_record": False,
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
    enrich_customer_portal_rows(project_rows, agreement_rows, payment_rows)
    _attach_homeowner_action_metadata(project_rows, agreement_rows)
    maintenance_work_order_rows = _maintenance_work_order_rows(email, request=request)
    document_rows = _documents(email, request=request)
    property_profile = _property_profile_payload(email)
    property_profiles = _property_profiles_payload(email)
    tenant_maintenance_request_rows = _tenant_maintenance_requests_for_email(email)
    property_work_order_rows = _property_work_orders_for_email(email)
    property_intelligence = build_property_intelligence(email)
    recommendations = build_customer_recommendations(email, property_intelligence=property_intelligence)

    summary = {
        "active_requests": sum(1 for row in request_rows if row.get("status") not in {"converted", "converted_to_project", "archived", "closed"}),
        "active_projects": len(project_rows),
        "bids_received": len(bid_rows),
        "active_agreements": sum(1 for row in agreement_rows if row.get("status") not in {"archived", "cancelled"}),
        "payments": len(payment_rows),
        "documents": len(document_rows),
        "maintenance_work_orders": len(maintenance_work_order_rows),
        "tenant_maintenance_requests": len(tenant_maintenance_request_rows),
        "property_work_orders": len(property_work_order_rows),
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
        "tenant_maintenance_requests": tenant_maintenance_request_rows,
        "property_work_orders": property_work_order_rows,
        "documents": document_rows,
        "property_profile": property_profile,
        "property_profiles": property_profiles,
        "property_intelligence": property_intelligence,
        "recommendations": recommendations,
        "notifications": _smart_notification_rows(email),
        "notification_cleanup_preferences": cleanup_preferences_payload(
            cleanup_preferences_for_email(email, homeowner=_primary_homeowner_for_email(email))
        ),
    }


def _active_amendment_request(agreement):
    if not agreement:
        return None
    return (
        AmendmentRequest.objects.filter(agreement=agreement)
        .exclude(status=AmendmentRequest.Status.CLOSED)
        .order_by("-created_at", "-id")
        .first()
    )


def _active_refund_request(agreement):
    if not agreement:
        return None
    return (
        CustomerRefundRequest.objects.filter(agreement=agreement)
        .exclude(status__in=[CustomerRefundRequest.Status.DENIED, CustomerRefundRequest.Status.REFUNDED])
        .order_by("-created_at", "-id")
        .first()
    )


def _active_dispute(agreement):
    if not agreement:
        return None
    return (
        Dispute.objects.filter(agreement=agreement, is_archived=False)
        .exclude(status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "canceled", "cancelled", "closed"])
        .order_by("-created_at", "-id")
        .first()
    )


def _serialize_amendment_attachment(attachment: AmendmentRequestAttachment) -> dict:
    file_obj = getattr(attachment, "file", None)
    try:
        file_url = getattr(file_obj, "url", "") or ""
    except Exception:
        file_url = ""
    return {
        "id": attachment.id,
        "filename": _safe_text(attachment.original_filename) or _safe_text(getattr(file_obj, "name", "")) or "attachment",
        "content_type": _safe_text(attachment.content_type),
        "size": int(getattr(attachment, "size", 0) or 0),
        "uploaded_at": _safe_dt(getattr(attachment, "uploaded_at", None)),
        "url": file_url,
    }


def _serialize_case(kind: str, obj) -> dict | None:
    if not obj:
        return None
    if kind == "amendment":
        requested_changes = obj.requested_changes or {}
        return {
            "id": obj.id,
            "type": kind,
            "label": "De-scope Review Pending" if obj.change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else "Amendment Pending",
            "status": obj.status,
            "status_label": obj.get_status_display(),
            "change_type": obj.change_type,
            "change_type_label": obj.get_change_type_display(),
            "created_at": _safe_dt(obj.created_at),
            "summary": _safe_text(obj.justification) or _safe_text(requested_changes.get("requested_change")),
            "original_project_value": str(obj.original_project_value) if obj.original_project_value is not None else "",
            "revised_project_value": str(obj.revised_project_value) if obj.revised_project_value is not None else "",
            "escrow_funded_amount": str(obj.escrow_funded_amount) if obj.escrow_funded_amount is not None else "",
            "estimated_refundable_escrow_surplus": str(obj.estimated_refundable_escrow_surplus or Decimal("0.00")),
            "refund_eligibility_status": obj.refund_eligibility_status,
            "refund_eligibility_label": obj.get_refund_eligibility_status_display(),
            "response_state": obj.response_state,
            "response_label": obj.get_response_state_display(),
            "response_note": _safe_text(obj.response_note),
            "counter_proposal": obj.counter_proposal or {},
            "counter_attachments": [
                _serialize_amendment_attachment(attachment)
                for attachment in obj.attachments.all()
            ],
            "response_due_at": _safe_dt(obj.response_due_at),
            "affected_milestone_ids": list(obj.affected_milestones.values_list("id", flat=True)),
            "activity_events": serialize_project_activity_events(obj.agreement, object_type="amendment_request", object_id=obj.id, limit=12),
        }
    if kind == "refund":
        return {
            "id": obj.id,
            "type": kind,
            "label": "Refund Pending",
            "status": obj.status,
            "status_label": obj.get_status_display(),
            "created_at": _safe_dt(obj.created_at),
            "summary": _safe_text(obj.reason),
        }
    if kind == "dispute":
        return {
            "id": obj.id,
            "type": kind,
            "label": "Dispute Open",
            "status": obj.status,
            "status_label": _safe_text(obj.status).replace("_", " ").title(),
            "created_at": _safe_dt(obj.created_at),
            "summary": _safe_text(obj.reason),
            "url": _portal_dispute_public_url(obj),
        }
    return None


def _homeowner_action_metadata(agreement_id, status_key: str, payment_summary: dict) -> dict:
    if not agreement_id:
        return {"actions": {}, "active_cases": []}
    agreement = Agreement.objects.filter(id=agreement_id).first()
    amendment = _active_amendment_request(agreement)
    refund = _active_refund_request(agreement)
    dispute = _active_dispute(agreement)
    amendment_allowed = status_key in {
        "signed",
        "escrow_needed",
        "funded",
        "in_progress",
        "awaiting_review",
        "payment_pending",
    }
    refund_allowed = Decimal(str((payment_summary or {}).get("remaining_in_escrow") or "0")) > Decimal("0.00")
    dispute_allowed = status_key in {"funded", "in_progress", "awaiting_review", "payment_pending", "completed", "disputed"}
    actions = {
        "amendment": {
            "available": bool(amendment_allowed and not amendment),
            "active": bool(amendment),
            "label": "View Amendment Request" if amendment else "Request Amendment",
        },
        "refund": {
            "available": bool(refund_allowed and not refund),
            "active": bool(refund),
            "label": "View Refund Request" if refund else "Request Refund",
        },
        "dispute": {
            "available": bool(dispute_allowed and not dispute),
            "active": bool(dispute),
            "label": "View Dispute" if dispute else "Open Dispute",
        },
    }
    return {
        "actions": actions,
        "active_cases": [
            row
            for row in [
                _serialize_case("amendment", amendment),
                _serialize_case("refund", refund),
                _serialize_case("dispute", dispute),
            ]
            if row
        ],
    }


def _attach_homeowner_action_metadata(project_rows: list[dict], agreement_rows: list[dict]) -> None:
    metadata_by_agreement_id = {}
    for row in agreement_rows:
        metadata = _homeowner_action_metadata(row.get("id"), row.get("customer_status_key", ""), row.get("payment_summary") or {})
        row["homeowner_actions"] = metadata["actions"]
        row["active_cases"] = metadata["active_cases"]
        metadata_by_agreement_id[str(row.get("id"))] = metadata
    for row in project_rows:
        metadata = metadata_by_agreement_id.get(str(row.get("agreement_id") or ""))
        if not metadata:
            metadata = _homeowner_action_metadata(row.get("agreement_id"), row.get("customer_status_key", ""), row.get("payment_summary") or {})
        row["homeowner_actions"] = metadata["actions"]
        row["active_cases"] = metadata["active_cases"]


def _customer_profile_payload(email: str) -> dict:
    homeowner = _primary_homeowner_for_email(email)
    user = User.objects.filter(email__iexact=email).first()
    default_account_type = getattr(Homeowner, "ACCOUNT_TYPE_INDIVIDUAL", "individual")
    return {
        "full_name": _safe_text(getattr(homeowner, "full_name", "")) or _safe_text(getattr(user, "get_full_name", lambda: "")()),
        "phone_number": _safe_text(getattr(homeowner, "phone_number", "")),
        "account_type": _safe_text(getattr(homeowner, "account_type", "")) or default_account_type,
        "address_line1": _safe_text(getattr(homeowner, "street_address", "")),
        "address_line2": _safe_text(getattr(homeowner, "address_line_2", "")),
        "city": _safe_text(getattr(homeowner, "city", "")),
        "state": _safe_text(getattr(homeowner, "state", "")),
        "postal_code": _safe_text(getattr(homeowner, "zip_code", "")),
        "company_name": _safe_text(getattr(homeowner, "company_name", "")),
        "company_phone": _safe_text(getattr(homeowner, "company_phone", "")),
        "company_email": _safe_text(getattr(homeowner, "company_email", "")),
        "company_website": _safe_text(getattr(homeowner, "company_website", "")),
        "company_street": _safe_text(getattr(homeowner, "company_street", "")),
        "company_unit": _safe_text(getattr(homeowner, "company_unit", "")),
        "company_city": _safe_text(getattr(homeowner, "company_city", "")),
        "company_state": _safe_text(getattr(homeowner, "company_state", "")),
        "company_zip": _safe_text(getattr(homeowner, "company_zip", "")),
        "company_license_number": _safe_text(getattr(homeowner, "company_license_number", "")),
        "company_notes": _safe_text(getattr(homeowner, "company_notes", "")),
    }


def _customer_account_payload(email: str) -> dict:
    user = User.objects.filter(email__iexact=email).first()
    homeowner = _primary_homeowner_for_email(email)
    company = create_or_sync_company_from_homeowner(homeowner)
    profile = _customer_profile_payload(email)
    is_property_management_company = profile["account_type"] == getattr(
        Homeowner,
        "ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY",
        "property_management_company",
    )
    return {
        "email": email,
        "has_user": bool(user),
        "has_usable_password": bool(user and user.has_usable_password()),
        "portal_token": _portal_token(email),
        "account_type": profile["account_type"],
        "is_property_management_company": is_property_management_company,
        "company": company_payload(company),
        "team_members": _property_management_team_payload(company),
        "vendors": _property_vendor_rows(company),
        "managed_property_count": managed_properties_for_company(company).count() if company else 0,
        "company_name": profile["company_name"],
        "company_phone": profile["company_phone"],
        "company_email": profile["company_email"],
        "company_website": profile["company_website"],
        "company_street": profile["company_street"],
        "company_unit": profile["company_unit"],
        "company_city": profile["company_city"],
        "company_state": profile["company_state"],
        "company_zip": profile["company_zip"],
        "company_license_number": profile["company_license_number"],
        "company_notes": profile["company_notes"],
    }


HOMEOWNER_VISIBLE_NOTIFICATION_EVENTS = {
    SmartNotificationEvent.CUSTOMER_REQUEST_SUBMITTED,
    SmartNotificationEvent.PROPERTY_PROFILE_UPDATED,
    SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED,
    SmartNotificationEvent.CUSTOMER_BID_RECEIVED,
    SmartNotificationEvent.BID_AWARDED,
    SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE,
    SmartNotificationEvent.AGREEMENT_SIGNED,
    SmartNotificationEvent.ESCROW_NEEDS_FUNDING,
    SmartNotificationEvent.ESCROW_FUNDED,
    SmartNotificationEvent.MILESTONE_NEEDS_APPROVAL,
    SmartNotificationEvent.PAYMENT_RECEIVED,
    SmartNotificationEvent.REIMBURSEMENT_SUBMITTED,
    SmartNotificationEvent.REIMBURSEMENT_APPROVED,
    SmartNotificationEvent.REIMBURSEMENT_DENIED,
    SmartNotificationEvent.REIMBURSEMENT_RELEASED,
    SmartNotificationEvent.REIMBURSEMENT_HELD,
    SmartNotificationEvent.DISPUTE_OPENED,
    SmartNotificationEvent.DISPUTE_UPDATED,
    SmartNotificationEvent.DISPUTE_RESOLVED,
    SmartNotificationEvent.REQUEST_MARKETPLACE_READY,
    SmartNotificationEvent.MAINTENANCE_WORK_ORDER_SCHEDULED,
    SmartNotificationEvent.MAINTENANCE_WORK_ORDER_COMPLETED,
    SmartNotificationEvent.MAINTENANCE_CONTRACT_CANCELLED,
    SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER,
}


def _notification_identity(row: SmartNotification) -> tuple:
    created_at = getattr(row, "created_at", None)
    bucket = 0
    if created_at:
        try:
            bucket = int(created_at.timestamp() // 600)
        except Exception:
            bucket = 0
    object_key = (
        getattr(row, "invoice_id", None)
        or getattr(row, "draw_request_id", None)
        or getattr(row, "milestone_id", None)
        or getattr(row, "agreement_id", None)
        or getattr(row, "project_id", None)
        or getattr(row, "customer_request_id", None)
        or getattr(row, "property_profile_id", None)
        or f"{_safe_text(row.title).lower()}:{_safe_text(row.message).lower()}"
    )
    return (_safe_text(row.event_type), object_key, bucket)


def _serialize_smart_notification(row: SmartNotification) -> dict:
    title = _safe_text(row.title)
    message = _safe_text(row.message)
    linked_invoice = getattr(row, "invoice", None)
    if (
        linked_invoice is not None
        and _safe_text(row.event_type) == SmartNotificationEvent.PAYMENT_RECEIVED
        and Decimal(str(getattr(linked_invoice, "amount", 0) or 0)) <= Decimal("0.00")
    ):
        project_title = _agreement_title(getattr(linked_invoice, "agreement", None))
        title = "Dispute correction recorded"
        message = f"No payment is required for {project_title or 'this correction'}."
    return {
        "id": row.id,
        "event_type": _safe_text(row.event_type),
        "channel": _safe_text(row.channel),
        "status": _safe_text(row.status),
        "is_archived": bool(row.archived_at or row.status == SmartNotification.STATUS_DISMISSED),
        "archived_at": _safe_dt(row.archived_at),
        "auto_archived_at": _safe_dt(row.auto_archived_at),
        "archive_reason": _safe_text(row.archive_reason),
        "title": title,
        "message": message,
        "action_url": _safe_text(row.action_url),
        "created_at": _safe_dt(row.created_at),
    }


def _smart_notification_rows(email: str) -> list[dict]:
    seen = set()
    rows = []
    qs = (
        SmartNotification.objects.select_related(
            "agreement",
            "invoice",
            "invoice__agreement",
            "project",
            "milestone",
            "draw_request",
            "customer_request",
            "property_profile",
        )
        .filter(recipient_email__iexact=email, channel=NotificationRule.CHANNEL_IN_APP)
        .order_by("-created_at", "-id")[:100]
    )
    for row in qs:
        if _safe_text(row.event_type) not in HOMEOWNER_VISIBLE_NOTIFICATION_EVENTS:
            continue
        if not _smart_notification_belongs_to_email(row, email):
            continue
        key = _notification_identity(row)
        if key in seen:
            continue
        seen.add(key)
        rows.append(_serialize_smart_notification(row))
        if len(rows) >= 20:
            break
    return rows


def _invoice_amount(invoice) -> Decimal:
    try:
        return Decimal(str(getattr(invoice, "amount", 0) or 0))
    except Exception:
        return Decimal("0.00")


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
        invoice_status = _safe_text(getattr(invoice, "status", "")).lower()
        invoice_amount = _invoice_amount(invoice)
        is_zero_correction = invoice_amount <= Decimal("0.00") and invoice_status in {"approved", "paid"}
        if invoice_status != "paid" and not paid_at and not is_zero_correction:
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
                "dedupe_key": f"{'zero_correction' if is_zero_correction else 'payment_received'}:invoice:{invoice.id}",
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
        amount = _invoice_amount(invoice)
        approved = status == "approved"
        if approved and not paid and amount > Decimal("0.00") and approved_unpaid is None:
            approved_unpaid = invoice
        invoice_rows.append(
            {
                "id": invoice.id,
                "type": "invoice",
                "label": f"Invoice {getattr(invoice, 'invoice_number', invoice.id)}",
                "amount": str(amount),
                "amount_label": f"${amount:.2f}",
                "status": "paid" if paid else status or "pending",
                "status_label": "Paid" if paid else _safe_text(getattr(invoice, "status", "")).replace("_", " ").title() or "Pending",
                "is_actionable": bool(amount > Decimal("0.00") and not paid),
                "date": _safe_dt(getattr(invoice, "escrow_released_at", None) or getattr(invoice, "direct_pay_paid_at", None) or getattr(invoice, "approved_at", None) or getattr(invoice, "created_at", None)),
                "link": f"/invoice/{invoice.public_token}",
                "notes": "No payment required" if amount <= Decimal("0.00") else "Escrow release" if getattr(invoice, "escrow_released", False) else "Direct pay" if getattr(invoice, "direct_pay_paid_at", None) else "",
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
        if row.get("status") == "approved" and row.get("is_actionable"):
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
        elif row.get("status") == "approved" and not row.get("is_actionable"):
            activity.append(
                {
                    "id": f"invoice-correction-{row['id']}",
                    "category": "payment_info",
                    "title": "Dispute correction recorded",
                    "body": "No payment is required for this correction.",
                    "tone": "slate",
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

    approved_invoice = next((row for row in invoice_rows if row.get("status") == "approved" and row.get("is_actionable")), None)
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
        "review": _portal_review_state(agreement, _safe_text(getattr(getattr(agreement, "homeowner", None), "email", ""))),
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


class CustomerPortalNotificationActionMixin:
    permission_classes = [AllowAny]

    def _portal_email(self, token: str):
        try:
            return _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _notification_queryset(self):
        return (
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
            )
        )

    def _get_notification(self, notification_id: int, email: str):
        notification = get_object_or_404(self._notification_queryset(), pk=notification_id)
        if not _smart_notification_belongs_to_email(notification, email):
            return None
        return notification


class CustomerPortalNotificationMarkReadView(CustomerPortalNotificationActionMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, notification_id: int):
        email = self._portal_email(token)
        if isinstance(email, Response):
            return email

        notification = self._get_notification(notification_id, email)
        if notification is None:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        if notification.status != SmartNotification.STATUS_READ:
            notification.status = SmartNotification.STATUS_READ
            notification.read_at = timezone.now()
            notification.save(update_fields=["status", "read_at"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalNotificationMarkAllReadView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()
        notifications = SmartNotification.objects.filter(
            recipient_email__iexact=email,
            channel=NotificationRule.CHANNEL_IN_APP,
            status=SmartNotification.STATUS_UNREAD,
        )
        for notification in notifications:
            if _safe_text(notification.event_type) not in HOMEOWNER_VISIBLE_NOTIFICATION_EVENTS:
                continue
            if not _smart_notification_belongs_to_email(notification, email):
                continue
            notification.status = SmartNotification.STATUS_READ
            notification.read_at = now
            notification.save(update_fields=["status", "read_at"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalNotificationArchiveView(CustomerPortalNotificationActionMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, notification_id: int):
        email = self._portal_email(token)
        if isinstance(email, Response):
            return email

        notification = self._get_notification(notification_id, email)
        if notification is None:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        if notification.status != SmartNotification.STATUS_DISMISSED:
            notification.status = SmartNotification.STATUS_DISMISSED
            if not notification.read_at:
                notification.read_at = timezone.now()
            notification.archived_at = timezone.now()
            notification.archive_reason = "manual_archive"
            notification.auto_archived_at = None
            notification.save(update_fields=["status", "read_at", "archived_at", "auto_archived_at", "archive_reason"])
        elif not notification.archived_at:
            notification.archived_at = timezone.now()
            notification.archive_reason = notification.archive_reason or "manual_archive"
            notification.save(update_fields=["archived_at", "archive_reason"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalNotificationRestoreView(CustomerPortalNotificationActionMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, notification_id: int):
        email = self._portal_email(token)
        if isinstance(email, Response):
            return email

        notification = self._get_notification(notification_id, email)
        if notification is None:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        notification.status = SmartNotification.STATUS_READ
        if not notification.read_at:
            notification.read_at = timezone.now()
        notification.archived_at = None
        notification.auto_archived_at = None
        notification.archive_reason = ""
        notification.save(update_fields=["status", "read_at", "archived_at", "auto_archived_at", "archive_reason"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalNotificationCleanupPreferenceSerializer(serializers.Serializer):
    auto_archive_enabled = serializers.BooleanField(required=False)
    auto_archive_frequency = serializers.ChoiceField(
        choices=[choice[0] for choice in CustomerNotificationCleanupPreference.FREQUENCY_CHOICES],
        required=False,
    )
    auto_archive_read_after_days = serializers.IntegerField(required=False, min_value=7, max_value=3650)
    auto_archive_maintenance_after_days = serializers.IntegerField(required=False, min_value=14, max_value=3650)
    auto_archive_completed_work_after_days = serializers.IntegerField(required=False, min_value=30, max_value=3650)


class CustomerPortalNotificationCleanupPreferenceView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalNotificationCleanupPreferenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preference = cleanup_preferences_for_email(email, homeowner=_primary_homeowner_for_email(email))
        for field, value in serializer.validated_data.items():
            setattr(preference, field, value)
        preference.next_auto_archive_run_at = next_cleanup_run_at(preference)
        preference.save()
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


CUSTOMER_PORTAL_TIMELINE_CHOICES = [
    "",
    "As soon as possible",
    "Within the next month",
    "1-3 months",
    "Just planning right now",
    "Specific date",
]


class CustomerPortalRequestSerializer(serializers.Serializer):
    property_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    request_type = serializers.ChoiceField(choices=[choice[0] for choice in CustomerRequest.REQUEST_TYPE_CHOICES])
    project_mode = serializers.CharField(max_length=32, required=False, allow_blank=True)
    project_category = serializers.CharField(max_length=80, required=False, allow_blank=True)
    project_type = serializers.CharField(max_length=120, required=False, allow_blank=True)
    project_subtype = serializers.CharField(max_length=120, required=False, allow_blank=True)
    payment_preference = serializers.ChoiceField(
        choices=[choice[0] for choice in CustomerRequest.PAYMENT_PREFERENCE_CHOICES],
        required=False,
        allow_blank=True,
    )
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    project_title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    project_scope = serializers.CharField(required=False, allow_blank=True)
    urgency = serializers.CharField(max_length=32, required=False, allow_blank=True)
    preferred_timeline = serializers.ChoiceField(
        choices=CUSTOMER_PORTAL_TIMELINE_CHOICES,
        required=False,
        allow_blank=True,
    )
    address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    state = serializers.CharField(max_length=60, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=24, required=False, allow_blank=True)
    linked_home_system_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    recommendation_key = serializers.CharField(max_length=160, required=False, allow_blank=True)
    recommendation_title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    recommendation_context = serializers.JSONField(required=False)
    status = serializers.ChoiceField(
        choices=[CustomerRequest.STATUS_DRAFT, CustomerRequest.STATUS_SUBMITTED],
        required=False,
    )

    def validate(self, attrs):
        title = _safe_text(attrs.get("project_title") or attrs.get("title"))
        scope = _safe_text(attrs.get("project_scope") or attrs.get("description"))
        if not title:
            raise serializers.ValidationError({"project_title": "Project Title is required."})
        if not scope:
            raise serializers.ValidationError({"project_scope": "Project Scope is required."})
        attrs["title"] = title
        attrs["description"] = scope
        attrs["project_type"] = _safe_text(attrs.get("project_type") or attrs.get("project_category"))
        attrs["project_subtype"] = _safe_text(attrs.get("project_subtype"))
        attrs["project_category"] = _safe_text(attrs.get("project_category") or attrs.get("project_type"))
        if attrs.get("project_mode") == "diy_assistance":
            attrs["project_mode"] = CustomerRequest.PROJECT_MODE_DIY_ASSIST
        allowed_modes = {choice[0] for choice in CustomerRequest.PROJECT_MODE_CHOICES}
        if attrs.get("project_mode") and attrs["project_mode"] not in allowed_modes:
            raise serializers.ValidationError({"project_mode": "Select a valid project mode."})
        return attrs


def _home_system_for_request_or_none(email: str, profile: PropertyProfile, system_id) -> PropertyHomeSystem | None:
    if not system_id:
        return None
    return get_object_or_404(
        PropertyHomeSystem.objects.select_related("property_profile"),
        pk=system_id,
        property_profile=profile,
        property_profile__customer_email__iexact=email.lower().strip(),
        is_archived=False,
    )


def _customer_request_recommendation_notes(data: dict, system: PropertyHomeSystem | None) -> str:
    key = _safe_text(data.get("recommendation_key"))
    title = _safe_text(data.get("recommendation_title"))
    context = data.get("recommendation_context") if isinstance(data.get("recommendation_context"), dict) else {}
    if not key and not title and not context:
        return ""
    payload = {
        "source": "home_system_recommendation",
        "linked_home_system_id": getattr(system, "id", None),
        "linked_home_system_name": _safe_text(getattr(system, "display_name", "")) if system else "",
        "recommendation_key": key,
        "recommendation_title": title,
        "context": context,
    }
    return json.dumps(payload, sort_keys=True)


def _customer_request_recommendation_payload(request_row: CustomerRequest) -> dict:
    raw = _safe_text(getattr(request_row, "internal_notes", ""))
    if not raw or "home_system_recommendation" not in raw:
        return {}
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if payload.get("source") != "home_system_recommendation":
        return {}
    return payload


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
        linked_system = _home_system_for_request_or_none(email, profile, data.get("linked_home_system_id"))
        internal_notes = _customer_request_recommendation_notes(data, linked_system)
        customer_request = CustomerRequest.objects.create(
            homeowner=homeowner,
            property_profile=profile,
            linked_home_system=linked_system,
            customer_email=email.lower().strip(),
            request_type=data["request_type"],
            project_mode=data.get("project_mode", ""),
            project_category=data.get("project_category", ""),
            project_type=data.get("project_type", ""),
            project_subtype=data.get("project_subtype", ""),
            payment_preference=data.get("payment_preference", ""),
            status=data.get("status") or CustomerRequest.STATUS_SUBMITTED,
            title=data["title"],
            description=data["description"],
            urgency=data.get("urgency", ""),
            preferred_timeline=data.get("preferred_timeline", ""),
            internal_notes=internal_notes,
            **address_defaults,
        )
        if linked_system and linked_system.linked_customer_request_id is None:
            linked_system.linked_customer_request = customer_request
            linked_system.save(update_fields=["linked_customer_request", "updated_at"])
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


class CustomerPortalRequestDetailView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, token: str, request_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        customer_request = get_object_or_404(
            CustomerRequest.objects.select_related("property_profile", "source_intake", "converted_project"),
            pk=request_id,
            customer_email__iexact=email.lower().strip(),
        )
        if not _customer_request_can_edit(customer_request):
            return Response(
                {"detail": "This request has already been sent to contractors. Use follow-up messaging or an amendment request for changes."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        recommendation_payload = _customer_request_recommendation_payload(customer_request)
        merged = {
            "property_id": getattr(customer_request.property_profile, "id", None),
            "request_type": customer_request.request_type,
            "project_mode": customer_request.project_mode,
            "project_category": customer_request.project_category,
            "project_type": customer_request.project_type,
            "project_subtype": customer_request.project_subtype,
            "payment_preference": customer_request.payment_preference,
            "project_title": customer_request.title,
            "project_scope": customer_request.description,
            "urgency": customer_request.urgency,
            "preferred_timeline": customer_request.preferred_timeline,
            "address_line1": customer_request.address_line1,
            "address_line2": customer_request.address_line2,
            "city": customer_request.city,
            "state": customer_request.state,
            "postal_code": customer_request.postal_code,
            "status": customer_request.status,
            "linked_home_system_id": getattr(customer_request, "linked_home_system_id", None),
            "recommendation_key": recommendation_payload.get("recommendation_key", ""),
            "recommendation_title": recommendation_payload.get("recommendation_title", ""),
            "recommendation_context": recommendation_payload.get("context", {}),
        }
        merged.update(request.data)
        serializer = CustomerPortalRequestSerializer(data=merged)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile = _property_profile_for_email_or_404(email, data.get("property_id"))
        linked_system = _home_system_for_request_or_none(email, profile, data.get("linked_home_system_id"))
        for field in [
            "request_type",
            "project_mode",
            "project_category",
            "project_type",
            "project_subtype",
            "payment_preference",
            "status",
            "urgency",
            "preferred_timeline",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "postal_code",
        ]:
            setattr(customer_request, field, data.get(field, ""))
        customer_request.property_profile = profile
        customer_request.linked_home_system = linked_system
        customer_request.title = data["title"]
        customer_request.description = data["description"]
        recommendation_notes = _customer_request_recommendation_notes(data, linked_system)
        if recommendation_notes:
            customer_request.internal_notes = recommendation_notes
        customer_request.save()
        if getattr(customer_request, "source_intake_id", None):
            _sync_customer_request_source_intake(customer_request)
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, request_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        customer_request = get_object_or_404(
            CustomerRequest.objects.select_related("property_profile", "source_intake", "converted_project"),
            pk=request_id,
            customer_email__iexact=email.lower().strip(),
        )
        if not _customer_request_can_delete(customer_request):
            return Response(
                {"detail": "Only private requests that have not been sent to contractors can be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        customer_request.delete()
        return Response(
            {
                "detail": "Request deleted.",
                "request_id": request_id,
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalRequestCancelView(APIView):
    permission_classes = [AllowAny]

    class InputSerializer(serializers.Serializer):
        reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def post(self, request, token: str, request_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        customer_request = get_object_or_404(
            CustomerRequest.objects.select_related("property_profile", "source_intake", "converted_project", "homeowner"),
            pk=request_id,
            customer_email__iexact=email.lower().strip(),
        )
        can_cancel, reason = _customer_request_cancel_state(customer_request)
        if not can_cancel:
            return Response({"detail": reason}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            customer_request.status = CustomerRequest.STATUS_CANCELLED
            customer_request.cancelled_at = timezone.now()
            customer_request.cancellation_reason = _safe_text(serializer.validated_data.get("reason"))
            customer_request.save(update_fields=["status", "cancelled_at", "cancellation_reason", "updated_at"])
            notified_contractors = _notify_contractors_request_cancelled(customer_request)

        return Response(
            {
                "detail": "Request cancelled.",
                "request_id": customer_request.id,
                "notified_contractors": notified_contractors,
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalRequestMatchingView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, request_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        customer_request = get_object_or_404(
            CustomerRequest.objects.select_related("property_profile", "source_intake", "converted_project"),
            pk=request_id,
            customer_email__iexact=email.lower().strip(),
        )
        source_intake = _sync_customer_request_source_intake(customer_request)
        if customer_request.status == CustomerRequest.STATUS_SUBMITTED:
            customer_request.status = CustomerRequest.STATUS_MARKETPLACE_READY
            customer_request.save(update_fields=["status", "updated_at"])
        return Response(
            {
                "detail": "Contractor matching is ready.",
                "request_id": customer_request.id,
                "source_intake_id": source_intake.id,
                "source_intake_token": source_intake.share_token,
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalRequestContractorSelectView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, request_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        customer_request = get_object_or_404(
            CustomerRequest.objects.select_related("property_profile", "source_intake", "converted_project"),
            pk=request_id,
            customer_email__iexact=email.lower().strip(),
        )
        selected = request.data.get("selected_contractors") or request.data.get("selected") or []
        if isinstance(selected, str):
            try:
                import json

                selected = json.loads(selected)
            except Exception:
                selected = []
        if not isinstance(selected, list) or not selected:
            return Response({"detail": "Select at least one contractor."}, status=status.HTTP_400_BAD_REQUEST)
        source_intake = _sync_customer_request_source_intake(customer_request)
        created = []
        payload = {
            "project_title": customer_request.title,
            "project_type": customer_request.project_type or customer_request.project_category,
            "project_subtype": customer_request.project_subtype,
            "description": customer_request.description,
            "refined_description": customer_request.description,
            "homeowner_email": customer_request.customer_email,
            "timeline": customer_request.preferred_timeline,
            "project_address_line1": customer_request.address_line1,
            "project_city": customer_request.city,
            "project_state": customer_request.state,
            "project_postal_code": customer_request.postal_code,
            "payment_preference": customer_request.payment_preference,
            "project_mode": customer_request.project_mode,
        }
        for selection in selected[:5]:
            if not isinstance(selection, dict):
                continue
            try:
                opportunity = create_or_update_opportunity_from_selection(
                    {
                        "intake_request": source_intake,
                        "selection": selection,
                        "payload": payload,
                    }
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            created.append({"opportunity_id": opportunity.id, "status": opportunity.status})
        source_intake.post_submit_flow = "multi_contractor" if len(created) > 1 else "single_contractor"
        source_intake.post_submit_flow_selected_at = source_intake.post_submit_flow_selected_at or timezone.now()
        source_intake.save(update_fields=["post_submit_flow", "post_submit_flow_selected_at", "updated_at"])
        customer_request.status = CustomerRequest.STATUS_ROUTED
        customer_request.save(update_fields=["status", "updated_at"])
        create_smart_notification(
            event_type=SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED,
            recipient_email=email,
            homeowner=customer_request.homeowner,
            customer_request=customer_request,
            property_profile=customer_request.property_profile,
            context={
                "request_title": customer_request.title,
                "contractor_count": len(created),
            },
        )
        return Response(
            {
                "detail": f"Request sent to {len(created)} contractor{'s' if len(created) != 1 else ''}.",
                "created": created,
                "opportunity_count": len(created),
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalRequestImproveView(APIView):
    permission_classes = [AllowAny]

    class InputSerializer(serializers.Serializer):
        request_type = serializers.CharField(max_length=64, required=False, allow_blank=True)
        project_mode = serializers.CharField(max_length=64, required=False, allow_blank=True)
        project_category = serializers.CharField(max_length=80, required=False, allow_blank=True)
        project_type = serializers.CharField(max_length=120, required=False, allow_blank=True)
        project_subtype = serializers.CharField(max_length=120, required=False, allow_blank=True)
        title = serializers.CharField(max_length=200, required=False, allow_blank=True)
        project_title = serializers.CharField(max_length=200, required=False, allow_blank=True)
        description = serializers.CharField(required=False, allow_blank=True)
        project_scope = serializers.CharField(required=False, allow_blank=True)
        urgency = serializers.CharField(max_length=32, required=False, allow_blank=True)
        preferred_timeline = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def post(self, request, token: str):
        try:
            _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        current_description = _safe_text(data.get("project_scope") or data.get("description"))
        if not current_description:
            return Response({"detail": "Add request details first."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            understanding = understand_project_request(
                description=current_description,
                project_title=_safe_text(data.get("project_title") or data.get("title")),
                project_type=_safe_text(data.get("project_type") or data.get("project_category") or data.get("request_type")),
                project_subtype=_safe_text(data.get("project_subtype")),
                urgency=_safe_text(data.get("urgency")),
            )
        except Exception:
            description = _customer_request_refine_fallback(current_description)
            understanding = {
                "project_title": _safe_text(data.get("project_title") or data.get("title")) or "Project request",
                "project_type": _safe_text(data.get("project_type") or data.get("project_category")),
                "project_subtype": _safe_text(data.get("project_subtype")),
                "description": description,
                "source": "fallback",
                "urgency": _safe_text(data.get("urgency")) or "normal",
                "clarifying_questions": [],
                "suggested_documents_or_photos": [],
            }

        description = _safe_text(understanding.get("description") or understanding.get("improved_description"))
        if not description:
            description = _customer_request_refine_fallback(current_description)
        title = _safe_text(understanding.get("project_title") or understanding.get("suggested_title") or data.get("project_title") or data.get("title"))
        if not title:
            title = _safe_text(data.get("project_type") or data.get("project_category") or data.get("request_type")) or "Project request"

        return Response(
            {
                "detail": "Request details improved.",
                "title": title,
                "project_title": title,
                "project_type": _safe_text(understanding.get("project_type") or data.get("project_type") or data.get("project_category")),
                "project_subtype": _safe_text(understanding.get("project_subtype") or data.get("project_subtype")),
                "urgency": _safe_text(understanding.get("urgency") or data.get("urgency")),
                "description": description,
                "project_scope": description,
                "clarification_questions": understanding.get("clarifying_questions") or [],
                "suggested_documents_or_photos": understanding.get("suggested_documents_or_photos") or [],
                "confidence": understanding.get("confidence", ""),
                "confidence_label": understanding.get("confidence_label", ""),
                "warnings": understanding.get("warnings") or [],
                "source": understanding.get("source", "fallback"),
            },
            status=status.HTTP_200_OK,
        )


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
    bedrooms = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=50)
    bathrooms = serializers.DecimalField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=50,
        max_digits=4,
        decimal_places=1,
    )
    notes = serializers.CharField(required=False, allow_blank=True)
    is_primary = serializers.BooleanField(required=False)


class CustomerPortalPropertyUnitSerializer(serializers.Serializer):
    unit_label = serializers.CharField(max_length=120, required=False, allow_blank=True)
    unit_type = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyUnit.UNIT_TYPE_CHOICES],
        required=False,
    )
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyUnit.STATUS_CHOICES],
        required=False,
    )
    access_notes = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalTenantSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    unit_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in Tenancy.STATUS_CHOICES],
        required=False,
    )
    move_in_date = serializers.DateField(required=False, allow_null=True)
    move_out_date = serializers.DateField(required=False, allow_null=True)
    emergency_contact_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    maintenance_access_enabled = serializers.BooleanField(required=False)
    portal_enabled = serializers.BooleanField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class TenantMaintenanceRequestPublicSerializer(serializers.Serializer):
    submitted_by_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    submitted_by_email = serializers.EmailField(required=False, allow_blank=True)
    submitted_by_phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    unit_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    category = serializers.ChoiceField(choices=[choice[0] for choice in TenantMaintenanceRequest.CATEGORY_CHOICES])
    urgency = serializers.ChoiceField(choices=[choice[0] for choice in TenantMaintenanceRequest.URGENCY_CHOICES], required=False)
    title = serializers.CharField(max_length=200)
    description = serializers.CharField()
    permission_to_enter = serializers.BooleanField(required=False)
    pets_present = serializers.BooleanField(required=False)
    preferred_access_times = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, attrs):
        if not _safe_text(attrs.get("submitted_by_name")) and not _safe_text(attrs.get("submitted_by_email")) and not _safe_text(attrs.get("submitted_by_phone")):
            raise serializers.ValidationError({"submitted_by_name": "Add your name, email, or phone so the manager can follow up."})
        attrs["title"] = _safe_text(attrs.get("title"))
        attrs["description"] = _safe_text(attrs.get("description"))
        if not attrs["title"]:
            raise serializers.ValidationError({"title": "Title is required."})
        if not attrs["description"]:
            raise serializers.ValidationError({"description": "Description is required."})
        return attrs


class TenantMaintenanceRequestVerifySerializer(serializers.Serializer):
    property_query = serializers.CharField(max_length=255, required=False, allow_blank=True)
    unit_label = serializers.CharField(max_length=120, required=False, allow_blank=True)
    tenant_last_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    contact = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, attrs):
        aliases = {
            "property_query": self.initial_data.get("property_query") or self.initial_data.get("property_name_or_address") or self.initial_data.get("property"),
            "tenant_last_name": self.initial_data.get("tenant_last_name") or self.initial_data.get("last_name"),
        }
        for field, value in aliases.items():
            if value and not attrs.get(field):
                attrs[field] = value
        for field in ("property_query", "unit_label", "tenant_last_name", "contact"):
            attrs[field] = _safe_text(attrs.get(field))
            if not attrs[field]:
                raise serializers.ValidationError({field: "This field is required."})
        return attrs


class TenantMaintenanceRequestVerifiedSubmitSerializer(TenantMaintenanceRequestPublicSerializer):
    verification_token = serializers.CharField(max_length=1000)


class TenantMaintenanceRequestReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            TenantMaintenanceRequest.STATUS_UNDER_REVIEW,
            TenantMaintenanceRequest.STATUS_MORE_INFO_REQUESTED,
            TenantMaintenanceRequest.STATUS_APPROVED,
            TenantMaintenanceRequest.STATUS_REJECTED,
            TenantMaintenanceRequest.STATUS_CLOSED,
        ],
        required=False,
    )
    manager_notes = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalPropertyWorkOrderSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    category = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyWorkOrder.CATEGORY_CHOICES],
        required=False,
    )
    priority = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyWorkOrder.PRIORITY_CHOICES],
        required=False,
    )
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyWorkOrder.STATUS_CHOICES],
        required=False,
    )
    unit_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    tenant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    assignment_type = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyWorkOrder.ASSIGNMENT_TYPE_CHOICES],
        required=False,
    )
    assigned_staff_member_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    assigned_vendor_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    assigned_contractor_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    scheduled_for = serializers.CharField(required=False, allow_blank=True)
    started_at = serializers.CharField(required=False, allow_blank=True)
    completed_at = serializers.CharField(required=False, allow_blank=True)
    closed_at = serializers.CharField(required=False, allow_blank=True)
    internal_notes = serializers.CharField(required=False, allow_blank=True)
    completion_notes = serializers.CharField(required=False, allow_blank=True)
    attachment_type = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyWorkOrderAttachment.TYPE_CHOICES],
        required=False,
    )

    def validate(self, attrs):
        for field in ("title", "description", "internal_notes", "completion_notes"):
            if field in attrs:
                attrs[field] = _safe_text(attrs.get(field))
        for field in ("scheduled_for", "started_at", "completed_at", "closed_at"):
            if field not in attrs:
                continue
            value = _safe_text(attrs.get(field))
            if not value:
                attrs[field] = None
                continue
            parsed = parse_datetime(value)
            if parsed is None:
                raise serializers.ValidationError({field: "Enter a valid date/time."})
            attrs[field] = parsed
        return attrs


class CustomerPortalHomeSystemSerializer(serializers.Serializer):
    property_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    system_type = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyHomeSystem.SYSTEM_TYPE_CHOICES],
        required=True,
    )
    custom_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    manufacturer = serializers.CharField(max_length=200, required=False, allow_blank=True)
    model_number = serializers.CharField(max_length=200, required=False, allow_blank=True)
    serial_number = serializers.CharField(max_length=200, required=False, allow_blank=True)
    install_date = serializers.DateField(required=False, allow_null=True)
    last_service_date = serializers.DateField(required=False, allow_null=True)
    warranty_start_date = serializers.DateField(required=False, allow_null=True)
    warranty_expiration_date = serializers.DateField(required=False, allow_null=True)
    expected_lifespan_years = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=150)
    condition = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyHomeSystem.CONDITION_CHOICES],
        required=False,
    )
    notes = serializers.CharField(required=False, allow_blank=True)
    service_provider = serializers.CharField(max_length=200, required=False, allow_blank=True)
    reminders_enabled = serializers.BooleanField(required=False)
    email_reminders_enabled = serializers.BooleanField(required=False)
    sms_reminders_enabled = serializers.BooleanField(required=False)
    reminder_lead_days = serializers.IntegerField(required=False, min_value=0, max_value=365)
    reminder_frequency = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyHomeSystem.REMINDER_FREQUENCY_CHOICES],
        required=False,
    )
    dismissed_until = serializers.DateTimeField(required=False, allow_null=True)
    linked_agreement_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    linked_customer_request_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    linked_document_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )


class CustomerPortalHomeSystemServiceSerializer(serializers.Serializer):
    last_service_date = serializers.DateField(required=False, allow_null=True)
    service_provider = serializers.CharField(max_length=200, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalProfileSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    account_type = serializers.ChoiceField(
        choices=[choice[0] for choice in Homeowner.ACCOUNT_TYPE_CHOICES],
        required=False,
    )
    address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    state = serializers.CharField(max_length=50, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    company_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    company_phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    company_email = serializers.EmailField(required=False, allow_blank=True)
    company_website = serializers.CharField(max_length=255, required=False, allow_blank=True)
    company_street = serializers.CharField(max_length=255, required=False, allow_blank=True)
    company_unit = serializers.CharField(max_length=255, required=False, allow_blank=True)
    company_city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    company_state = serializers.CharField(max_length=50, required=False, allow_blank=True)
    company_zip = serializers.CharField(max_length=20, required=False, allow_blank=True)
    company_license_number = serializers.CharField(max_length=120, required=False, allow_blank=True)
    company_notes = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalTeamMemberSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    email = serializers.EmailField(required=False)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    role = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyManagementStaffMembership.ROLE_CHOICES],
        required=False,
    )
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyManagementStaffMembership.STATUS_CHOICES],
        required=False,
    )


class CustomerPortalVendorSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    trade_category = serializers.CharField(max_length=120, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    website = serializers.CharField(max_length=255, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in PropertyVendor.STATUS_CHOICES],
        required=False,
    )


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
            "account_type": "account_type",
            "address_line1": "street_address",
            "address_line2": "address_line_2",
            "city": "city",
            "state": "state",
            "postal_code": "zip_code",
            "company_name": "company_name",
            "company_phone": "company_phone",
            "company_email": "company_email",
            "company_website": "company_website",
            "company_street": "company_street",
            "company_unit": "company_unit",
            "company_city": "company_city",
            "company_state": "company_state",
            "company_zip": "company_zip",
            "company_license_number": "company_license_number",
            "company_notes": "company_notes",
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


class CustomerPortalTeamMemberView(APIView):
    permission_classes = [AllowAny]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _company_from_token(self, token: str):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, None, error
        return email, company, None

    def get(self, request, token: str):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error
        return Response({"team_members": _property_management_team_payload(company)}, status=status.HTTP_200_OK)

    def post(self, request, token: str):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error

        serializer = CustomerPortalTeamMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member_email = _safe_text(data.get("email")).lower()
        if not member_email:
            return Response({"email": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        duplicate_exists = PropertyManagementStaffMembership.objects.filter(
            company=company,
            email__iexact=member_email,
        ).exclude(status=PropertyManagementStaffMembership.STATUS_DISABLED).exists()
        if duplicate_exists:
            return Response(
                {"email": ["A non-disabled team member with this email already exists for this company."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        PropertyManagementStaffMembership.objects.create(
            company=company,
            name=_safe_text(data.get("name")),
            email=member_email,
            phone=_safe_text(data.get("phone")),
            role=data.get("role") or PropertyManagementStaffMembership.ROLE_VIEWER,
            status=PropertyManagementStaffMembership.STATUS_INVITED,
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str, member_id: int):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error

        member = get_object_or_404(PropertyManagementStaffMembership, pk=member_id, company=company)
        serializer = CustomerPortalTeamMemberSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        update_fields = []
        for field in ("name", "phone", "role", "status"):
            if field not in data:
                continue
            value = _safe_text(data[field]) if field in {"name", "phone"} else data[field]
            if getattr(member, field) != value:
                setattr(member, field, value)
                update_fields.append(field)
        if update_fields:
            member.save(update_fields=[*update_fields, "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, member_id: int):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error

        member = get_object_or_404(PropertyManagementStaffMembership, pk=member_id, company=company)
        if member.status != PropertyManagementStaffMembership.STATUS_DISABLED:
            member.status = PropertyManagementStaffMembership.STATUS_DISABLED
            member.save(update_fields=["status", "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalVendorView(APIView):
    permission_classes = [AllowAny]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _company_from_token(self, token: str):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, None, error
        return email, company, None

    def get(self, request, token: str):
        _email, company, error = self._company_from_token(token)
        if error is not None:
            return error
        return Response({"vendors": _property_vendor_rows(company)}, status=status.HTTP_200_OK)

    def post(self, request, token: str):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error
        serializer = CustomerPortalVendorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        name = _safe_text(data.get("name"))
        if not name:
            return Response({"name": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        PropertyVendor.objects.create(
            property_management_company=company,
            name=name,
            trade_category=_safe_text(data.get("trade_category")),
            email=_safe_text(data.get("email")).lower(),
            phone=_safe_text(data.get("phone")),
            website=_safe_text(data.get("website")),
            notes=_safe_text(data.get("notes")),
            status=data.get("status") or PropertyVendor.STATUS_ACTIVE,
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str, vendor_id: int):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error
        vendor = get_object_or_404(PropertyVendor, pk=vendor_id, property_management_company=company)
        serializer = CustomerPortalVendorSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        update_fields = []
        for field in ("name", "trade_category", "email", "phone", "website", "notes", "status"):
            if field not in data:
                continue
            value = _safe_text(data[field]).lower() if field == "email" else (_safe_text(data[field]) if field != "status" else data[field])
            if getattr(vendor, field) != value:
                setattr(vendor, field, value)
                update_fields.append(field)
        if update_fields:
            vendor.save(update_fields=[*update_fields, "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, vendor_id: int):
        email, company, error = self._company_from_token(token)
        if error is not None:
            return error
        vendor = get_object_or_404(PropertyVendor, pk=vendor_id, property_management_company=company)
        if vendor.status != PropertyVendor.STATUS_INACTIVE:
            vendor.status = PropertyVendor.STATUS_INACTIVE
            vendor.save(update_fields=["status", "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalPropertyUnitView(APIView):
    permission_classes = [AllowAny]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _property_from_token(self, token: str, property_id: int):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, None, error
        property_profile = get_object_or_404(
            PropertyProfile.objects.filter(
                id=property_id,
                customer_email__iexact=email.lower().strip(),
            ).filter(
                Q(managed_by_company=company) | Q(managed_by_company__isnull=True)
            )
        )
        if property_profile.managed_by_company_id is None:
            property_profile.managed_by_company = company
            property_profile.save(update_fields=["managed_by_company", "updated_at"])
        return email, property_profile, None

    def _duplicate_response(self):
        return Response(
            {"unit_label": ["A non-inactive unit with this label already exists for this property."]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _duplicate_label_exists(self, property_profile: PropertyProfile, unit_label: str, unit_id: int | None = None) -> bool:
        queryset = PropertyUnit.objects.filter(
            property_profile=property_profile,
            unit_label__iexact=unit_label,
        ).exclude(status=PropertyUnit.STATUS_INACTIVE)
        if unit_id:
            queryset = queryset.exclude(id=unit_id)
        return queryset.exists()

    def get(self, request, token: str, property_id: int):
        email, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        return Response({"units": [_property_unit_payload(unit) for unit in units_for_property(property_profile)]}, status=status.HTTP_200_OK)

    def post(self, request, token: str, property_id: int):
        email, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        serializer = CustomerPortalPropertyUnitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        unit_label = _safe_text(data.get("unit_label"))
        if not unit_label:
            return Response({"unit_label": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if self._duplicate_label_exists(property_profile, unit_label):
            return self._duplicate_response()
        try:
            PropertyUnit.objects.create(
                property_profile=property_profile,
                unit_label=unit_label,
                unit_type=data.get("unit_type") or PropertyUnit.UNIT_WHOLE_PROPERTY,
                status=data.get("status") or PropertyUnit.STATUS_ACTIVE,
                access_notes=_safe_text(data.get("access_notes")),
                notes=_safe_text(data.get("notes")),
            )
        except IntegrityError:
            return self._duplicate_response()
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str, property_id: int, unit_id: int):
        email, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        unit = get_object_or_404(PropertyUnit.objects.filter(property_profile=property_profile), pk=unit_id)
        serializer = CustomerPortalPropertyUnitSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        unit_label = _safe_text(data.get("unit_label", unit.unit_label))
        if not unit_label:
            return Response({"unit_label": ["This field may not be blank."]}, status=status.HTTP_400_BAD_REQUEST)
        if unit_label.lower() != _safe_text(unit.unit_label).lower() and self._duplicate_label_exists(property_profile, unit_label, unit.id):
            return self._duplicate_response()
        update_fields = []
        field_values = {
            "unit_label": unit_label,
            "unit_type": data.get("unit_type", unit.unit_type),
            "status": data.get("status", unit.status),
            "access_notes": _safe_text(data.get("access_notes", unit.access_notes)),
            "notes": _safe_text(data.get("notes", unit.notes)),
        }
        for field, value in field_values.items():
            if getattr(unit, field) != value:
                setattr(unit, field, value)
                update_fields.append(field)
        if update_fields:
            try:
                unit.save(update_fields=[*update_fields, "updated_at"])
            except IntegrityError:
                return self._duplicate_response()
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, property_id: int, unit_id: int):
        email, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        unit = get_object_or_404(PropertyUnit.objects.filter(property_profile=property_profile), pk=unit_id)
        if unit.status != PropertyUnit.STATUS_INACTIVE:
            unit.status = PropertyUnit.STATUS_INACTIVE
            unit.save(update_fields=["status", "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalTenantView(APIView):
    permission_classes = [AllowAny]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _property_from_token(self, token: str, property_id: int):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, company, None, error
        property_profile = get_object_or_404(
            PropertyProfile.objects.filter(
                id=property_id,
                customer_email__iexact=email.lower().strip(),
            ).filter(
                Q(managed_by_company=company) | Q(managed_by_company__isnull=True)
            )
        )
        if property_profile.managed_by_company_id is None:
            property_profile.managed_by_company = company
            property_profile.save(update_fields=["managed_by_company", "updated_at"])
        return email, company, property_profile, None

    def _unit_for_property_or_none(self, property_profile: PropertyProfile, unit_id):
        if not unit_id:
            return None
        return get_object_or_404(PropertyUnit.objects.filter(property_profile=property_profile), pk=unit_id)

    def _duplicate_active_occupancy_exists(self, *, company, property_profile, unit, tenant_email: str, tenancy_id=None) -> bool:
        if not tenant_email:
            return False
        queryset = Tenancy.objects.select_related("tenant").filter(
            tenant__company=company,
            tenant__email__iexact=tenant_email,
            property_profile=property_profile,
            status__in=[Tenancy.STATUS_PENDING, Tenancy.STATUS_ACTIVE],
        )
        if unit is None:
            queryset = queryset.filter(unit__isnull=True)
        else:
            queryset = queryset.filter(unit=unit)
        if tenancy_id:
            queryset = queryset.exclude(id=tenancy_id)
        return queryset.exists()

    def _duplicate_response(self):
        return Response(
            {"email": ["This tenant already has a pending or active occupancy for that property/unit."]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def get(self, request, token: str, property_id: int):
        _email, _company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        rows = _tenant_payloads_for_property(property_profile)
        unit_id = request.query_params.get("unit_id")
        status_filter = _safe_text(request.query_params.get("status"))
        if unit_id:
            rows = [row for row in rows if str(row.get("unit_id") or "") == str(unit_id)]
        if status_filter:
            rows = [row for row in rows if row.get("status") == status_filter]
        return Response({"tenants": rows}, status=status.HTTP_200_OK)

    def post(self, request, token: str, property_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        serializer = CustomerPortalTenantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        first_name = _safe_text(data.get("first_name"))
        last_name = _safe_text(data.get("last_name"))
        tenant_email = _safe_text(data.get("email")).lower()
        phone = _safe_text(data.get("phone"))
        if not any([first_name, last_name, tenant_email, phone]):
            return Response({"detail": "Enter a tenant name, email, or phone number."}, status=status.HTTP_400_BAD_REQUEST)
        unit = self._unit_for_property_or_none(property_profile, data.get("unit_id"))
        tenancy_status = data.get("status") or Tenancy.STATUS_PENDING
        if tenancy_status in {Tenancy.STATUS_PENDING, Tenancy.STATUS_ACTIVE} and self._duplicate_active_occupancy_exists(
            company=company,
            property_profile=property_profile,
            unit=unit,
            tenant_email=tenant_email,
        ):
            return self._duplicate_response()

        tenant = Tenant.objects.create(
            company=company,
            first_name=first_name,
            last_name=last_name,
            email=tenant_email,
            phone=phone,
            status=tenancy_status,
            emergency_contact_name=_safe_text(data.get("emergency_contact_name")),
            emergency_contact_phone=_safe_text(data.get("emergency_contact_phone")),
            notes=_safe_text(data.get("notes")),
            maintenance_access_enabled=bool(data.get("maintenance_access_enabled", False)),
            portal_enabled=bool(data.get("portal_enabled", False)),
        )
        Tenancy.objects.create(
            tenant=tenant,
            property_profile=property_profile,
            unit=unit,
            status=tenancy_status,
            move_in_date=data.get("move_in_date"),
            move_out_date=data.get("move_out_date"),
            notes=_safe_text(data.get("notes")),
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str, property_id: int, tenancy_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        tenancy = get_object_or_404(
            Tenancy.objects.select_related("tenant", "unit").filter(property_profile=property_profile),
            pk=tenancy_id,
        )
        serializer = CustomerPortalTenantSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        tenant = tenancy.tenant
        next_email = _safe_text(data.get("email", tenant.email)).lower()
        next_unit = self._unit_for_property_or_none(property_profile, data.get("unit_id", tenancy.unit_id))
        next_status = data.get("status", tenancy.status)
        if next_status in {Tenancy.STATUS_PENDING, Tenancy.STATUS_ACTIVE} and self._duplicate_active_occupancy_exists(
            company=company,
            property_profile=property_profile,
            unit=next_unit,
            tenant_email=next_email,
            tenancy_id=tenancy.id,
        ):
            return self._duplicate_response()

        tenant_fields = {
            "first_name": _safe_text(data.get("first_name", tenant.first_name)),
            "last_name": _safe_text(data.get("last_name", tenant.last_name)),
            "email": next_email,
            "phone": _safe_text(data.get("phone", tenant.phone)),
            "status": next_status,
            "emergency_contact_name": _safe_text(data.get("emergency_contact_name", tenant.emergency_contact_name)),
            "emergency_contact_phone": _safe_text(data.get("emergency_contact_phone", tenant.emergency_contact_phone)),
            "notes": _safe_text(data.get("notes", tenant.notes)),
            "maintenance_access_enabled": bool(data.get("maintenance_access_enabled", tenant.maintenance_access_enabled)),
            "portal_enabled": bool(data.get("portal_enabled", tenant.portal_enabled)),
        }
        tenant_update_fields = []
        for field, value in tenant_fields.items():
            if getattr(tenant, field) != value:
                setattr(tenant, field, value)
                tenant_update_fields.append(field)
        if tenant_update_fields:
            tenant.save(update_fields=[*tenant_update_fields, "updated_at"])

        tenancy_fields = {
            "unit": next_unit,
            "status": next_status,
            "move_in_date": data.get("move_in_date", tenancy.move_in_date),
            "move_out_date": data.get("move_out_date", tenancy.move_out_date),
            "notes": _safe_text(data.get("notes", tenancy.notes)),
        }
        tenancy_update_fields = []
        for field, value in tenancy_fields.items():
            if getattr(tenancy, field) != value:
                setattr(tenancy, field, value)
                tenancy_update_fields.append(field)
        if tenancy_update_fields:
            tenancy.save(update_fields=[*tenancy_update_fields, "updated_at"])

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, property_id: int, tenancy_id: int):
        email, _company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error

        tenancy = get_object_or_404(
            Tenancy.objects.select_related("tenant").filter(property_profile=property_profile),
            pk=tenancy_id,
        )
        changed = False
        if tenancy.status != Tenancy.STATUS_FORMER:
            tenancy.status = Tenancy.STATUS_FORMER
            tenancy.save(update_fields=["status", "updated_at"])
            changed = True
        tenant = tenancy.tenant
        if tenant.status != Tenant.STATUS_FORMER:
            tenant.status = Tenant.STATUS_FORMER
            tenant.save(update_fields=["status", "updated_at"])
            changed = True
        if not changed:
            tenant.save(update_fields=["updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class TenantMaintenanceRequestPublicView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, token: str):
        property_profile, token_unit, error = _resolve_tenant_maintenance_token(token)
        if error is not None:
            return error
        return Response(_tenant_maintenance_context_payload(property_profile, token_unit, include_units=token_unit is None), status=status.HTTP_200_OK)

    def post(self, request, token: str):
        property_profile, token_unit, error = _resolve_tenant_maintenance_token(token)
        if error is not None:
            return error
        serializer = TenantMaintenanceRequestPublicSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        files = _tenant_maintenance_uploaded_files(request)
        try:
            _validate_tenant_maintenance_attachments(files)
        except serializers.ValidationError as exc:
            return Response({"detail": exc.detail[0] if isinstance(exc.detail, list) else exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        unit = token_unit
        if unit is None and data.get("unit_id"):
            unit = get_object_or_404(
                PropertyUnit.objects.filter(property_profile=property_profile).exclude(status=PropertyUnit.STATUS_INACTIVE),
                pk=data.get("unit_id"),
            )
        elif token_unit is not None and data.get("unit_id") and int(data.get("unit_id")) != token_unit.id:
            return Response({"detail": "This request link is for a specific unit."}, status=status.HTTP_400_BAD_REQUEST)

        tenant = _tenant_for_maintenance_submission(property_profile, unit, data.get("submitted_by_email", ""))
        row = _tenant_maintenance_save_request(property_profile=property_profile, unit=unit, tenant=tenant, data=data, files=files)
        return Response(
            {
                "ok": True,
                "detail": "Maintenance request submitted.",
                "request": _tenant_maintenance_request_payload(row),
            },
            status=status.HTTP_201_CREATED,
        )


class TenantMaintenanceRequestVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if _tenant_maintenance_verification_rate_limited(request):
            return Response({"detail": "Please wait a few minutes before trying again."}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        serializer = TenantMaintenanceRequestVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenancy = _verify_tenant_maintenance_identity(**serializer.validated_data)
        if tenancy is None:
            return _generic_tenant_maintenance_verification_failure()
        verification_token = signing.dumps({"tenancy_id": tenancy.id}, salt=TENANT_MAINTENANCE_VERIFICATION_SALT)
        payload = _tenant_maintenance_context_payload(tenancy.property_profile, tenancy.unit)
        payload["ok"] = True
        payload["verification_token"] = verification_token
        return Response(payload, status=status.HTTP_200_OK)


class TenantMaintenanceRequestVerifiedSubmitView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request):
        serializer = TenantMaintenanceRequestVerifiedSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        tenancy, error = _resolve_verified_tenant_maintenance_token(data.get("verification_token"))
        if error is not None:
            return error
        files = _tenant_maintenance_uploaded_files(request)
        try:
            _validate_tenant_maintenance_attachments(files)
        except serializers.ValidationError as exc:
            return Response({"detail": exc.detail[0] if isinstance(exc.detail, list) else exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        row = _tenant_maintenance_save_request(
            property_profile=tenancy.property_profile,
            unit=tenancy.unit,
            tenant=tenancy.tenant,
            data=data,
            files=files,
        )
        return Response(
            {
                "ok": True,
                "detail": "Maintenance request submitted.",
                "request": _tenant_maintenance_request_payload(row),
            },
            status=status.HTTP_201_CREATED,
        )


class CustomerPortalPropertyWorkOrderView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _property_from_token(self, token: str, property_id: int):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, None, None, error
        property_profile = get_object_or_404(
            PropertyProfile.objects.filter(
                id=property_id,
                customer_email__iexact=email.lower().strip(),
                managed_by_company=company,
            )
        )
        return email, company, property_profile, None

    def _unit_for_property_or_none(self, property_profile: PropertyProfile, unit_id):
        if not unit_id:
            return None
        return get_object_or_404(PropertyUnit.objects.filter(property_profile=property_profile), pk=unit_id)

    def _tenant_for_property_or_none(self, company: PropertyManagementCompany, property_profile: PropertyProfile, tenant_id):
        if not tenant_id:
            return None
        tenant = get_object_or_404(Tenant.objects.filter(company=company), pk=tenant_id)
        if not Tenancy.objects.filter(tenant=tenant, property_profile=property_profile).exists():
            raise Http404
        return tenant

    def _staff_for_company_or_none(self, company: PropertyManagementCompany, staff_id):
        if not staff_id:
            return None
        return get_object_or_404(
            PropertyManagementStaffMembership.objects.filter(company=company).exclude(status=PropertyManagementStaffMembership.STATUS_DISABLED),
            pk=staff_id,
        )

    def _vendor_for_company_or_none(self, company: PropertyManagementCompany, vendor_id):
        if not vendor_id:
            return None
        return get_object_or_404(
            PropertyVendor.objects.filter(property_management_company=company, status=PropertyVendor.STATUS_ACTIVE),
            pk=vendor_id,
        )

    def _contractor_or_none(self, contractor_id):
        if not contractor_id:
            return None
        return get_object_or_404(Contractor.objects.filter(pk=contractor_id), pk=contractor_id)

    def _assignment_values(self, company: PropertyManagementCompany, data: dict, current: PropertyWorkOrder | None = None) -> dict:
        assignment_type = data.get("assignment_type")
        if not assignment_type:
            if "assigned_vendor_id" in data and data.get("assigned_vendor_id"):
                assignment_type = PropertyWorkOrder.ASSIGNMENT_VENDOR
            elif "assigned_contractor_id" in data and data.get("assigned_contractor_id"):
                assignment_type = PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR
            elif "assigned_staff_member_id" in data:
                assignment_type = PropertyWorkOrder.ASSIGNMENT_INTERNAL_STAFF
            else:
                assignment_type = getattr(current, "assignment_type", PropertyWorkOrder.ASSIGNMENT_INTERNAL_STAFF)

        if assignment_type == PropertyWorkOrder.ASSIGNMENT_VENDOR:
            return {
                "assignment_type": assignment_type,
                "assigned_staff_member": None,
                "assigned_vendor": self._vendor_for_company_or_none(company, data.get("assigned_vendor_id") if "assigned_vendor_id" in data else getattr(current, "assigned_vendor_id", None)),
                "assigned_contractor": None,
            }
        if assignment_type == PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR:
            return {
                "assignment_type": assignment_type,
                "assigned_staff_member": None,
                "assigned_vendor": None,
                "assigned_contractor": self._contractor_or_none(data.get("assigned_contractor_id") if "assigned_contractor_id" in data else getattr(current, "assigned_contractor_id", None)),
            }
        return {
            "assignment_type": PropertyWorkOrder.ASSIGNMENT_INTERNAL_STAFF,
            "assigned_staff_member": self._staff_for_company_or_none(company, data.get("assigned_staff_member_id") if "assigned_staff_member_id" in data else getattr(current, "assigned_staff_member_id", None)),
            "assigned_vendor": None,
            "assigned_contractor": None,
        }

    def _assignment_activity_message(self, row: PropertyWorkOrder) -> str:
        if row.assignment_type == PropertyWorkOrder.ASSIGNMENT_VENDOR:
            label = _safe_text(getattr(row.assigned_vendor, "name", "")) if row.assigned_vendor else "Unassigned vendor"
            return f"Assigned to vendor {label}."
        if row.assignment_type == PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR:
            label = _safe_text(getattr(row.assigned_contractor, "business_name", "")) or _safe_text(getattr(row.assigned_contractor, "company_name", "")) if row.assigned_contractor else "Marketplace contractor"
            return f"Assigned to {label}."
        label = row.assigned_staff_member.name or row.assigned_staff_member.email if row.assigned_staff_member else "Unassigned staff"
        return f"Assigned to {label}."

    def _duplicate_active_source_response(self):
        return Response(
            {"detail": "An active work order already exists for this maintenance request."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _active_source_work_order_exists(self, source_request: TenantMaintenanceRequest, work_order_id=None) -> bool:
        queryset = PropertyWorkOrder.objects.filter(
            source_tenant_request=source_request,
            status__in=PropertyWorkOrder.ACTIVE_STATUSES,
        )
        if work_order_id:
            queryset = queryset.exclude(id=work_order_id)
        return queryset.exists()

    def _status_transition_error(self, current_status: str, next_status: str):
        allowed = PROPERTY_WORK_ORDER_ALLOWED_TRANSITIONS.get(current_status, {current_status})
        if next_status not in allowed:
            return Response(
                {"detail": f"Cannot change work order from {current_status} to {next_status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    def _save_completion_attachments(self, row: PropertyWorkOrder, files, data: dict, actor: str):
        attachment_type = data.get("attachment_type") or PropertyWorkOrderAttachment.TYPE_COMPLETION_PHOTO
        created = []
        for uploaded_file in files:
            attachment = PropertyWorkOrderAttachment.objects.create(
                work_order=row,
                file=uploaded_file,
                original_filename=_safe_text(getattr(uploaded_file, "name", "")),
                content_type=_safe_text(getattr(uploaded_file, "content_type", "")),
                size_bytes=int(getattr(uploaded_file, "size", 0) or 0),
                uploaded_by=actor,
                attachment_type=attachment_type,
            )
            created.append(attachment)
        if created:
            _property_work_order_add_activity(
                row,
                PropertyWorkOrderActivity.TYPE_ATTACHMENT_ADDED,
                f"Added {len(created)} completion attachment{'s' if len(created) != 1 else ''}.",
                actor,
            )
        return None

    def get(self, request, token: str, property_id: int):
        _email, _company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        rows = _property_work_orders_for_property(property_profile)
        status_filter = _safe_text(request.query_params.get("status"))
        if status_filter:
            rows = [row for row in rows if row.get("status") == status_filter]
        return Response({"work_orders": rows}, status=status.HTTP_200_OK)

    def post(self, request, token: str, property_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        serializer = CustomerPortalPropertyWorkOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        title = _safe_text(data.get("title"))
        description = _safe_text(data.get("description"))
        if not title:
            return Response({"title": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if not description:
            return Response({"description": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        unit = self._unit_for_property_or_none(property_profile, data.get("unit_id"))
        tenant = self._tenant_for_property_or_none(company, property_profile, data.get("tenant_id"))
        assignment_values = self._assignment_values(company, data)
        row = PropertyWorkOrder.objects.create(
            property_management_company=company,
            property_profile=property_profile,
            unit=unit,
            tenant=tenant,
            title=title,
            description=description,
            category=data.get("category") or PropertyWorkOrder.CATEGORY_GENERAL_REPAIR,
            priority=data.get("priority") or PropertyWorkOrder.PRIORITY_NORMAL,
            status=data.get("status") or PropertyWorkOrder.STATUS_OPEN,
            assignment_type=assignment_values["assignment_type"],
            assigned_staff_member=assignment_values["assigned_staff_member"],
            assigned_vendor=assignment_values["assigned_vendor"],
            assigned_contractor=assignment_values["assigned_contractor"],
            scheduled_for=data.get("scheduled_for"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            closed_at=data.get("closed_at"),
            internal_notes=_safe_text(data.get("internal_notes")),
            completion_notes=_safe_text(data.get("completion_notes")),
            created_by=email.lower().strip(),
        )
        _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_CREATED, "Work order created.", email)
        if row.assigned_staff_member_id or row.assigned_vendor_id or row.assignment_type == PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR:
            _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_ASSIGNED, self._assignment_activity_message(row), email)
        if row.scheduled_for:
            _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_SCHEDULED, "Work order scheduled.", email)
        return Response(
            {"work_order": _property_work_order_payload(row), "portal": _build_customer_portal_payload(email, request=request)},
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request, token: str, property_id: int, work_order_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        row = get_object_or_404(
            PropertyWorkOrder.objects.select_related("property_profile", "unit", "tenant", "assigned_staff_member", "assigned_vendor", "assigned_contractor", "source_tenant_request")
            .prefetch_related("source_tenant_request__attachments", "attachments", "activities")
            .filter(property_profile=property_profile, property_management_company=company),
            pk=work_order_id,
        )
        serializer = CustomerPortalPropertyWorkOrderSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        next_status = data.get("status", row.status)
        transition_error = self._status_transition_error(row.status, next_status)
        if transition_error is not None:
            return transition_error
        if next_status == PropertyWorkOrder.STATUS_COMPLETED and not _safe_text(data.get("completion_notes", row.completion_notes)):
            return Response({"completion_notes": ["Completion notes are required to complete a work order."]}, status=status.HTTP_400_BAD_REQUEST)
        files = _property_work_order_uploaded_files(request)
        try:
            _validate_property_work_order_attachments(files)
        except serializers.ValidationError as exc:
            return Response({"detail": exc.detail[0] if isinstance(exc.detail, list) else exc.detail}, status=status.HTTP_400_BAD_REQUEST)

        field_values = {}
        for field in ("title", "description", "category", "priority", "status", "scheduled_for", "started_at", "completed_at", "closed_at", "internal_notes", "completion_notes"):
            if field in data:
                field_values[field] = data[field]
        if "unit_id" in data:
            field_values["unit"] = self._unit_for_property_or_none(property_profile, data.get("unit_id"))
        if "tenant_id" in data:
            field_values["tenant"] = self._tenant_for_property_or_none(company, property_profile, data.get("tenant_id"))
        assignment_keys = {"assignment_type", "assigned_staff_member_id", "assigned_vendor_id", "assigned_contractor_id"}
        if assignment_keys.intersection(data.keys()):
            field_values.update(self._assignment_values(company, data, current=row))

        update_fields = []
        activity_messages = []
        previous_status = row.status
        previous_assignment = (row.assignment_type, row.assigned_staff_member_id, row.assigned_vendor_id, row.assigned_contractor_id)
        previous_staff_id = row.assigned_staff_member_id
        previous_scheduled_for = row.scheduled_for
        for field, value in field_values.items():
            if getattr(row, field) != value:
                setattr(row, field, value)
                update_fields.append(field)
        now = timezone.now()
        if "status" in field_values and previous_status != row.status:
            if row.status == PropertyWorkOrder.STATUS_IN_PROGRESS and row.started_at is None:
                row.started_at = now
                update_fields.append("started_at")
            if row.status == PropertyWorkOrder.STATUS_COMPLETED and row.completed_at is None:
                row.completed_at = now
                update_fields.append("completed_at")
            if row.status == PropertyWorkOrder.STATUS_CLOSED and row.closed_at is None:
                row.closed_at = now
                update_fields.append("closed_at")
            activity_type = PropertyWorkOrderActivity.TYPE_STATUS_CHANGED
            if row.status == PropertyWorkOrder.STATUS_IN_PROGRESS:
                activity_type = PropertyWorkOrderActivity.TYPE_STARTED
            elif row.status == PropertyWorkOrder.STATUS_COMPLETED:
                activity_type = PropertyWorkOrderActivity.TYPE_COMPLETED
            elif row.status == PropertyWorkOrder.STATUS_CLOSED:
                activity_type = PropertyWorkOrderActivity.TYPE_CLOSED
            activity_messages.append((activity_type, f"Status changed to {row.get_status_display()}."))
        current_assignment = (row.assignment_type, row.assigned_staff_member_id, row.assigned_vendor_id, row.assigned_contractor_id)
        if assignment_keys.intersection(data.keys()) and previous_assignment != current_assignment:
            activity_messages.append((PropertyWorkOrderActivity.TYPE_ASSIGNED, self._assignment_activity_message(row)))
        if "scheduled_for" in field_values and previous_scheduled_for != row.scheduled_for:
            activity_messages.append((PropertyWorkOrderActivity.TYPE_SCHEDULED, "Work order schedule updated."))
        if "internal_notes" in field_values or "completion_notes" in field_values:
            activity_messages.append((PropertyWorkOrderActivity.TYPE_NOTE_ADDED, "Work order notes updated."))
        if update_fields:
            row.save(update_fields=[*update_fields, "updated_at"])
        self._save_completion_attachments(row, files, data, email.lower().strip())
        for activity_type, message in activity_messages:
            _property_work_order_add_activity(row, activity_type, message, email)
        if hasattr(row, "_prefetched_objects_cache"):
            row._prefetched_objects_cache.pop("attachments", None)
            row._prefetched_objects_cache.pop("activities", None)
        return Response(
            {"work_order": _property_work_order_payload(row), "portal": _build_customer_portal_payload(email, request=request)},
            status=status.HTTP_200_OK,
        )


class CustomerPortalPropertyWorkOrderMarketplaceView(CustomerPortalPropertyWorkOrderView):
    action = "send"

    def _work_order_for_marketplace(self, company: PropertyManagementCompany, property_profile: PropertyProfile, work_order_id: int):
        return get_object_or_404(
            PropertyWorkOrder.objects.select_related(
                "property_management_company",
                "property_profile",
                "unit",
                "tenant",
                "assigned_staff_member",
                "assigned_vendor",
                "assigned_contractor",
                "source_tenant_request",
            )
            .prefetch_related("source_tenant_request__attachments", "attachments", "activities", "contractor_opportunities")
            .filter(property_profile=property_profile, property_management_company=company),
            pk=work_order_id,
        )

    def _property_work_order_photos(self, row: PropertyWorkOrder) -> list[dict]:
        photos = []
        source_request = getattr(row, "source_tenant_request", None)
        if source_request is not None:
            for attachment in source_request.attachments.all():
                payload = _tenant_maintenance_attachment_payload(attachment)
                photos.append(
                    {
                        "id": payload.get("id"),
                        "url": payload.get("url"),
                        "caption": payload.get("filename"),
                        "original_name": payload.get("filename"),
                        "source": "tenant_request",
                    }
                )
        for attachment in row.attachments.all():
            payload = _property_work_order_attachment_payload(attachment)
            photos.append(
                {
                    "id": payload.get("id"),
                    "url": payload.get("url"),
                    "caption": payload.get("filename"),
                    "original_name": payload.get("filename"),
                    "source": "work_order",
                }
            )
        return [photo for photo in photos if photo.get("url") or photo.get("original_name")]

    def _eligible_directory_entries(self, row: PropertyWorkOrder):
        qs = ContractorDirectoryEntry.objects.select_related("claimed_by_contractor", "claimed_by_contractor__user").filter(
            claimed=True,
            claimed_by_contractor__isnull=False,
            claimed_by_contractor__marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        property_profile = row.property_profile
        state = _safe_text(getattr(property_profile, "state", ""))
        if state:
            qs = qs.filter(Q(state__iexact=state) | Q(service_state__iexact=state) | Q(state__isnull=True, service_state__isnull=True))
        category_label = _safe_text(row.get_category_display()).lower()
        category_key = _safe_text(row.category).lower().replace("_", " ")
        if category_key and row.category != PropertyWorkOrder.CATEGORY_OTHER:
            qs = qs.filter(
                Q(primary_service__icontains=category_key)
                | Q(primary_service__icontains=category_label)
                | Q(services__icontains=category_key)
                | Q(services__icontains=category_label)
                | Q(normalized_services__icontains=category_key)
                | Q(normalized_services__icontains=category_label)
            )
        return qs.order_by("-claimed_by_contractor__marketplace_preferred", "business_name", "id")[:10]

    def post(self, request, token: str, property_id: int, work_order_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        row = self._work_order_for_marketplace(company, property_profile, work_order_id)
        action = getattr(self, "action", "send")
        if action == "withdraw":
            if row.marketplace_status not in {PropertyWorkOrder.MARKETPLACE_SENT, PropertyWorkOrder.MARKETPLACE_DECLINED}:
                return Response({"detail": "Only sent marketplace work orders can be withdrawn."}, status=status.HTTP_400_BAD_REQUEST)
            now = timezone.now()
            row.marketplace_status = PropertyWorkOrder.MARKETPLACE_WITHDRAWN
            row.marketplace_response_at = now
            row.save(update_fields=["marketplace_status", "marketplace_response_at", "updated_at"])
            ContractorOpportunity.objects.filter(property_work_order=row, status=ContractorOpportunity.STATUS_PENDING).update(status=ContractorOpportunity.STATUS_EXPIRED, updated_at=now)
            _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_MARKETPLACE_WITHDRAWN, "Marketplace opportunity withdrawn.", email)
            if hasattr(row, "_prefetched_objects_cache"):
                row._prefetched_objects_cache.clear()
            return Response({"work_order": _property_work_order_payload(row), "portal": _build_customer_portal_payload(email, request=request)}, status=status.HTTP_200_OK)

        if row.assignment_type != PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR:
            return Response({"detail": "Set assignment type to Marketplace Contractor before sending."}, status=status.HTTP_400_BAD_REQUEST)
        if row.marketplace_status in {PropertyWorkOrder.MARKETPLACE_SENT, PropertyWorkOrder.MARKETPLACE_ACCEPTED}:
            return Response({"detail": "This work order has already been sent to the marketplace."}, status=status.HTTP_400_BAD_REQUEST)
        active_exists = ContractorOpportunity.objects.filter(property_work_order=row, status__in=[ContractorOpportunity.STATUS_PENDING, ContractorOpportunity.STATUS_ACCEPTED]).exists()
        if active_exists:
            return Response({"detail": "This work order already has active marketplace opportunities."}, status=status.HTTP_400_BAD_REQUEST)

        entries = list(self._eligible_directory_entries(row))
        if not entries:
            return Response({"detail": "No eligible marketplace contractors are available for this work order yet."}, status=status.HTTP_400_BAD_REQUEST)
        property_profile = row.property_profile
        address = ", ".join(part for part in [_safe_text(property_profile.address_line1), _safe_text(property_profile.city), _safe_text(property_profile.state), _safe_text(property_profile.postal_code)] if part)
        now = timezone.now()
        created = []
        for entry in entries:
            opportunity, was_created = ContractorOpportunity.objects.update_or_create(
                directory_entry=entry,
                property_work_order=row,
                defaults={
                    "homeowner_name": "Property Management Company",
                    "homeowner_email": None,
                    "homeowner_phone": None,
                    "project_address": _safe_text(property_profile.address_line1),
                    "project_city": _safe_text(property_profile.city),
                    "project_state": _safe_text(property_profile.state),
                    "project_zip": _safe_text(property_profile.postal_code),
                    "project_type": row.get_category_display(),
                    "project_subtype": row.get_priority_display(),
                    "project_title": f"{row.work_order_number or f'PWO-{row.id:06d}'} - {row.title}",
                    "project_description": row.description,
                    "refined_description": f"{row.description}\n\nLocation: {address or 'Managed property'}\nPriority: {row.get_priority_display()}",
                    "timeline": _safe_dt(row.scheduled_for) or "Requested by property manager",
                    "photos": self._property_work_order_photos(row),
                    "status": ContractorOpportunity.STATUS_PENDING,
                    "selected_by_homeowner": True,
                },
            )
            if was_created:
                created.append(opportunity)
        row.marketplace_status = PropertyWorkOrder.MARKETPLACE_SENT
        row.marketplace_sent_at = now
        row.marketplace_response_at = None
        row.assigned_contractor = None
        row.assigned_staff_member = None
        row.assigned_vendor = None
        row.save(update_fields=["marketplace_status", "marketplace_sent_at", "marketplace_response_at", "assigned_contractor", "assigned_staff_member", "assigned_vendor", "updated_at"])
        _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_MARKETPLACE_SENT, f"Sent to {len(entries)} marketplace contractor{'s' if len(entries) != 1 else ''}.", email)
        if hasattr(row, "_prefetched_objects_cache"):
            row._prefetched_objects_cache.clear()
        return Response(
            {
                "work_order": _property_work_order_payload(row),
                "created_opportunity_count": len(created),
                "opportunity_count": len(entries),
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalTenantMaintenanceRequestView(APIView):
    permission_classes = [AllowAny]

    def _email_from_token(self, token: str):
        try:
            return _unsign_portal_token(token), None
        except signing.SignatureExpired:
            return None, Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return None, Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

    def _property_from_token(self, token: str, property_id: int):
        email, error = self._email_from_token(token)
        if error is not None:
            return None, None, None, error
        company, error = _property_management_company_for_email_or_response(email)
        if error is not None:
            return email, company, None, error
        property_profile = get_object_or_404(
            PropertyProfile.objects.filter(
                id=property_id,
                customer_email__iexact=email.lower().strip(),
                managed_by_company=company,
            )
        )
        return email, company, property_profile, None

    def get(self, request, token: str, property_id: int):
        _email, _company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        rows = _tenant_maintenance_requests_for_property(property_profile)
        status_filter = _safe_text(request.query_params.get("status"))
        unit_id = _safe_text(request.query_params.get("unit_id"))
        if status_filter:
            rows = [row for row in rows if row.get("status") == status_filter]
        if unit_id:
            rows = [row for row in rows if str(row.get("unit_id") or "") == unit_id]
        return Response({"tenant_maintenance_requests": rows}, status=status.HTTP_200_OK)

    def post(self, request, token: str, property_id: int, request_id: int):
        email, company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        source_request = get_object_or_404(
            TenantMaintenanceRequest.objects.select_related("property_profile", "unit", "tenant").prefetch_related("attachments"),
            pk=request_id,
            property_profile=property_profile,
        )
        if source_request.status != TenantMaintenanceRequest.STATUS_APPROVED:
            return Response({"detail": "Only approved tenant maintenance requests can be converted to work orders."}, status=status.HTTP_400_BAD_REQUEST)
        if PropertyWorkOrder.objects.filter(source_tenant_request=source_request, status__in=PropertyWorkOrder.ACTIVE_STATUSES).exists():
            return Response({"detail": "An active work order already exists for this maintenance request."}, status=status.HTTP_400_BAD_REQUEST)
        row = PropertyWorkOrder.objects.create(
            property_management_company=company,
            property_profile=property_profile,
            unit=source_request.unit,
            tenant=source_request.tenant,
            source_tenant_request=source_request,
            title=_safe_text(source_request.title) or "Tenant maintenance request",
            description=_safe_text(source_request.description),
            category=source_request.category or PropertyWorkOrder.CATEGORY_GENERAL_REPAIR,
            priority=source_request.urgency or PropertyWorkOrder.PRIORITY_NORMAL,
            status=PropertyWorkOrder.STATUS_OPEN,
            internal_notes=_safe_text(source_request.manager_notes),
            created_by=email.lower().strip(),
        )
        _property_work_order_add_activity(row, PropertyWorkOrderActivity.TYPE_CREATED, "Work order created from tenant maintenance request.", email)
        return Response(
            {
                "work_order": _property_work_order_payload(row),
                "request": _tenant_maintenance_request_payload(source_request),
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request, token: str, property_id: int, request_id: int):
        email, _company, property_profile, error = self._property_from_token(token, property_id)
        if error is not None:
            return error
        serializer = TenantMaintenanceRequestReviewSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = get_object_or_404(
            TenantMaintenanceRequest.objects.select_related("property_profile", "unit", "tenant").prefetch_related("attachments"),
            pk=request_id,
            property_profile=property_profile,
        )
        data = serializer.validated_data
        update_fields = []
        if "status" in data and row.status != data["status"]:
            row.status = data["status"]
            row.reviewed_at = timezone.now()
            row.reviewed_by = email.lower().strip()
            update_fields.extend(["status", "reviewed_at", "reviewed_by"])
        if "manager_notes" in data:
            row.manager_notes = _safe_text(data.get("manager_notes"))
            if "reviewed_at" not in update_fields:
                row.reviewed_at = timezone.now()
                row.reviewed_by = email.lower().strip()
                update_fields.extend(["reviewed_at", "reviewed_by"])
            update_fields.append("manager_notes")
        if update_fields:
            row.save(update_fields=[*dict.fromkeys(update_fields), "updated_at"])
        return Response(
            {
                "request": _tenant_maintenance_request_payload(row),
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


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
        managed_by_company = create_or_sync_company_from_homeowner(homeowner) if homeowner_is_property_management_company(homeowner) else None
        should_be_primary = bool(data.pop("is_primary", False)) or not PropertyProfile.objects.filter(customer_email__iexact=email).exists()
        data.pop("id", None)
        profile = PropertyProfile.objects.create(
            homeowner=homeowner,
            customer_email=email.lower().strip(),
            managed_by_company=managed_by_company,
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


def _agreement_for_home_system_or_none(email: str, agreement_id):
    if not agreement_id:
        return None
    agreement = get_object_or_404(
        Agreement.objects.select_related("project", "contractor", "homeowner"),
        pk=agreement_id,
    )
    if not _agreement_customer_visible_reason(agreement, email):
        raise PermissionError("That agreement is not available in your portal.")
    return agreement


def _customer_request_for_home_system_or_none(email: str, request_id):
    if not request_id:
        return None
    return get_object_or_404(CustomerRequest, pk=request_id, customer_email__iexact=email.lower().strip())


def _documents_for_home_system(profile: PropertyProfile, document_ids) -> list[PropertyDocument]:
    if document_ids is None:
        return []
    ids = [int(value) for value in document_ids]
    documents = list(PropertyDocument.objects.filter(property_profile=profile, id__in=ids))
    if len(documents) != len(set(ids)):
        raise PermissionError("One or more linked documents are not available for this property.")
    return documents


def _home_system_for_email_or_404(email: str, system_id: int) -> PropertyHomeSystem:
    return get_object_or_404(
        PropertyHomeSystem.objects.select_related("property_profile"),
        pk=system_id,
        property_profile__customer_email__iexact=email.lower().strip(),
        is_archived=False,
    )


class CustomerPortalHomeSystemView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalHomeSystemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        profile = _property_profile_for_email_or_404(email, data.pop("property_id", None))
        linked_document_ids = data.pop("linked_document_ids", None)
        try:
            linked_agreement = _agreement_for_home_system_or_none(email, data.pop("linked_agreement_id", None))
            linked_customer_request = _customer_request_for_home_system_or_none(email, data.pop("linked_customer_request_id", None))
            linked_documents = _documents_for_home_system(profile, linked_document_ids)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        system = PropertyHomeSystem.objects.create(
            property_profile=profile,
            linked_agreement=linked_agreement,
            linked_customer_request=linked_customer_request,
            **data,
        )
        if linked_document_ids is not None:
            system.linked_documents.set(linked_documents)
        create_smart_notification(
            event_type=SmartNotificationEvent.PROPERTY_PROFILE_UPDATED,
            recipient_email=email,
            homeowner=profile.homeowner,
            property_profile=profile,
            context={
                "property_name": profile.display_name or "Property profile",
                "system_name": system.display_name,
            },
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)

    def patch(self, request, token: str, system_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        system = _home_system_for_email_or_404(email, system_id)
        serializer = CustomerPortalHomeSystemSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        if "property_id" in data:
            system.property_profile = _property_profile_for_email_or_404(email, data.pop("property_id"))
        linked_document_ids = data.pop("linked_document_ids", None)
        try:
            if "linked_agreement_id" in data:
                system.linked_agreement = _agreement_for_home_system_or_none(email, data.pop("linked_agreement_id"))
            if "linked_customer_request_id" in data:
                system.linked_customer_request = _customer_request_for_home_system_or_none(email, data.pop("linked_customer_request_id"))
            linked_documents = _documents_for_home_system(system.property_profile, linked_document_ids) if linked_document_ids is not None else None
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        for field, value in data.items():
            setattr(system, field, value)
        system.save()
        if linked_documents is not None:
            system.linked_documents.set(linked_documents)
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)

    def delete(self, request, token: str, system_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        system = _home_system_for_email_or_404(email, system_id)
        system.archive()
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalHomeSystemServiceView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, system_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        system = _home_system_for_email_or_404(email, system_id)
        serializer = CustomerPortalHomeSystemServiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        system.last_service_date = data.get("last_service_date") or timezone.localdate()
        if "service_provider" in data:
            system.service_provider = data.get("service_provider", "")
        note = _safe_text(data.get("notes"))
        if note:
            prefix = f"Service note {timezone.localdate().isoformat()}: "
            system.notes = f"{system.notes.strip()}\n\n{prefix}{note}".strip()
        system.resolved_at = timezone.now()
        system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_RESOLVED
        system.next_notification_at = None
        system.save(
            update_fields=[
                "last_service_date",
                "service_provider",
                "notes",
                "resolved_at",
                "reminder_delivery_status",
                "next_notification_at",
                "updated_at",
            ]
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


class CustomerPortalHomeSystemServiceRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, system_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        system = _home_system_for_email_or_404(email, system_id)
        profile = system.property_profile
        homeowner = _primary_homeowner_for_email(email)
        reminder = build_home_system_reminder(system)
        title = f"{system.display_name} service request"
        customer_request = CustomerRequest.objects.create(
            homeowner=homeowner,
            property_profile=profile,
            linked_home_system=system,
            customer_email=email.lower().strip(),
            request_type=CustomerRequest.TYPE_MAINTENANCE,
            project_mode=CustomerRequest.PROJECT_MODE_FULL_SERVICE,
            project_category=system.get_system_type_display(),
            project_type=system.get_system_type_display(),
            project_subtype="Maintenance Service",
            payment_preference=CustomerRequest.PAYMENT_PREFERENCE_DISCUSS,
            status=CustomerRequest.STATUS_SUBMITTED,
            title=title,
            description=(
                f"Request service for {system.display_name}.\n\n"
                f"Reason: {reminder.reminder_reason}\n\n"
                f"Recommended action: {reminder.recommended_action}"
            ),
            urgency="high" if reminder.priority == "high" else "normal",
            preferred_timeline="asap" if reminder.priority == "high" else "flexible",
            address_line1=profile.address_line1,
            address_line2=profile.address_line2,
            city=profile.city,
            state=profile.state,
            postal_code=profile.postal_code,
        )
        system.linked_customer_request = customer_request
        system.save(update_fields=["linked_customer_request", "updated_at"])
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
                "dedupe_key": f"home-system-service-request:{system.id}:{customer_request.id}",
            },
        )
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)


class CustomerPortalHomeSystemRecommendationPreferenceView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, recommendation_key: str, action: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        if action not in {"ignore", "restore"}:
            return Response({"detail": "Unsupported recommendation action."}, status=status.HTTP_404_NOT_FOUND)
        system_id = request.data.get("system_id") or request.data.get("home_system_id")
        if not system_id:
            return Response({"detail": "Please include the home system for this recommendation."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            system, normalized_key = _home_system_recommendation_or_404(email, int(system_id), recommendation_key)
        except (TypeError, ValueError):
            return Response({"detail": "Please include a valid home system."}, status=status.HTTP_400_BAD_REQUEST)
        preference, _created = PropertyHomeSystemRecommendationPreference.objects.get_or_create(
            property_profile=system.property_profile,
            home_system=system,
            recommendation_key=normalized_key,
            defaults={"status": PropertyHomeSystemRecommendationPreference.STATUS_ACTIVE},
        )
        if action == "ignore":
            preference.ignore()
            detail = "Recommendation ignored."
        else:
            preference.restore()
            detail = "Recommendation restored."
        return Response(
            {
                "detail": detail,
                "recommendation_key": normalized_key,
                "system_id": system.id,
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalUploadSessionSerializer(serializers.Serializer):
    property_profile_id = serializers.IntegerField(required=False)
    home_system_id = serializers.IntegerField(required=False, allow_null=True)
    document_type = serializers.ChoiceField(choices=sorted(HOME_SYSTEM_SCAN_DOCUMENT_TYPES), required=False, allow_blank=True)


class CustomerPortalScanUploadSerializer(serializers.Serializer):
    property_profile_id = serializers.IntegerField(required=False)
    home_system_id = serializers.IntegerField(required=False, allow_null=True)
    document_type = serializers.ChoiceField(choices=sorted(HOME_SYSTEM_SCAN_DOCUMENT_TYPES), required=False, allow_blank=True)
    upload_source = serializers.ChoiceField(choices=sorted(HOME_SYSTEM_SCAN_UPLOAD_SOURCES), required=False)
    title = serializers.CharField(required=False, allow_blank=True, max_length=200)


class CustomerPortalApplyExtractionSerializer(serializers.Serializer):
    selected_fields = serializers.DictField(child=serializers.JSONField(), allow_empty=False)


def _property_profile_for_email_or_404(email: str, property_id=None) -> PropertyProfile:
    queryset = PropertyProfile.objects.filter(customer_email__iexact=email.lower().strip())
    if property_id:
        return get_object_or_404(queryset, pk=property_id)
    profile = queryset.order_by("-is_primary", "-updated_at", "-id").first()
    if profile:
        return profile
    return _get_or_create_property_profile(email)


def _home_system_for_profile_or_404(profile: PropertyProfile, system_id) -> PropertyHomeSystem | None:
    if not system_id:
        return None
    return get_object_or_404(PropertyHomeSystem.objects.filter(property_profile=profile, is_archived=False), pk=system_id)


def _validate_scan_file(uploaded_file) -> str:
    filename = _safe_text(getattr(uploaded_file, "name", "")).lower()
    extension = ""
    if "." in filename:
        extension = f".{filename.rsplit('.', 1)[-1]}"
    content_type = _safe_text(getattr(uploaded_file, "content_type", "")).lower()
    if extension not in HOME_SYSTEM_SCAN_ALLOWED_EXTENSIONS:
        raise serializers.ValidationError("Unsupported file type. Upload JPG, PNG, or PDF.")
    if content_type and not (
        content_type.startswith("image/")
        or content_type == "application/pdf"
        or content_type == "application/octet-stream"
    ):
        raise serializers.ValidationError("Unsupported file type. Upload JPG, PNG, or PDF.")
    return extension


def _frontend_portal_url(path: str) -> str:
    base = (
        getattr(settings, "FRONTEND_URL", "")
        or getattr(settings, "PUBLIC_SITE_URL", "")
        or "https://www.myhomebro.com"
    ).rstrip("/")
    return f"{base}{path}"


def _qr_data_url(value: str) -> str:
    try:
        import qrcode

        image = qrcode.make(value)
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception:
        escaped = (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        svg = (
            "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'>"
            "<rect width='240' height='240' fill='white'/>"
            "<rect x='18' y='18' width='54' height='54' fill='#0f172a'/>"
            "<rect x='168' y='18' width='54' height='54' fill='#0f172a'/>"
            "<rect x='18' y='168' width='54' height='54' fill='#0f172a'/>"
            "<path d='M96 32h18v18H96zm36 0h18v18h-18zm-18 36h18v18h-18zm54 36h18v18h-18zm-72 18h18v18H96zm36 36h18v18h-18zm54 18h18v18h-18z' fill='#0f172a'/>"
            "<text x='120' y='112' text-anchor='middle' font-size='12' font-family='Arial' fill='#0f172a'>Open link below</text>"
            f"<title>{escaped}</title>"
            "</svg>"
        )
        return f"data:image/svg+xml;base64,{base64.b64encode(svg.encode('utf-8')).decode('ascii')}"


def _upload_session_payload(session: CustomerPortalUploadSession) -> dict:
    path = f"/portal/upload-session/{session.session_token}"
    url = _frontend_portal_url(path)
    return {
        "session_token": session.session_token,
        "upload_url": url,
        "frontend_path": path,
        "expires_at": _safe_dt(session.expires_at),
        "document_type": _safe_text(session.document_type),
        "property_profile_id": session.property_profile_id,
        "home_system_id": session.home_system_id,
        "home_system_name": session.home_system.display_name if session.home_system_id else "",
        "qr_code_data_url": _qr_data_url(url),
    }


def _serialize_scan_upload(document: PropertyDocument, extraction: PropertyDocumentExtraction) -> dict:
    return {
        "detail": "File saved. Review suggested fields before applying anything to your Home System.",
        "document": _property_document_payload(document, include_record_id=True),
        "extraction": _serialize_document_extraction(document),
        "home_system_id": getattr(extraction, "home_system_id", None),
    }


def _save_scanned_property_document(
    *,
    email: str,
    uploaded_file,
    property_profile: PropertyProfile,
    home_system: PropertyHomeSystem | None,
    document_type: str,
    upload_source: str,
    title: str = "",
) -> tuple[PropertyDocument, PropertyDocumentExtraction]:
    _validate_scan_file(uploaded_file)
    document_type = _safe_text(document_type) or "Equipment Label"
    if document_type not in HOME_SYSTEM_SCAN_DOCUMENT_TYPES:
        raise serializers.ValidationError("Unsupported document type.")
    if upload_source not in HOME_SYSTEM_SCAN_UPLOAD_SOURCES:
        raise serializers.ValidationError("Unsupported upload source.")
    document = PropertyDocument.objects.create(
        property_profile=property_profile,
        title=_safe_text(title) or _safe_text(getattr(uploaded_file, "name", "")) or "Home system document",
        document_type=document_type,
        upload_source=upload_source,
        file=uploaded_file,
    )
    if home_system is not None:
        home_system.linked_documents.add(document)
    extraction = extract_home_system_document(document, home_system=home_system)
    return document, extraction


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

        profile_id = request.data.get("property_profile_id") or request.data.get("property_id")
        profile = _property_profile_for_email_or_404(email, profile_id)
        home_system = _home_system_for_profile_or_404(profile, request.data.get("home_system_id"))
        title = _safe_text(request.data.get("title")) or _safe_text(getattr(uploaded_file, "name", "")) or "Property file"
        if upload_kind == "photos":
            PropertyPhoto.objects.create(
                property_profile=profile,
                title=title,
                photo=uploaded_file,
            )
        else:
            upload_source = _safe_text(request.data.get("upload_source")) or PropertyDocument.UPLOAD_SOURCE_PORTAL_DESKTOP
            scan_upload = bool(
                home_system
                or request.data.get("run_extraction")
                or upload_source
                in {
                    PropertyDocument.UPLOAD_SOURCE_QR_MOBILE_WEB,
                    PropertyDocument.UPLOAD_SOURCE_MOBILE_APP,
                }
            )
            if scan_upload:
                try:
                    document, extraction = _save_scanned_property_document(
                        email=email,
                        uploaded_file=uploaded_file,
                        property_profile=profile,
                        home_system=home_system,
                        document_type=_safe_text(request.data.get("document_type")) or "Equipment Label",
                        upload_source=upload_source,
                        title=title,
                    )
                except serializers.ValidationError as exc:
                    return Response({"detail": exc.detail[0] if isinstance(exc.detail, list) else exc.detail}, status=status.HTTP_400_BAD_REQUEST)
                payload = _serialize_scan_upload(document, extraction)
                payload["portal"] = _build_customer_portal_payload(email, request=request)
                return Response(payload, status=status.HTTP_201_CREATED)
            else:
                PropertyDocument.objects.create(
                    property_profile=profile,
                    title=title,
                    document_type=_safe_text(request.data.get("document_type")) or "Property Document",
                    upload_source=upload_source,
                    file=uploaded_file,
                )

        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_201_CREATED)


class CustomerPortalUploadSessionView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalUploadSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = _property_profile_for_email_or_404(email, serializer.validated_data.get("property_profile_id"))
        home_system = _home_system_for_profile_or_404(profile, serializer.validated_data.get("home_system_id"))
        session = CustomerPortalUploadSession.objects.create(
            session_token=secrets.token_urlsafe(32),
            customer_email=email.lower().strip(),
            property_profile=profile,
            home_system=home_system,
            document_type=serializer.validated_data.get("document_type") or "Equipment Label",
            upload_source=PropertyDocument.UPLOAD_SOURCE_QR_MOBILE_WEB,
            expires_at=timezone.now() + timedelta(minutes=30),
        )
        return Response(_upload_session_payload(session), status=status.HTTP_201_CREATED)


class CustomerPortalUploadSessionDetailView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def _session_or_error(self, session_token: str):
        session = CustomerPortalUploadSession.objects.select_related("property_profile", "home_system").filter(
            session_token=_safe_text(session_token)
        ).first()
        if session is None:
            return None, Response({"detail": "Upload session not found."}, status=status.HTTP_404_NOT_FOUND)
        if session.is_expired:
            return None, Response({"detail": "This upload session has expired."}, status=status.HTTP_403_FORBIDDEN)
        return session, None

    def get(self, request, session_token: str):
        session, error = self._session_or_error(session_token)
        if error:
            return error
        return Response(_upload_session_payload(session), status=status.HTTP_200_OK)

    def post(self, request, session_token: str):
        session, error = self._session_or_error(session_token)
        if error:
            return error
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            files = list(request.FILES.values())
            uploaded_file = files[0] if files else None
        if uploaded_file is None:
            return Response({"detail": "Please attach a file."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            document, extraction = _save_scanned_property_document(
                email=session.customer_email,
                uploaded_file=uploaded_file,
                property_profile=session.property_profile,
                home_system=session.home_system,
                document_type=_safe_text(request.data.get("document_type")) or session.document_type or "Equipment Label",
                upload_source=session.upload_source or PropertyDocument.UPLOAD_SOURCE_QR_MOBILE_WEB,
                title=_safe_text(request.data.get("title")),
            )
        except serializers.ValidationError as exc:
            return Response({"detail": exc.detail[0] if isinstance(exc.detail, list) else exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        session.mark_used()
        return Response(_serialize_scan_upload(document, extraction), status=status.HTTP_201_CREATED)


class CustomerPortalApplyDocumentExtractionView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, document_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        serializer = CustomerPortalApplyExtractionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = get_object_or_404(
            PropertyDocument.objects.select_related("property_profile").filter(
                property_profile__customer_email__iexact=email.lower().strip()
            ),
            pk=document_id,
        )
        try:
            extraction = document.extraction
        except PropertyDocumentExtraction.DoesNotExist:
            return Response({"detail": "No extraction results are available for this document."}, status=status.HTTP_404_NOT_FOUND)
        home_system = extraction.home_system or document.home_systems.filter(property_profile=document.property_profile, is_archived=False).first()
        if home_system is None:
            return Response({"detail": "This document is not linked to a Home System."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_fields = {
            "manufacturer": "manufacturer",
            "model_number": "model_number",
            "serial_number": "serial_number",
            "install_date": "install_date",
            "warranty_expiration_date": "warranty_expiration_date",
            "condition": "condition",
        }
        selected = serializer.validated_data["selected_fields"] or {}
        suggestions = extraction.suggested_fields or {}
        updated_fields = []
        for source_field, model_field in allowed_fields.items():
            if source_field not in selected:
                continue
            suggestion = suggestions.get(source_field)
            value = selected.get(source_field)
            if isinstance(value, dict):
                value = value.get("value")
            if not value and isinstance(suggestion, dict):
                value = suggestion.get("value")
            value = _safe_text(value)
            if not value:
                continue
            if model_field in {"install_date", "warranty_expiration_date"}:
                parsed = parse_date(value)
                if parsed is None:
                    continue
                value = parsed
            setattr(home_system, model_field, value)
            updated_fields.append(model_field)
        if "notes" in selected:
            note_value = selected.get("notes")
            if isinstance(note_value, dict):
                note_value = note_value.get("value")
            note_value = _safe_text(note_value)
            if note_value:
                existing = _safe_text(home_system.notes)
                home_system.notes = f"{existing}\n\n{note_value}".strip() if existing else note_value
                updated_fields.append("notes")
        if updated_fields:
            home_system.save(update_fields=sorted(set(updated_fields + ["updated_at"])))
        extraction.reviewed_at = timezone.now()
        extraction.applied_at = timezone.now() if updated_fields else None
        extraction.save(update_fields=["reviewed_at", "applied_at", "updated_at"])
        return Response(_build_customer_portal_payload(email, request=request), status=status.HTTP_200_OK)


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


def _portal_agreement_for_email(email: str, agreement_id: int):
    agreement = get_object_or_404(
        Agreement.objects.select_related("homeowner", "project", "project__homeowner", "contractor"),
        pk=agreement_id,
    )
    if _agreement_customer_email(agreement) != email.lower().strip():
        return None
    if not _agreement_customer_visible_reason(agreement, email):
        return None
    return agreement


class CustomerPortalAgreementAmendmentSerializer(serializers.Serializer):
    change_type = serializers.ChoiceField(
        choices=[
            "scope_change",
            "timeline_change",
            "price_change",
            "milestone_change",
            "descope_remove_work",
            "materials_change",
            "warranty_change",
            "other",
        ]
    )
    requested_change = serializers.CharField()
    reason = serializers.CharField()
    attachment_note = serializers.CharField(required=False, allow_blank=True)
    revised_project_value = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    affected_milestone_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=True)


class CustomerPortalAgreementRefundSerializer(serializers.Serializer):
    reason = serializers.CharField()
    requested_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    evidence_note = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalAgreementDisputeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)
    description = serializers.CharField()
    desired_resolution = serializers.CharField(required=False, allow_blank=True)
    milestone_id = serializers.IntegerField(required=False)
    evidence_note = serializers.CharField(required=False, allow_blank=True)


class CustomerPortalAgreementAmendmentImproveView(APIView):
    permission_classes = [AllowAny]

    class InputSerializer(serializers.Serializer):
        requested_change = serializers.CharField()
        current_change_type = serializers.ChoiceField(
            choices=[
                "scope_change",
                "timeline_change",
                "price_change",
                "milestone_change",
                "descope_remove_work",
                "materials_change",
                "warranty_change",
                "other",
            ],
            required=False,
        )

    CHANGE_TYPE_LABELS = {
        "scope_change": "Scope Change",
        "timeline_change": "Timeline Change",
        "price_change": "Price Change",
        "milestone_change": "Milestone Change",
        "descope_remove_work": "De-scope / Remove Work",
        "materials_change": "Materials Change",
        "warranty_change": "Warranty Change",
        "other": "Other",
    }

    def _suggest_change_type(self, requested_change: str, current_change_type: str = "") -> str:
        text = requested_change.lower()
        if re.search(r"\b(remove|cancel|exclude|take out|cut|de[- ]?scope|reduce scope|remaining work)\b", text):
            return "descope_remove_work"
        if re.search(r"\b(tile|material|porcelain|fixture|paint|color|supplier|product|brand|finish)\b", text):
            return "materials_change"
        if re.search(r"\b(delay|start date|schedule|timeline|week|month|deadline|reschedule)\b", text):
            return "timeline_change"
        if re.search(r"\b(price|cost|amount|credit|refund|adjust|lower|increase|decrease|budget)\b", text):
            return "price_change"
        if re.search(r"\b(milestone|phase|draw|payment schedule|payment amount)\b", text):
            return "milestone_change"
        if re.search(r"\b(warranty|coverage|guarantee|covered)\b", text):
            return "warranty_change"
        if re.search(r"\b(add|replace|change|expand|scope|work)\b", text):
            return "scope_change"
        return current_change_type or "other"

    def _improve_description(self, requested_change: str, change_type: str) -> str:
        clean = re.sub(r"\s+", " ", requested_change).strip()
        if not clean:
            return ""
        if clean.endswith("."):
            clean = clean[:-1]
        prefix = "Please review this proposed change"
        if change_type == "descope_remove_work":
            prefix = "Please review this proposed de-scope change"
        elif change_type == "materials_change":
            prefix = "Please review this proposed materials change"
        elif change_type == "timeline_change":
            prefix = "Please review this proposed timeline change"
        elif change_type == "price_change":
            prefix = "Please review this proposed price change"
        elif change_type == "milestone_change":
            prefix = "Please review this proposed milestone change"
        elif change_type == "warranty_change":
            prefix = "Please review this proposed warranty change"
        return f"{prefix}: {clean}."

    def _clarifying_questions(self, requested_change: str, change_type: str) -> list[str]:
        text = requested_change.lower()
        questions: list[str] = []
        if len(requested_change.strip()) < 40:
            questions.append("Which specific work, material, date, or milestone should the contractor review?")
        if change_type in {"price_change", "descope_remove_work"} and not re.search(r"\$|\b\d+(\.\d+)?\b", text):
            questions.append("What amount or revised project value should the contractor consider, if known?")
        if change_type == "timeline_change" and not re.search(r"\b(date|week|month|day|start|finish|delay)\b", text):
            questions.append("What date or timing change are you requesting?")
        if change_type == "materials_change" and not re.search(r"\b(to|from|brand|model|porcelain|tile|color|finish)\b", text):
            questions.append("Which material or product should be changed, and what should replace it?")
        return questions[:3]

    def _evidence_note(self, change_type: str) -> str:
        notes = {
            "descope_remove_work": "A revised scope list, estimate, or note identifying removed milestones can help the contractor review this.",
            "price_change": "A revised estimate, receipt, or written price basis can help support this request.",
            "materials_change": "A supplier quote, material sample, product link, or photo can help support this request.",
            "timeline_change": "A schedule constraint, delivery date, or availability note can help support this request.",
            "milestone_change": "A milestone list, payment schedule note, or project update can help support this request.",
            "warranty_change": "A warranty document, product detail, or contractor warranty note can help support this request.",
        }
        return notes.get(change_type, "Photos, documents, estimates, or notes from your project records can help support this request.")

    def post(self, request, token: str, agreement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        agreement = _portal_agreement_for_email(email, agreement_id)
        if not agreement:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested_change = _safe_text(serializer.validated_data.get("requested_change"))
        if not requested_change:
            return Response({"detail": "Describe the change first."}, status=status.HTTP_400_BAD_REQUEST)

        change_type = self._suggest_change_type(
            requested_change,
            serializer.validated_data.get("current_change_type") or "",
        )
        return Response(
            {
                "detail": "Amendment request improved.",
                "original_request": requested_change,
                "suggested_change_type": change_type,
                "suggested_change_type_label": self.CHANGE_TYPE_LABELS.get(change_type, "Other"),
                "improved_description": self._improve_description(requested_change, change_type),
                "clarification_questions": self._clarifying_questions(requested_change, change_type),
                "evidence_note": self._evidence_note(change_type),
                "source": "ai_advisory",
            },
            status=status.HTTP_200_OK,
        )


class CustomerPortalAgreementAmendmentRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, agreement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        agreement = _portal_agreement_for_email(email, agreement_id)
        if not agreement:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = CustomerPortalAgreementAmendmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        portal_payload = _build_customer_portal_payload(email, request=request)
        agreement_row = next((row for row in portal_payload["agreements"] if row["id"] == agreement.id), {})
        status_key = agreement_row.get("customer_status_key", "")
        if status_key not in {"signed", "escrow_needed", "funded", "in_progress", "awaiting_review", "payment_pending"}:
            return Response({"detail": "This agreement is not eligible for amendment requests from the portal."}, status=status.HTTP_400_BAD_REQUEST)

        existing = _active_amendment_request(agreement)
        if existing:
            return Response({"detail": "An amendment request is already open.", "amendment_request_id": existing.id, "portal": portal_payload}, status=status.HTTP_200_OK)

        change_type_map = {
            "scope_change": AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE,
            "timeline_change": AmendmentRequest.ChangeType.DATE_CHANGE,
            "price_change": AmendmentRequest.ChangeType.AMOUNT_CHANGE,
            "milestone_change": AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE,
            "descope_remove_work": AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK,
            "materials_change": AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE,
            "warranty_change": AmendmentRequest.ChangeType.OTHER,
            "other": AmendmentRequest.ChangeType.OTHER,
        }
        portal_change_type = serializer.validated_data["change_type"]
        original_project_value = Decimal(str(getattr(agreement, "total_cost", 0) or 0)).quantize(Decimal("0.01"))
        escrow_funded_amount = Decimal(str(getattr(agreement, "escrow_funded_amount", 0) or 0)).quantize(Decimal("0.01"))
        revised_project_value = serializer.validated_data.get("revised_project_value")
        estimated_surplus = Decimal("0.00")
        refund_eligibility_status = AmendmentRequest.RefundEligibilityStatus.NOT_APPLICABLE
        if portal_change_type == "descope_remove_work":
            refund_eligibility_status = AmendmentRequest.RefundEligibilityStatus.ELIGIBLE_AFTER_SIGNED
            if revised_project_value is not None:
                revised_project_value = Decimal(str(revised_project_value)).quantize(Decimal("0.01"))
                estimated_surplus = max(escrow_funded_amount - revised_project_value, Decimal("0.00"))
            else:
                refund_eligibility_status = AmendmentRequest.RefundEligibilityStatus.ESTIMATE_ONLY
        requested_changes = {
            "portal_change_type": portal_change_type,
            "requested_change": serializer.validated_data["requested_change"],
            "attachment_note": serializer.validated_data.get("attachment_note", ""),
            "requested_on_amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
        }
        if portal_change_type == "descope_remove_work":
            requested_changes.update(
                {
                    "original_project_value": str(original_project_value),
                    "revised_project_value": str(revised_project_value) if revised_project_value is not None else "",
                    "escrow_funded_amount": str(escrow_funded_amount),
                    "estimated_refundable_escrow_surplus": str(estimated_surplus),
                    "refund_eligibility_note": "Estimated only. Refund eligibility is created after both parties approve/sign the amendment or addendum.",
                }
            )
        user = User.objects.filter(email__iexact=email).first()
        amendment = AmendmentRequest.objects.create(
            agreement=agreement,
            requested_by=user,
            initiated_by_role="homeowner",
            change_type=change_type_map[portal_change_type],
            requested_changes=requested_changes,
            justification=serializer.validated_data["reason"],
            original_project_value=original_project_value if portal_change_type == "descope_remove_work" else None,
            revised_project_value=revised_project_value if portal_change_type == "descope_remove_work" else None,
            escrow_funded_amount=escrow_funded_amount if portal_change_type == "descope_remove_work" else None,
            estimated_refundable_escrow_surplus=estimated_surplus,
            refund_eligibility_status=refund_eligibility_status,
            status=AmendmentRequest.Status.OPEN,
        )
        if portal_change_type == "descope_remove_work":
            ids = set()
            for value in serializer.validated_data.get("affected_milestone_ids") or []:
                try:
                    ids.add(int(value))
                except Exception:
                    pass
            affected = agreement.milestones.filter(id__in=ids) if ids else agreement.milestones.none()
            amendment.affected_milestones.set(affected)
            apply_descoped_milestone_hold(amendment)
            for milestone in affected:
                create_project_activity_event(
                    agreement=agreement,
                    milestone=milestone,
                    event_type="milestone_blocked",
                    object_type="amendment_request",
                    object_id=amendment.id,
                    title="Milestone blocked by de-scope review",
                    body=f"{milestone.title} is paused while the de-scope amendment is reviewed.",
                    actor=user,
                    actor_role="homeowner",
                    recipient_role="contractor",
                    delivered=True,
                    metadata={"milestone_id": milestone.id},
                )
        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_created",
            object_type="amendment_request",
            object_id=amendment.id,
            title="Homeowner submitted amendment request",
            body=serializer.validated_data["reason"],
            actor=user,
            actor_role="homeowner",
            recipient_role="contractor",
            delivered=True,
            metadata={
                "change_type": amendment.change_type,
                "portal_change_type": portal_change_type,
                "estimated_refundable_escrow_surplus": str(estimated_surplus),
            },
        )
        return Response(
            {
                "ok": True,
                "amendment_request": {"id": amendment.id, "status": amendment.status, "status_label": amendment.get_status_display()},
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_201_CREATED,
        )


class CustomerPortalAgreementRefundRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, agreement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        agreement = _portal_agreement_for_email(email, agreement_id)
        if not agreement:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = CustomerPortalAgreementRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ledger = serialize_ledger(escrow_ledger(agreement)) if agreement else {}
        remaining = Decimal(str(ledger.get("available") or "0"))
        if remaining <= Decimal("0.00"):
            return Response({"detail": "No escrow balance is available for a refund request."}, status=status.HTTP_400_BAD_REQUEST)
        requested_amount = serializer.validated_data.get("requested_amount")
        if requested_amount and requested_amount > remaining:
            return Response({"detail": "Requested refund exceeds the remaining escrow balance."}, status=status.HTTP_400_BAD_REQUEST)

        existing = _active_refund_request(agreement)
        if existing:
            return Response(
                {
                    "detail": "A refund request is already open.",
                    "refund_request_id": existing.id,
                    "portal": _build_customer_portal_payload(email, request=request),
                },
                status=status.HTTP_200_OK,
            )

        user = User.objects.filter(email__iexact=email).first()
        refund = CustomerRefundRequest.objects.create(
            agreement=agreement,
            requested_by=user,
            reason=serializer.validated_data["reason"],
            evidence_note=serializer.validated_data.get("evidence_note", ""),
            requested_amount=requested_amount,
            status=CustomerRefundRequest.Status.REFUND_REQUESTED,
        )
        return Response(
            {
                "ok": True,
                "refund_request": {"id": refund.id, "status": refund.status, "status_label": refund.get_status_display()},
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_201_CREATED,
        )


class CustomerPortalAgreementDisputeView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, agreement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        agreement = _portal_agreement_for_email(email, agreement_id)
        if not agreement:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = CustomerPortalAgreementDisputeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        portal_payload = _build_customer_portal_payload(email, request=request)
        agreement_row = next((row for row in portal_payload["agreements"] if row["id"] == agreement.id), {})
        if agreement_row.get("customer_status_key") in {"closed"}:
            return Response({"detail": "Closed agreements cannot open a new dispute from the portal."}, status=status.HTTP_400_BAD_REQUEST)

        milestone = None
        milestone_id = serializer.validated_data.get("milestone_id")
        if milestone_id:
            milestone = Milestone.objects.filter(id=milestone_id, agreement=agreement).first()
            if not milestone:
                return Response({"detail": "Milestone not found for this agreement."}, status=status.HTTP_404_NOT_FOUND)

        existing = _active_dispute(agreement)
        if existing:
            return Response(
                {
                    "detail": "A dispute is already open.",
                    "dispute_id": existing.id,
                    "dispute_url": _portal_dispute_public_url(existing),
                    "portal": portal_payload,
                },
                status=status.HTTP_200_OK,
            )

        reason = serializer.validated_data["reason"].strip()
        desired_resolution = serializer.validated_data.get("desired_resolution", "").strip()
        evidence_note = serializer.validated_data.get("evidence_note", "").strip()
        description = "\n\n".join(
            part
            for part in [
                serializer.validated_data["description"].strip(),
                f"Desired resolution: {desired_resolution}" if desired_resolution else "",
                f"Evidence note: {evidence_note}" if evidence_note else "",
                "[Portal Source] agreement_level_dispute",
            ]
            if part
        )
        dispute = Dispute.objects.create(
            agreement=agreement,
            milestone=milestone,
            initiator="homeowner",
            reason=reason,
            description=description,
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
            notify_dispute_event(dispute=dispute, event_type=Notification.EVENT_DISPUTE_OPENED, actor_user=None)
        except Exception:
            pass
        user = User.objects.filter(email__iexact=email).first()
        create_project_activity_event(
            agreement=agreement,
            milestone=milestone,
            event_type="dispute_created",
            object_type="dispute",
            object_id=dispute.id,
            title="Homeowner opened dispute",
            body=reason,
            actor=user,
            actor_role="homeowner",
            recipient_role="contractor",
            delivered=True,
            metadata={"desired_resolution": desired_resolution},
        )
        return Response(
            {
                "ok": True,
                "dispute": {
                    "id": dispute.id,
                    "status": dispute.status,
                    "status_label": _safe_text(dispute.status).replace("_", " ").title(),
                    "public_url": _portal_dispute_public_url(dispute),
                    "reason": dispute.reason,
                },
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_201_CREATED,
        )


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
            sync_customer_request_agreement_links(
                intake=source_intake,
                agreement=agreement,
                project=getattr(agreement, "project", None),
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


class CustomerPortalReviewSubmitView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token: str, agreement_id: int):
        try:
            email = _unsign_portal_token(token)
        except signing.SignatureExpired:
            return Response({"detail": "This portal link has expired."}, status=status.HTTP_403_FORBIDDEN)
        except signing.BadSignature:
            return Response({"detail": "Invalid portal link."}, status=status.HTTP_403_FORBIDDEN)

        agreement = get_object_or_404(
            Agreement.objects.select_related("project", "homeowner", "contractor", "contractor__public_profile"),
            Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email),
            pk=agreement_id,
        )
        try:
            review = submit_customer_review(
                agreement=agreement,
                customer_email=email,
                customer_name=request.data.get("customer_name") or getattr(getattr(agreement, "homeowner", None), "full_name", ""),
                rating=request.data.get("rating"),
                title=request.data.get("title", ""),
                review_text=request.data.get("review_text", ""),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": "Thanks for your feedback. It will appear publicly after review.",
                "review": serialize_review(review),
                "portal": _build_customer_portal_payload(email, request=request),
            },
            status=status.HTTP_201_CREATED,
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
                "detail": "Reimbursement approved and released." if expense.status == ExpenseRequest.Status.RELEASED else "Reimbursement approved and queued for escrow release.",
                "reimbursement_id": expense.id,
                "status": expense.status,
                "stripe_transfer_id": expense.stripe_transfer_id,
                "release_error": expense.release_error,
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
