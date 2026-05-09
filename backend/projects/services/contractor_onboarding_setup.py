from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from collections.abc import Mapping
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Contractor, ContractorOnboardingSetup
from projects.services.contractor_activation_analytics import (
    FUNNEL_EVENT_AI_USED_FOR_PROJECT,
    FUNNEL_EVENT_ONBOARDING_COMPLETED,
    FUNNEL_EVENT_ONBOARDING_STARTED,
    track_activation_event,
)
from projects.services.intake_analysis import _clarification_questions
from projects.services.project_intelligence import build_project_intelligence_context
from projects.services.project_intelligence_orchestrator import build_project_intelligence
from projects.services.workspace_context import normalize_project_family
from projects.services.workspace_context import update_workspace_context


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _safe_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _normalize_json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _normalize_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_json_value(item) for item in value]
    if isinstance(value, set):
        return [_normalize_json_value(item) for item in sorted(value, key=repr)]
    return value


def _seed_description(contractor: Contractor | None, work_description: str) -> str:
    text = _safe_text(work_description)
    if text:
        return text
    if contractor is not None:
        skills = ", ".join(_safe_text(skill.name) for skill in contractor.skills.all() if _safe_text(skill.name))
        if skills:
            return skills
        business_name = _safe_text(contractor.business_name)
        if business_name:
            return business_name
    return "General contractor work"


def _build_materials_behavior(work_description: str, plan: dict[str, Any], questions: list[dict[str, Any]]) -> str:
    text = _safe_text(work_description).lower()
    if any(token in text for token in ["roof", "repair", "leak"]):
        return "Inspection and materials confirmation first."
    if any(token in text for token in ["remodel", "cabinet", "bath", "kitchen"]):
        return "Selections and finish materials should be confirmed early."
    if any(token in text for token in ["paint", "floor", "plumb", "electrical"]):
        return "Materials are usually confirmed with the work order."
    if questions:
        return "Materials should be confirmed during clarification."
    if _safe_text(plan.get("suggested_template_label")):
        return "Use the suggested plan as the baseline for materials decisions."
    return "Materials are optional until you refine the scope."


def _milestone_tendencies(plan: dict[str, Any]) -> list[dict[str, Any]]:
    milestones = _safe_list(plan.get("milestones"))
    rows: list[dict[str, Any]] = []
    for row in milestones[:4]:
        rows.append(
            {
                "title": _safe_text(row.get("title")),
                "allocation_percent": float(row.get("allocation_percent") or 0),
                "suggested_duration_days": int(row.get("suggested_duration_days") or 0),
                "note": _safe_text(row.get("note")),
            }
        )
    return rows


def _pricing_baseline(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "low": _safe_text(plan.get("suggested_budget_low")),
        "high": _safe_text(plan.get("suggested_budget_high")),
        "center": _safe_text(plan.get("suggested_budget_center")),
        "duration_low_days": int(plan.get("suggested_duration_low_days") or 0),
        "duration_high_days": int(plan.get("suggested_duration_high_days") or 0),
        "duration_days": int(plan.get("suggested_duration_days") or 0),
        "milestone_count": int(plan.get("suggested_milestone_count") or 0),
        "confidence_level": _safe_text(plan.get("confidence_level")),
        "confidence_reasoning": _safe_text(plan.get("confidence_reasoning")),
    }


def _agreement_defaults(analysis: dict[str, Any], setup: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_family_key": _safe_text(analysis.get("project_family_key")),
        "project_family_label": _safe_text(analysis.get("project_family_label")),
        "project_type": _safe_text(setup.get("recommended_project_type")),
        "project_subtype": _safe_text(setup.get("recommended_project_subtype")),
        "project_class": "residential",
        "suggested_workflow": _safe_text(setup.get("suggested_workflow")),
        "suggested_template_label": _safe_text(setup.get("suggested_template_label")),
        "recommended_template_name": _safe_text(setup.get("recommended_template_name")),
        "template_id": analysis.get("template_id"),
        "template_name": _safe_text(analysis.get("template_name")),
        "payment_mode": "escrow",
        "payment_structure": "progress",
    }


