# backend/projects/services/template_pricing.py
from __future__ import annotations

from decimal import Decimal
from typing import Any

from projects.models_templates import (
    MarketPricingBaseline,
    PricingStatistic,
    ProjectTemplate,
    ProjectTemplateMilestone,
)
from projects.services.pricing_observations import normalize_milestone_type


def _d(value, default: str = "0.00") -> Decimal:
    try:
        if value is None:
            return Decimal(default)
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _pick_best_stat(
    *,
    scope: str,
    project_type: str,
    project_subtype: str,
    normalized_milestone_type: str,
    contractor=None,
    region_state: str = "",
    region_city: str = "",
):
    qs = PricingStatistic.objects.filter(
        scope=scope,
        project_type=project_type or "",
        project_subtype=project_subtype or "",
        normalized_milestone_type=normalized_milestone_type or "",
    )

    if scope == "contractor":
        qs = qs.filter(contractor=contractor)
    else:
        qs = qs.filter(
            region_state=region_state or "",
            region_city=region_city or "",
        )

    stat = qs.order_by("-sample_size", "-updated_at").first()
    if stat:
        return stat

    # fallback: same scope but ignore subtype
    qs = PricingStatistic.objects.filter(
        scope=scope,
        project_type=project_type or "",
        normalized_milestone_type=normalized_milestone_type or "",
    )

    if scope == "contractor":
        qs = qs.filter(contractor=contractor)
    else:
        qs = qs.filter(
            region_state=region_state or "",
            region_city=region_city or "",
        )

    return qs.order_by("-sample_size", "-updated_at").first()


def _pick_best_baseline(
    *,
    project_type: str,
    project_subtype: str,
    normalized_milestone_type: str,
    region_state: str = "",
    region_city: str = "",
):
    qs = MarketPricingBaseline.objects.filter(
        is_active=True,
        project_type=project_type or "",
        project_subtype=project_subtype or "",
        normalized_milestone_type=normalized_milestone_type or "",
        region_state=region_state or "",
        region_city=region_city or "",
    )
    baseline = qs.order_by("-updated_at").first()
    if baseline:
        return baseline

    qs = MarketPricingBaseline.objects.filter(
        is_active=True,
        project_type=project_type or "",
        normalized_milestone_type=normalized_milestone_type or "",
        region_state=region_state or "",
        region_city=region_city or "",
    )
    baseline = qs.order_by("-updated_at").first()
    if baseline:
        return baseline

    qs = MarketPricingBaseline.objects.filter(
        is_active=True,
        project_type=project_type or "",
        normalized_milestone_type=normalized_milestone_type or "",
        region_state=region_state or "",
        region_city="",
    )
    baseline = qs.order_by("-updated_at").first()
    if baseline:
        return baseline

    qs = MarketPricingBaseline.objects.filter(
        is_active=True,
        project_type=project_type or "",
        normalized_milestone_type=normalized_milestone_type or "",
        region_state="",
        region_city="",
    )
    return qs.order_by("-updated_at").first()


def _template_defaults_for_milestone(m: ProjectTemplateMilestone) -> dict[str, Decimal]:
    fixed = _d(getattr(m, "suggested_amount_fixed", None))
    low = _d(getattr(m, "suggested_amount_low", None))
    high = _d(getattr(m, "suggested_amount_high", None))

    if fixed > 0:
        if low <= 0:
            low = (fixed * Decimal("0.85")).quantize(Decimal("0.01"))
        if high <= 0:
            high = (fixed * Decimal("1.15")).quantize(Decimal("0.01"))

    return {
        "suggested_amount": fixed if fixed > 0 else Decimal("0.00"),
        "low_amount": low if low > 0 else Decimal("0.00"),
        "high_amount": high if high > 0 else Decimal("0.00"),
    }


