from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from django.db.models import Q

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    EmployeeCapability,
    Milestone,
    Skill,
)
from projects.models_contractor_discovery import ContractorOpportunity


ADVISORY_NOTICE = (
    "Recommended Crew is advisory only. Review availability, scope, licensing, and customer commitments before assigning work."
)

LEVEL_RANK = {
    "beginner": 1,
    "working": 2,
    "skilled": 3,
    "lead": 4,
    "expert": 5,
}

TRADE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Demolition", ("demo", "demolition", "tear out", "remove old", "removal")),
    ("Cleanup", ("cleanup", "clean up", "debris", "haul away", "trash")),
    ("General Labor", ("labor", "helper", "move", "prep", "site prep", "load", "unload")),
    ("Carpentry", ("carpentry", "framing", "frame", "wood repair", "stairs")),
    ("Finish Carpentry", ("trim", "baseboard", "crown", "finish carpentry", "millwork")),
    ("Drywall", ("drywall", "sheetrock", "texture", "patch wall")),
    ("Painting", ("paint", "painting", "stain", "primer")),
    ("Flooring", ("floor", "flooring", "laminate", "vinyl", "hardwood", "carpet")),
    ("Roofing", ("roof", "roofing", "shingle", "flashing")),
    ("Plumbing", ("plumb", "plumbing", "pipe", "water heater", "toilet", "faucet", "drain")),
    ("Electrical", ("electric", "electrical", "outlet", "breaker", "panel", "wiring", "lighting")),
    ("HVAC", ("hvac", "air conditioning", "furnace", "heat pump", "duct")),
    ("Concrete", ("concrete", "cement", "slab", "driveway", "sidewalk")),
    ("Masonry", ("masonry", "brick", "stone", "block")),
    ("Tile", ("tile", "backsplash", "grout", "shower surround")),
    ("Cabinet Installation", ("cabinet", "cabinets", "vanity")),
    ("Landscaping", ("landscape", "landscaping", "sod", "mulch", "garden")),
    ("Irrigation", ("irrigation", "sprinkler")),
    ("Tree Work", ("tree", "stump", "branch", "limb")),
    ("Pressure Washing", ("pressure wash", "power wash")),
    ("Fencing", ("fence", "fencing", "gate")),
    ("Windows & Doors", ("window", "windows", "door", "doors")),
    ("Gutters", ("gutter", "gutters", "downspout")),
    ("Appliance Installation", ("appliance", "dishwasher", "range", "oven", "washer", "dryer")),
    ("Smart Home", ("smart home", "thermostat", "camera", "doorbell", "automation")),
    ("Pool Service", ("pool", "spa", "swimming")),
)


@dataclass(frozen=True)
class SourceContext:
    source_type: str
    source_id: int
    contractor: Contractor
    title: str
    project_type: str
    project_subtype: str
    description: str
    start: date | None = None
    end: date | None = None
    milestone_text: str = ""


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _lower_text(*values: Any) -> str:
    return " ".join(_safe_text(value) for value in values if _safe_text(value)).lower()


def _source_summary(ctx: SourceContext) -> dict[str, Any]:
    return {
        "source_type": ctx.source_type,
        "source_id": ctx.source_id,
        "project_title": ctx.title,
        "project_type": ctx.project_type,
        "project_subtype": ctx.project_subtype,
        "start": ctx.start.isoformat() if ctx.start else None,
        "end": ctx.end.isoformat() if ctx.end else None,
    }


def _resolve_opportunity(*, contractor: Contractor, source_id: int) -> SourceContext:
    opportunity = (
        ContractorOpportunity.objects.select_related("directory_entry")
        .filter(pk=source_id)
        .filter(Q(directory_entry__claimed_by_contractor=contractor) | Q(accepted_by_contractor=contractor))
        .first()
    )
    if opportunity is None:
        raise PermissionError("Opportunity not found for this contractor.")
    return SourceContext(
        source_type="opportunity",
        source_id=opportunity.id,
        contractor=contractor,
        title=_safe_text(opportunity.project_title) or f"Opportunity #{opportunity.id}",
        project_type=_safe_text(opportunity.project_type),
        project_subtype=_safe_text(opportunity.project_subtype),
        description=_safe_text(opportunity.refined_description) or _safe_text(opportunity.project_description),
    )


