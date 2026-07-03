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
    CrewAssignmentDraft,
    EmployeeCapability,
    Milestone,
    MilestoneAssignment,
    Skill,
)
from projects.models_contractor_discovery import ContractorOpportunity
from projects.services.assignment_conflicts import evaluate_assignment_conflicts


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


def _safe_source_id(ctx: SourceContext, source_type: str) -> int | None:
    return ctx.source_id if ctx.source_type == source_type else None


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


def _skill_rule_terms(skill_name: str) -> tuple[str, ...]:
    for rule_skill_name, terms in TRADE_RULES:
        if rule_skill_name == skill_name:
            return terms
    return (skill_name.lower(),)


def _milestone_matches_member(milestone: Milestone, member: dict[str, Any]) -> bool:
    text = _lower_text(
        milestone.title,
        milestone.description,
        milestone.normalized_milestone_type,
        milestone.materials_hint,
    )
    skill_name = _safe_text(member.get("matched_skill_name"))
    if not skill_name:
        return False
    return any(term in text for term in _skill_rule_terms(skill_name))


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


def _build_assignment_plan(ctx: SourceContext, preview: dict[str, Any]) -> dict[str, Any]:
    recommended_members = list(preview.get("recommended_members") or [])
    source_summary = preview.get("source_summary") or _source_summary(ctx)
    agreement_target_id = ctx.source_id if ctx.source_type == "agreement" else None

    suggested_agreement_assignments: list[dict[str, Any]] = []
    seen_members: set[int] = set()
    for member in recommended_members:
        subaccount_id = member.get("subaccount_id")
        if not subaccount_id or subaccount_id in seen_members:
            continue
        seen_members.add(subaccount_id)
        suggested_agreement_assignments.append(
            {
                "target_type": "agreement" if agreement_target_id else "future_agreement",
                "agreement_id": agreement_target_id,
                "source_type": source_summary.get("source_type"),
                "source_id": source_summary.get("source_id"),
                "subaccount_id": subaccount_id,
                "display_name": member.get("display_name", ""),
                "matched_skill_name": member.get("matched_skill_name", ""),
                "skill_level_label": member.get("skill_level_label", ""),
                "apply_safe": False,
                "reason": (
                    "Suggested for agreement-level assignment after contractor review."
                    if agreement_target_id
                    else "Opportunity must be converted to an agreement before assignment can be applied."
                ),
            }
        )

    suggested_milestone_assignments: list[dict[str, Any]] = []
    if ctx.source_type == "agreement":
        milestones = (
            Milestone.objects.filter(agreement_id=ctx.source_id, subaccount_assignment__isnull=True)
            .order_by("order", "id")
        )
        for milestone in milestones:
            member = next((candidate for candidate in recommended_members if _milestone_matches_member(milestone, candidate)), None)
            if not member:
                continue
            suggested_milestone_assignments.append(
                {
                    "target_type": "milestone",
                    "agreement_id": ctx.source_id,
                    "milestone_id": milestone.id,
                    "milestone_title": milestone.title,
                    "subaccount_id": member.get("subaccount_id"),
                    "display_name": member.get("display_name", ""),
                    "matched_skill_name": member.get("matched_skill_name", ""),
                    "skill_level_label": member.get("skill_level_label", ""),
                    "apply_safe": False,
                    "reason": "Milestone text appears to match this employee capability; review before applying.",
                }
            )

    return {
        "apply_enabled": False,
        "apply_disabled_reason": "Apply coming soon.",
        "suggested_agreement_assignments": suggested_agreement_assignments,
        "suggested_milestone_assignments": suggested_milestone_assignments,
    }


