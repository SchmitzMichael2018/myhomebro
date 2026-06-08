from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any, Iterable

from django.db import transaction
from django.utils import timezone

from projects.models import (
    Agreement,
    AgreementPaymentMode,
    AgreementProjectClass,
    Homeowner,
    Milestone,
    Project,
    PublicContractorLead,
)
from projects.models_templates import ProjectTemplate
from projects.services.sms_service import ensure_sms_consent

COMMERCIAL_HINTS = {
    "commercial",
    "office",
    "retail",
    "restaurant",
    "warehouse",
    "industrial",
    "tenant",
    "tenant improvement",
    "tenant buildout",
    "buildout",
    "multi family",
    "multifamily",
    "apartment",
    "hoa",
    "association",
    "property manager",
    "property management",
    "business",
    "storefront",
    "facility",
    "campus",
    "school",
    "church",
    "clinic",
}


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _joined_text(parts: Iterable[Any]) -> str:
    return " ".join(_safe_text(part) for part in parts if _safe_text(part)).lower()


def infer_project_class(*parts: Any, default: str = AgreementProjectClass.RESIDENTIAL) -> str:
    text = _joined_text(parts)
    if not text:
        return default
    if any(keyword in text for keyword in COMMERCIAL_HINTS):
        return AgreementProjectClass.COMMERCIAL
    return AgreementProjectClass.RESIDENTIAL


def project_class_label(value: Any) -> str:
    normalized = _safe_text(value).lower()
    if normalized == AgreementProjectClass.COMMERCIAL:
        return "Commercial"
    return "Residential"


def normalize_bid_status(*, raw_status: Any = "", has_agreement: bool = False, record_kind: str = "") -> str:
    status = _safe_text(raw_status).lower()
    kind = _safe_text(record_kind).lower()

    if has_agreement or status == PublicContractorLead.STATUS_ACCEPTED:
        return "awarded"
    if status in {PublicContractorLead.STATUS_REJECTED}:
        return "declined"
    if status in {PublicContractorLead.STATUS_CLOSED, PublicContractorLead.STATUS_ARCHIVED}:
        return "expired"
    if status in {getattr(PublicContractorLead, "STATUS_FOLLOW_UP", "follow_up")}:
        return "follow_up"
    if status in {
        PublicContractorLead.STATUS_READY_FOR_REVIEW,
        PublicContractorLead.STATUS_CONTACTED,
        PublicContractorLead.STATUS_QUALIFIED,
        "analyzed",
    }:
        return "under_review"
    if status in {
        PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
        PublicContractorLead.STATUS_NEW,
        "submitted",
    }:
        return "submitted"
    if status in {"draft", "created"}:
        return "draft"
    if kind == "intake":
        return "draft"
    return "under_review"


def bid_status_label(status: str) -> str:
    normalized = _safe_text(status).lower()
    return {
        "draft": "Draft",
        "submitted": "Submitted",
        "follow_up": "Follow-Up",
        "under_review": "Under Review",
        "awarded": "Awarded",
        "declined": "Declined",
        "expired": "Expired",
    }.get(normalized, "Under Review")


