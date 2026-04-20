from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from projects.models import Contractor
from projects.services.contractor_benchmarks import get_blended_benchmark
from projects.services.regional_benchmarks import resolve_regional_benchmark
from projects.services.regions import build_region_context


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_decimal(value: Any, default: Decimal | None = None) -> Decimal | None:
    if value in (None, "", []):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return max(int(value), 0)
    except (TypeError, ValueError):
        return default


def _money(value: Any) -> Decimal:
    return (_safe_decimal(value, Decimal("0.00")) or Decimal("0.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _percent(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%"


def _midpoint_low_high(low: Any, high: Any) -> Decimal:
    low_value = _safe_decimal(low, Decimal("0.00")) or Decimal("0.00")
    high_value = _safe_decimal(high, Decimal("0.00")) or Decimal("0.00")
    if low_value <= 0 and high_value <= 0:
        return Decimal("0.00")
    if low_value <= 0:
        return high_value
    if high_value <= 0:
        return low_value
    return _money((low_value + high_value) / Decimal("2"))


def _compare_percent(value: Decimal, baseline: Decimal) -> Decimal:
    if baseline <= 0:
        return Decimal("0.00")
    return ((value - baseline) / baseline * Decimal("100")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def _direction_from_delta(delta: Decimal, *, tolerance: Decimal = Decimal("5")) -> str:
    if delta > tolerance:
        return "above"
    if delta < -tolerance:
        return "below"
    return "similar"


def _contractor_region_context(contractor: Contractor | None, project_context: dict[str, Any]) -> dict[str, str]:
    region_state = _safe_text(project_context.get("region_state"))
    region_city = _safe_text(project_context.get("region_city"))
    if not region_state and contractor is not None:
        region_state = _safe_text(getattr(contractor, "state", ""))
    if not region_city and contractor is not None:
        region_city = _safe_text(getattr(contractor, "city", ""))
    return build_region_context(country="US", state=region_state, city=region_city)


def _friendly_confidence(sample_sizes: dict[str, int], regional_bias: Decimal, contractor_bias: Decimal) -> str:
    strongest = max(
        Decimal(sample_sizes.get("platform", 0)) / Decimal("12"),
        Decimal(sample_sizes.get("regional", 0)) / Decimal("10"),
        Decimal(sample_sizes.get("contractor", 0)) / Decimal("8"),
    )
    if strongest >= Decimal("1.00") and regional_bias <= Decimal("0.20") and contractor_bias <= Decimal("0.25"):
        return "high"
    if strongest >= Decimal("0.45"):
        return "medium"
    return "low"


def _suggestion_confidence(overall_confidence: str, magnitude: Decimal) -> str:
    confidence = _safe_text(overall_confidence).lower()
    if confidence == "high" and magnitude >= Decimal("10"):
        return "high"
    if confidence in {"high", "medium"} and magnitude >= Decimal("5"):
        return "medium"
    if magnitude >= Decimal("10"):
        return "medium"
    return "low"


def _build_suggested_adjustments(
    *,
    price_delta: Decimal,
    duration_delta: Decimal,
    milestone_delta: int,
    dispute_rate: Decimal,
    market_dispute_rate: Decimal | None,
    contractor_amendment_rate: Decimal,
    regional_sample_size: int,
    contractor_sample_size: int,
    confidence: str,
) -> list[dict[str, str]]:
    suggestions: list[dict[str, str]] = []

    price_magnitude = abs(price_delta)
    if price_delta > Decimal("8"):
        suggestions.append(
            {
                "suggestion_type": "pricing",
                "suggestion_text": "You may want to review pricing for this type of project to stay competitive.",
                "suggestion_confidence": _suggestion_confidence(confidence, price_magnitude),
            }
        )
    elif price_delta < Decimal("-8"):
        suggestions.append(
            {
                "suggestion_type": "pricing",
                "suggestion_text": "Your pricing is below the platform average. Make sure it still covers labor, materials, and risk.",
                "suggestion_confidence": _suggestion_confidence(confidence, price_magnitude),
            }
        )

    duration_magnitude = abs(duration_delta)
    if duration_delta > Decimal("8"):
        suggestions.append(
            {
                "suggestion_type": "duration",
                "suggestion_text": "Projects like this typically complete faster. Consider tightening your timeline if the scope is straightforward.",
                "suggestion_confidence": _suggestion_confidence(confidence, duration_magnitude),
            }
        )
    elif duration_delta < Decimal("-8"):
        suggestions.append(
            {
                "suggestion_type": "duration",
                "suggestion_text": "Your timeline is leaner than peers. Double-check access, finish work, and inspection time before finalizing.",
                "suggestion_confidence": _suggestion_confidence(confidence, duration_magnitude),
            }
        )

    if milestone_delta < 0:
        suggestions.append(
            {
                "suggestion_type": "structure",
                "suggestion_text": "Adding more milestones may improve clarity and payment flow.",
                "suggestion_confidence": _suggestion_confidence(confidence, Decimal(str(abs(milestone_delta) * 4))),
            }
        )
    elif milestone_delta > 1:
        suggestions.append(
            {
                "suggestion_type": "structure",
                "suggestion_text": "You may be using a more detailed milestone structure than peers. Consider whether a few steps can be grouped.",
                "suggestion_confidence": _suggestion_confidence(confidence, Decimal(str(milestone_delta * 4))),
            }
        )

    market_dispute = market_dispute_rate or Decimal("0.00")
    if market_dispute > Decimal("0.00") and dispute_rate > market_dispute * Decimal("1.20"):
        suggestions.append(
            {
                "suggestion_type": "scope_clarity",
                "suggestion_text": "Clearer scope notes and exclusions may help reduce disputes and amendments.",
                "suggestion_confidence": "medium" if confidence != "low" else "low",
            }
        )
    elif contractor_sample_size > 0 and contractor_amendment_rate >= Decimal("0.15"):
        suggestions.append(
            {
                "suggestion_type": "scope_clarity",
                "suggestion_text": "More detail around selections, exclusions, or follow-up checks may help reduce amendments on similar jobs.",
                "suggestion_confidence": "medium" if confidence == "high" else "low",
            }
        )
    elif regional_sample_size > 0 and dispute_rate > Decimal("0.00"):
        suggestions.append(
            {
                "suggestion_type": "scope_clarity",
                "suggestion_text": "A clearer scope summary can help keep similar projects moving smoothly.",
                "suggestion_confidence": "low",
            }
        )

    return suggestions[:3]


def build_contractor_insights(
    *,
    contractor_id: int | None,
    project_family_key: str,
    project_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = dict(project_context or {})
    family_key = _safe_text(project_family_key)
    if not contractor_id or not family_key:
        return {
            "project_family_key": family_key,
            "source_type": "platform",
            "confidence": "low",
            "sample_sizes": {"platform": 0, "regional": 0, "contractor": 0},
            "pricing_delta_vs_platform": {"value": "0.0", "direction": "similar", "explanation": "Not enough data to compare yet."},
            "duration_delta_vs_platform": {"value": "0.0", "direction": "similar", "explanation": "Not enough data to compare yet."},
            "milestone_count_delta": {"value": 0, "direction": "similar", "explanation": "Not enough data to compare yet."},
            "dispute_rate_comparison": {"value": "", "direction": "unknown", "explanation": "Not enough market history to compare dispute patterns yet."},
            "explanation_strings": ["Not enough benchmark history is available yet for this project family."],
            "suggested_adjustments": [],
        }

    contractor = Contractor.objects.filter(pk=contractor_id).first()
    region_context = _contractor_region_context(contractor, context)
    benchmark_context = {
        "project_family_key": family_key,
        "project_type": _safe_text(context.get("project_type")),
        "project_subtype": _safe_text(context.get("project_subtype")),
        "project_scope_summary": _safe_text(context.get("project_scope_summary")) or _safe_text(context.get("description")),
        "description": _safe_text(context.get("description")),
        "scope_mode": _safe_text(context.get("scope_mode")),
        "template_used": _safe_text(context.get("template_used") or context.get("template_name")),
        "template_name": _safe_text(context.get("template_name")),
        "region_state": region_context.get("state", ""),
        "region_city": region_context.get("city", ""),
        "region_country": region_context.get("country", "US"),
    }

    platform_context = dict(benchmark_context, region_state="", region_city="")
    platform_benchmark = get_blended_benchmark(platform_context, None)
    contractor_benchmark = get_blended_benchmark(benchmark_context, contractor_id)
    regional_benchmark = resolve_regional_benchmark(benchmark_context)

    platform_price = _midpoint_low_high(
        platform_benchmark.get("pricing_range", {}).get("low"),
        platform_benchmark.get("pricing_range", {}).get("high"),
    )
    platform_duration = _midpoint_low_high(
        platform_benchmark.get("duration_range", {}).get("low"),
        platform_benchmark.get("duration_range", {}).get("high"),
    )
    platform_milestones = _safe_int(platform_benchmark.get("milestone_count"), 0)

    contractor_price = _midpoint_low_high(
        contractor_benchmark.get("pricing_range", {}).get("low"),
        contractor_benchmark.get("pricing_range", {}).get("high"),
    )
    contractor_duration = _midpoint_low_high(
        contractor_benchmark.get("duration_range", {}).get("low"),
        contractor_benchmark.get("duration_range", {}).get("high"),
    )
    contractor_milestones = _safe_int(contractor_benchmark.get("milestone_count"), 0)

    regional_price = _safe_decimal(regional_benchmark.get("learned_price"), Decimal("0.00")) or Decimal("0.00")
    regional_duration = _safe_decimal(regional_benchmark.get("learned_duration_days"), Decimal("0.00")) or Decimal("0.00")
    regional_milestones = _safe_decimal(regional_benchmark.get("learned_milestone_count"), Decimal("0.00")) or Decimal("0.00")
    regional_sample_size = _safe_int(regional_benchmark.get("sample_size"), 0)
    contractor_sample_size = _safe_int(contractor_benchmark.get("contractor", {}).get("sample_size"), 0)
    platform_sample_size = _safe_int(platform_benchmark.get("platform", {}).get("sample_size"), 0)

    price_delta = _compare_percent(contractor_price, platform_price) if platform_price > 0 else Decimal("0.00")
    duration_delta = _compare_percent(contractor_duration, platform_duration) if platform_duration > 0 else Decimal("0.00")
    milestone_delta = contractor_milestones - platform_milestones

    dispute_rate = _safe_decimal(contractor_benchmark.get("contractor", {}).get("dispute_rate"), Decimal("0.00")) or Decimal("0.00")
    contractor_amendment_rate = _safe_decimal(contractor_benchmark.get("contractor", {}).get("amendment_rate"), Decimal("0.00")) or Decimal("0.00")
    market_dispute_rate = _safe_decimal(regional_benchmark.get("dispute_rate"), Decimal("0.00")) if regional_sample_size > 0 else None

    if regional_sample_size > 0:
        dispute_baseline = market_dispute_rate or Decimal("0.00")
    else:
        dispute_baseline = None
    if dispute_baseline is not None and dispute_baseline > 0:
        dispute_delta = _compare_percent(dispute_rate, dispute_baseline)
        if dispute_delta > 5:
            dispute_direction = "above"
        elif dispute_delta < -5:
            dispute_direction = "below"
        else:
            dispute_direction = "similar"
        dispute_explanation = (
            f"Your dispute rate is {dispute_direction} similar projects in your market."
            if regional_sample_size > 0
            else "Your dispute rate is being compared against available platform history."
        )
        dispute_value = _percent(dispute_rate)
        market_value = _percent(dispute_baseline)
    else:
        dispute_direction = "unknown"
        dispute_explanation = "Not enough regional history yet to compare dispute patterns safely."
        dispute_value = _percent(dispute_rate)
        market_value = ""

    regional_bias = Decimal(str(_safe_int(regional_sample_size, 0)))
    contractor_bias = Decimal(str(contractor_sample_size))
    confidence = _friendly_confidence(
        {"platform": platform_sample_size, "regional": regional_sample_size, "contractor": contractor_sample_size},
        regional_bias,
        contractor_bias,
    )

    explanation_strings: list[str] = []
    if price_delta != 0:
        explanation_strings.append(
            f"Your pricing runs {abs(price_delta):.1f}% {'above' if price_delta > 0 else 'below'} the platform average for this project family."
        )
    else:
        explanation_strings.append("Your pricing is close to the platform average for this project family.")
    if duration_delta != 0:
        explanation_strings.append(
            f"Your duration is {abs(duration_delta):.1f}% {'longer' if duration_delta > 0 else 'shorter'} than the platform average."
        )
    else:
        explanation_strings.append("Your duration is close to the platform average.")
    if milestone_delta != 0:
        explanation_strings.append(
            f"Your milestone structure uses {abs(milestone_delta)} {'more' if milestone_delta > 0 else 'fewer'} step{'s' if abs(milestone_delta) != 1 else ''} than the platform baseline."
        )
    else:
        explanation_strings.append("Your milestone structure is close to the platform baseline.")
    if regional_sample_size > 0:
        explanation_strings.append(
            f"Your market history includes {regional_sample_size} completed project{'s' if regional_sample_size != 1 else ''}, which helps sharpen the comparison."
        )
    if contractor_sample_size > 0:
        explanation_strings.append(
            f"Your own history includes {contractor_sample_size} completed project{'s' if contractor_sample_size != 1 else ''} in this family."
        )

    if confidence == "low":
        explanation_strings = explanation_strings[:2]

    source_type = "platform"
    if regional_sample_size > 0 and contractor_sample_size > 0:
        source_type = "blended_all"
    elif regional_sample_size > 0:
        source_type = "blended_platform_regional"
    elif contractor_sample_size > 0:
        source_type = "blended_platform_contractor"

    return {
        "project_family_key": family_key,
        "project_family_label": _safe_text(context.get("project_family_label")) or family_key.replace("_", " ").title(),
        "source_type": source_type,
        "confidence": confidence,
        "sample_sizes": {
            "platform": platform_sample_size,
            "regional": regional_sample_size,
            "contractor": contractor_sample_size,
        },
        "pricing_delta_vs_platform": {
            "value": str(price_delta.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
            "direction": _direction_from_delta(price_delta),
            "explanation": (
                "Your pricing is close to the platform average for this family."
                if price_delta == 0
                else f"Your pricing is {abs(price_delta):.1f}% {'above' if price_delta > 0 else 'below'} the platform average."
            ),
        },
        "duration_delta_vs_platform": {
            "value": str(duration_delta.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
            "direction": _direction_from_delta(duration_delta),
            "explanation": (
                "Your duration is close to the platform average."
                if duration_delta == 0
                else f"Your duration is {abs(duration_delta):.1f}% {'longer' if duration_delta > 0 else 'shorter'} than the platform average."
            ),
        },
        "milestone_count_delta": {
            "value": milestone_delta,
            "direction": "above" if milestone_delta > 0 else "below" if milestone_delta < 0 else "similar",
            "explanation": (
                "Your milestone structure is close to the platform baseline."
                if milestone_delta == 0
                else f"Your milestone structure uses {abs(milestone_delta)} {'more' if milestone_delta > 0 else 'fewer'} step{'s' if abs(milestone_delta) != 1 else ''} than the platform baseline."
            ),
        },
        "dispute_rate_comparison": {
            "value": dispute_value,
            "market_value": market_value,
            "direction": dispute_direction,
            "explanation": dispute_explanation,
        },
        "amendment_rate": {
            "value": _percent(contractor_amendment_rate),
            "explanation": (
                "Your amendment rate is part of the quality check for this family."
                if contractor_sample_size > 0
                else "No completed-job amendment history is available yet."
            ),
        },
        "regional_reference": {
            "region_key": _safe_text(regional_benchmark.get("region_key")),
            "region_label": _safe_text(regional_benchmark.get("region_label")),
            "region_granularity": _safe_text(regional_benchmark.get("region_granularity")) or "unknown",
            "sample_size": regional_sample_size,
            "milestone_count": str(regional_milestones.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
            "price": str(_money(regional_price)) if regional_price > 0 else "0.00",
            "duration_days": str(regional_duration.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) if regional_duration > 0 else "0.0",
        },
        "explanation_strings": explanation_strings,
        "suggested_adjustments": _build_suggested_adjustments(
            price_delta=price_delta,
            duration_delta=duration_delta,
            milestone_delta=milestone_delta,
            dispute_rate=dispute_rate,
            market_dispute_rate=market_dispute_rate,
            contractor_amendment_rate=contractor_amendment_rate,
            regional_sample_size=regional_sample_size,
            contractor_sample_size=contractor_sample_size,
            confidence=confidence,
        ),
    }