def serialize_assignment_draft(draft: CrewAssignmentDraft) -> dict[str, Any]:
    preview = draft.preview_snapshot or {}
    assignment_plan = draft.assignment_plan or {}
    return {
        "id": draft.id,
        "status": draft.status,
        "source_summary": preview.get("source_summary", {}),
        "required_capabilities": preview.get("required_capabilities", []),
        "recommended_members": preview.get("recommended_members", []),
        "gaps": preview.get("gaps", []),
        "warnings": preview.get("warnings", []),
        "advisory_notice": preview.get("advisory_notice", ADVISORY_NOTICE),
        "assignment_plan": assignment_plan,
        "apply_enabled": bool(draft.apply_enabled and assignment_plan.get("apply_enabled")),
        "apply_disabled_reason": assignment_plan.get("apply_disabled_reason", "Apply coming soon."),
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
    }


def create_assignment_draft_from_preview(ctx: SourceContext, *, created_by=None) -> dict[str, Any]:
    preview = build_crew_recommendation_preview(ctx)
    assignment_plan = _build_assignment_plan(ctx, preview)
    draft = CrewAssignmentDraft.objects.create(
        contractor=ctx.contractor,
        source_type=ctx.source_type,
        source_opportunity_id=_safe_source_id(ctx, "opportunity"),
        source_agreement_id=_safe_source_id(ctx, "agreement"),
        preview_snapshot=preview,
        assignment_plan=assignment_plan,
        apply_enabled=False,
        created_by=created_by if getattr(created_by, "is_authenticated", False) else None,
    )
    return serialize_assignment_draft(draft)


def _int_set(values: Any) -> set[int]:
    if not isinstance(values, (list, tuple, set)):
        return set()
    parsed: set[int] = set()
    for value in values:
        try:
            parsed.add(int(value))
        except (TypeError, ValueError):
            continue
    return parsed


def _subaccount_label(subaccount: ContractorSubAccount | None, fallback: str = "Employee") -> str:
    if subaccount is None:
        return fallback
    return subaccount.display_name or getattr(getattr(subaccount, "user", None), "email", "") or fallback


def _target_key(prefix: str, *parts: Any) -> str:
    return ":".join([prefix, *(str(part) for part in parts if part is not None)])


