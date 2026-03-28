from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from django.db.models import Count, Prefetch, Q

from projects.models import Contractor
from projects.models_learning import ProjectBenchmarkAggregate
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.services.regions import build_normalized_region_key


def _safe_text(value) -> str:
    return str(value or "").strip()


def _normalize_query_text(value) -> str:
    return _safe_text(value).lower()


def _region_scope_from_key(region_key: str) -> str:
    if not region_key:
        return "none"
    parts = region_key.split("-")
    if len(parts) >= 3:
        return "city"
    if len(parts) == 2:
        return "state"
    return "country"


def _region_match_scope(template_region_key: str, requested_region_key: str) -> str:
    template_region_key = _safe_text(template_region_key)
    requested_region_key = _safe_text(requested_region_key)
    if not template_region_key:
        return "global"
    if not requested_region_key:
        return _region_scope_from_key(template_region_key)
    if template_region_key == requested_region_key:
        return _region_scope_from_key(template_region_key)
    if requested_region_key.startswith(f"{template_region_key}-"):
        return _region_scope_from_key(template_region_key)
    if template_region_key.startswith(f"{requested_region_key}-"):
        return _region_scope_from_key(requested_region_key)
    return ""


def _template_is_regionally_visible(template: ProjectTemplate, requested_region_key: str) -> bool:
    if template.is_system:
        return True
    if template.visibility == ProjectTemplate.Visibility.PUBLIC:
        return bool(template.allow_discovery)
    if template.visibility == ProjectTemplate.Visibility.REGIONAL:
        if not template.allow_discovery:
            return False
        scope = _region_match_scope(template.normalized_region_key, requested_region_key)
        return bool(scope)
    return False


def _template_matches_query(template: ProjectTemplate, query: str) -> bool:
    q = _normalize_query_text(query)
    if not q:
        return True
    haystack = " ".join(
        [
            _safe_text(template.name),
            _safe_text(template.project_type),
            _safe_text(template.project_subtype),
            _safe_text(template.description),
            _safe_text(template.benchmark_match_key),
        ]
    ).lower()
    return q in haystack


@dataclass(frozen=True)
class DiscoveryContext:
    contractor: Contractor | None
    source: str
    project_type: str
    project_subtype: str
    query: str
    sort: str
    benchmark_match_key: str
    region_key: str


def get_template_detail_queryset():
    return (
        ProjectTemplate.objects.annotate(
            template_milestone_count=Count("milestones", distinct=True),
            usage_count=Count("outcome_snapshots", distinct=True),
        )
        .select_related("benchmark_profile", "source_system_template", "published_by", "contractor")
        .prefetch_related(
            Prefetch(
                "milestones",
                queryset=ProjectTemplateMilestone.objects.all().order_by("sort_order", "id"),
            )
        )
    )


def can_access_template(template: ProjectTemplate, contractor: Contractor | None, *, region_key: str = "") -> bool:
    if template.is_system:
        return True
    if contractor is not None and template.contractor_id == contractor.id:
        return True
    return _template_is_regionally_visible(template, region_key)


def _candidate_queryset(contractor: Contractor | None):
    visibility_filter = Q(
        allow_discovery=True,
        visibility__in=[
            ProjectTemplate.Visibility.REGIONAL,
            ProjectTemplate.Visibility.PUBLIC,
        ],
    )
    owned_filter = Q(contractor=contractor) if contractor is not None else Q(pk__in=[])
    return (
        get_template_detail_queryset()
        .filter(Q(is_system=True) | owned_filter | visibility_filter)
        .filter(is_active=True)
    )


def _apply_primary_filters(
    queryset,
    *,
    contractor: Contractor | None,
    source: str,
    project_type: str,
    project_subtype: str,
    benchmark_match_key: str,
):
    if source == "mine":
        queryset = queryset.filter(is_system=False, contractor=contractor)
    elif source == "system":
        queryset = queryset.filter(is_system=True)
    elif source == "regional":
        queryset = queryset.filter(is_system=False, visibility=ProjectTemplate.Visibility.REGIONAL, allow_discovery=True)
    elif source == "public":
        queryset = queryset.filter(is_system=False, visibility=ProjectTemplate.Visibility.PUBLIC, allow_discovery=True)

    if project_type:
        queryset = queryset.filter(project_type__iexact=project_type)
    if project_subtype:
        queryset = queryset.filter(project_subtype__iexact=project_subtype)
    if benchmark_match_key:
        queryset = queryset.filter(benchmark_match_key__iexact=benchmark_match_key)
    return queryset


def attach_template_learning_metrics(templates: Iterable[ProjectTemplate]) -> None:
    template_ids = [template.id for template in templates]
    if not template_ids:
        return
    aggregates = (
        ProjectBenchmarkAggregate.objects.filter(
            scope=ProjectBenchmarkAggregate.Scope.TEMPLATE,
            template_id__in=template_ids,
        )
        .order_by("template_id", "-completed_project_count", "-updated_at")
    )
    best_by_template: dict[int, ProjectBenchmarkAggregate] = {}
    for aggregate in aggregates:
        best_by_template.setdefault(aggregate.template_id, aggregate)

    for template in templates:
        aggregate = best_by_template.get(template.id)
        template._completed_project_count = int(getattr(aggregate, "completed_project_count", 0) or 0)
        template._avg_duration_days = getattr(aggregate, "average_actual_duration_days", None)
        template._avg_final_total = getattr(aggregate, "average_final_total", None)


