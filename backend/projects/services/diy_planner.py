from __future__ import annotations

import re
import json
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models_diy_planner import DIYProjectAIProposal, DIYProjectPhase, DIYProjectTask


PARTICIPATION_TYPES = {choice for choice, _ in DIYProjectTask.Participation.choices}
TAG_RE = re.compile(r"<[^>]+>")


def clean_text(value, limit=2000):
    return TAG_RE.sub("", str(value or "")).strip()[:limit]


def validate_plan_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("Project Assistant returned an invalid plan.")
    phases = payload.get("phases")
    if not isinstance(phases, list) or not phases:
        raise ValueError("Project Assistant did not return any plan phases.")
    normalized = {
        "summary": clean_text(payload.get("summary"), 1200),
        "questions": [],
        "phases": [],
        "warnings": [],
        "assumptions": [],
        "source": clean_text(payload.get("source") or "Project Assistant", 80),
        "limitations": "This is planning guidance, not a code, permit, engineering, or safety determination.",
    }
    for index, row in enumerate((payload.get("questions") or [])[:10]):
        if isinstance(row, dict) and clean_text(row.get("question"), 300):
            normalized["questions"].append({"id": clean_text(row.get("id") or f"q{index + 1}", 60), "question": clean_text(row["question"], 300)})
    for p_index, phase in enumerate(phases[:20]):
        if not isinstance(phase, dict) or not clean_text(phase.get("title"), 200):
            continue
        next_phase = {
            "client_id": clean_text(phase.get("client_id") or f"phase-{p_index + 1}", 80),
            "title": clean_text(phase["title"], 200),
            "description": clean_text(phase.get("description"), 2000),
            "tasks": [],
        }
        for t_index, task in enumerate((phase.get("tasks") or [])[:40]):
            if not isinstance(task, dict) or not clean_text(task.get("title"), 200):
                continue
            participation = clean_text(task.get("participation_type"), 32).upper()
            if participation not in PARTICIPATION_TYPES:
                participation = DIYProjectTask.Participation.UNDECIDED
            cost = task.get("estimated_cost")
            try:
                cost = str(max(Decimal("0"), Decimal(str(cost)))) if cost not in (None, "") else None
            except (InvalidOperation, TypeError, ValueError):
                cost = None
            next_phase["tasks"].append({
                "client_id": clean_text(task.get("client_id") or f"task-{p_index + 1}-{t_index + 1}", 80),
                "title": clean_text(task["title"], 200),
                "description": clean_text(task.get("description"), 2000),
                "participation_type": participation,
                "professional_review_recommended": bool(task.get("professional_review_recommended")),
                "reason": clean_text(task.get("reason"), 500),
                "estimated_duration": clean_text(task.get("estimated_duration"), 120),
                "estimated_cost": cost,
                "prerequisite_notes": clean_text(task.get("prerequisite_notes"), 1000),
            })
        if next_phase["tasks"]:
            normalized["phases"].append(next_phase)
    if not normalized["phases"]:
        raise ValueError("Project Assistant did not return usable tasks.")
    for row in (payload.get("warnings") or [])[:10]:
        if isinstance(row, dict) and clean_text(row.get("message"), 500):
            normalized["warnings"].append({"level": "professional_review", "message": clean_text(row["message"], 500)})
    normalized["assumptions"] = [clean_text(value, 400) for value in (payload.get("assumptions") or [])[:10] if clean_text(value, 400)]
    return normalized


