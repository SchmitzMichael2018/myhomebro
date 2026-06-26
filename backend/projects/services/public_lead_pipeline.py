from __future__ import annotations

from decimal import Decimal
from typing import Optional

from projects.models import Notification
from projects.models import ContractorPublicProfile, PublicContractorLead
from projects.services.customer_lifecycle import upsert_customer_for_public_lead
from projects.services.notification_center import create_notification


LEGACY_SOURCE_ALIASES = {
    "website": PublicContractorLead.SOURCE_WEBSITE,
    "website_contact": PublicContractorLead.SOURCE_WEBSITE,
    "website_quote": PublicContractorLead.SOURCE_WEBSITE,
    "website_quote_cta": PublicContractorLead.SOURCE_WEBSITE,
    "profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
    "public_profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
    "quote_request": PublicContractorLead.SOURCE_QUOTE_REQUEST,
    "request_quote": PublicContractorLead.SOURCE_QUOTE_REQUEST,
    "landing_page": PublicContractorLead.SOURCE_LANDING_PAGE,
    "manual": PublicContractorLead.SOURCE_MANUAL,
    "qr": PublicContractorLead.SOURCE_QR,
    "contractor_sent_form": PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM,
    "direct": PublicContractorLead.SOURCE_DIRECT,
}

PUBLIC_LEAD_SOURCE_LABELS = {
    PublicContractorLead.SOURCE_WEBSITE: "Website",
    PublicContractorLead.SOURCE_QUOTE_REQUEST: "Website",
    PublicContractorLead.SOURCE_LANDING_PAGE: "Website",
    PublicContractorLead.SOURCE_PUBLIC_PROFILE: "Public Profile",
    PublicContractorLead.SOURCE_QR: "QR Code",
    PublicContractorLead.SOURCE_MANUAL: "Manual",
    PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM: "Manual",
    PublicContractorLead.SOURCE_DIRECT: "Manual",
}

WEBSITE_LEAD_SOURCES = {
    PublicContractorLead.SOURCE_WEBSITE,
    PublicContractorLead.SOURCE_QUOTE_REQUEST,
    PublicContractorLead.SOURCE_LANDING_PAGE,
    PublicContractorLead.SOURCE_PUBLIC_PROFILE,
    PublicContractorLead.SOURCE_QR,
}


def normalize_public_lead_source(
    value: Optional[str],
    *,
    default: str = PublicContractorLead.SOURCE_DIRECT,
) -> str:
    normalized = str(value or "").strip().lower()
    return LEGACY_SOURCE_ALIASES.get(normalized, default)


def public_lead_source_label(source: Optional[str]) -> str:
    normalized = normalize_public_lead_source(source, default=PublicContractorLead.SOURCE_DIRECT)
    return PUBLIC_LEAD_SOURCE_LABELS.get(normalized, "Manual")


def is_website_sales_lead(lead) -> bool:
    source = normalize_public_lead_source(
        getattr(lead, "source", None),
        default=PublicContractorLead.SOURCE_DIRECT,
    )
    return source in WEBSITE_LEAD_SOURCES


def website_lead_filter_key(source: Optional[str]) -> str:
    normalized = normalize_public_lead_source(source, default=PublicContractorLead.SOURCE_DIRECT)
    if normalized == PublicContractorLead.SOURCE_QR:
        return "qr"
    if normalized == PublicContractorLead.SOURCE_PUBLIC_PROFILE:
        return "public_profile"
    if normalized in {PublicContractorLead.SOURCE_WEBSITE, PublicContractorLead.SOURCE_QUOTE_REQUEST, PublicContractorLead.SOURCE_LANDING_PAGE}:
        return "website"
    return "manual"


def create_public_lead_sales_notification(lead):
    if lead is None or not is_website_sales_lead(lead):
        return None, False

    contractor = getattr(lead, "contractor", None)
    source_key = website_lead_filter_key(getattr(lead, "source", ""))
    customer_name = (getattr(lead, "full_name", "") or "").strip() or "a customer"
    project_type = (getattr(lead, "project_type", "") or "").strip()
    details = f" Lead: {customer_name}."
    if project_type:
        details += f" Project type: {project_type}."
    return create_notification(
        contractor=contractor,
        user=getattr(contractor, "user", None),
        category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
        title="New website lead",
        body=f"Hey, you got a new lead from your website.{details}",
        link=f"/app/opportunities?source={source_key}",
        public_lead=lead,
        actor_display_name=customer_name,
        actor_email=(getattr(lead, "email", "") or "").strip(),
    )


def ensure_public_profile_for_contractor(contractor):
    profile = getattr(contractor, "public_profile", None)
    if profile is not None:
        return profile
    return ContractorPublicProfile.objects.create(
        contractor=contractor,
        business_name_public=contractor.business_name or contractor.name or "",
        city=contractor.city or "",
        state=contractor.state or "",
        phone_public=contractor.phone or "",
        email_public=contractor.email or "",
    )


