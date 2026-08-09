from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from projects.models_learning import ContractorBenchmarkAggregate
from projects.services.project_intelligence import infer_project_intelligence, infer_project_scope_mode
from projects.services.regional_benchmarks import resolve_regional_benchmark


MIN_REGIONAL_BENCHMARK_SAMPLE = 5

SCOPE_MODE_LABELS = {
    "repair": "Repair",
    "replacement": "Replacement",
    "remodel": "Remodel",
    "install": "Installation",
    "install_removal": "Installation and removal",
    "interior": "Interior",
    "exterior": "Exterior",
    "interior_exterior": "Interior and exterior",
    "shed": "Shed",
    "garage": "Garage",
    "outdoor_structure": "Outdoor structure",
    "general": "General scope",
}


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _money(value: Any) -> str:
    return str(Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _proposal_total(proposal) -> Decimal:
    subtotal = tax = incidentals = discounts = Decimal("0.00")
    for item in proposal.line_items.all():
        amount = Decimal(item.total or 0)
        if item.category == "tax":
            tax += amount
        elif item.category == "discount":
            discounts += abs(amount)
        elif item.category == "incidentals_reserve":
            incidentals += amount
        else:
            subtotal += amount
    return (subtotal + tax + incidentals - discounts).quantize(Decimal("0.01"))


def _position(total: Decimal, low: Any, high: Any) -> str:
    low_value = Decimal(str(low or 0))
    high_value = Decimal(str(high or 0))
    if total < low_value:
        return "below"
    if total > high_value:
        return "above"
    return "within"


def _confidence(sample_size: int, *, regional: bool = False, granularity: str = "") -> str:
    if sample_size >= 10 and (not regional or granularity in {"city", "state"}):
        return "high"
    if sample_size >= 5:
        return "medium"
    return "low"


def _inferred_classification(*, title: str = "", project_type: str = "", project_subtype: str = "", description: str = ""):
    family = infer_project_intelligence(
        project_title=title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description,
    )
    family_key = _text(family.get("key")) or "general"
    family_label = _text(family.get("label")) or family_key.replace("_", " ").title()
    scope_mode = infer_project_scope_mode(
        text=" ".join(filter(None, [title, project_type, project_subtype, description])),
        family_key=family_key,
    )
    return family_key, family_label, scope_mode


def _benchmark_key_scope_mode(benchmark_match_key: str) -> str:
    prefix = _text(benchmark_match_key).lower().split(":", 1)[0]
    return prefix if prefix in SCOPE_MODE_LABELS else ""


def _meaningful_structured_values(project_type: str, project_subtype: str) -> bool:
    values = {_text(project_type).lower(), _text(project_subtype).lower()}
    return bool(values - {"", "general", "custom", "other", "project"})


def classify_proposal_benchmark(proposal) -> tuple[dict[str, str], str]:
    """Classify comparable work from strongest structured source to weakest text."""
    template = getattr(proposal, "selected_template", None)
    source_template = getattr(template, "source_system_template", None) if template is not None else None
    template_name = _text(getattr(template, "name", "")) or _text(getattr(proposal, "selected_template_name_snapshot", ""))
    benchmark_key = _text(getattr(template, "benchmark_match_key", "")) or _text(getattr(source_template, "benchmark_match_key", ""))
    template_type = _text(getattr(template, "project_type", "")) or _text(getattr(source_template, "project_type", ""))
    template_subtype = _text(getattr(template, "project_subtype", "")) or _text(getattr(source_template, "project_subtype", ""))

    if benchmark_key:
        family_key, family_label, inferred_mode = _inferred_classification(
            title=template_name,
            project_type=template_type,
            project_subtype=template_subtype or benchmark_key.replace(":", " ").replace("_", " "),
        )
        scope_mode = _benchmark_key_scope_mode(benchmark_key) or inferred_mode
        source = "template_benchmark_metadata" if _text(getattr(template, "benchmark_match_key", "")) else "source_template_benchmark_metadata"
    elif template is not None and _meaningful_structured_values(template_type, template_subtype):
        family_key, family_label, scope_mode = _inferred_classification(
            title=template_name,
            project_type=template_type,
            project_subtype=template_subtype,
        )
        source = "selected_template"
    elif _meaningful_structured_values(getattr(proposal, "project_type", ""), getattr(proposal, "project_subtype", "")):
        family_key, family_label, scope_mode = _inferred_classification(
            project_type=proposal.project_type,
            project_subtype=proposal.project_subtype,
        )
        source = "proposal_project_type"
    else:
        opportunity = getattr(proposal, "contractor_opportunity", None)
        opportunity_type = _text(getattr(opportunity, "project_type", ""))
        opportunity_subtype = _text(getattr(opportunity, "project_subtype", ""))
        if opportunity is not None and _meaningful_structured_values(opportunity_type, opportunity_subtype):
            family_key, family_label, scope_mode = _inferred_classification(
                project_type=opportunity_type,
                project_subtype=opportunity_subtype,
            )
            source = "opportunity_project_type"
        elif template_name:
            family_key, family_label, scope_mode = _inferred_classification(title=template_name)
            source = "selected_template_name"
        else:
            family_key, family_label, scope_mode = _inferred_classification(
                title=proposal.project_title,
                project_type=proposal.project_type,
                project_subtype=proposal.project_subtype,
                description=proposal.project_summary,
            )
            source = "proposal_text" if family_key != "general" else "general_fallback"

    scope_label = SCOPE_MODE_LABELS.get(scope_mode, scope_mode.replace("_", " ").title() or "General scope")
    return {
        "project_family_key": family_key,
        "scope_mode": scope_mode,
        "match_description": f"{family_label} · {scope_label}",
        "classification_source": source,
    }, template_name


def _location(proposal) -> dict[str, str]:
    opportunity = getattr(proposal, "contractor_opportunity", None)
    # Proposal.service_location is intentionally not parsed: it is free text and
    # must not be represented as reliable city-level benchmark geography.
    return {
        "region_country": "US",
        "region_state": _text(getattr(opportunity, "project_state", "")),
        "region_city": _text(getattr(opportunity, "project_city", "")),
    }


def _contractor_aggregate(proposal, classification: dict[str, str], template_name: str):
    queryset = ContractorBenchmarkAggregate.objects.filter(
        contractor_id=proposal.contractor_id,
        project_family_key__iexact=classification["project_family_key"],
        scope_mode__iexact=classification["scope_mode"],
    )
    if template_name:
        exact = queryset.filter(template_used__iexact=template_name).order_by("-sample_size", "-last_updated").first()
        if exact:
            return exact
    return queryset.order_by("-sample_size", "-last_updated").first()


def _unavailable(reason: str, **extra) -> dict[str, Any]:
    return {"available": False, "reason": reason, **extra}


def build_proposal_pricing_benchmark(proposal) -> dict[str, Any]:
    """Return presentation-safe aggregate pricing context for one owned Proposal."""
    classification, template_name = classify_proposal_benchmark(proposal)
    total = _proposal_total(proposal)
    contractor_aggregate = _contractor_aggregate(proposal, classification, template_name)

    if contractor_aggregate is None or contractor_aggregate.sample_size <= 0:
        contractor = _unavailable("insufficient_comparable_data")
    else:
        count = int(contractor_aggregate.sample_size)
        contractor = {
            "available": True,
            "reference_only": count == 1,
            "count": count,
            "p25": _money(contractor_aggregate.p25_project_value),
            "median": _money(contractor_aggregate.p50_project_value),
            "p75": _money(contractor_aggregate.p75_project_value),
            "position": _position(total, contractor_aggregate.p25_project_value, contractor_aggregate.p75_project_value),
            "confidence": _confidence(count),
        }

    location = _location(proposal)
    regional_decision = resolve_regional_benchmark({
        **classification,
        **location,
        "project_title": proposal.project_title,
        "project_type": proposal.project_type,
        "project_subtype": proposal.project_subtype,
        "project_scope_summary": proposal.project_summary,
        "template_used": template_name,
    })
    regional_aggregate = regional_decision.get("aggregate")
    regional_count = int(getattr(regional_aggregate, "sample_size", 0) or 0)
    if regional_aggregate is None or regional_count < MIN_REGIONAL_BENCHMARK_SAMPLE:
        regional = _unavailable(
            "insufficient_comparable_data",
            minimum_required=MIN_REGIONAL_BENCHMARK_SAMPLE,
        )
    else:
        granularity = _text(regional_decision.get("region_granularity")) or "unknown"
        regional = {
            "available": True,
            "count": regional_count,
            "p25": _money(regional_aggregate.p25_project_value),
            "median": _money(regional_aggregate.p50_project_value),
            "p75": _money(regional_aggregate.p75_project_value),
            "position": _position(total, regional_aggregate.p25_project_value, regional_aggregate.p75_project_value),
            "confidence": _confidence(regional_count, regional=True, granularity=granularity),
            "region_label": _text(regional_decision.get("region_label")),
            "geography_level": granularity,
        }

    return {
        "available": bool(contractor.get("available") or regional.get("available")),
        "advisory_only": True,
        "current_total": _money(total),
        "classification": classification,
        "contractor": contractor,
        "regional": regional,
        "pricing_provenance": {
            "type": "template" if _text(proposal.pricing_template_name_snapshot) else "contractor_entered",
            "template_name": _text(proposal.pricing_template_name_snapshot),
        },
    }