def _build_snapshot(
    *,
    contractor: Contractor,
    work_description: str,
    clarification_answers: dict[str, Any],
    completed: bool = False,
) -> dict[str, Any]:
    description = _seed_description(contractor, work_description)
    intelligence = build_project_intelligence(
        {
            "contractor": contractor,
            "project_title": description,
            "description": description,
            "project_scope_summary": description,
            "clarification_answers": clarification_answers,
        }
    )
    analysis = _safe_dict(intelligence.get("analysis"))
    recommended_setup = _safe_dict(intelligence.get("recommended_setup"))
    suggested_plan = _safe_dict(intelligence.get("suggested_plan"))

    family = normalize_project_family(
        {
            "project_family_key": analysis.get("project_family_key") or recommended_setup.get("project_family_key"),
            "project_family_label": analysis.get("project_family_label") or recommended_setup.get("project_family_label"),
        }
    )
    family_context = build_project_intelligence_context(
        project_title=description,
        project_type=_safe_text(recommended_setup.get("recommended_project_type")),
        project_subtype=_safe_text(recommended_setup.get("recommended_project_subtype")),
        description=description,
    )
    clarification_questions = _clarification_questions(
        _safe_text(recommended_setup.get("recommended_project_type")),
        _safe_text(recommended_setup.get("recommended_project_subtype")),
        description,
    )[:4]

    project_style = {
        "workflow_style": _safe_text(recommended_setup.get("suggested_workflow")) or "General project review",
        "materials_behavior": _build_materials_behavior(description, suggested_plan, clarification_questions),
        "project_family_cue": _safe_text(family_context.get("family_cue_label")),
    }
    pricing_baseline = _pricing_baseline(suggested_plan)
    milestone_tendencies = _milestone_tendencies(suggested_plan)
    agreement_defaults = _agreement_defaults(analysis, recommended_setup)

    setup_snapshot = {
        "work_description": description,
        "project_family": family,
        "project_families": [family] if family.get("key") else [],
        "project_style": project_style,
        "milestone_tendencies": milestone_tendencies,
        "pricing_baseline": pricing_baseline,
        "agreement_defaults": agreement_defaults,
        "clarification_questions": clarification_questions,
        "clarification_answers": clarification_answers,
        "recommended_setup": recommended_setup,
        "suggested_plan": suggested_plan,
        "source": "server",
        "summary": _safe_text(recommended_setup.get("recommendation_note"))
        or _safe_text(suggested_plan.get("confidence_reasoning"))
        or "Your setup is ready.",
        "completed_at": timezone.now().isoformat() if completed else None,
    }
    setup_snapshot = _normalize_json_value(setup_snapshot)

    setup_fields = {
        "work_description": description,
        "preferred_project_family_keys": [family["key"]] if family.get("key") else [],
        "preferred_project_family_label": family.get("label") or "",
        "workflow_style": _safe_text(project_style.get("workflow_style")),
        "milestone_tendencies": milestone_tendencies,
        "pricing_baseline": pricing_baseline,
        "agreement_defaults": agreement_defaults,
        "clarification_questions": clarification_questions,
        "clarification_answers": clarification_answers,
        "generated_setup": setup_snapshot,
        "quick_adjustment_notes": _safe_text(agreement_defaults.get("suggested_workflow")) or "",
    }
    if completed:
        setup_fields["completed_at"] = timezone.now()
    setup_fields = {
        field: (_normalize_json_value(value) if field != "completed_at" else value)
        for field, value in setup_fields.items()
    }
    return {
        "snapshot": setup_snapshot,
        "fields": setup_fields,
        "family": family,
        "analysis": analysis,
        "recommended_setup": recommended_setup,
        "suggested_plan": suggested_plan,
        "clarification_questions": clarification_questions,
    }


