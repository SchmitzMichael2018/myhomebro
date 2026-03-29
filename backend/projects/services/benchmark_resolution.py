from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any

from projects.models_templates import ProjectTemplate, SeedBenchmarkProfile
from projects.services.regions import build_normalized_region_key


def _safe_text(value) -> str:
    return str(value or "").strip()


@dataclass
class ResolvedBenchmarkDefaults:
    benchmark_profile_id: int | None
    benchmark_source: str
    match_scope: str
    region_scope_used: str
    normalized_region_key: str
    region_priority_weight: str
    price_range: dict[str, str]
    duration_range: dict[str, int]
    milestone_defaults: list[dict[str, Any]]
    clarification_defaults: list[dict[str, Any]]
    multipliers_available: dict[str, bool]
    region_key_used: str
    template_id: int | None
    template_name: str
    benchmark_match_key: str
    fallback_reason: str
    source_metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _profile_queryset():
    return SeedBenchmarkProfile.objects.filter(is_active=True).select_related("template")


def _derive_match_key(project_type: str, project_subtype: str) -> str:
    if project_subtype:
        return f"{project_type}:{project_subtype}".strip().lower().replace(" ", "_")
    return project_type.strip().lower().replace(" ", "_")


def _region_candidates(state: str, city: str, region_key: str) -> list[tuple[str, dict[str, Any]]]:
    candidates: list[tuple[str, dict[str, Any]]] = []
    national_key = build_normalized_region_key(country="US")
    if city and state:
        candidates.append(
            (
                "city",
                {
                    "region_state__iexact": state,
                    "region_city__iexact": city,
                },
            )
        )
    if state:
        candidates.append(
            (
                "state",
                {
                    "region_state__iexact": state,
                    "region_city": "",
                },
            )
        )
    if region_key:
        candidates.append(
            (
                "normalized_region",
                {
                    "normalized_region_key": region_key,
                },
            )
        )
    candidates.append(
            (
                "national",
                {
                    "region_state": "",
                    "region_city": "",
                    "normalized_region_key__in": ["", national_key],
                },
            )
        )
    return candidates


def _resolve_by_chain(
    *,
    qs,
    project_type: str,
    project_subtype: str,
    benchmark_match_key: str,
    region_candidates: list[tuple[str, dict[str, Any]]],
) -> tuple[SeedBenchmarkProfile | None, str, str]:
    for region_scope, region_filter in region_candidates:
        if project_type and project_subtype:
            profile = qs.filter(
                project_type__iexact=project_type,
                project_subtype__iexact=project_subtype,
                **region_filter,
            ).first()
            if profile:
                return profile, f"exact_subtype_{region_scope}", region_scope

        if benchmark_match_key:
            profile = qs.filter(
                benchmark_match_key__iexact=benchmark_match_key,
                **region_filter,
            ).first()
            if profile:
                return profile, f"benchmark_key_{region_scope}", region_scope

        if project_type:
            profile = qs.filter(
                project_type__iexact=project_type,
                project_subtype="",
                **region_filter,
            ).first()
            if profile:
                return profile, f"type_only_{region_scope}", region_scope

    generic_profile = qs.filter(
        project_type="",
        project_subtype="",
        region_state="",
        region_city="",
        normalized_region_key__in=["", build_normalized_region_key(country="US")],
    ).first()
    if generic_profile:
        return generic_profile, "generic_national", "national"
    return None, "no_match", "none"