def _resolve_agreement(*, contractor: Contractor, source_id: int) -> SourceContext:
    agreement = (
        Agreement.objects.select_related("project")
        .prefetch_related("milestones")
        .filter(pk=source_id, contractor=contractor)
        .first()
    )
    if agreement is None:
        raise PermissionError("Agreement not found for this contractor.")
    milestones = list(agreement.milestones.all().order_by("order", "id"))
    milestone_text = " ".join(
        _lower_text(
            milestone.title,
            milestone.description,
            milestone.normalized_milestone_type,
            milestone.materials_hint,
        )
        for milestone in milestones
    )
    project = getattr(agreement, "project", None)
    return SourceContext(
        source_type="agreement",
        source_id=agreement.id,
        contractor=contractor,
        title=_safe_text(getattr(project, "title", "")) or f"Agreement #{agreement.id}",
        project_type=_safe_text(agreement.project_type),
        project_subtype=_safe_text(agreement.project_subtype),
        description=_safe_text(agreement.description),
        start=agreement.start,
        end=agreement.end,
        milestone_text=milestone_text,
    )


def resolve_source_context(*, contractor: Contractor, source_type: str, source_id: int) -> SourceContext:
    normalized = _safe_text(source_type).lower()
    if normalized == "opportunity":
        return _resolve_opportunity(contractor=contractor, source_id=source_id)
    if normalized == "agreement":
        return _resolve_agreement(contractor=contractor, source_id=source_id)
    raise ValueError("source_type must be opportunity or agreement.")


def _quantity_for_trade(skill_name: str, text: str) -> int:
    if skill_name == "General Labor":
        return 2 if any(term in text for term in ("remodel", "renovation", "buildout", "demo", "demolition")) else 1
    if skill_name in {"Demolition", "Cleanup"}:
        return 2 if "whole" in text or "full" in text else 1
    return 1


def infer_required_capabilities(ctx: SourceContext) -> list[dict[str, Any]]:
    text = _lower_text(ctx.title, ctx.project_type, ctx.project_subtype, ctx.description, ctx.milestone_text)
    matched: list[str] = []
    for skill_name, terms in TRADE_RULES:
        if any(term in text for term in terms):
            matched.append(skill_name)
    if not matched:
        matched.append("General Labor")

    skills = {skill.name: skill for skill in Skill.objects.filter(name__in=matched)}
    required = []
    for skill_name in matched:
        skill = skills.get(skill_name)
        if skill is None:
            required.append(
                {
                    "skill_id": None,
                    "skill_name": skill_name,
                    "skill_slug": "",
                    "quantity": _quantity_for_trade(skill_name, text),
                    "minimum_skill_level": "working",
                    "reason": "Project details suggest this trade, but the catalog row is missing.",
                }
            )
            continue
        required.append(
            {
                "skill_id": skill.id,
                "skill_name": skill.name,
                "skill_slug": skill.slug,
                "quantity": _quantity_for_trade(skill.name, text),
                "minimum_skill_level": "working",
                "reason": f"Matched from project type, subtype, description, or milestone text for {skill.name.lower()} work.",
            }
        )
    return required