def bid_status_group(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized in {"draft", "submitted"}:
        return "open"
    if normalized == "follow_up":
        return "follow_up"
    if normalized == "under_review":
        return "under_review"
    if normalized == "awarded":
        return "awarded"
    return "declined_expired"


def format_money(value: Any) -> str:
    try:
        amount = Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except Exception:
        amount = Decimal("0.00")
    return f"{amount:.2f}"


def parse_money_like_text(value: Any) -> Decimal | None:
    text = _safe_text(value)
    if not text:
        return None

    cleaned = (
        text.replace("$", "")
        .replace(",", "")
        .replace("USD", "")
        .replace("usd", "")
        .strip()
    )
    try:
        amount = Decimal(cleaned)
    except Exception:
        return None
    if amount < 0:
        return None
    return amount.quantize(Decimal("0.01"))


def bid_next_action(*, status: str, linked_agreement_id: int | None, source_kind: str) -> dict[str, Any]:
    normalized = _safe_text(status).lower()
    if normalized == "awarded":
        if linked_agreement_id:
            return {
                "key": "open_agreement",
                "label": "Open Agreement",
                "target": f"/app/agreements/{linked_agreement_id}",
            }
        return {
            "key": "convert_to_agreement",
            "label": "Convert to Agreement",
            "target": "",
        }
    if normalized == "under_review":
        return {
            "key": "review_bid",
            "label": "Review Bid",
            "target": "",
        }
    if normalized in {"draft", "submitted"}:
        return {
            "key": "review_bid",
            "label": "Review Bid",
            "target": "",
        }
    return {
        "key": "view_details",
        "label": "View Details",
        "target": "",
    }


def record_source_label(record_kind: str) -> str:
    return "Lead" if _safe_text(record_kind).lower() == "lead" else "Intake"


def sync_bid_agreement_links(*, agreement, lead=None, intake=None) -> None:
    now = timezone.now()

    if intake is not None:
        updates = []
        if getattr(intake, "agreement_id", None) != getattr(agreement, "id", None):
            intake.agreement = agreement
            updates.append("agreement")
        if getattr(intake, "status", "") != "converted":
            intake.status = "converted"
            updates.append("status")
        if getattr(intake, "converted_at", None) is None:
            intake.converted_at = now
            updates.append("converted_at")
        if updates:
            updates.append("updated_at")
            intake.save(update_fields=updates)

    if lead is not None:
        updates = []
        if getattr(lead, "converted_agreement_id", None) != getattr(agreement, "id", None):
            lead.converted_agreement = agreement
            updates.append("converted_agreement")
        if getattr(lead, "converted_at", None) is None:
            lead.converted_at = now
            updates.append("converted_at")
        if updates:
            updates.append("updated_at")
            lead.save(update_fields=updates)


def _source_intake_for_lead(lead):
    source_intake = getattr(lead, "source_intake", None)
    if source_intake is not None:
        return source_intake
    analysis = getattr(lead, "ai_analysis", None) or {}
    source_intake_id = analysis.get("source_intake_id")
    if not source_intake_id:
        return None
    try:
        from projects.models_project_intake import ProjectIntake

        return ProjectIntake.objects.filter(pk=source_intake_id).first()
    except Exception:
        return None


def _agreement_payment_mode_from_intake(source_intake) -> str:
    preference = _safe_text(getattr(source_intake, "payment_preference", "")).lower()
    if preference == "direct":
        return AgreementPaymentMode.DIRECT
    return AgreementPaymentMode.ESCROW


def _bid_amount_for_lead(lead, analysis: dict[str, Any]) -> Decimal:
    amount = (
        parse_money_like_text(getattr(lead, "budget_text", ""))
        or parse_money_like_text(analysis.get("suggested_total_price"))
        or Decimal("0.00")
    )
    return Decimal(str(amount or "0")).quantize(Decimal("0.01"))


def _milestone_amount_from_row(row: dict[str, Any], total: Decimal, count: int) -> Decimal:
    explicit = (
        row.get("amount")
        or row.get("price")
        or row.get("suggested_amount")
        or row.get("template_suggested_amount")
        or row.get("ai_suggested_amount")
    )
    parsed = parse_money_like_text(explicit)
    if parsed is not None and parsed > 0:
        return parsed
    if total > 0 and count > 0:
        return (total / Decimal(count)).quantize(Decimal("0.01"))
    return Decimal("0.00")


def _duration_from_row(row: dict[str, Any]):
    days = row.get("duration_days") or row.get("recommended_days") or row.get("recommended_days_from_start")
    try:
        days_int = int(days)
    except Exception:
        return None
    if days_int <= 0:
        return None
    return timedelta(days=days_int)


def _normalized_milestone_rows(*, lead, source_intake, analysis: dict[str, Any]) -> list[dict[str, Any]]:
    raw_rows = analysis.get("milestones")
    if not raw_rows and source_intake is not None:
        raw_rows = getattr(source_intake, "ai_milestones", None)
    if not isinstance(raw_rows, list):
        return []

    rows: list[dict[str, Any]] = []
    for index, row in enumerate(raw_rows, start=1):
        if not isinstance(row, dict):
            continue
        title = _safe_text(row.get("title") or row.get("name"))
        description = _safe_text(row.get("description") or row.get("scope") or row.get("details"))
        if not title and not description:
            continue
        rows.append(
            {
                "order": row.get("order") or index,
                "title": title or f"Milestone {index}",
                "description": description,
                "amount": row.get("amount")
                or row.get("price")
                or row.get("suggested_amount")
                or row.get("template_suggested_amount")
                or row.get("ai_suggested_amount"),
                "duration": _duration_from_row(row),
                "normalized_milestone_type": _safe_text(row.get("normalized_milestone_type")),
                "milestone_role": _safe_text(row.get("milestone_role")),
            }
        )
    return rows


def _ensure_bid_agreement_milestones(*, agreement, lead, source_intake, analysis: dict[str, Any], total: Decimal) -> None:
    if getattr(agreement, "milestones", None) is not None and agreement.milestones.exists():
        return

    rows = _normalized_milestone_rows(lead=lead, source_intake=source_intake, analysis=analysis)
    if not rows:
        rows = [
            {
                "order": 1,
                "title": "Project Completion",
                "description": (
                    _safe_text(analysis.get("suggested_description"))
                    or _safe_text(analysis.get("project_scope_summary"))
                    or _safe_text(getattr(lead, "project_description", ""))
                    or "Complete the awarded project scope from the marketplace bid."
                ),
                "amount": total,
                "duration": None,
                "normalized_milestone_type": "completion",
                "milestone_role": "",
            }
        ]

    count = len(rows)
    created = []
    running_total = Decimal("0.00")
    for index, row in enumerate(rows, start=1):
        amount = _milestone_amount_from_row(row, total, count)
        if total > 0 and index == count:
            remaining = total - running_total
            if remaining >= 0:
                amount = remaining.quantize(Decimal("0.01"))
        running_total += amount
        created.append(
            Milestone(
                agreement=agreement,
                order=index,
                title=row["title"],
                description=row["description"],
                amount=amount,
                duration=row.get("duration"),
                normalized_milestone_type=row.get("normalized_milestone_type", ""),
                milestone_role=row.get("milestone_role", ""),
                ai_suggested_amount=amount if amount > 0 else None,
                pricing_source_note="Marketplace awarded bid",
            )
        )

    if created:
        Milestone.objects.bulk_create(created)
        agreement.milestone_count = len(created)
        agreement.save(update_fields=["milestone_count", "updated_at"])


def _ensure_homeowner_for_public_lead(*, lead, homeowner=None):
    source_intake = _source_intake_for_lead(lead)
    analysis = getattr(lead, "ai_analysis", None) or {}
    consent_requested = bool(
        getattr(source_intake, "contact_consent", False)
        or analysis.get("contact_consent")
    )
    if homeowner is not None:
        if consent_requested and _safe_text(getattr(homeowner, "phone_number", "")):
            try:
                ensure_sms_consent(
                    phone_number=getattr(homeowner, "phone_number", ""),
                    homeowner=homeowner,
                    contractor=getattr(lead, "contractor", None),
                    source="agreement",
                    consent_text_snapshot="Customer consent captured during quote request.",
                    consent_source_page=getattr(getattr(lead, "public_profile", None), "public_url_path", "") or "",
                )
            except Exception:
                pass
        return homeowner
    if not getattr(lead, "email", ""):
        return None

    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None

    existing = contractor.homeowners.filter(email__iexact=lead.email).first()
    if existing is not None:
        return existing

    homeowner = Homeowner.objects.create(
        created_by=contractor,
        full_name=_safe_text(getattr(lead, "full_name", "")) or "Customer",
        email=_safe_text(getattr(lead, "email", "")),
        phone_number=_safe_text(getattr(lead, "phone", "")),
        street_address=_safe_text(getattr(lead, "project_address", "")),
        city=_safe_text(getattr(lead, "city", "")),
        state=_safe_text(getattr(lead, "state", "")),
        zip_code=_safe_text(getattr(lead, "zip_code", "")),
        status="active",
    )
    if consent_requested and _safe_text(getattr(homeowner, "phone_number", "")):
        try:
            ensure_sms_consent(
                phone_number=getattr(homeowner, "phone_number", ""),
                homeowner=homeowner,
                contractor=contractor,
                source="agreement",
                consent_text_snapshot="Customer consent captured during quote request.",
                consent_source_page=getattr(getattr(lead, "public_profile", None), "public_url_path", "") or "",
            )
        except Exception:
            pass
    return homeowner


def promote_public_lead_to_agreement(*, lead, homeowner=None):
    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None, False

    if getattr(lead, "converted_agreement_id", None):
        agreement = lead.converted_agreement
        source_intake = _source_intake_for_lead(lead)
        if source_intake is not None:
            sync_bid_agreement_links(agreement=agreement, lead=lead, intake=source_intake)
        return agreement, False

    homeowner = _ensure_homeowner_for_public_lead(lead=lead, homeowner=homeowner)
    if homeowner is None:
        return None, False

    source_intake = _source_intake_for_lead(lead)
    analysis = (
        getattr(source_intake, "ai_analysis_payload", None)
        if source_intake is not None
        else None
    ) or getattr(lead, "ai_analysis", None) or {}
    title = (
        _safe_text(getattr(source_intake, "ai_project_title", "")) if source_intake is not None else ""
    ) or (
        _safe_text(analysis.get("suggested_title"))
        or _safe_text(getattr(lead, "project_type", ""))
        or "Draft Agreement"
    )
    description = (
        _safe_text(getattr(source_intake, "ai_description", "")) if source_intake is not None else ""
    ) or (
        _safe_text(analysis.get("suggested_description"))
        or _safe_text(analysis.get("project_scope_summary"))
        or _safe_text(analysis.get("refined_description"))
        or _safe_text(getattr(lead, "project_description", ""))
        or "Draft agreement from public lead."
    )
    project_type = (
        _safe_text(getattr(source_intake, "ai_project_type", "")) if source_intake is not None else ""
    ) or _safe_text(analysis.get("project_type")) or _safe_text(getattr(lead, "project_type", ""))
    project_subtype = (
        _safe_text(getattr(source_intake, "ai_project_subtype", "")) if source_intake is not None else ""
    ) or _safe_text(analysis.get("project_subtype", ""))
    template_id = analysis.get("template_id")
    bid_total = _bid_amount_for_lead(lead, analysis)
    selected_template = None
    if template_id:
        selected_template = (
            ProjectTemplate.objects.filter(pk=template_id, contractor=contractor, is_active=True).first()
            or ProjectTemplate.objects.filter(
                pk=template_id,
                is_system_template=True,
                is_published=True,
                is_active=True,
            ).first()
        )

    with transaction.atomic():
        project = Project.objects.create(
            contractor=contractor,
            homeowner=homeowner,
            title=title,
            description=description,
            project_street_address=(
                _safe_text(getattr(source_intake, "project_address_line1", "")) if source_intake is not None else _safe_text(getattr(lead, "project_address", ""))
            ),
            project_city=(
                _safe_text(getattr(source_intake, "project_city", "")) if source_intake is not None else _safe_text(getattr(lead, "city", ""))
            ),
            project_state=(
                _safe_text(getattr(source_intake, "project_state", "")) if source_intake is not None else _safe_text(getattr(lead, "state", ""))
            ),
            project_zip_code=(
                _safe_text(getattr(source_intake, "project_postal_code", "")) if source_intake is not None else _safe_text(getattr(lead, "zip_code", ""))
            ),
            status="draft",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=homeowner,
            description=description,
            project_address_line1=(
                _safe_text(getattr(source_intake, "project_address_line1", "")) if source_intake is not None else _safe_text(getattr(lead, "project_address", ""))
            ),
            project_address_line2=(
                _safe_text(getattr(source_intake, "project_address_line2", "")) if source_intake is not None else ""
            ),
            project_address_city=(
                _safe_text(getattr(source_intake, "project_city", "")) if source_intake is not None else _safe_text(getattr(lead, "city", ""))
            ),
            project_address_state=(
                _safe_text(getattr(source_intake, "project_state", "")) if source_intake is not None else _safe_text(getattr(lead, "state", ""))
            ),
            project_postal_code=(
                _safe_text(getattr(source_intake, "project_postal_code", "")) if source_intake is not None else _safe_text(getattr(lead, "zip_code", ""))
            ),
            status="draft",
            step_status="marketplace_award_draft",
            total_cost=bid_total,
            payment_mode=_agreement_payment_mode_from_intake(source_intake),
            project_type=project_type,
            project_subtype=project_subtype,
            selected_template=selected_template,
            selected_template_name_snapshot=getattr(selected_template, "name", "") or "",
            source_lead=lead,
            collaboration_summary_snapshot={
                "source": "marketplace_award",
                "source_label": "Marketplace awarded bid",
                "source_lead_id": getattr(lead, "id", None),
                "source_intake_id": getattr(source_intake, "id", None),
                "contractor_opportunity_id": analysis.get("contractor_opportunity_id"),
                "marketplace_invite_id": analysis.get("marketplace_invite_id"),
                "awarded_at": timezone.now().isoformat(),
            },
            project_class=infer_project_class(
                project_type,
                project_subtype,
                description,
                getattr(lead, "project_description", ""),
                getattr(lead, "project_type", ""),
            ),
        )
        lead.converted_homeowner = homeowner
        lead.status = PublicContractorLead.STATUS_ACCEPTED
        if getattr(lead, "accepted_at", None) is None:
            lead.accepted_at = timezone.now()
        if getattr(lead, "converted_at", None) is None:
            lead.converted_at = timezone.now()
        updates = ["converted_homeowner", "status", "accepted_at", "converted_at", "updated_at"]
        lead.save(update_fields=updates)
        sync_bid_agreement_links(agreement=agreement, lead=lead, intake=source_intake)
        _ensure_bid_agreement_milestones(
            agreement=agreement,
            lead=lead,
            source_intake=source_intake,
            analysis=analysis,
            total=bid_total,
        )
    return agreement, True