def _rank_template(template: ProjectTemplate, context: DiscoveryContext) -> None:
    score = 0.0
    reasons: list[str] = []

    owner_match = context.contractor is not None and template.contractor_id == context.contractor.id
    if owner_match:
        score += 250
        reasons.append("owned_by_you")

    if template.is_system:
        score += 180
        reasons.append("system_template")
    elif template.visibility == ProjectTemplate.Visibility.PUBLIC:
        score += 60
        reasons.append("public_template")
    elif template.visibility == ProjectTemplate.Visibility.REGIONAL:
        score += 80
        reasons.append("regional_template")

    if context.project_type and _safe_text(template.project_type).lower() == context.project_type.lower():
        score += 50
        reasons.append("project_type_match")
    if context.project_subtype and _safe_text(template.project_subtype).lower() == context.project_subtype.lower():
        score += 80
        reasons.append("project_subtype_match")

    region_match = _region_match_scope(template.normalized_region_key, context.region_key)
    template.region_match_scope = region_match
    if region_match == "city":
        score += 90
        reasons.append("exact_city_region")
    elif region_match == "state":
        score += 65
        reasons.append("state_region")
    elif region_match == "country":
        score += 20
        reasons.append("national_region")
    elif region_match == "global":
        score += 10
        reasons.append("global_template")

    if template.benchmark_profile_id:
        score += 25
        reasons.append("seeded_benchmark_linked")
    elif _safe_text(template.benchmark_match_key):
        score += 12
        reasons.append("benchmark_key_present")

    completed_project_count = int(getattr(template, "_completed_project_count", 0) or 0)
    usage_count = int(getattr(template, "usage_count", 0) or 0)
    if usage_count:
        score += min(usage_count, 25)
        reasons.append("used_on_projects")
    if completed_project_count:
        score += min(completed_project_count * 2, 50)
        reasons.append("completed_projects")

    if int(getattr(template, "template_milestone_count", 0) or 0) > 0:
        score += 8
        reasons.append("has_milestones")
    if bool(getattr(template, "default_clarifications", None)):
        score += 8
        reasons.append("has_clarifications")

    template.rank_score = round(score, 2)
    template.rank_reasons = reasons


def _sort_templates(templates: list[ProjectTemplate], sort: str) -> list[ProjectTemplate]:
    if sort == "most_used":
        return sorted(
            templates,
            key=lambda t: (
                int(getattr(t, "usage_count", 0) or 0),
                int(getattr(t, "_completed_project_count", 0) or 0),
                t.rank_score,
                t.id,
            ),
            reverse=True,
        )
    if sort == "regional":
        region_order = {"city": 4, "state": 3, "country": 2, "global": 1, "": 0}
        return sorted(
            templates,
            key=lambda t: (
                region_order.get(getattr(t, "region_match_scope", ""), 0),
                t.rank_score,
                t.id,
            ),
            reverse=True,
        )
    if sort == "newest":
        return sorted(templates, key=lambda t: (t.created_at, t.id), reverse=True)
    if sort == "benchmark":
        return sorted(
            templates,
            key=lambda t: (
                1 if getattr(t, "benchmark_profile_id", None) else 0,
                1 if int(getattr(t, "_completed_project_count", 0) or 0) > 0 else 0,
                t.rank_score,
                t.id,
            ),
            reverse=True,
        )
    return sorted(templates, key=lambda t: (t.rank_score, t.id), reverse=True)


def discover_templates(
    *,
    contractor: Contractor | None,
    source: str = "mine",
    project_type: str = "",
    project_subtype: str = "",
    query: str = "",
    sort: str = "relevant",
    benchmark_match_key: str = "",
    region_state: str = "",
    region_city: str = "",
    normalized_region_key: str = "",
) -> dict:
    region_key = _safe_text(normalized_region_key) or build_normalized_region_key(
        country="US",
        state=region_state or getattr(contractor, "state", ""),
        city=region_city or getattr(contractor, "city", ""),
    )
    context = DiscoveryContext(
        contractor=contractor,
        source=_safe_text(source) or "mine",
        project_type=_safe_text(project_type),
        project_subtype=_safe_text(project_subtype),
        query=_safe_text(query),
        sort=_safe_text(sort) or "relevant",
        benchmark_match_key=_safe_text(benchmark_match_key),
        region_key=region_key,
    )

    queryset = _candidate_queryset(contractor)
    queryset = _apply_primary_filters(
        queryset,
        contractor=contractor,
        source=context.source,
        project_type=context.project_type,
        project_subtype=context.project_subtype,
        benchmark_match_key=context.benchmark_match_key,
    )

    templates = []
    for template in queryset:
        if not can_access_template(template, contractor, region_key=context.region_key):
            continue
        if not _template_matches_query(template, context.query):
            continue
        templates.append(template)

    attach_template_learning_metrics(templates)
    for template in templates:
        _rank_template(template, context)

    ordered_templates = _sort_templates(templates, context.sort)
    return {
        "results": ordered_templates,
        "meta": {
            "source": context.source,
            "sort": context.sort,
            "project_type": context.project_type,
            "project_subtype": context.project_subtype,
            "normalized_region_key": context.region_key,
            "count": len(ordered_templates),
        },
    }