def validate_assignment_draft_apply(
    draft: CrewAssignmentDraft,
    *,
    confirmations: dict[str, Any] | None = None,
    selected_targets: dict[str, Any] | None = None,
) -> dict[str, Any]:
    confirmations = confirmations or {}
    selected_targets = selected_targets or {}
    confirmed_supervisor_sub_ids = _int_set(confirmations.get("supervisor_overlap_subaccount_ids"))
    confirmed_replace_milestone_ids = _int_set(confirmations.get("replace_milestone_ids"))
    selected_agreement_sub_ids = _int_set(selected_targets.get("agreement_subaccount_ids"))
    selected_milestone_ids = _int_set(selected_targets.get("milestone_ids"))

    plan = draft.assignment_plan or {}
    source_summary = (draft.preview_snapshot or {}).get("source_summary", {})
    response: dict[str, Any] = {
        "draft_id": draft.id,
        "source_summary": source_summary,
        "apply_ready": False,
        "apply_enabled": False,
        "apply_disabled_reason": "Apply coming soon.",
        "selected_targets": {
            "agreement_assignments": [],
            "milestone_assignments": [],
        },
        "safe_targets": [],
        "blocking_issues": [],
        "warnings": [],
        "required_confirmations": [],
        "advisory_notice": "This is a validation preview only. No assignments were created.",
    }

    if draft.source_type != CrewAssignmentDraft.SOURCE_AGREEMENT or not draft.source_agreement_id:
        response["blocking_issues"].append(
            {
                "type": "source_not_apply_ready",
                "message": "Only agreement-source assignment drafts can be validated for apply readiness.",
            }
        )
        return response

    agreement = (
        Agreement.objects.select_related("project")
        .filter(id=draft.source_agreement_id, contractor=draft.contractor)
        .first()
    )
    if agreement is None:
        response["blocking_issues"].append(
            {
                "type": "agreement_not_found",
                "message": "The source agreement is no longer available for this contractor.",
            }
        )
        return response

    agreement_targets = list(plan.get("suggested_agreement_assignments") or [])
    milestone_targets = list(plan.get("suggested_milestone_assignments") or [])
    if selected_agreement_sub_ids:
        filtered = []
        for target in agreement_targets:
            try:
                if int(target.get("subaccount_id") or 0) in selected_agreement_sub_ids:
                    filtered.append(target)
            except (TypeError, ValueError):
                continue
        agreement_targets = filtered
    if selected_milestone_ids:
        filtered = []
        for target in milestone_targets:
            try:
                if int(target.get("milestone_id") or 0) in selected_milestone_ids:
                    filtered.append(target)
            except (TypeError, ValueError):
                continue
        milestone_targets = filtered

    if not agreement_targets and not milestone_targets:
        response["blocking_issues"].append(
            {
                "type": "no_targets",
                "message": "No assignment targets are selected in this draft.",
            }
        )
        return response

    subaccount_ids = set()
    for target in [*agreement_targets, *milestone_targets]:
        try:
            subaccount_ids.add(int(target.get("subaccount_id")))
        except (TypeError, ValueError):
            continue
    subaccounts = {
        subaccount.id: subaccount
        for subaccount in ContractorSubAccount.objects.select_related("user").filter(
            id__in=subaccount_ids,
            parent_contractor=draft.contractor,
        )
    }
    conflict_cache: dict[int, dict[str, Any]] = {}

    def validate_subaccount(target: dict[str, Any], target_key: str) -> tuple[ContractorSubAccount | None, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        blockers: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        required: list[dict[str, Any]] = []
        subaccount_id = target.get("subaccount_id")
        try:
            subaccount_id = int(subaccount_id)
        except (TypeError, ValueError):
            blockers.append({"type": "invalid_employee", "target_key": target_key, "message": "Draft target is missing a valid employee."})
            return None, blockers, warnings, required

        subaccount = subaccounts.get(subaccount_id)
        if subaccount is None:
            blockers.append({"type": "employee_not_found", "target_key": target_key, "message": "Employee is no longer available for this contractor."})
            return None, blockers, warnings, required
        if not subaccount.is_active:
            blockers.append(
                {
                    "type": "employee_inactive",
                    "target_key": target_key,
                    "subaccount_id": subaccount.id,
                    "message": f"{_subaccount_label(subaccount)} is inactive.",
                }
            )

        if subaccount.id not in conflict_cache:
            conflict_cache[subaccount.id] = evaluate_assignment_conflicts(
                contractor=draft.contractor,
                subaccount=subaccount,
                agreement=agreement,
                create_missing_schedule=False,
            )
        conflict_result = conflict_cache[subaccount.id]
        conflicts = list(conflict_result.get("conflicts") or [])
        if conflicts and conflict_result.get("is_supervisor"):
            warning = {
                "type": "supervisor_overlap",
                "target_key": target_key,
                "subaccount_id": subaccount.id,
                "message": f"{_subaccount_label(subaccount)} has overlapping assignments; supervisor overlap requires confirmation.",
                "conflicts": conflicts,
            }
            warnings.append(warning)
            if subaccount.id not in confirmed_supervisor_sub_ids:
                required.append(
                    {
                        "type": "supervisor_overlap",
                        "target_key": target_key,
                        "subaccount_id": subaccount.id,
                        "message": f"Confirm supervisor overlap for {_subaccount_label(subaccount)}.",
                    }
                )
        elif conflicts:
            blockers.append(
                {
                    "type": "non_supervisor_overlap",
                    "target_key": target_key,
                    "subaccount_id": subaccount.id,
                    "message": f"{_subaccount_label(subaccount)} is already assigned to overlapping agreement(s).",
                    "conflicts": conflicts,
                }
            )

        if conflict_result.get("schedule_warning"):
            warnings.append(
                {
                    "type": "schedule_warning",
                    "target_key": target_key,
                    "subaccount_id": subaccount.id,
                    "message": conflict_result.get("message") or "Schedule warning detected.",
                    "schedule_issues": conflict_result.get("schedule_issues", []),
                }
            )
        return subaccount, blockers, warnings, required

    for target in agreement_targets:
        target_key = _target_key("agreement", agreement.id, target.get("subaccount_id"))
        subaccount, blockers, warnings, required = validate_subaccount(target, target_key)
        already_assigned = bool(
            subaccount
            and AgreementAssignment.objects.filter(agreement=agreement, subaccount=subaccount).exists()
        )
        row = {
            **target,
            "target_key": target_key,
            "agreement_id": agreement.id,
            "status": "safe",
            "already_assigned": already_assigned,
            "blocking_issues": blockers,
            "warnings": warnings,
            "required_confirmations": required,
        }
        if blockers:
            row["status"] = "blocked"
        elif required:
            row["status"] = "requires_confirmation"
        response["selected_targets"]["agreement_assignments"].append(row)
        response["blocking_issues"].extend(blockers)
        response["warnings"].extend(warnings)
        response["required_confirmations"].extend(required)
        if row["status"] == "safe":
            response["safe_targets"].append({"target_type": "agreement", "target_key": target_key})

    milestone_ids = [target.get("milestone_id") for target in milestone_targets if target.get("milestone_id")]
    milestones = {
        milestone.id: milestone
        for milestone in Milestone.objects.select_related("agreement").filter(
            id__in=milestone_ids,
            agreement=agreement,
        )
    }
    existing_assignments = {
        assignment.milestone_id: assignment
        for assignment in MilestoneAssignment.objects.select_related("subaccount", "subaccount__user").filter(milestone_id__in=milestone_ids)
    }
    for target in milestone_targets:
        milestone_id = target.get("milestone_id")
        target_key = _target_key("milestone", milestone_id, target.get("subaccount_id"))
        subaccount, blockers, warnings, required = validate_subaccount(target, target_key)
        try:
            milestone_id = int(milestone_id)
        except (TypeError, ValueError):
            blockers.append({"type": "invalid_milestone", "target_key": target_key, "message": "Draft target is missing a valid milestone."})
            milestone = None
        else:
            milestone = milestones.get(milestone_id)
            if milestone is None:
                blockers.append({"type": "milestone_not_found", "target_key": target_key, "message": "Milestone is no longer available on this agreement."})

        existing = existing_assignments.get(milestone_id)
        if existing and (not subaccount or existing.subaccount_id != subaccount.id):
            warning = {
                "type": "milestone_replacement",
                "target_key": target_key,
                "milestone_id": milestone_id,
                "message": f"{getattr(milestone, 'title', 'This milestone')} already has an assignee.",
                "existing_subaccount_id": existing.subaccount_id,
                "existing_display_name": _subaccount_label(existing.subaccount),
            }
            warnings.append(warning)
            if milestone_id not in confirmed_replace_milestone_ids:
                required.append(
                    {
                        "type": "replace_milestone_assignment",
                        "target_key": target_key,
                        "milestone_id": milestone_id,
                        "message": f"Confirm replacement for {getattr(milestone, 'title', 'this milestone')}.",
                    }
                )
        elif existing and subaccount and existing.subaccount_id == subaccount.id:
            warnings.append(
                {
                    "type": "milestone_already_assigned",
                    "target_key": target_key,
                    "milestone_id": milestone_id,
                    "message": f"{getattr(milestone, 'title', 'This milestone')} is already assigned to {_subaccount_label(subaccount)}.",
                }
            )

        row = {
            **target,
            "target_key": target_key,
            "agreement_id": agreement.id,
            "status": "safe",
            "blocking_issues": blockers,
            "warnings": warnings,
            "required_confirmations": required,
        }
        if blockers:
            row["status"] = "blocked"
        elif required:
            row["status"] = "requires_confirmation"
        response["selected_targets"]["milestone_assignments"].append(row)
        response["blocking_issues"].extend(blockers)
        response["warnings"].extend(warnings)
        response["required_confirmations"].extend(required)
        if row["status"] == "safe":
            response["safe_targets"].append({"target_type": "milestone", "target_key": target_key})

    response["apply_ready"] = not response["blocking_issues"] and not response["required_confirmations"]
    return response


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