def _assignment_warnings_for_member(ctx: SourceContext, subaccount: ContractorSubAccount) -> list[str]:
    if not ctx.start or not ctx.end:
        return ["No project start/end dates available; schedule conflict check is limited."]

    warnings: list[str] = []
    assigned_agreement_ids = AgreementAssignment.objects.filter(subaccount=subaccount).values_list("agreement_id", flat=True)
    overlapping = (
        Agreement.objects.filter(id__in=assigned_agreement_ids, contractor=ctx.contractor)
        .exclude(id=ctx.source_id if ctx.source_type == "agreement" else None)
        .filter(start__isnull=False, end__isnull=False, start__lte=ctx.end, end__gte=ctx.start)
        .select_related("project")
    )
    for agreement in overlapping[:3]:
        project = getattr(agreement, "project", None)
        warnings.append(
            f"Already assigned to overlapping agreement: {_safe_text(getattr(project, 'title', '')) or f'Agreement #{agreement.id}'}."
        )
    return warnings


def build_crew_recommendation_preview(ctx: SourceContext) -> dict[str, Any]:
    required = infer_required_capabilities(ctx)
    skill_ids = [row["skill_id"] for row in required if row.get("skill_id")]
    capabilities = (
        EmployeeCapability.objects.filter(subaccount__parent_contractor=ctx.contractor, skill_id__in=skill_ids)
        .select_related("subaccount", "subaccount__user", "skill")
        .order_by("-subaccount__is_active", "subaccount__display_name", "skill__name")
    )

    caps_by_skill: dict[int, list[EmployeeCapability]] = {}
    for capability in capabilities:
        caps_by_skill.setdefault(capability.skill_id, []).append(capability)

    recommended_members: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    used_subaccount_ids: set[int] = set()

    for requirement in required:
        skill_id = requirement.get("skill_id")
        quantity = int(requirement.get("quantity") or 1)
        candidates = list(caps_by_skill.get(skill_id, [])) if skill_id else []
        candidates.sort(
            key=lambda cap: (
                0 if cap.subaccount_id in used_subaccount_ids else 1,
                1 if cap.subaccount.is_active else 0,
                LEVEL_RANK.get(cap.skill_level, 0),
                cap.subaccount.display_name.lower(),
            ),
            reverse=True,
        )
        chosen = candidates[:quantity]
        for capability in chosen:
            used_subaccount_ids.add(capability.subaccount_id)
            member_warnings = _assignment_warnings_for_member(ctx, capability.subaccount)
            for warning in member_warnings:
                warnings.append(
                    {
                        "type": "schedule_conflict" if "overlapping agreement" in warning.lower() else "schedule_data",
                        "subaccount_id": capability.subaccount_id,
                        "message": warning,
                    }
                )
            recommended_members.append(
                {
                    "subaccount_id": capability.subaccount_id,
                    "display_name": capability.subaccount.display_name,
                    "email": getattr(getattr(capability.subaccount, "user", None), "email", ""),
                    "is_active": bool(capability.subaccount.is_active),
                    "permission_role": capability.subaccount.role,
                    "matched_skill_id": capability.skill_id,
                    "matched_skill_name": capability.skill.name,
                    "skill_level": capability.skill_level,
                    "skill_level_label": capability.get_skill_level_display(),
                    "explanation": (
                        f"{capability.subaccount.display_name} has {capability.skill.name} capability at "
                        f"{capability.get_skill_level_display()} level."
                    ),
                    "warnings": member_warnings,
                }
            )

        missing = max(quantity - len(chosen), 0)
        if missing:
            gaps.append(
                {
                    "skill_id": skill_id,
                    "skill_name": requirement.get("skill_name", ""),
                    "missing_quantity": missing,
                    "reason": "Not enough active or recorded employees with this capability.",
                }
            )

    if ctx.source_type == "opportunity":
        warnings.append(
            {
                "type": "schedule_data",
                "message": "Opportunity records usually do not include confirmed start/end dates; conflict checks are limited until an agreement is drafted.",
            }
        )

    return {
        "source_summary": _source_summary(ctx),
        "required_capabilities": required,
        "recommended_members": recommended_members,
        "gaps": gaps,
        "warnings": warnings,
        "advisory_notice": ADVISORY_NOTICE,
    }
