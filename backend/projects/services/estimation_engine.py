from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
import hashlib
from math import sqrt
from typing import Any

from django.db.models import Q

from projects.models import Agreement, AgreementAIScope, Milestone, ProjectBenchmarkAggregate
from projects.models_templates import SeedBenchmarkProfile
from projects.services.benchmark_resolution import resolve_seed_benchmark_defaults
from projects.services.regions import build_normalized_region_key
from projects.services.project_plan_suggestions import build_project_plan_suggestion


STRUCTURED_RESULT_VERSION = "2026-03-26-estimator-v1"
MONEY_QUANT = Decimal("0.01")
TEMPLATE_BLEND_WEIGHT = Decimal("0.60")
BENCHMARK_BLEND_WEIGHT = Decimal("0.40")


@dataclass
class LearnedBenchmarkDecision:
    aggregate: ProjectBenchmarkAggregate | None
    learned_price: Decimal
    learned_duration_days: int
    learned_weight: Decimal
    scope_label: str
    reasoning: str


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_decimal(value: Any, default: Decimal = Decimal("0.00")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _money(value: Decimal | float | int | str) -> Decimal:
    return _safe_decimal(value).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def _clamp_decimal(value: Decimal, lower: Decimal, upper: Decimal) -> Decimal:
    return max(lower, min(upper, value))


def _midpoint_money(low: Any, high: Any) -> Decimal:
    lo = _safe_decimal(low)
    hi = _safe_decimal(high)
    if lo <= 0 and hi <= 0:
        return Decimal("0.00")
    if hi <= 0:
        return _money(lo)
    if lo <= 0:
        return _money(hi)
    if hi < lo:
        lo = hi
    return _money((lo + hi) / Decimal("2"))


def _midpoint_days(low: Any, high: Any) -> int:
    lo = _safe_int(low)
    hi = _safe_int(high)
    if lo <= 0 and hi <= 0:
        return 0
    if hi <= 0:
        return lo
    if lo <= 0:
        return hi
    if hi < lo:
        lo = hi
    return max(int(round((lo + hi) / 2)), 1)


def _slug(value: Any) -> str:
    return (
        _safe_text(value)
        .lower()
        .replace("&", " and ")
        .replace("/", " ")
        .replace("-", " ")
        .replace(",", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace(".", " ")
    )


def _normalize_answer_key(value: Any) -> str:
    return "_".join(part for part in _slug(value).split() if part)


def _normalize_answer_value(value: Any) -> str:
    return "_".join(part for part in _slug(value).split() if part)


def _bucket_numeric_answer(key: str, value: str) -> str:
    try:
        number = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return ""
    if "square_foot" in key or "sq_ft" in key or "sqft" in key or "project_size" in key:
        lower = max((number // 250) * 250, 0)
        upper = lower + 249
        return f"{lower}_{upper}"
    if number <= 1:
        return "1"
    if number <= 3:
        return "2_3"
    if number <= 7:
        return "4_7"
    return "8_plus"


def _clarification_signature_from_answers(answers: dict[str, Any]) -> str:
    if not isinstance(answers, dict):
        return ""
    traits: dict[str, str] = {}
    for raw_key, raw_value in sorted(answers.items()):
        key = _normalize_answer_key(raw_key)
        if not key:
            continue
        value_text = _safe_text(raw_value)
        if not value_text:
            continue
        bucketed = _bucket_numeric_answer(key, value_text)
        if bucketed:
            traits[key] = bucketed
            continue
        if len(value_text.split()) > 6:
            continue
        normalized = _normalize_answer_value(value_text)
        if normalized:
            traits[key] = normalized[:64]
    if not traits:
        return ""
    joined = "|".join(f"{key}={traits[key]}" for key in sorted(traits))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def _first_matching_answer(answers: dict[str, Any], *needles: str) -> Any:
    if not isinstance(answers, dict):
        return None
    normalized_needles = {_normalize_answer_key(needle) for needle in needles if needle}
    for raw_key, raw_value in answers.items():
        key = _normalize_answer_key(raw_key)
        if key in normalized_needles:
            return raw_value
    for raw_key, raw_value in answers.items():
        key = _normalize_answer_key(raw_key)
        if any(needle in key for needle in normalized_needles):
            return raw_value
    return None


def _truthy_answer(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _safe_text(value).lower() in {"yes", "true", "1", "required", "needed", "occupied", "urgent", "rush"}


def _extract_answers(agreement: Agreement) -> dict[str, Any]:
    scope = getattr(agreement, "ai_scope", None)
    if isinstance(scope, AgreementAIScope):
        answers = getattr(scope, "answers", None)
    else:
        answers = None
    return dict(answers or {}) if isinstance(answers, dict) else {}


def _existing_milestones(agreement: Agreement) -> list[Milestone]:
    return list(Milestone.objects.filter(agreement_id=agreement.id).order_by("order", "id"))


def _project_context(agreement: Agreement) -> dict[str, Any]:
    return {
        "project_type": _safe_text(getattr(agreement, "project_type", "")),
        "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")),
        "region_state": _safe_text(getattr(agreement, "project_address_state", "")),
        "region_city": _safe_text(getattr(agreement, "project_address_city", "")),
        "selected_template_id": getattr(agreement, "selected_template_id", None),
        "benchmark_match_key": _safe_text(
            getattr(getattr(agreement, "selected_template", None), "benchmark_match_key", "")
        ),
    }


def _template_label(agreement: Agreement) -> str:
    selected_template = getattr(agreement, "selected_template", None)
    return _safe_text(getattr(selected_template, "name", "")) or _safe_text(
        getattr(agreement, "selected_template_name_snapshot", "")
    )


def _baseline_sqft(project_type: str, project_subtype: str) -> int:
    text = f"{_slug(project_type)} {_slug(project_subtype)}"
    if "kitchen" in text:
        return 220
    if "bath" in text:
        return 80
    if "roof" in text:
        return 2200
    if "floor" in text:
        return 1000
    if "painting" in text:
        return 1200
    if "deck" in text or "fence" in text:
        return 320
    if "hvac" in text:
        return 1800
    if "handyman" in text or "repair" in text:
        return 200
    return 500


def _pick_learned_candidate(*, agreement: Agreement, region_key: str) -> LearnedBenchmarkDecision:
    project_type = _safe_text(getattr(agreement, "project_type", ""))
    project_subtype = _safe_text(getattr(agreement, "project_subtype", ""))
    template_id = getattr(agreement, "selected_template_id", None)
    clarification_signature = _clarification_signature_from_answers(_extract_answers(agreement))
    if not project_type:
        return LearnedBenchmarkDecision(None, Decimal("0.00"), 0, Decimal("0.00"), "", "")

    queryset = ProjectBenchmarkAggregate.objects.filter(
        completed_project_count__gt=0,
        project_type__iexact=project_type,
    )
    if project_subtype:
        queryset = queryset.filter(Q(project_subtype__iexact=project_subtype) | Q(project_subtype=""))
    if clarification_signature:
        queryset = queryset.filter(Q(clarification_signature=clarification_signature) | Q(clarification_signature=""))
    else:
        queryset = queryset.filter(clarification_signature="")
    candidates = list(queryset.order_by("-completed_project_count", "-updated_at"))

    def candidate_tuple(aggregate: ProjectBenchmarkAggregate) -> tuple[int, int, int, int, int, int]:
        exact_signature = int(
            bool(clarification_signature)
            and _safe_text(aggregate.clarification_signature) == clarification_signature
        )
        exact_subtype = int(
            bool(project_subtype)
            and _safe_text(aggregate.project_subtype).lower() == project_subtype.lower()
        )
        type_only = int(not _safe_text(aggregate.project_subtype))
        scope_score = {
            ProjectBenchmarkAggregate.Scope.REGIONAL: 40,
            ProjectBenchmarkAggregate.Scope.TEMPLATE: 35,
            ProjectBenchmarkAggregate.Scope.CONTRACTOR: 25,
            ProjectBenchmarkAggregate.Scope.GLOBAL: 20,
        }.get(aggregate.scope, 0)
        region_score = 0
        if aggregate.scope == ProjectBenchmarkAggregate.Scope.REGIONAL:
            aggregate_region_key = _safe_text(aggregate.normalized_region_key)
            if region_key and aggregate_region_key == region_key:
                region_score = 8
            elif region_key and aggregate_region_key and region_key.startswith(f"{aggregate_region_key}-"):
                region_score = 6
            elif aggregate_region_key:
                region_score = -10
        elif aggregate.scope == ProjectBenchmarkAggregate.Scope.TEMPLATE and template_id and aggregate.template_id == template_id:
            region_score = 4
        template_score = int(bool(template_id) and aggregate.template_id == template_id)
        contractor_score = int(aggregate.scope == ProjectBenchmarkAggregate.Scope.CONTRACTOR and aggregate.contractor_id == getattr(getattr(agreement, "contractor", None), "id", None))
        return (
            exact_signature,
            exact_subtype,
            template_score,
            contractor_score,
            scope_score + region_score,
            min(int(aggregate.completed_project_count), 50),
        )

    def candidate_is_usable(aggregate: ProjectBenchmarkAggregate) -> bool:
        if aggregate.scope == ProjectBenchmarkAggregate.Scope.TEMPLATE and template_id:
            return aggregate.template_id == template_id
        if aggregate.scope == ProjectBenchmarkAggregate.Scope.REGIONAL:
            aggregate_region_key = _safe_text(aggregate.normalized_region_key)
            return bool(region_key) and bool(aggregate_region_key) and (
                aggregate_region_key == region_key or region_key.startswith(f"{aggregate_region_key}-")
            )
        return True

    eligible = [candidate for candidate in candidates if candidate_is_usable(candidate)]
    if not eligible:
        return LearnedBenchmarkDecision(None, Decimal("0.00"), 0, Decimal("0.00"), "", "")

    eligible.sort(key=candidate_tuple, reverse=True)
    aggregate = eligible[0]

    learned_price = _safe_decimal(aggregate.median_final_total)
    if learned_price <= 0:
        learned_price = _safe_decimal(aggregate.average_final_total)
    learned_duration = _safe_int(aggregate.median_actual_duration_days)
    if learned_duration <= 0:
        learned_duration = int(round(float(aggregate.average_actual_duration_days or 0)))

    scope_bits: list[str] = [aggregate.scope]
    if project_subtype and _safe_text(aggregate.project_subtype).lower() == project_subtype.lower():
        scope_bits.append("exact_subtype")
    else:
        scope_bits.append("type_fallback")
    if clarification_signature and _safe_text(aggregate.clarification_signature) == clarification_signature:
        scope_bits.append("clarification")
    learned_weight = BENCHMARK_BLEND_WEIGHT
    reasoning = (
        f"Learned benchmark from {aggregate.scope} scope with {aggregate.completed_project_count} completed project"
        f"{'' if aggregate.completed_project_count == 1 else 's'}"
        f"{' and a clarification-specific match' if clarification_signature and _safe_text(aggregate.clarification_signature) == clarification_signature else ''}."
    )
    return LearnedBenchmarkDecision(
        aggregate,
        _money(learned_price),
        max(learned_duration, 0),
        learned_weight,
        "_".join(scope_bits),
        reasoning,
    )


def _apply_multiplier_adjustment(
    *,
    label: str,
    factor: Decimal,
    price_anchor: Decimal,
    price_adjustments: list[dict[str, Any]],
    explanation_lines: list[str],
    reason: str,
) -> Decimal:
    if factor <= 0 or factor == Decimal("1.00") or price_anchor <= 0:
        return Decimal("0.00")
    delta = _money(price_anchor * (factor - Decimal("1.00")))
    if delta == 0:
        return Decimal("0.00")
    price_adjustments.append({"label": label, "amount": str(delta), "reason": reason})
    explanation_lines.append(f"{label}: {reason}")
    return delta


def _apply_day_adjustment(
    *,
    label: str,
    days: int,
    timeline_adjustments: list[dict[str, Any]],
    explanation_lines: list[str],
    reason: str,
) -> int:
    if not days:
        return 0
    timeline_adjustments.append({"label": label, "days": days, "reason": reason})
    explanation_lines.append(f"{label}: {reason}")
    return days


def _clarification_adjustments(
    *,
    agreement: Agreement,
    seeded_profile: SeedBenchmarkProfile | None,
    seeded_price_anchor: Decimal,
    seeded_duration_days: int,
    answers: dict[str, Any],
) -> tuple[Decimal, int, list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    price_adjustments: list[dict[str, Any]] = []
    timeline_adjustments: list[dict[str, Any]] = []
    explanation_lines: list[str] = []
    price_delta_total = Decimal("0.00")
    day_delta_total = 0

    finish_value = _normalize_answer_value(
        _first_matching_answer(
            answers,
            "finish_level",
            "finish_tier",
            "material_tier",
            "materials_quality",
            "finish_quality",
        )
    )
    finish_multipliers = dict(getattr(seeded_profile, "finish_level_multipliers", {}) or {})
    finish_factor = _safe_decimal(finish_multipliers.get(finish_value), Decimal("0.00"))
    if finish_factor <= 0:
        finish_factor = {
            "builder_grade": Decimal("0.90"),
            "economy": Decimal("0.90"),
            "standard": Decimal("1.00"),
            "mid_grade": Decimal("1.00"),
            "premium": Decimal("1.18"),
            "luxury": Decimal("1.25"),
        }.get(finish_value, Decimal("1.00"))
    price_delta_total += _apply_multiplier_adjustment(
        label="Finish level",
        factor=finish_factor,
        price_anchor=seeded_price_anchor,
        price_adjustments=price_adjustments,
        explanation_lines=explanation_lines,
        reason=f"Finish selections were treated as `{finish_value or 'standard'}`.",
    )

    sqft_value = _first_matching_answer(
        answers,
        "square_footage",
        "square_feet",
        "sq_ft",
        "project_size",
        "size_sqft",
    )
    sqft = _safe_int(str(sqft_value).replace(",", ""), 0) if sqft_value not in (None, "") else 0
    if sqft > 0 and seeded_price_anchor > 0:
        baseline_sqft = _baseline_sqft(
            _safe_text(getattr(agreement, "project_type", "")),
            _safe_text(getattr(agreement, "project_subtype", "")),
        )
        size_factor = _clamp_decimal(
            Decimal(str(sqft)) / Decimal(str(max(baseline_sqft, 1))),
            Decimal("0.70"),
            Decimal("1.80"),
        )
        if abs(float(size_factor - Decimal("1.00"))) >= 0.10:
            price_delta_total += _apply_multiplier_adjustment(
                label="Project size",
                factor=size_factor,
                price_anchor=seeded_price_anchor,
                price_adjustments=price_adjustments,
                explanation_lines=explanation_lines,
                reason=f"Used approximately {sqft} sq ft against a {baseline_sqft} sq ft baseline.",
            )
            extra_days = int(round(max((sqrt(float(size_factor)) - 1.0) * float(max(seeded_duration_days, 1)), -3)))
            day_delta_total += _apply_day_adjustment(
                label="Project size",
                days=extra_days,
                timeline_adjustments=timeline_adjustments,
                explanation_lines=explanation_lines,
                reason="Larger scope usually extends sequencing and finish time.",
            )

    if _truthy_answer(_first_matching_answer(answers, "demolition_required", "demo_required", "tear_out_required")):
        price_delta_total += _apply_multiplier_adjustment(
            label="Demolition",
            factor=Decimal("1.08"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Demolition or tear-out was included.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Demolition",
            days=2,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Prep and debris handling add time.",
        )

    permit_value = _normalize_answer_value(
        _first_matching_answer(
            answers,
            "permit_complexity",
            "permit_required",
            "permits_required",
            "inspection_complexity",
        )
    )
    if permit_value in {"required", "yes", "standard"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Permits & inspections",
            factor=Decimal("1.04"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Permitting and inspection coordination was included.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Permits & inspections",
            days=2,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Scheduling inspections adds slack to the timeline.",
        )
    elif permit_value in {"high", "complex", "expedited"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Permits & inspections",
            factor=Decimal("1.08"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Permit complexity was treated as higher than baseline.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Permits & inspections",
            days=4,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Complex inspection flow increases duration risk.",
        )

    if _safe_text(_first_matching_answer(answers, "custom_features", "specialty_features", "built_ins", "custom_work")):
        price_delta_total += _apply_multiplier_adjustment(
            label="Custom features",
            factor=Decimal("1.06"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Custom features or specialty work were noted.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Custom features",
            days=3,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Custom fabrication and finish coordination usually extend the job.",
        )

    access_value = _normalize_answer_value(
        _first_matching_answer(answers, "access_difficulty", "difficult_access", "site_access", "access_constraints")
    )
    if access_value in {"difficult", "limited", "tight", "restricted"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Site access",
            factor=Decimal("1.05"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Restricted site access increases handling and setup time.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Site access",
            days=2,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Crew movement and staging constraints slow production.",
        )

    occupancy_value = _normalize_answer_value(
        _first_matching_answer(answers, "occupancy", "occupied_during_work", "occupied_home")
    )
    if occupancy_value in {"occupied", "yes", "lived_in"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Occupied home",
            factor=Decimal("1.04"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Occupied homes require additional protection and phasing.",
        )
        day_delta_total += _apply_day_adjustment(
            label="Occupied home",
            days=2,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Occupied work usually reduces working efficiency.",
        )
    elif occupancy_value in {"vacant", "no"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Vacant project",
            factor=Decimal("0.97"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Vacant projects usually need less protection and coordination.",
        )

    urgency_value = _normalize_answer_value(
        _first_matching_answer(answers, "urgency", "compressed_schedule", "schedule_speed", "rush_timeline")
    )
    if urgency_value in {"urgent", "rush", "compressed", "asap"}:
        price_delta_total += _apply_multiplier_adjustment(
            label="Compressed schedule",
            factor=Decimal("1.07"),
            price_anchor=seeded_price_anchor,
            price_adjustments=price_adjustments,
            explanation_lines=explanation_lines,
            reason="Rush scheduling usually increases labor pressure and coordination cost.",
        )
        reduced_days = min(max(int(round(seeded_duration_days * 0.12)), 1), max(seeded_duration_days - 1, 1))
        day_delta_total += _apply_day_adjustment(
            label="Compressed schedule",
            days=-reduced_days,
            timeline_adjustments=timeline_adjustments,
            explanation_lines=explanation_lines,
            reason="Requested acceleration compresses the baseline timeline.",
        )

    return price_delta_total, day_delta_total, price_adjustments, timeline_adjustments, explanation_lines


def _milestone_weight_from_row(row: dict[str, Any], fallback_weight: Decimal) -> Decimal:
    midpoint = _midpoint_money(row.get("suggested_amount_low"), row.get("suggested_amount_high"))
    if midpoint > 0:
        return midpoint
    fixed_amount = _safe_decimal(row.get("suggested_amount_fixed"))
    if fixed_amount > 0:
        return fixed_amount
    return fallback_weight


def _milestone_duration_from_row(row: dict[str, Any], fallback_days: int) -> int:
    duration = _safe_int(row.get("recommended_duration_days"))
    if duration <= 0:
        duration = _safe_int(row.get("duration_days"))
    return max(duration, fallback_days, 1)


def _build_milestone_suggestions(
    *,
    existing_milestones: list[Milestone],
    seeded_defaults: list[dict[str, Any]],
    suggested_total_price: Decimal,
    suggested_duration_days: int,
    clarification_answers: dict[str, Any],
) -> list[dict[str, Any]]:
    if existing_milestones:
        base_rows = [
            {
                "milestone_id": row.id,
                "title": row.title,
                "description": row.description,
                "normalized_milestone_type": row.normalized_milestone_type,
                "suggested_amount_low": row.suggested_amount_low,
                "suggested_amount_high": row.suggested_amount_high,
                "recommended_duration_days": row.recommended_duration_days,
                "amount": row.amount,
                "source": "existing_milestone",
            }
            for row in existing_milestones
        ]
    else:
        base_rows = [
            {
                "milestone_id": None,
                "title": _safe_text(row.get("title")) or f"Milestone {idx + 1}",
                "description": _safe_text(row.get("description")),
                "normalized_milestone_type": _safe_text(row.get("normalized_milestone_type")),
                "suggested_amount_low": row.get("suggested_amount_low"),
                "suggested_amount_high": row.get("suggested_amount_high"),
                "recommended_duration_days": row.get("recommended_duration_days") or row.get("duration_days"),
                "amount": row.get("suggested_amount_fixed"),
                "source": "seeded_default",
            }
            for idx, row in enumerate(seeded_defaults or [])
        ]

    if not base_rows:
        base_rows = [
            {
                "milestone_id": None,
                "title": "Main Scope",
                "description": "Primary scope of work",
                "normalized_milestone_type": "general_milestone",
                "recommended_duration_days": max(suggested_duration_days, 1),
                "amount": suggested_total_price,
                "source": "generic_fallback",
            }
        ]

    weight_pool: list[Decimal] = []
    duration_pool: list[int] = []
    fallback_weight = Decimal("1.00")
    fallback_days = max(int(round(suggested_duration_days / max(len(base_rows), 1))), 1)
    for row in base_rows:
        amount_weight = _safe_decimal(row.get("amount"))
        if amount_weight <= 0:
            amount_weight = _milestone_weight_from_row(row, fallback_weight)
        weight_pool.append(max(amount_weight, Decimal("1.00")))
        duration_pool.append(_milestone_duration_from_row(row, fallback_days))

    total_weight = sum(weight_pool) or Decimal(str(len(base_rows)))
    total_duration_weight = sum(duration_pool) or len(base_rows)
    demo_boost = _truthy_answer(_first_matching_answer(clarification_answers, "demolition_required", "demo_required"))
    custom_boost = bool(_safe_text(_first_matching_answer(clarification_answers, "custom_features", "specialty_features")))

    suggestions: list[dict[str, Any]] = []
    running_total = Decimal("0.00")
    running_days = 0
    for idx, row in enumerate(base_rows):
        row_weight = weight_pool[idx]
        row_days_weight = duration_pool[idx]
        price_share = suggested_total_price * (row_weight / total_weight) if total_weight > 0 else Decimal("0.00")
        duration_share = int(round(suggested_duration_days * (row_days_weight / total_duration_weight))) if total_duration_weight > 0 else 0

        normalized_type = _safe_text(row.get("normalized_milestone_type")).lower()
        title = _safe_text(row.get("title"))
        type_text = f"{normalized_type} {title.lower()}"
        if demo_boost and ("demo" in type_text or "tear" in type_text or "prep" in type_text):
            price_share *= Decimal("1.05")
            duration_share += 1
        if custom_boost and any(token in type_text for token in ("cabinet", "tile", "finish", "paint", "installation", "install")):
            price_share *= Decimal("1.04")
            duration_share += 1

        price_share = _money(price_share)
        duration_share = max(duration_share, 1)
        running_total += price_share
        running_days += duration_share
        allocation_percent = float(row_weight / total_weight) if total_weight > 0 else 0.0
        suggestions.append(
            {
                "milestone_id": row.get("milestone_id"),
                "title": title or f"Milestone {idx + 1}",
                "description": _safe_text(row.get("description")),
                "normalized_milestone_type": normalized_type,
                "suggested_amount": str(price_share),
                "suggested_duration_days": duration_share,
                "suggested_order": idx + 1,
                "allocation_percent": allocation_percent,
                "source": row.get("source") or "estimator",
                "source_note": "Suggested values are editable and based on template, benchmark, and clarification context.",
            }
        )

    if suggestions and running_total != suggested_total_price:
        delta = suggested_total_price - running_total
        suggestions[-1]["suggested_amount"] = str(_money(_safe_decimal(suggestions[-1]["suggested_amount"]) + delta))
    if suggestions and running_days != suggested_duration_days:
        suggestions[-1]["suggested_duration_days"] = max(
            int(suggestions[-1]["suggested_duration_days"]) + (suggested_duration_days - running_days),
            1,
        )

    return suggestions


def _confidence_level(
    *,
    seeded_defaults: dict[str, Any],
    learned_decision: LearnedBenchmarkDecision,
    clarification_answers: dict[str, Any],
) -> tuple[str, str]:
    clarification_count = len([value for value in (clarification_answers or {}).values() if value not in (None, "", [], {})])
    region_scope = _safe_text(seeded_defaults.get("region_scope_used"))
    match_scope = _safe_text(seeded_defaults.get("match_scope"))

    if learned_decision.aggregate is not None and learned_decision.aggregate.completed_project_count >= 10 and learned_decision.learned_weight >= Decimal("0.35") and clarification_count >= 2:
        return "high", "Confidence is higher because local or template-specific completed-job data exists and several project details were provided."
    if match_scope.startswith("exact_subtype_") and region_scope in {"city", "state", "normalized_region"}:
        return "medium", "Confidence is moderate because a seeded benchmark matched the project family and region, but final pricing still depends on site-specific details."
    if learned_decision.aggregate is not None and learned_decision.aggregate.completed_project_count >= 5:
        return "medium", "Confidence is moderate because similar completed jobs influenced the estimate, but sample size is still limited."
    return "low", "Confidence is lower because the estimate is leaning on broader seeded defaults and limited clarification detail."


def build_project_estimate(*, agreement: Agreement) -> dict[str, Any]:
    context = _project_context(agreement)
    seeded_defaults = resolve_seed_benchmark_defaults(**context)
    if (
        seeded_defaults.get("match_scope") == "template_linked_profile"
        and (context.get("region_state") or context.get("region_city"))
    ):
        regional_seeded_defaults = resolve_seed_benchmark_defaults(
            project_type=context.get("project_type", ""),
            project_subtype=context.get("project_subtype", ""),
            region_state=context.get("region_state", ""),
            region_city=context.get("region_city", ""),
            benchmark_match_key=context.get("benchmark_match_key", ""),
        )
        if regional_seeded_defaults.get("benchmark_profile_id") and regional_seeded_defaults.get("region_scope_used") in {"city", "state", "normalized_region"}:
            regional_seeded_defaults["source_metadata"] = {
                **(regional_seeded_defaults.get("source_metadata") or {}),
                "template_linked": True,
                "template_id": context.get("selected_template_id"),
            }
            seeded_defaults = regional_seeded_defaults

    seeded_profile = None
    if seeded_defaults.get("benchmark_profile_id"):
        seeded_profile = SeedBenchmarkProfile.objects.filter(pk=seeded_defaults["benchmark_profile_id"]).first()

    seeded_price_anchor = _midpoint_money(
        seeded_defaults.get("price_range", {}).get("low"),
        seeded_defaults.get("price_range", {}).get("high"),
    )
    agreement_total = _money(getattr(agreement, "total_cost", 0) or 0)
    if seeded_price_anchor <= 0 and agreement_total > 0:
        seeded_price_anchor = agreement_total
    seeded_duration_days = _midpoint_days(
        seeded_defaults.get("duration_range", {}).get("low"),
        seeded_defaults.get("duration_range", {}).get("high"),
    )

    region_key = build_normalized_region_key(
        country="US",
        state=context.get("region_state", ""),
        city=context.get("region_city", ""),
    )
    learned_decision = _pick_learned_candidate(agreement=agreement, region_key=region_key)
    learned_weight = learned_decision.learned_weight if learned_decision.aggregate is not None else Decimal("0.00")
    template_weight = TEMPLATE_BLEND_WEIGHT if learned_weight > 0 else Decimal("1.00")

    baseline_price = seeded_price_anchor
    baseline_duration = seeded_duration_days
    benchmark_source = "seeded_only"
    explanation_lines: list[str] = []
    if seeded_defaults.get("benchmark_profile_id"):
        explanation_lines.append(
            f"Started from seeded benchmark `{seeded_defaults.get('match_scope')}` for `{context.get('project_type') or 'project'}`."
        )
    if seeded_defaults.get("fallback_reason"):
        explanation_lines.append(seeded_defaults["fallback_reason"])

    if learned_decision.aggregate is not None and learned_weight > 0:
        if learned_decision.learned_price > 0 and baseline_price > 0:
            baseline_price = _money((baseline_price * template_weight) + (learned_decision.learned_price * learned_weight))
        elif learned_decision.learned_price > 0:
            baseline_price = learned_decision.learned_price

        if learned_decision.learned_duration_days > 0 and baseline_duration > 0:
            baseline_duration = max(
                int(round((baseline_duration * float(template_weight)) + (learned_decision.learned_duration_days * float(learned_weight)))),
                1,
            )
        elif learned_decision.learned_duration_days > 0:
            baseline_duration = learned_decision.learned_duration_days

        benchmark_source = "seeded_plus_learned"
        explanation_lines.append(
            f"Blended template defaults ({template_weight.quantize(Decimal('0.01'))}) with learned benchmark data ({learned_weight.quantize(Decimal('0.01'))})."
        )
        explanation_lines.append(learned_decision.reasoning)

    clarification_answers = _extract_answers(agreement)
    clarification_price_delta, clarification_day_delta, price_adjustments, timeline_adjustments, clarification_explanations = _clarification_adjustments(
        agreement=agreement,
        seeded_profile=seeded_profile,
        seeded_price_anchor=baseline_price if baseline_price > 0 else seeded_price_anchor,
        seeded_duration_days=baseline_duration,
        answers=clarification_answers,
    )
    explanation_lines.extend(clarification_explanations)

    suggested_total_price = _money(max(baseline_price + clarification_price_delta, Decimal("0.00")))
    suggested_duration_days = max(baseline_duration + clarification_day_delta, 1 if baseline_duration or clarification_day_delta else 0)

    range_spread = Decimal("0.12")
    if learned_decision.aggregate is not None and learned_weight >= Decimal("0.30"):
        range_spread = Decimal("0.09")
    elif benchmark_source == "seeded_only":
        range_spread = Decimal("0.15")

    suggested_price_low = _money(suggested_total_price * (Decimal("1.00") - range_spread)) if suggested_total_price > 0 else Decimal("0.00")
    suggested_price_high = _money(suggested_total_price * (Decimal("1.00") + range_spread)) if suggested_total_price > 0 else Decimal("0.00")
    suggested_duration_low = max(int(round(suggested_duration_days * (1 - float(range_spread)))), 1) if suggested_duration_days else 0
    suggested_duration_high = max(int(round(suggested_duration_days * (1 + float(range_spread)))), suggested_duration_low) if suggested_duration_days else 0

    confidence_level, confidence_reasoning = _confidence_level(
        seeded_defaults=seeded_defaults,
        learned_decision=learned_decision,
        clarification_answers=clarification_answers,
    )

    source_lead_ai = getattr(getattr(agreement, "source_lead", None), "ai_analysis", None) or {}
    request_snapshot = source_lead_ai.get("request_snapshot") if isinstance(source_lead_ai, dict) else {}
    if not isinstance(request_snapshot, dict):
        request_snapshot = {}
    project_scope_summary = (
        _safe_text(request_snapshot.get("project_scope_summary"))
        or _safe_text(request_snapshot.get("refined_description"))
        or _safe_text(getattr(agreement, "description", ""))
    )
    photo_count = _safe_int(request_snapshot.get("photo_count"), 0)

    milestone_suggestions = _build_milestone_suggestions(
        existing_milestones=_existing_milestones(agreement),
        seeded_defaults=list(seeded_defaults.get("milestone_defaults") or []),
        suggested_total_price=suggested_total_price,
        suggested_duration_days=max(suggested_duration_days, 1),
        clarification_answers=clarification_answers,
    )
    suggested_plan = build_project_plan_suggestion(
        project_title=getattr(getattr(agreement, "project", None), "title", "") or "",
        project_type=getattr(agreement, "project_type", "") or "",
        project_subtype=getattr(agreement, "project_subtype", "") or "",
        description=getattr(agreement, "description", "") or "",
        project_scope_summary=project_scope_summary,
        clarification_answers=clarification_answers,
        photo_count=photo_count,
        suggested_total_price=suggested_total_price,
        suggested_price_low=suggested_price_low,
        suggested_price_high=suggested_price_high,
        suggested_duration_days=suggested_duration_days,
        suggested_duration_low=suggested_duration_low,
        suggested_duration_high=suggested_duration_high,
        confidence_level=confidence_level,
        confidence_reasoning=confidence_reasoning,
        learned_benchmark_used=bool(learned_decision.aggregate is not None and learned_weight > 0),
        seeded_benchmark_used=bool(seeded_defaults.get("benchmark_profile_id")),
        benchmark_source=benchmark_source,
        benchmark_match_scope=seeded_defaults.get("match_scope") or "none",
        template_name=_template_label(agreement),
        selected_template_id=getattr(agreement, "selected_template_id", None),
    )

    return {
        "suggested_total_price": str(suggested_total_price),
        "suggested_price_low": str(suggested_price_low),
        "suggested_price_high": str(suggested_price_high),
        "suggested_duration_days": suggested_duration_days,
        "suggested_duration_low": suggested_duration_low,
        "suggested_duration_high": suggested_duration_high,
        "suggested_milestones": milestone_suggestions,
        "milestone_suggestions": milestone_suggestions,
        "suggested_plan": suggested_plan,
        "price_adjustments": price_adjustments,
        "timeline_adjustments": timeline_adjustments,
        "explanation_lines": explanation_lines,
        "benchmark_source": benchmark_source,
        "benchmark_match_scope": seeded_defaults.get("match_scope") or "none",
        "learned_benchmark_used": learned_decision.aggregate is not None and learned_weight > 0,
        "seeded_benchmark_used": bool(seeded_defaults.get("benchmark_profile_id")),
        "template_used": _template_label(agreement),
        "confidence_level": confidence_level,
        "confidence_reasoning": confidence_reasoning,
        "structured_result_version": STRUCTURED_RESULT_VERSION,
        "source_metadata": {
            "seeded_benchmark_profile_id": seeded_defaults.get("benchmark_profile_id"),
            "seeded_region_scope": seeded_defaults.get("region_scope_used"),
            "seeded_normalized_region_key": seeded_defaults.get("normalized_region_key"),
            "region_priority_weight": seeded_defaults.get("region_priority_weight"),
            "fallback_reason": seeded_defaults.get("fallback_reason") or "",
            "learned_scope": learned_decision.scope_label,
            "learned_completed_project_count": getattr(learned_decision.aggregate, "completed_project_count", 0) if learned_decision.aggregate else 0,
            "learned_weight": str(learned_weight.quantize(Decimal("0.01"))),
            "template_weight": str(template_weight.quantize(Decimal("0.01"))),
            "learned_clarification_signature": _safe_text(getattr(learned_decision.aggregate, "clarification_signature", "")),
            "region_key_used": region_key,
        },
    }
