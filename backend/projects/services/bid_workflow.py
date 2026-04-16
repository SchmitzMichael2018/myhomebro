from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable

from django.utils import timezone

from projects.models import AgreementProjectClass, PublicContractorLead

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
        "under_review": "Under Review",
        "awarded": "Awarded",
        "declined": "Declined",
        "expired": "Expired",
    }.get(normalized, "Under Review")


def bid_status_group(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized in {"draft", "submitted"}:
        return "open"
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