@dataclass
class OnboardingSetupResult:
    setup: ContractorOnboardingSetup
    snapshot: dict[str, Any]


def get_contractor_onboarding_setup(contractor: Contractor | None) -> dict[str, Any]:
    if contractor is None:
        return {
            "work_description": "",
            "project_family": {"key": "", "label": ""},
            "project_families": [],
            "project_style": {
                "workflow_style": "",
                "materials_behavior": "",
                "project_family_cue": "",
            },
            "milestone_tendencies": [],
            "pricing_baseline": {
                "low": "",
                "high": "",
                "center": "",
                "duration_low_days": 0,
                "duration_high_days": 0,
                "duration_days": 0,
                "milestone_count": 0,
                "confidence_level": "",
                "confidence_reasoning": "",
            },
            "agreement_defaults": {},
            "clarification_questions": [],
            "clarification_answers": {},
            "source": "server",
            "summary": "Tell us what kind of work you do and we’ll build your default setup.",
        }

    setup = ContractorOnboardingSetup.objects.filter(contractor=contractor).first()
    if setup is None:
        result = _build_snapshot(contractor=contractor, work_description="", clarification_answers={}, completed=False)
        return result["snapshot"]
    snapshot = _safe_dict(setup.generated_setup) or _build_snapshot(
        contractor=contractor,
        work_description=setup.work_description,
        clarification_answers=_safe_dict(setup.clarification_answers),
        completed=bool(setup.completed_at),
    )["snapshot"]
    snapshot = _normalize_json_value(snapshot)
    snapshot.setdefault("work_description", setup.work_description or "")
    snapshot.setdefault("clarification_answers", _safe_dict(setup.clarification_answers))
    snapshot.setdefault("completed_at", setup.completed_at.isoformat() if setup.completed_at else None)
    snapshot.setdefault("source", "server")
    return snapshot


@transaction.atomic
def save_contractor_onboarding_setup(
    contractor: Contractor | None,
    *,
    work_description: str = "",
    clarification_answers: dict[str, Any] | None = None,
    completed: bool = False,
    quick_adjustment_notes: str = "",
) -> OnboardingSetupResult | None:
    if contractor is None:
        return None

    clarification_answers = _safe_dict(clarification_answers)
    result = _build_snapshot(
        contractor=contractor,
        work_description=work_description,
        clarification_answers=clarification_answers,
        completed=completed,
    )
    setup, _created = ContractorOnboardingSetup.objects.get_or_create(contractor=contractor)
    for field, value in result["fields"].items():
        if field == "completed_at" and not completed:
            continue
        if field == "completed_at":
            setattr(setup, field, value)
        else:
            setattr(setup, field, _normalize_json_value(value))
    if quick_adjustment_notes:
        setup.quick_adjustment_notes = _safe_text(quick_adjustment_notes)
    if completed and not setup.completed_at:
        setup.completed_at = timezone.now()
    setup.save()

    family = result["family"]
    update_workspace_context(contractor, project_family=family)
    track_activation_event(
        contractor,
        event_type=FUNNEL_EVENT_AI_USED_FOR_PROJECT,
        step="onboarding_setup",
        context={
            "project_family_key": family.get("key", ""),
            "project_family_label": family.get("label", ""),
            "work_description": _safe_text(work_description),
        },
        user=getattr(contractor, "user", None),
        once=False,
    )
    if completed:
        track_activation_event(
            contractor,
        event_type=FUNNEL_EVENT_ONBOARDING_COMPLETED,
        step="onboarding_setup",
        context={
            "project_family_key": family.get("key", ""),
            "project_family_label": family.get("label", ""),
        },
        user=getattr(contractor, "user", None),
        once=True,
    )

    return OnboardingSetupResult(setup=setup, snapshot=result["snapshot"])
