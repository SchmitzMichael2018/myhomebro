from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import transaction

from projects.models_learning import ProjectOutcomeSnapshot, RegionalBenchmarkAggregate
from projects.services.project_intelligence import infer_project_intelligence, infer_project_scope_mode
from projects.services.regions import build_region_context_from_key, build_region_hierarchy


RELIABLE_COMPLETION_STATUSES = {"completed", "payment_released"}


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
    weight = position - lower
    return int(round(ordered[lower] + (ordered[upper] - ordered[lower]) * weight))


def _mean_decimal(values: list[Decimal]) -> Decimal:
    if not values:
        return Decimal("0.00")
    return (sum(values) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _mean_number(values: list[int]) -> Decimal:
    if not values:
        return Decimal("0.00")
    return (Decimal(sum(values)) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


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
    template_used = _safe_text(context.get("template_used") or context.get("template_name"))
    return family_key, scope_mode, template_used


def _snapshot_is_reliable(snapshot: ProjectOutcomeSnapshot) -> bool:
    status = _safe_text(getattr(snapshot, "completion_status", "")).lower()
    return bool(status and status in RELIABLE_COMPLETION_STATUSES and _safe_decimal(getattr(snapshot, "total_project_value", None), Decimal("0.00")) > 0)


def _snapshot_numbers(snapshot: ProjectOutcomeSnapshot) -> tuple[Decimal | None, int | None]:
    project_value = _safe_decimal(getattr(snapshot, "total_project_value", None), default=None)
    if project_value is None:
        project_value = _safe_decimal(_safe_text(_safe_dict(getattr(snapshot, "final_project_state", {})).get("total_project_value")), default=None)
    duration = _safe_int(getattr(snapshot, "actual_duration_days", None), default=0) or _safe_int(
        _safe_dict(getattr(snapshot, "final_project_state", {})).get("actual_duration_days"),
        default=0,
    )
    return project_value, duration or None


def _region_signatures(snapshot: ProjectOutcomeSnapshot) -> list[dict[str, str]]:
    region_key = _safe_text(getattr(snapshot, "region_key", ""))
    if not region_key:
        return []
    region_context = build_region_context_from_key(region_key)
    hierarchy = build_region_hierarchy(
        country=region_context.get("country", ""),
        state=region_context.get("state", ""),
        city=region_context.get("city", ""),
    )
    if not hierarchy:
        hierarchy = [region_context]
    signatures: list[dict[str, str]] = []
    for region in hierarchy:
        signatures.append(
            {
                "region_key": _safe_text(region.get("region_key", "")),
                "region_label": _safe_text(region.get("region_label", "")),
                "region_granularity": _safe_text(region.get("region_granularity", "")),
            }
        )
    return signatures


def _group_key(snapshot: ProjectOutcomeSnapshot, region_signature: dict[str, str]) -> tuple[str, str, str, str, str]:
    return (
        _safe_text(region_signature.get("region_key", "")),
        _safe_text(region_signature.get("region_granularity", "")),
        _safe_text(getattr(snapshot, "project_family_key", "")),
        _safe_text(getattr(snapshot, "scope_mode", "")),
        _safe_text(getattr(snapshot, "template_used", "")),
    )


def _aggregate_payload(snapshot_rows: list[ProjectOutcomeSnapshot], region_signature: dict[str, str]) -> dict[str, Any]:
    project_values: list[Decimal] = []
    durations: list[int] = []
    milestone_counts: list[int] = []
    dispute_flags = 0
    amendment_flags = 0

    for row in snapshot_rows:
        project_value, duration = _snapshot_numbers(row)
        if project_value is not None:
            project_values.append(project_value)
        if duration is not None:
            durations.append(duration)
        milestone_counts.append(_safe_int(getattr(row, "milestone_count", 0), 0))
        if bool(getattr(row, "dispute_flag", False)):
            dispute_flags += 1
        if _safe_int(getattr(row, "amendment_count", 0), 0) > 0:
            amendment_flags += 1

    sample_size = len(snapshot_rows)
    return {
        "region_key": _safe_text(region_signature.get("region_key", "")),
        "region_label": _safe_text(region_signature.get("region_label", "")),
        "region_granularity": _safe_text(region_signature.get("region_granularity", "unknown")) or "unknown",
        "project_family_key": _safe_text(getattr(snapshot_rows[0], "project_family_key", "")) if snapshot_rows else "",
        "scope_mode": _safe_text(getattr(snapshot_rows[0], "scope_mode", "")) if snapshot_rows else "",
        "template_used": _safe_text(getattr(snapshot_rows[0], "template_used", "")) if snapshot_rows else "",
        "sample_size": sample_size,
        "avg_project_value": _mean_decimal(project_values),
        "p25_project_value": _percentile_decimal(project_values, 0.25),
        "p50_project_value": _percentile_decimal(project_values, 0.50),
        "p75_project_value": _percentile_decimal(project_values, 0.75),
        "avg_duration_days": _mean_number(durations),
        "p25_duration_days": Decimal(_percentile_int(durations, 0.25)).quantize(Decimal("0.01")),
        "p50_duration_days": Decimal(_percentile_int(durations, 0.50)).quantize(Decimal("0.01")),
        "p75_duration_days": Decimal(_percentile_int(durations, 0.75)).quantize(Decimal("0.01")),
        "avg_milestone_count": _mean_number(milestone_counts),
        "dispute_rate": (Decimal(dispute_flags) / Decimal(sample_size)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if sample_size else Decimal("0.00"),
        "amendment_rate": (Decimal(amendment_flags) / Decimal(sample_size)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if sample_size else Decimal("0.00"),
    }


@transaction.atomic
def rebuild_regional_benchmark_aggregates(*, region_keys: list[str] | None = None, project_family_keys: list[str] | None = None) -> int:
    snapshot_qs = ProjectOutcomeSnapshot.objects.select_related("contractor", "template", "agreement")
    if region_keys:
        snapshot_qs = snapshot_qs.filter(region_key__in=region_keys)
    if project_family_keys:
        snapshot_qs = snapshot_qs.filter(project_family_key__in=project_family_keys)

    snapshots = [snapshot for snapshot in snapshot_qs.order_by("region_key", "project_family_key", "scope_mode", "template_used", "id") if _snapshot_is_reliable(snapshot)]
    if region_keys and project_family_keys:
        RegionalBenchmarkAggregate.objects.filter(region_key__in=region_keys, project_family_key__in=project_family_keys).delete()
    elif region_keys:
        RegionalBenchmarkAggregate.objects.filter(region_key__in=region_keys).delete()
    elif project_family_keys:
        RegionalBenchmarkAggregate.objects.filter(project_family_key__in=project_family_keys).delete()
    else:
        RegionalBenchmarkAggregate.objects.all().delete()

    grouped: dict[tuple[str, str, str, str, str], list[ProjectOutcomeSnapshot]] = defaultdict(list)
    region_lookup: dict[tuple[str, str, str, str, str], dict[str, str]] = {}
    for snapshot in snapshots:
        signatures = _region_signatures(snapshot)
        if not signatures:
            continue
        for region_signature in signatures:
            key = _group_key(snapshot, region_signature)
            grouped[key].append(snapshot)
            region_lookup[key] = region_signature

    created = 0
    for key, rows in grouped.items():
        region_signature = region_lookup.get(key, {"region_key": "", "region_label": "", "region_granularity": "unknown"})
        payload = _aggregate_payload(rows, region_signature)
        lookup = {
            "region_key": payload["region_key"],
            "project_family_key": payload["project_family_key"],
            "scope_mode": payload["scope_mode"],
            "template_used": payload["template_used"],
        }
        RegionalBenchmarkAggregate.objects.update_or_create(defaults=payload, **lookup)
        created += 1
    return created


def _candidate_weight(aggregate: RegionalBenchmarkAggregate) -> Decimal:
    sample_size = int(getattr(aggregate, "sample_size", 0) or 0)
    if sample_size < 3:
        return Decimal("0.00")
    sample_factor = min(Decimal(sample_size) / Decimal("15"), Decimal("1.00"))
    quality_factor = Decimal("1.00") - min(
        Decimal("0.70"),
        (Decimal(str(getattr(aggregate, "dispute_rate", 0) or 0)) * Decimal("0.65"))
        + (Decimal(str(getattr(aggregate, "amendment_rate", 0) or 0)) * Decimal("0.35")),
    )
    granularity_factor = {
        "city": Decimal("1.00"),
        "state": Decimal("0.85"),
        "country": Decimal("0.65"),
        "unknown": Decimal("0.55"),
    }.get(_safe_text(getattr(aggregate, "region_granularity", "")).lower(), Decimal("0.55"))
    weight = sample_factor * quality_factor * granularity_factor * Decimal("0.45")
    if sample_size < 5:
        weight = min(weight, Decimal("0.15"))
    elif sample_size < 8:
        weight = min(weight, Decimal("0.25"))
    else:
        weight = min(weight, Decimal("0.35"))
    if Decimal(str(getattr(aggregate, "dispute_rate", 0) or 0)) >= Decimal("0.40") or Decimal(str(getattr(aggregate, "amendment_rate", 0) or 0)) >= Decimal("0.40"):
        weight = min(weight, Decimal("0.20"))
    return max(weight, Decimal("0.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resolve_regional_benchmark(project_context: dict[str, Any]) -> dict[str, Any]:
    context = dict(project_context or {})
    family_key, scope_mode, template_used = (
        _safe_text(context.get("project_family_key")),
        _safe_text(context.get("scope_mode")),
        _safe_text(context.get("template_used") or context.get("template_name")),
    )
    if not family_key:
        family = infer_project_intelligence(
            project_title=_safe_text(context.get("project_title")),
            project_type=_safe_text(context.get("project_type")),
            project_subtype=_safe_text(context.get("project_subtype")),
            description=_safe_text(context.get("project_scope_summary")) or _safe_text(context.get("description")),
        )
        family_key = _safe_text(family.get("key")) or "general"
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

    region_contexts = build_region_hierarchy(
        country=_safe_text(context.get("region_country")) or "US",
        state=_safe_text(context.get("region_state")),
        city=_safe_text(context.get("region_city")),
    )
    if not region_contexts:
        return {
            "aggregate": None,
            "region_key": "",
            "region_label": "",
            "region_granularity": "unknown",
            "sample_size": 0,
            "learned_weight": "0.00",
            "learned_price": "0.00",
            "learned_duration_days": 0,
            "learned_milestone_count": "0.00",
            "confidence": "low",
            "reasoning": "No regional location data was available.",
        }

    candidate_rows: list[tuple[RegionalBenchmarkAggregate, Decimal]] = []
    for region_context in region_contexts:
        region_key = _safe_text(region_context.get("region_key", ""))
        if not region_key:
            continue
        queryset = RegionalBenchmarkAggregate.objects.filter(
            region_key=region_key,
            project_family_key__iexact=family_key,
            scope_mode__iexact=scope_mode,
        )
        if template_used:
            template_match = queryset.filter(template_used__iexact=template_used).order_by("-sample_size", "-last_updated").first()
            if template_match is not None:
                candidate_rows.append((template_match, _candidate_weight(template_match)))
        generic_match = queryset.filter(template_used="").order_by("-sample_size", "-last_updated").first()
        if generic_match is not None:
            candidate_rows.append((generic_match, _candidate_weight(generic_match)))
        if not candidate_rows:
            broader_match = queryset.order_by("-sample_size", "-last_updated").first()
            if broader_match is not None:
                candidate_rows.append((broader_match, (_candidate_weight(broader_match) * Decimal("0.70")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))

    if not candidate_rows:
        return {
            "aggregate": None,
            "region_key": "",
            "region_label": "",
            "region_granularity": "unknown",
            "sample_size": 0,
            "learned_weight": "0.00",
            "learned_price": "0.00",
            "learned_duration_days": 0,
            "learned_milestone_count": "0.00",
            "confidence": "low",
            "reasoning": "No regional benchmark matched the project family and scope.",
        }

    candidate_rows.sort(
        key=lambda item: (
            item[1],
            int(getattr(item[0], "sample_size", 0) or 0),
            {"city": 3, "state": 2, "country": 1, "unknown": 0}.get(_safe_text(getattr(item[0], "region_granularity", "")).lower(), 0),
            int(bool(_safe_text(getattr(item[0], "template_used", "")))),
        ),
        reverse=True,
    )
    aggregate, weight = candidate_rows[0]
    region_context = build_region_context_from_key(_safe_text(getattr(aggregate, "region_key", "")))
    sample_size = int(getattr(aggregate, "sample_size", 0) or 0)
    if weight <= Decimal("0.00"):
        confidence = "low"
    elif sample_size >= 10 and weight >= Decimal("0.25"):
        confidence = "high"
    elif weight >= Decimal("0.15"):
        confidence = "medium"
    else:
        confidence = "low"

    reason_bits = [
        f"Regional history from {region_context.get('region_label') or 'this market'} contributes {sample_size} completed project{'s' if sample_size != 1 else ''} for this project family.",
    ]
    if _safe_decimal(getattr(aggregate, "dispute_rate", 0), Decimal("0.00")) > Decimal("0.00"):
        reason_bits.append("Historical disputes reduce the regional influence.")
    if _safe_decimal(getattr(aggregate, "amendment_rate", 0), Decimal("0.00")) > Decimal("0.00"):
        reason_bits.append("Historical amendments reduce the regional influence.")

    learned_price = _safe_decimal(getattr(aggregate, "p50_project_value", None), Decimal("0.00")) or _safe_decimal(getattr(aggregate, "avg_project_value", None), Decimal("0.00")) or Decimal("0.00")
    learned_duration_days = _safe_int(getattr(aggregate, "p50_duration_days", None), 0) or _safe_int(getattr(aggregate, "avg_duration_days", None), 0)
    learned_milestone_count = _safe_decimal(getattr(aggregate, "avg_milestone_count", None), Decimal("0.00")) or Decimal("0.00")

    return {
        "aggregate": aggregate,
        "region_key": _safe_text(getattr(aggregate, "region_key", "")),
        "region_label": _safe_text(getattr(aggregate, "region_label", "")) or _safe_text(region_context.get("region_label", "")),
        "region_granularity": _safe_text(getattr(aggregate, "region_granularity", "")) or _safe_text(region_context.get("region_granularity", "unknown")),
        "sample_size": sample_size,
        "learned_weight": str(weight),
        "learned_price": str(_money(learned_price)),
        "learned_duration_days": learned_duration_days,
        "learned_milestone_count": str(_safe_decimal(learned_milestone_count, Decimal("0.00")) or Decimal("0.00")),
        "confidence": confidence,
        "reasoning": " ".join(reason_bits).strip(),
        "dispute_rate": str(_safe_decimal(getattr(aggregate, "dispute_rate", None), Decimal("0.00")) or Decimal("0.00")),
        "amendment_rate": str(_safe_decimal(getattr(aggregate, "amendment_rate", None), Decimal("0.00")) or Decimal("0.00")),
    }