def _project_address_from_intake(intake) -> str:
    parts = [
        (intake.project_address_line1 or "").strip(),
        (intake.project_address_line2 or "").strip(),
    ]
    return ", ".join([part for part in parts if part])


def _format_budget(amount) -> str:
    try:
        if amount in (None, "", False):
            return ""
        value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
        return f"${value:,.2f}"
    except Exception:
        return ""


def sync_public_lead_from_project_intake(intake, *, status_override=None):
    contractor = getattr(intake, "contractor", None)
    if contractor is None:
        return None

    profile = getattr(intake, "public_profile", None) or ensure_public_profile_for_contractor(
        contractor
    )
    lead = getattr(intake, "public_lead", None)
    analysis = getattr(intake, "ai_analysis_payload", None) or getattr(lead, "ai_analysis", {}) or {}

    normalized_source = normalize_public_lead_source(getattr(intake, "lead_source", None))
    original_description = (getattr(intake, "accomplishment_text", "") or "").strip()
    refined_description = (getattr(intake, "ai_description", "") or "").strip()
    payload = {
        "contractor": contractor,
        "public_profile": profile,
        "source": normalized_source,
        "full_name": (intake.customer_name or "").strip() or "Project Intake Lead",
        "email": (intake.customer_email or "").strip(),
        "phone": (intake.customer_phone or "").strip(),
        "project_address": _project_address_from_intake(intake),
        "city": (intake.project_city or "").strip(),
        "state": (intake.project_state or "").strip(),
        "zip_code": (intake.project_postal_code or "").strip(),
        "project_type": (getattr(intake, "ai_project_type", "") or "").strip(),
        "project_description": original_description or refined_description,
        "preferred_timeline": (
            (getattr(intake, "desired_timing_text", "") or "").strip()
            or (
                f"{int(getattr(intake, 'ai_project_timeline_days', 0) or 0)} days"
                if getattr(intake, "ai_project_timeline_days", None)
                else ""
            )
        ),
        "budget_text": _format_budget(getattr(intake, "ai_project_budget", None)),
        "ai_analysis": {
            **analysis,
            "property_type": (getattr(intake, "property_type", "") or "").strip(),
            "budget_range_text": (getattr(intake, "budget_range_text", "") or "").strip(),
            "desired_timing_text": (getattr(intake, "desired_timing_text", "") or "").strip(),
            "original_description": original_description,
            "refined_description": refined_description,
            "project_scope_summary": refined_description or original_description or analysis.get("project_scope_summary", ""),
            "preferred_contact_method": (getattr(intake, "preferred_contact_method", "") or "").strip(),
            "contact_consent": bool(getattr(intake, "contact_consent", False)),
            "request_path_label": "Request a Quote"
            if normalized_source in {PublicContractorLead.SOURCE_WEBSITE, PublicContractorLead.SOURCE_QUOTE_REQUEST}
            else analysis.get("request_path_label", ""),
        },
        "status": status_override or PublicContractorLead.STATUS_NEW,
    }

    if lead is None:
        lead = PublicContractorLead.objects.create(**payload)
        intake.public_lead = lead
        intake.public_profile = profile
        intake.save(update_fields=["public_lead", "public_profile", "updated_at"])
        upsert_customer_for_public_lead(lead, source=normalized_source)
        create_public_lead_sales_notification(lead)
        return lead

    update_fields = [
        "contractor",
        "public_profile",
        "source",
        "full_name",
        "email",
        "phone",
        "project_address",
        "city",
        "state",
        "zip_code",
        "project_type",
        "project_description",
        "preferred_timeline",
        "budget_text",
        "ai_analysis",
        "status",
        "updated_at",
    ]

    for key, value in payload.items():
        if key == "status" and status_override is None:
            continue
        if (
            key == "status"
            and normalized_source == PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM
            and lead.status
            in {
                PublicContractorLead.STATUS_ACCEPTED,
                PublicContractorLead.STATUS_REJECTED,
                PublicContractorLead.STATUS_CONTACTED,
                PublicContractorLead.STATUS_QUALIFIED,
                PublicContractorLead.STATUS_CLOSED,
                PublicContractorLead.STATUS_ARCHIVED,
            }
            and value
            in {
                PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
                PublicContractorLead.STATUS_READY_FOR_REVIEW,
            }
        ):
            continue
        setattr(lead, key, value)
    lead.save(update_fields=update_fields)
    if intake.public_profile_id != profile.id:
        intake.public_profile = profile
        intake.save(update_fields=["public_profile", "updated_at"])
    upsert_customer_for_public_lead(lead, source=normalized_source)
    create_public_lead_sales_notification(lead)
    return lead