def _template_defaults(template: ProjectTemplate | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if template is None:
        return [], []
    milestones = [
        {
            "title": milestone.title,
            "description": milestone.description,
            "normalized_milestone_type": milestone.normalized_milestone_type,
            "recommended_days_from_start": milestone.recommended_days_from_start,
            "recommended_duration_days": milestone.recommended_duration_days,
            "suggested_amount_low": str(milestone.suggested_amount_low) if milestone.suggested_amount_low is not None else None,
            "suggested_amount_high": str(milestone.suggested_amount_high) if milestone.suggested_amount_high is not None else None,
            "pricing_confidence": milestone.pricing_confidence,
            "materials_hint": milestone.materials_hint,
            "is_optional": milestone.is_optional,
        }
        for milestone in template.milestones.all().order_by("sort_order", "id")
    ]
    clarifications = list(getattr(template, "default_clarifications", []) or [])
    return milestones, clarifications


def resolve_seed_benchmark_defaults(
    *,
    project_type: str = "",
    project_subtype: str = "",
    region_state: str = "",
    region_city: str = "",
    selected_template_id: int | None = None,
    benchmark_match_key: str = "",
) -> dict[str, Any]:
    project_type = _safe_text(project_type)
    project_subtype = _safe_text(project_subtype)
    region_state = _safe_text(region_state)
    region_city = _safe_text(region_city)
    template: ProjectTemplate | None = None

    if selected_template_id:
        template = (
            ProjectTemplate.objects.filter(pk=selected_template_id)
            .prefetch_related("milestones")
            .select_related("benchmark_profile", "source_system_template")
            .first()
        )
        if template:
            project_type = project_type or _safe_text(template.project_type)
            project_subtype = project_subtype or _safe_text(template.project_subtype)
            benchmark_match_key = benchmark_match_key or _safe_text(template.benchmark_match_key)

    benchmark_match_key = benchmark_match_key or _derive_match_key(project_type, project_subtype)
    region_key = build_normalized_region_key(country="US", state=region_state, city=region_city)
    region_candidates = _region_candidates(region_state, region_city, region_key)

    if template and template.benchmark_profile_id:
        profile = template.benchmark_profile
        match_scope = "template_linked_profile"
        region_scope_used = (
            "city"
            if profile and profile.region_city
            else "state"
            if profile and profile.region_state
            else "normalized_region"
            if profile and profile.normalized_region_key
            else "national"
        )
    else:
        profile, match_scope, region_scope_used = _resolve_by_chain(
            qs=_profile_queryset(),
            project_type=project_type,
            project_subtype=project_subtype,
            benchmark_match_key=benchmark_match_key,
            region_candidates=region_candidates,
        )

    template_milestones, template_clarifications = _template_defaults(template)
    milestone_defaults = template_milestones or list(getattr(profile, "default_milestone_pattern", []) or [])
    clarification_defaults = template_clarifications or list(getattr(profile, "default_clarification_questions", []) or [])

    fallback_reason = ""
    if profile is None:
        fallback_reason = "No seeded benchmark profile matched the requested project context."
        price_low = Decimal("0.00")
        price_high = Decimal("0.00")
        duration_low = 0
        duration_high = 0
        source_note = ""
        location_multiplier = Decimal("1.0000")
        profile_id = None
    else:
        price_low = profile.base_price_low
        price_high = profile.base_price_high
        duration_low = int(profile.base_duration_days_low or 0)
        duration_high = int(profile.base_duration_days_high or 0)
        source_note = profile.source_note
        location_multiplier = profile.location_multiplier
        region_priority_weight = profile.region_priority_weight
        profile_id = profile.id
        if match_scope.startswith("type_only_"):
            fallback_reason = f"No subtype-specific seeded benchmark existed, so a type-level {region_scope_used} fallback was used."
        elif match_scope == "generic_national":
            fallback_reason = "No project-specific seeded benchmark existed, so the generic national fallback was used."
        elif region_scope_used == "national" and (region_state or region_city):
            fallback_reason = "No city, state, or normalized regional override matched, so the national seeded profile was used."
        elif region_scope_used == "state" and region_city:
            fallback_reason = "No city override matched, so the state-level seeded profile was used."
        elif region_scope_used == "normalized_region":
            fallback_reason = "A normalized regional seeded profile matched after city/state-specific checks."
    if profile is None:
        region_priority_weight = Decimal("0.00")

    result = ResolvedBenchmarkDefaults(
        benchmark_profile_id=profile_id,
        benchmark_source="seeded_benchmark_profile" if profile_id else "none",
        match_scope=match_scope,
        region_scope_used=region_scope_used,
        normalized_region_key=getattr(profile, "normalized_region_key", "") or region_key,
        region_priority_weight=str(region_priority_weight),
        price_range={"low": str(price_low), "high": str(price_high)},
        duration_range={"low": duration_low, "high": duration_high},
        milestone_defaults=milestone_defaults,
        clarification_defaults=clarification_defaults,
        multipliers_available={
            "finish_level": bool(profile and profile.finish_level_multipliers),
            "complexity": bool(profile and profile.complexity_multipliers),
            "location": bool(profile and profile.location_multiplier != Decimal("1.0000")),
        },
        region_key_used=region_key,
        template_id=getattr(template, "id", None),
        template_name=getattr(template, "name", "") or "",
        benchmark_match_key=benchmark_match_key,
        fallback_reason=fallback_reason,
        source_metadata={
            "source_note": source_note,
            "location_multiplier": str(location_multiplier),
            "profile_region_state": _safe_text(getattr(profile, "region_state", "")) if profile else "",
            "profile_region_city": _safe_text(getattr(profile, "region_city", "")) if profile else "",
            "profile_normalized_region_key": _safe_text(getattr(profile, "normalized_region_key", "")) if profile else "",
            "template_linked": bool(template and template.benchmark_profile_id),
            "system_template": bool(template and template.is_system),
            "benchmark_specificity": {
                "has_project_type": bool(getattr(profile, "project_type", "")) if profile else False,
                "has_project_subtype": bool(getattr(profile, "project_subtype", "")) if profile else False,
                "has_region_override": bool(getattr(profile, "normalized_region_key", "")) if profile else False,
            },
        },
    )
    return result.to_dict()