def _blend_values(
    template_defaults: dict[str, Decimal],
    baseline=None,
    contractor_stat=None,
    market_stat=None,
) -> tuple[Decimal, Decimal, Decimal, str, str]:
    # Build candidate weighted sources
    candidates: list[tuple[Decimal, Decimal, Decimal, Decimal, str]] = []

    # Contractor history
    if contractor_stat and int(getattr(contractor_stat, "sample_size", 0) or 0) > 0:
        n = int(getattr(contractor_stat, "sample_size", 0) or 0)
        weight = Decimal("0.65") if n >= 5 else Decimal("0.40")
        candidates.append(
            (
                _d(getattr(contractor_stat, "median_amount", None)),
                _d(getattr(contractor_stat, "low_amount", None)),
                _d(getattr(contractor_stat, "high_amount", None)),
                weight,
                "Based on your contractor history",
            )
        )

    # Market stats
    if market_stat and int(getattr(market_stat, "sample_size", 0) or 0) > 0:
        n = int(getattr(market_stat, "sample_size", 0) or 0)
        weight = Decimal("0.35") if n >= 5 else Decimal("0.25")
        candidates.append(
            (
                _d(getattr(market_stat, "median_amount", None)),
                _d(getattr(market_stat, "low_amount", None)),
                _d(getattr(market_stat, "high_amount", None)),
                weight,
                "Based on market history",
            )
        )

    # Seeded market baseline
    if baseline:
        candidates.append(
            (
                _d(getattr(baseline, "median_amount", None)),
                _d(getattr(baseline, "low_amount", None)),
                _d(getattr(baseline, "high_amount", None)),
                Decimal("0.35"),
                _safe_str(getattr(baseline, "source_note", None)) or "Based on market baseline",
            )
        )

    # Template defaults
    if template_defaults["suggested_amount"] > 0:
        candidates.append(
            (
                template_defaults["suggested_amount"],
                template_defaults["low_amount"],
                template_defaults["high_amount"],
                Decimal("0.20"),
                "Based on template defaults",
            )
        )

    if not candidates:
        return Decimal("0.00"), Decimal("0.00"), Decimal("0.00"), "", "No pricing data available"

    total_weight = sum(weight for _, _, _, weight, _ in candidates) or Decimal("1.00")

    suggested = sum(amount * weight for amount, _, _, weight, _ in candidates) / total_weight
    low = sum(low_amount * weight for _, low_amount, _, weight, _ in candidates) / total_weight
    high = sum(high_amount * weight for _, _, high_amount, weight, _ in candidates) / total_weight

    suggested = suggested.quantize(Decimal("0.01"))
    low = low.quantize(Decimal("0.01"))
    high = high.quantize(Decimal("0.01"))

    # Confidence
    if contractor_stat and int(getattr(contractor_stat, "sample_size", 0) or 0) >= 5:
        confidence = "high"
    elif market_stat or baseline:
        confidence = "medium"
    elif template_defaults["suggested_amount"] > 0:
        confidence = "low"
    else:
        confidence = ""

    notes = []
    for _, _, _, _, note in candidates:
        if note and note not in notes:
            notes.append(note)

    return suggested, low, high, confidence, " + ".join(notes[:3])


def suggest_template_pricing(
    template: ProjectTemplate,
    *,
    contractor=None,
    region_state: str = "",
    region_city: str = "",
) -> list[dict[str, Any]]:
    """
    Return pricing suggestions for each milestone in a template.

    Priority/blend:
    1. Contractor pricing statistics
    2. Market pricing statistics
    3. Seeded market baselines
    4. Template defaults
    """
    if template is None:
        return []

    project_type = _safe_str(getattr(template, "project_type", None))
    project_subtype = _safe_str(getattr(template, "project_subtype", None))

    if contractor is None:
        contractor = getattr(template, "contractor", None)

    rows: list[dict[str, Any]] = []

    milestones = template.milestones.all().order_by("sort_order", "id")
    for m in milestones:
        normalized_type = _safe_str(getattr(m, "normalized_milestone_type", None))
        if not normalized_type:
            normalized_type = normalize_milestone_type(
                title=_safe_str(getattr(m, "title", None)),
                description=_safe_str(getattr(m, "description", None)),
            )

        contractor_stat = None
        if contractor is not None:
            contractor_stat = _pick_best_stat(
                scope="contractor",
                contractor=contractor,
                project_type=project_type,
                project_subtype=project_subtype,
                normalized_milestone_type=normalized_type,
            )

        market_stat = _pick_best_stat(
            scope="market",
            project_type=project_type,
            project_subtype=project_subtype,
            normalized_milestone_type=normalized_type,
            region_state=region_state,
            region_city=region_city,
        )

        baseline = _pick_best_baseline(
            project_type=project_type,
            project_subtype=project_subtype,
            normalized_milestone_type=normalized_type,
            region_state=region_state,
            region_city=region_city,
        )

        template_defaults = _template_defaults_for_milestone(m)

        suggested_amount, low_amount, high_amount, confidence, source_note = _blend_values(
            template_defaults=template_defaults,
            baseline=baseline,
            contractor_stat=contractor_stat,
            market_stat=market_stat,
        )

        rows.append(
            {
                "template_milestone_id": m.id,
                "sort_order": getattr(m, "sort_order", 0),
                "title": _safe_str(getattr(m, "title", None)),
                "description": _safe_str(getattr(m, "description", None)),
                "normalized_milestone_type": normalized_type,
                "current_amount": _d(getattr(m, "suggested_amount_fixed", None)),
                "current_low_amount": _d(getattr(m, "suggested_amount_low", None)),
                "current_high_amount": _d(getattr(m, "suggested_amount_high", None)),
                "suggested_amount": suggested_amount,
                "low_amount": low_amount,
                "high_amount": high_amount,
                "confidence": confidence,
                "source_note": source_note,
                "contractor_sample_size": int(getattr(contractor_stat, "sample_size", 0) or 0)
                if contractor_stat
                else 0,
                "market_sample_size": int(getattr(market_stat, "sample_size", 0) or 0)
                if market_stat
                else 0,
            }
        )

    return rows