def _fallback_plan(project):
    high_risk = bool(re.search(r"\b(electrical|wiring|panel|plumb|gas|roof|structur|foundation|asbestos|mold)\b", " ".join([
        project.category, project.desired_outcome, project.existing_conditions, project.additional_context
    ]), re.I))
    payload = {
        "summary": f"Suggested planning order for {project.title}. Review and edit every item before adding it to your plan.",
        "questions": [
            {"id": "q1", "question": "What dimensions and existing conditions still need to be confirmed?"},
            {"id": "q2", "question": "Which finish, layout, or product decisions must be made before work starts?"},
        ],
        "phases": [
            {"client_id": "planning", "title": "Define and verify the project", "description": "Document the goal, constraints, and decisions.", "tasks": [
                {"client_id": "document", "title": "Document existing conditions", "description": "Add clear photos, measurements, and notes about current conditions.", "participation_type": "DO_IT_MYSELF", "professional_review_recommended": False, "reason": "Planning task based on homeowner-provided information."},
                {"client_id": "decisions", "title": "Confirm scope and design decisions", "description": "Record the desired outcome, selected direction, and unresolved questions.", "participation_type": "NEED_GUIDANCE", "professional_review_recommended": high_risk, "reason": "Important decisions should be resolved before execution."},
            ]},
            {"client_id": "prepare", "title": "Prepare for the work", "description": "Confirm prerequisites before beginning.", "tasks": [
                {"client_id": "requirements", "title": "Confirm local requirements and professional needs", "description": "Check locally whether permits, licensing, engineering, or specialist review apply.", "participation_type": "NEED_PROFESSIONAL" if high_risk else "UNDECIDED", "professional_review_recommended": high_risk, "reason": "Rules and risk vary by jurisdiction and exact scope."},
                {"client_id": "sequence", "title": "Review task order and prerequisites", "description": "Confirm that access, materials research, and prior work are ready.", "participation_type": "DO_IT_MYSELF", "professional_review_recommended": False, "reason": "A reviewed sequence reduces avoidable rework."},
            ]},
            {"client_id": "execute", "title": "Execute and document", "description": "Work only within the participation choices you confirm.", "tasks": [
                {"client_id": "work", "title": "Complete the selected work session", "description": "Review prerequisites, pause for unexpected conditions, and document progress.", "participation_type": "UNDECIDED", "professional_review_recommended": high_risk, "reason": "Participation depends on the final scope and homeowner decision."},
                {"client_id": "review", "title": "Review results and next steps", "description": "Record progress photos, open questions, and any professional help needed.", "participation_type": "NEED_GUIDANCE" if high_risk else "DO_IT_MYSELF", "professional_review_recommended": high_risk, "reason": "Review before continuing to later phases."},
            ]},
        ],
        "warnings": [{"level": "professional_review", "message": "Rules vary by jurisdiction. Confirm permits, licensing, and professional requirements locally before execution."}],
        "assumptions": ["Measurements are homeowner-provided unless a qualified professional explicitly verifies them.", "The exact site conditions have not been independently inspected."],
        "source": "Project Assistant",
    }
    return payload


def build_plan_proposal(project):
    fallback = _fallback_plan(project)
    api_key = str(getattr(settings, "OPENAI_API_KEY", "") or "").strip()
    if not api_key:
        return validate_plan_payload(fallback)
    try:
        from openai import OpenAI
        context = {
            "title": project.title, "desired_outcome": project.desired_outcome, "category": project.category,
            "area": project.area, "existing_conditions": project.existing_conditions,
            "work_completed": project.work_completed, "confidence_notes": project.confidence_notes,
            "design_notes": project.design_notes, "additional_context": project.additional_context,
        }
        response = OpenAI(api_key=api_key, timeout=15.0, max_retries=0).responses.create(
            model=str(getattr(settings, "OPENAI_MODEL", "") or "gpt-4.1-mini"),
            input=[
                {"role": "system", "content": (
                    "You are Project Assistant. Return JSON only with summary, questions, phases, warnings, assumptions, and source. "
                    "Each phase needs client_id, title, description, tasks. Each task needs client_id, title, description, "
                    "participation_type (DO_IT_MYSELF, NEED_GUIDANCE, NEED_HELP, NEED_PROFESSIONAL, or UNDECIDED), "
                    "professional_review_recommended, reason, estimated_duration, estimated_cost, and prerequisite_notes. "
                    "This is editable planning guidance, never code, permit, engineering, qualification, or safety approval. "
                    "Recommend local professional review for electrical, plumbing, gas, roofing, structural, or hazardous work."
                )},
                {"role": "user", "content": json.dumps(context)},
            ],
        )
        raw = json.loads(response.output_text)
        raw["source"] = "Project Assistant"
        return validate_plan_payload(raw)
    except Exception:
        return validate_plan_payload(fallback)


@transaction.atomic
def apply_plan_proposal(proposal: DIYProjectAIProposal, selected_keys):
    selected = sorted({str(value) for value in (selected_keys or []) if value})
    if proposal.status == "applied":
        return proposal
    phase_map = {row["client_id"]: row for row in proposal.payload.get("phases", [])}
    for p_index, (phase_key, phase_data) in enumerate(phase_map.items()):
        task_rows = [row for row in phase_data["tasks"] if row["client_id"] in selected or phase_key in selected]
        if not task_rows:
            continue
        phase = DIYProjectPhase.objects.create(
            project=proposal.project, title=phase_data["title"], description=phase_data["description"],
            sort_order=proposal.project.phases.count() + p_index,
        )
        for t_index, task in enumerate(task_rows):
            DIYProjectTask.objects.create(
                phase=phase, title=task["title"], description=task["description"],
                participation_type=task["participation_type"], sort_order=t_index,
                professional_review_recommended=task["professional_review_recommended"],
                estimated_duration=task.get("estimated_duration", ""), estimated_cost=task.get("estimated_cost"),
                prerequisite_notes=task.get("prerequisite_notes", ""), source=DIYProjectTask.Source.AI,
                ai_metadata={"proposal_id": str(proposal.id), "client_id": task["client_id"], "reason": task.get("reason", "")},
            )
    proposal.status = "applied"
    proposal.applied_keys = selected
    proposal.applied_at = timezone.now()
    proposal.save(update_fields=["status", "applied_keys", "applied_at"])
    return proposal
