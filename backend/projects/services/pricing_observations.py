# backend/projects/services/pricing_observations.py
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from django.utils import timezone

from projects.models_templates import PricingObservation


def _safe_str(value) -> str:
    return str(value or "").strip()


def normalize_milestone_type(title: str = "", description: str = "") -> str:
    blob = f"{_safe_str(title)} {_safe_str(description)}".lower()

    rules = [
        (("demo", "demolition", "tear out", "tear-out"), "demolition"),
        (("site prep", "site preparation", "prep"), "site_preparation"),
        (("frame", "framing"), "framing"),
        (("foundation", "footing", "footings"), "foundation"),
        (("roof tear off", "tear-off"), "roof_removal"),
        (("roof install", "shingle install", "shingle installation"), "roof_installation"),
        (("siding",), "siding"),
        (("drywall", "sheetrock"), "drywall"),
        (("paint", "painting"), "painting"),
        (("tile install", "tile installation", "tiling"), "tile_installation"),
        (("flooring", "floor install", "flooring installation"), "flooring_installation"),
        (("electrical rough", "rough electrical"), "electrical_rough_in"),
        (("plumbing rough", "rough plumbing"), "plumbing_rough_in"),
        (("trim", "finish trim"), "trim_installation"),
        (("cabinet", "cabinet install"), "cabinet_installation"),
        (("vanity", "vanity install"), "vanity_installation"),
        (("cleanup", "clean up", "final clean"), "cleanup"),
        (("final walkthrough", "walkthrough", "final inspection"), "final_walkthrough"),
    ]

    for keywords, normalized in rules:
        if any(k in blob for k in keywords):
            return normalized

    fallback = _safe_str(title).lower().replace("/", " ").replace("-", " ")
    fallback = "_".join(part for part in fallback.split() if part)
    return fallback[:128] or "general_milestone"


def _agreement_total(agreement) -> Decimal:
    for field in ("total_cost", "contract_price", "amount", "project_total"):
        val = getattr(agreement, field, None)
        if val is not None:
            try:
                return Decimal(str(val))
            except Exception:
                pass
    return Decimal("0.00")


def _invoice_amount(invoice) -> Decimal:
    val = getattr(invoice, "amount", None)
    if val is None:
        return Decimal("0.00")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0.00")


def _milestone_day_offset(milestone) -> Optional[int]:
    if milestone is None:
        return None

    for field in ("day_offset", "days_from_start", "recommended_days_from_start", "order"):
        val = getattr(milestone, field, None)
        if isinstance(val, int) and val >= 0:
            return val
    return None


def _milestone_duration_days(milestone) -> Optional[int]:
    if milestone is None:
        return None

    for field in ("duration_days", "recommended_duration_days"):
        val = getattr(milestone, field, None)
        if isinstance(val, int) and val >= 0:
            return val
    return None


def record_pricing_observation_for_invoice(invoice, paid_at=None) -> PricingObservation | None:
    """
    Create one pricing observation for a truly paid invoice.
    Safe to call multiple times; avoids duplicates.
    """
    if invoice is None:
        return None

    agreement = getattr(invoice, "agreement", None)
    if agreement is None:
        return None

    milestone = getattr(invoice, "source_milestone", None) or getattr(invoice, "milestone", None)
    contractor = getattr(agreement, "contractor", None) or getattr(getattr(agreement, "project", None), "contractor", None)

    project_type = _safe_str(getattr(agreement, "project_type", None))
    project_subtype = _safe_str(getattr(agreement, "project_subtype", None))

    title = ""
    description = ""

    if milestone is not None:
        title = _safe_str(getattr(milestone, "title", None))
        description = _safe_str(getattr(milestone, "description", None))

    if not title:
        title = _safe_str(getattr(invoice, "milestone_title_snapshot", None)) or "Milestone"

    if not description:
        description = _safe_str(getattr(invoice, "milestone_description_snapshot", None))

    normalized_type = normalize_milestone_type(title=title, description=description)

    amount = _invoice_amount(invoice)
    if amount <= 0:
        return None

    state = _safe_str(getattr(agreement, "address_state", None))
    city = _safe_str(getattr(agreement, "address_city", None))
    postal_code = _safe_str(getattr(agreement, "address_postal_code", None))

    existing = PricingObservation.objects.filter(
        agreement=agreement,
        milestone=milestone,
        normalized_milestone_type=normalized_type,
        amount=amount,
    ).first()
    if existing:
        return existing

    observation = PricingObservation.objects.create(
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        region_state=state,
        region_city=city,
        postal_code=postal_code,
        project_type=project_type,
        project_subtype=project_subtype,
        normalized_milestone_type=normalized_type,
        milestone_title_snapshot=title,
        milestone_description_snapshot=description,
        amount=amount,
        agreement_total=_agreement_total(agreement),
        estimated_days=getattr(agreement, "estimated_days", None) or 0,
        milestone_days_from_start=_milestone_day_offset(milestone),
        milestone_duration_days=_milestone_duration_days(milestone),
        paid_at=paid_at or timezone.now(),
    )
    return observation