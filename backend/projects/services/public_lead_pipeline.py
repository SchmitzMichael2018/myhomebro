from __future__ import annotations

from decimal import Decimal
from typing import Optional

from projects.models import ContractorPublicProfile, PublicContractorLead


LEGACY_SOURCE_ALIASES = {
    "profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
    "public_profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
    "landing_page": PublicContractorLead.SOURCE_LANDING_PAGE,
    "manual": PublicContractorLead.SOURCE_MANUAL,
    "qr": PublicContractorLead.SOURCE_QR,
    "contractor_sent_form": PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM,
    "direct": PublicContractorLead.SOURCE_DIRECT,
}


def normalize_public_lead_source(
    value: Optional[str],
    *,
    default: str = PublicContractorLead.SOURCE_DIRECT,
) -> str:
    normalized = str(value or "").strip().lower()
    return LEGACY_SOURCE_ALIASES.get(normalized, default)


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
        "project_description": (intake.accomplishment_text or "").strip(),
        "preferred_timeline": (
            f"{int(getattr(intake, 'ai_project_timeline_days', 0) or 0)} days"
            if getattr(intake, "ai_project_timeline_days", None)
            else ""
        ),
        "budget_text": _format_budget(getattr(intake, "ai_project_budget", None)),
        "ai_analysis": analysis,
        "status": status_override or PublicContractorLead.STATUS_NEW,
    }

    if lead is None:
        lead = PublicContractorLead.objects.create(**payload)
        intake.public_lead = lead
        intake.public_profile = profile
        intake.save(update_fields=["public_lead", "public_profile", "updated_at"])
        return lead

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
        lead.save(
        update_fields=[
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
    )
    if intake.public_profile_id != profile.id:
        intake.public_profile = profile
        intake.save(update_fields=["public_profile", "updated_at"])
    return lead
