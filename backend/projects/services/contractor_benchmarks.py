from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from statistics import mean
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from types import SimpleNamespace

from projects.models import ProjectBenchmarkAggregate
from projects.models_learning import ContractorBenchmarkAggregate, ProjectOutcomeSnapshot
from projects.services.benchmark_resolution import resolve_seed_benchmark_defaults
from projects.services.project_intelligence import infer_project_intelligence, infer_project_scope_mode
from projects.services.regions import build_normalized_region_key


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


def _money(value: Decimal | float | int | str) -> Decimal:
    return _safe_decimal(value, Decimal("0.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _percentile_decimal(values: list[Decimal], percentile: float) -> Decimal:
    if not values:
        return Decimal("0.00")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = Decimal(str(position - lower))
    lower_value = ordered[lower]
    upper_value = ordered[upper]
    return (lower_value + (upper_value - lower_value) * weight).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _percentile_int(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    if len(ordered) == 1:
        return int(ordered[0])
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return int(round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction))


def _mean_decimal(values: list[Decimal]) -> Decimal:
    if not values:
        return Decimal("0.00")
    return (sum(values) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _mean_int(values: list[int]) -> Decimal:
    if not values:
        return Decimal("0.00")
    return (Decimal(sum(values)) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _template_key(value: Any) -> str:
    return _safe_text(value)


def _project_context_key(context: dict[str, Any]) -> tuple[str, str, str]:
    family_key = _safe_text(context.get("project_family_key"))
    if not family_key:
        family = infer_project_intelligence(
            project_title=_safe_text(context.get("project_title")),
            project_type=_safe_text(context.get("project_type")),
            project_subtype=_safe_text(context.get("project_subtype")),
            description=_safe_text(context.get("project_scope_summary")) or _safe_text(context.get("description")),
        )
        family_key = _safe_text(family.get("key")) or "general"
    scope_mode = _safe_text(context.get("scope_mode"))
    if not scope_mode:
        scope_mode = infer_project_scope_mode(
            text=" ".join(
                part for part in [
                    _safe_text(context.get("project_title")),
                    _safe_text(context.get("project_type")),
                    _safe_text(context.get("project_subtype")),
                    _safe_text(context.get("project_scope_summary")) or _safe_text(context.get("description")),
                ]
                if part
            ),
            family_key=family_key,
        )
    template_used = _template_key(context.get("template_used") or context.get("template_name"))
    return family_key, scope_mode, template_used


def _contractor_snapshot_queryset(contractor_id: int | None = None):
    qs = ProjectOutcomeSnapshot.objects.select_related("contractor", "template")
    if contractor_id:
        qs = qs.filter(contractor_id=contractor_id)
    return qs


def _eligible_snapshot_qs(contractor_id: int | None = None, project_family_key: str = ""):
    qs = _contractor_snapshot_queryset(contractor_id)
    if project_family_key:
        qs = qs.filter(project_family_key__iexact=project_family_key)
    return qs.exclude(total_project_value__isnull=True).exclude(total_project_value=Decimal("0.00"))


def _group_key(snapshot: ProjectOutcomeSnapshot) -> tuple[int, str, str, str]:
    return (
        getattr(snapshot, "contractor_id", None) or 0,
        _safe_text(getattr(snapshot, "project_family_key", "")),
        _safe_text(getattr(snapshot, "scope_mode", "")),
        _safe_text(getattr(snapshot, "template_used", "")),
    )


def _snapshot_to_numbers(snapshot: ProjectOutcomeSnapshot) -> tuple[Decimal | None, int | None]:
    project_value = _safe_decimal(getattr(snapshot, "total_project_value", None), default=None)
    if project_value is None:
        project_value = _safe_decimal(_safe_text(_safe_dict(getattr(snapshot, "final_project_state", {})).get("total_project_value")), default=None)
    duration = _safe_int(getattr(snapshot, "actual_duration_days", None), default=0) or _safe_int(
        _safe_dict(getattr(snapshot, "final_project_state", {})).get("actual_duration_days"),
        default=0,
    )
    return project_value, duration or None


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


@transaction.atomic
def rebuild_contractor_benchmark_aggregates(
    *,
    contractor_ids: list[int] | None = None,
    project_family_keys: list[str] | None = None,
) -> int:
    snapshot_qs = ProjectOutcomeSnapshot.objects.select_related("contractor", "template")
    if contractor_ids:
        snapshot_qs = snapshot_qs.filter(contractor_id__in=contractor_ids)
    if project_family_keys:
        snapshot_qs = snapshot_qs.filter(project_family_key__in=project_family_keys)

    snapshots = list(snapshot_qs.order_by("contractor_id", "project_family_key", "scope_mode", "template_used", "id"))
    if contractor_ids:
        ContractorBenchmarkAggregate.objects.filter(contractor_id__in=contractor_ids).delete()
    elif project_family_keys:
        ContractorBenchmarkAggregate.objects.filter(project_family_key__in=project_family_keys).delete()
    else:
        ContractorBenchmarkAggregate.objects.all().delete()

    grouped: dict[tuple[int, str, str, str], list[ProjectOutcomeSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        if not snapshot.contractor_id:
            continue
        grouped[_group_key(snapshot)].append(snapshot)

    created = 0
    for (contractor_id, family_key, scope_mode, template_used), rows in grouped.items():
        project_values: list[Decimal] = []
        durations: list[int] = []
        milestone_counts: list[int] = []
        dispute_flags = 0
        amendment_flags = 0
        for row in rows:
            project_value, duration = _snapshot_to_numbers(row)
            if project_value is not None:
                project_values.append(project_value)
            if duration is not None:
                durations.append(duration)
            milestone_counts.append(_safe_int(getattr(row, "milestone_count", 0), 0))
            if bool(getattr(row, "dispute_flag", False)):
                dispute_flags += 1
            if _safe_int(getattr(row, "amendment_count", 0), 0) > 0:
                amendment_flags += 1

        sample_size = len(rows)
        if sample_size <= 0:
            continue

        ContractorBenchmarkAggregate.objects.update_or_create(
            contractor_id=contractor_id,
            project_family_key=family_key,
            scope_mode=scope_mode,
            template_used=template_used,
            defaults={
                "sample_size": sample_size,
                "avg_project_value": _mean_decimal(project_values),
                "p25_project_value": _percentile_decimal(project_values, 0.25),
                "p50_project_value": _percentile_decimal(project_values, 0.50),
                "p75_project_value": _percentile_decimal(project_values, 0.75),
                "avg_duration_days": _mean_int(durations),
                "p25_duration_days": Decimal(_percentile_int(durations, 0.25)).quantize(Decimal("0.01")),
                "p50_duration_days": Decimal(_percentile_int(durations, 0.50)).quantize(Decimal("0.01")),
                "p75_duration_days": Decimal(_percentile_int(durations, 0.75)).quantize(Decimal("0.01")),
                "avg_milestone_count": _mean_int(milestone_counts),
                "dispute_rate": (Decimal(dispute_flags) / Decimal(sample_size)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                "amendment_rate": (Decimal(amendment_flags) / Decimal(sample_size)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            },
        )
        created += 1
    return created


def _select_contractor_aggregate(
    *,
    contractor_id: int | None,
    project_family_key: str,
    scope_mode: str,
    template_used: str,
) -> ContractorBenchmarkAggregate | None:
    if not contractor_id:
        return None
    qs = ContractorBenchmarkAggregate.objects.filter(
        contractor_id=contractor_id,
        project_family_key__iexact=project_family_key,
        scope_mode__iexact=scope_mode,
    )
    if template_used:
        exact = qs.filter(template_used__iexact=template_used).order_by("-sample_size", "-last_updated").first()
        if exact:
            return exact
    return qs.order_by("-sample_size", "-last_updated").first()


def _seeded_platform_benchmark(context: dict[str, Any], contractor_id: int | None) -> dict[str, Any]:
    from projects.services.estimation_engine import BENCHMARK_BLEND_WEIGHT, TEMPLATE_BLEND_WEIGHT, _pick_learned_candidate

    seed_defaults = resolve_seed_benchmark_defaults(
        project_type=_safe_text(context.get("project_type")),
        project_subtype=_safe_text(context.get("project_subtype")),
        region_state=_safe_text(context.get("region_state")),
        region_city=_safe_text(context.get("region_city")),
        selected_template_id=context.get("selected_template_id"),
        benchmark_match_key=_safe_text(context.get("benchmark_match_key")),
    )

    agreement_like = SimpleNamespace(
        contractor=SimpleNamespace(id=contractor_id) if contractor_id else None,
        project_type=_safe_text(context.get("project_type")),
        project_subtype=_safe_text(context.get("project_subtype")),
        selected_template_id=context.get("selected_template_id"),
        ai_scope=SimpleNamespace(answers=dict(context.get("clarification_answers") or {})),
        project_address_state=_safe_text(context.get("region_state")),
        project_address_city=_safe_text(context.get("region_city")),
        selected_template=SimpleNamespace(
            name=_safe_text(context.get("template_name")),
            benchmark_match_key=_safe_text(context.get("benchmark_match_key")),
        )
        if context.get("template_name") or context.get("benchmark_match_key")
        else None,
    )
    region_key = build_normalized_region_key(
        country="US",
        state=_safe_text(context.get("region_state")),
        city=_safe_text(context.get("region_city")),
    )
    learned_decision = _pick_learned_candidate(agreement=agreement_like, region_key=region_key)

    price_low = _safe_decimal(seed_defaults.get("price_range", {}).get("low"), Decimal("0.00")) or Decimal("0.00")
    price_high = _safe_decimal(seed_defaults.get("price_range", {}).get("high"), Decimal("0.00")) or Decimal("0.00")
    price_center = Decimal("0.00")
    if price_low > 0 and price_high > 0:
        price_center = _money((price_low + price_high) / Decimal("2"))
    elif price_high > 0:
        price_center = _money(price_high)
    elif price_low > 0:
        price_center = _money(price_low)

    duration_low = _safe_int(seed_defaults.get("duration_range", {}).get("low"), 0)
    duration_high = _safe_int(seed_defaults.get("duration_range", {}).get("high"), 0)
    duration_center = 0
    if duration_low > 0 and duration_high > 0:
        duration_center = max(int(round((duration_low + duration_high) / 2)), 1)
    elif duration_high > 0:
        duration_center = duration_high
    elif duration_low > 0:
        duration_center = duration_low

    if learned_decision.aggregate is not None and learned_decision.learned_weight > 0:
        platform_weight = TEMPLATE_BLEND_WEIGHT
        learned_weight = BENCHMARK_BLEND_WEIGHT
        if price_center > 0 and learned_decision.learned_price > 0:
            price_center = _money((price_center * platform_weight) + (learned_decision.learned_price * learned_weight))
        elif learned_decision.learned_price > 0:
            price_center = learned_decision.learned_price
        if duration_center > 0 and learned_decision.learned_duration_days > 0:
            duration_center = max(
                int(round((duration_center * float(platform_weight)) + (learned_decision.learned_duration_days * float(learned_weight)))),
                1,
            )
        elif learned_decision.learned_duration_days > 0:
            duration_center = learned_decision.learned_duration_days
    return {
        "seed_defaults": seed_defaults,
        "price_center": price_center,
        "duration_center": duration_center,
        "learned_decision": learned_decision,
    }


def _blend_numeric_ranges(
    *,
    platform_low: Decimal,
    platform_high: Decimal,
    contractor_low: Decimal,
    contractor_high: Decimal,
    contractor_weight: Decimal,
    center: Decimal,
) -> tuple[Decimal, Decimal]:
    platform_spread = max((platform_high - platform_low) / Decimal("2"), Decimal("0.00"))
    contractor_spread = max((contractor_high - contractor_low) / Decimal("2"), Decimal("0.00"))
    blended_spread = (platform_spread * (Decimal("1.00") - contractor_weight)) + (contractor_spread * contractor_weight)
    if center <= 0:
        center = platform_low if platform_low > 0 else contractor_low
    if center <= 0:
        center = Decimal("0.00")
    floor_low = platform_low * Decimal("0.60") if platform_low > 0 else Decimal("0.00")
    cap_high = platform_high * Decimal("1.75") if platform_high > 0 else Decimal("0.00")
    low = center - blended_spread
    high = center + blended_spread
    if floor_low > 0:
        low = max(low, floor_low)
    if cap_high > 0:
        high = min(high, cap_high)
    if high < low:
        high = low
    return _money(low), _money(high)


def get_blended_benchmark(project_context: dict[str, Any], contractor_id: int | None) -> dict[str, Any]:
    context = dict(project_context or {})
    family_key, scope_mode, template_used = _project_context_key(context)
    contractor_aggregate = _select_contractor_aggregate(
        contractor_id=contractor_id,
        project_family_key=family_key,
        scope_mode=scope_mode,
        template_used=template_used,
    )
    platform = _seeded_platform_benchmark(context, contractor_id)
    seed_defaults = platform["seed_defaults"]
    learned_decision = platform["learned_decision"]

    platform_price_center = platform["price_center"]
    platform_duration_center = platform["duration_center"]
    platform_price_low = _safe_decimal(seed_defaults.get("price_range", {}).get("low"), Decimal("0.00")) or Decimal("0.00")
    platform_price_high = _safe_decimal(seed_defaults.get("price_range", {}).get("high"), Decimal("0.00")) or Decimal("0.00")
    platform_duration_low = _safe_int(seed_defaults.get("duration_range", {}).get("low"), 0)
    platform_duration_high = _safe_int(seed_defaults.get("duration_range", {}).get("high"), 0)

    contractor_weight = Decimal("0.00")
    contractor_price_center = Decimal("0.00")
    contractor_duration_center = 0
    contractor_price_low = Decimal("0.00")
    contractor_price_high = Decimal("0.00")
    contractor_duration_low = 0
    contractor_duration_high = 0
    contractor_milestone_count = Decimal("0.00")
    contractor_confidence = "low"
    contractor_reason = ""
    contractor_sample_size = 0
    contractor_dispute_rate = Decimal("0.00")
    contractor_amendment_rate = Decimal("0.00")

    if contractor_aggregate is not None:
        contractor_sample_size = int(contractor_aggregate.sample_size or 0)
        contractor_price_center = _safe_decimal(contractor_aggregate.p50_project_value, Decimal("0.00")) or _safe_decimal(contractor_aggregate.avg_project_value, Decimal("0.00")) or Decimal("0.00")
        contractor_price_low = _safe_decimal(contractor_aggregate.p25_project_value, Decimal("0.00")) or contractor_price_center
        contractor_price_high = _safe_decimal(contractor_aggregate.p75_project_value, Decimal("0.00")) or contractor_price_center
        contractor_duration_center = _safe_int(contractor_aggregate.p50_duration_days, 0) or _safe_int(contractor_aggregate.avg_duration_days, 0)
        contractor_duration_low = _safe_int(contractor_aggregate.p25_duration_days, 0) or contractor_duration_center
        contractor_duration_high = _safe_int(contractor_aggregate.p75_duration_days, 0) or contractor_duration_center
        contractor_milestone_count = _safe_decimal(contractor_aggregate.avg_milestone_count, Decimal("0.00")) or Decimal("0.00")
        contractor_dispute_rate = _safe_decimal(contractor_aggregate.dispute_rate, Decimal("0.00")) or Decimal("0.00")
        contractor_amendment_rate = _safe_decimal(contractor_aggregate.amendment_rate, Decimal("0.00")) or Decimal("0.00")

        sample_factor = min(Decimal(contractor_sample_size) / Decimal("12"), Decimal("1.00"))
        quality_factor = Decimal("1.00") - min(
            Decimal("0.70"),
            (contractor_dispute_rate * Decimal("0.65")) + (contractor_amendment_rate * Decimal("0.35")),
        )
        contractor_weight = max(Decimal("0.00"), min(Decimal("0.70"), sample_factor * quality_factor * Decimal("0.70")))
        if contractor_sample_size < 3:
            contractor_weight = min(contractor_weight, Decimal("0.15"))
        elif contractor_sample_size < 5:
            contractor_weight = min(contractor_weight, Decimal("0.30"))
        if contractor_dispute_rate >= Decimal("0.40") or contractor_amendment_rate >= Decimal("0.40"):
            contractor_weight = min(contractor_weight, Decimal("0.20"))

        if contractor_weight > 0:
            contractor_confidence = "medium" if contractor_sample_size < 8 else "high"
            contractor_reason = (
                f"Contractor history contributes {contractor_sample_size} completed project"
                f"{'' if contractor_sample_size == 1 else 's'} for this project family."
            )
        else:
            contractor_reason = "Contractor history exists but is too noisy or sparse to dominate the recommendation."

    platform_weight = Decimal("1.00") - contractor_weight
    if contractor_aggregate is None:
        source_type = "platform_only"
    elif contractor_weight <= Decimal("0.00"):
        source_type = "platform_only"
    else:
        source_type = "platform_plus_contractor"

    blended_price_center = platform_price_center
    blended_duration_center = platform_duration_center
    if contractor_weight > 0 and contractor_price_center > 0:
        blended_price_center = _money((platform_price_center * platform_weight) + (contractor_price_center * contractor_weight)) if platform_price_center > 0 else _money(contractor_price_center)
    if contractor_weight > 0 and contractor_duration_center > 0:
        blended_duration_center = max(
            int(round((platform_duration_center * float(platform_weight)) + (contractor_duration_center * float(contractor_weight)))),
            1,
        ) if platform_duration_center > 0 else contractor_duration_center

    blended_price_low, blended_price_high = _blend_numeric_ranges(
        platform_low=platform_price_low,
        platform_high=platform_price_high,
        contractor_low=contractor_price_low,
        contractor_high=contractor_price_high,
        contractor_weight=contractor_weight,
        center=blended_price_center,
    )
    blended_duration_low, blended_duration_high = _blend_numeric_ranges(
        platform_low=Decimal(platform_duration_low or 0),
        platform_high=Decimal(platform_duration_high or 0),
        contractor_low=Decimal(contractor_duration_low or 0),
        contractor_high=Decimal(contractor_duration_high or 0),
        contractor_weight=contractor_weight,
        center=Decimal(blended_duration_center or 0),
    )

    platform_milestone_count = _safe_decimal(len(seed_defaults.get("milestone_defaults") or []), Decimal("0.00")) or Decimal("0.00")
    if platform_milestone_count <= 0:
        platform_milestone_count = Decimal("4.00")
    blended_milestone_count = platform_milestone_count
    if contractor_weight > 0 and contractor_milestone_count > 0:
        blended_milestone_count = (
            (platform_milestone_count * platform_weight) + (contractor_milestone_count * contractor_weight)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    confidence_score = Decimal("0.00")
    confidence_bits: list[str] = []
    if contractor_aggregate is None:
        confidence_bits.append("No contractor history was available, so platform benchmarks remain in control.")
    else:
        confidence_score = contractor_weight
        confidence_bits.append(contractor_reason)
        if contractor_dispute_rate > Decimal("0.00"):
            confidence_bits.append("Historical disputes reduce the contractor-history weight.")
        if contractor_amendment_rate > Decimal("0.00"):
            confidence_bits.append("Historical amendments reduce the contractor-history weight.")
    if learned_decision.aggregate is not None and learned_decision.learned_weight > 0:
        confidence_bits.append("Platform benchmark learning is also available.")
    if contractor_weight >= Decimal("0.45"):
        confidence = "high"
    elif contractor_weight >= Decimal("0.20"):
        confidence = "medium"
    elif learned_decision.aggregate is not None and learned_decision.learned_weight > 0:
        confidence = "medium"
    else:
        confidence = "low"

    confidence_reasoning = " ".join(bit for bit in confidence_bits if bit).strip() or "Platform benchmarks are the primary source."
    benchmark_source = source_type if contractor_aggregate is None else f"{source_type}_blended"

    return {
        "source_type": source_type,
        "benchmark_source": benchmark_source,
        "weights": {
            "platform": str(platform_weight.quantize(Decimal("0.01"))),
            "contractor": str(contractor_weight.quantize(Decimal("0.01"))),
        },
        "confidence": confidence,
        "confidence_reasoning": confidence_reasoning,
        "project_family_key": family_key,
        "scope_mode": scope_mode,
        "template_used": template_used,
        "pricing_range": {
            "low": str(blended_price_low),
            "high": str(blended_price_high),
            "center": str(blended_price_center.quantize(Decimal("0.01"))) if blended_price_center > 0 else "",
        },
        "duration_range": {
            "low": int(blended_duration_low),
            "high": int(blended_duration_high),
            "center": int(blended_duration_center or 0),
        },
        "milestone_count": int(round(float(blended_milestone_count))) if blended_milestone_count > 0 else 0,
        "milestone_count_range": {
            "low": max(int(round(float(blended_milestone_count))) - 1, 1) if blended_milestone_count > 0 else 0,
            "high": max(int(round(float(blended_milestone_count))) + 1, 1) if blended_milestone_count > 0 else 0,
        },
        "contractor": {
            "sample_size": contractor_sample_size,
            "avg_project_value": str(_safe_decimal(contractor_aggregate.avg_project_value, Decimal("0.00")) if contractor_aggregate else Decimal("0.00")),
            "p50_project_value": str(_safe_decimal(contractor_aggregate.p50_project_value, Decimal("0.00")) if contractor_aggregate else Decimal("0.00")),
            "avg_duration_days": str(_safe_decimal(contractor_aggregate.avg_duration_days, Decimal("0.00")) if contractor_aggregate else Decimal("0.00")),
            "p50_duration_days": str(_safe_decimal(contractor_aggregate.p50_duration_days, Decimal("0.00")) if contractor_aggregate else Decimal("0.00")),
            "avg_milestone_count": str(_safe_decimal(contractor_aggregate.avg_milestone_count, Decimal("0.00")) if contractor_aggregate else Decimal("0.00")),
            "dispute_rate": str(contractor_dispute_rate.quantize(Decimal("0.01"))) if contractor_aggregate else "0.00",
            "amendment_rate": str(contractor_amendment_rate.quantize(Decimal("0.01"))) if contractor_aggregate else "0.00",
        },
        "platform": {
            "seeded_benchmark_profile_id": seed_defaults.get("benchmark_profile_id"),
            "match_scope": seed_defaults.get("match_scope"),
            "region_scope_used": seed_defaults.get("region_scope_used"),
            "benchmark_source": seed_defaults.get("benchmark_source"),
        },
    }
