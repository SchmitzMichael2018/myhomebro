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

WORK_ITEM_RULES = (
    {
        "key": "cabinetry",
        "pattern": r"\b(cabinet|cabinetry|vanity|cupboard)s?\b",
        "material_title": "Select cabinet preparation and finish materials",
        "material_description": "Confirm the cleaner or degreaser, abrasives, repair filler, bonding primer, cabinet-grade finish, applicators, and manufacturer cure times.",
        "work_title": "Prepare and finish the cabinetry",
        "work_description": "Remove and label doors and hardware, clean and degloss, repair defects, sand and control dust, then prime and finish in thin coats with the required cure time.",
        "participation": "DO_IT_MYSELF",
        "professional": False,
    },
    {
        "key": "countertop",
        "pattern": r"\b(butcher[ -]?block|counter ?top|work ?surface)s?\b",
        "material_title": "Confirm the countertop blank, sealer, and cutout requirements",
        "material_description": "Verify finished dimensions, overhangs, sink and faucet templates, mounting method, and a finish suitable for the intended moisture exposure before ordering or cutting.",
        "work_title": "Cut, seal, and install the countertop",
        "work_description": "Dry-fit before cutting, follow the sink template, ease exposed edges, and seal every face, end, underside, and cutout before installation.",
        "participation": "NEED_GUIDANCE",
        "professional": False,
    },
    {
        "key": "wall_panels",
        "pattern": r"\b(wall panel|wall panels|wood[ -]?slat|slat panel|slat panels|wainscot|wainscoting)\b",
        "material_title": "Select wall panels and rated attachment materials",
        "material_description": "Confirm panel coverage, cut allowance, moisture limitations, edge treatment, framing or anchor locations, adhesive compatibility, and fastener requirements.",
        "work_title": "Install the decorative wall panels",
        "work_description": "Lay out the panel pattern, locate secure attachment points, keep products outside prohibited wet zones, make controlled cuts, and finish exposed edges.",
        "participation": "DO_IT_MYSELF",
        "professional": False,
    },
    {
        "key": "flooring",
        "pattern": r"\b(lvp|luxury vinyl|vinyl plank|flooring|floor covering)s?\b",
        "material_title": "Select bathroom-approved flooring and accessories",
        "material_description": "Confirm coverage plus waste, water-resistance versus waterproof claims, standing-water limits, warranty exclusions, acclimation, underlayment, transition, and expansion-gap requirements.",
        "work_title": "Prepare the substrate and install the flooring",
        "work_description": "Verify the substrate is dry, sound, clean, and within flatness tolerance; then install in the approved sequence with the required gaps, transitions, and moisture precautions.",
        "participation": "DO_IT_MYSELF",
        "professional": False,
    },
    {
        "key": "plumbing_fixtures",
        "pattern": r"\b(sink|faucet|drain|supply line|toilet|plumb(?:ing)?)s?\b",
        "material_title": "Verify fixture compatibility and connection parts",
        "material_description": "Confirm sink and faucet dimensions, hole pattern, drain size, shutoff condition, supply-line connections, sealants, and manufacturer installation requirements.",
        "work_title": "Install fixtures and verify plumbing connections",
        "work_description": "Use the manufacturer instructions, protect finished surfaces, make compatible connections, and perform repeated leak tests before closing or storing items below the fixture.",
        "participation": "NEED_GUIDANCE",
        "professional": True,
    },
    {
        "key": "hardware",
        "pattern": r"\b(hardware|pull|pulls|knob|knobs|handle|handles)\b",
        "material_title": "Confirm hardware size and finish",
        "material_description": "Verify hole spacing, quantity, fastener length, finish consistency, clearances, and whether existing holes can be reused.",
        "work_title": "Install and align the finish hardware",
        "work_description": "Use a repeatable layout, protect finished surfaces, confirm door and drawer alignment, and tighten hardware without damaging the new finish.",
        "participation": "DO_IT_MYSELF",
        "professional": False,
    },
)


def clean_text(value, limit=2000):
    return TAG_RE.sub("", str(value or "")).strip()[:limit]


def _project_context(project):
    return " ".join(filter(None, [
        clean_text(project.title, 300),
        clean_text(project.category, 300),
        clean_text(project.desired_outcome, 2000),
        clean_text(project.area, 300),
        clean_text(project.existing_conditions, 2000),
        clean_text(project.work_completed, 1000),
        clean_text(project.confidence_notes, 1000),
        clean_text(project.design_notes, 2000),
        clean_text(project.additional_context, 2000),
    ]))


def _project_scope_context(project):
    """Fields that describe intended work, excluding merely existing items."""
    return " ".join(filter(None, [
        clean_text(project.title, 300),
        clean_text(project.category, 300),
        clean_text(project.desired_outcome, 2000),
        clean_text(project.design_notes, 2000),
    ]))


def _detected_work_items(project):
    context = _project_scope_context(project)
    return [rule for rule in WORK_ITEM_RULES if re.search(rule["pattern"], context, re.I)]


def _plan_is_contextual(payload, project):
    """Reject provider plans that ignore the supplied scope or material sequence."""
    plan_text = " ".join(
        " ".join(filter(None, [
            clean_text(phase.get("title"), 200),
            clean_text(phase.get("description"), 1000),
            *[
                " ".join(filter(None, [clean_text(task.get("title"), 200), clean_text(task.get("description"), 1000)]))
                for task in (phase.get("tasks") or []) if isinstance(task, dict)
            ],
        ]))
        for phase in (payload.get("phases") or []) if isinstance(phase, dict)
    ).lower()
    detected = _detected_work_items(project)
    if detected:
        required_matches = min(3, len(detected))
        matched = sum(bool(re.search(rule["pattern"], plan_text, re.I)) for rule in detected)
        if matched < required_matches:
            return False

    scope_words = {
        word.lower() for word in re.findall(r"[A-Za-z][A-Za-z-]{4,}", clean_text(project.desired_outcome, 2000))
        if word.lower() not in {"about", "after", "before", "existing", "install", "project", "replace", "their", "there", "these", "those", "with"}
    }
    if scope_words and len(scope_words.intersection(set(re.findall(r"[a-z][a-z-]{4,}", plan_text)))) < min(3, len(scope_words)):
        return False
    return True


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
    context = _project_context(project)
    high_risk = bool(re.search(r"\b(electrical|wiring|breaker|plumb|gas|roof|structur|foundation|asbestos|mold)\b", context, re.I))
    work_items = _detected_work_items(project)
    scope = clean_text(project.desired_outcome, 700) or clean_text(project.title, 300)
    conditions = clean_text(project.existing_conditions, 900) or "The exact existing conditions still need to be documented."
    requirements = clean_text(project.additional_context, 1000) or "Confirm dimensions, compatibility, quantities, lead times, installation requirements, and warranty limitations before ordering."

    material_tasks = []
    execution_tasks = []
    for index, rule in enumerate(work_items):
        material_tasks.append({
            "client_id": f"material-{rule['key']}",
            "title": rule["material_title"],
            "description": rule["material_description"],
            "participation_type": "DO_IT_MYSELF",
            "professional_review_recommended": rule["professional"],
            "reason": "Product and compatibility decisions should be resolved before dependent work begins.",
            "prerequisite_notes": requirements,
        })
        execution_tasks.append({
            "client_id": f"work-{rule['key']}",
            "title": rule["work_title"],
            "description": rule["work_description"],
            "participation_type": rule["participation"],
            "professional_review_recommended": rule["professional"],
            "reason": f"Sequence position {index + 1} reflects the detected scope and avoids covering or damaging earlier work.",
            "prerequisite_notes": "Complete the preceding preparation and material-verification tasks before starting this work.",
        })
    if not material_tasks:
        material_tasks.append({
            "client_id": "material-scope",
            "title": f"Confirm materials for {clean_text(project.title, 120)}",
            "description": requirements,
            "participation_type": "DO_IT_MYSELF",
            "professional_review_recommended": high_risk,
            "reason": "The stated scope should drive the material list and quantities.",
        })
        execution_tasks.append({
            "client_id": "work-scope",
            "title": f"Complete the scoped work: {clean_text(scope, 140)}",
            "description": "Follow the selected product instructions and the verified prerequisite sequence. Pause if hidden damage or a condition outside the stated scope appears.",
            "participation_type": "NEED_PROFESSIONAL" if high_risk else "UNDECIDED",
            "professional_review_recommended": high_risk,
            "reason": "This task preserves the homeowner's stated outcome instead of replacing it with generic guidance.",
        })
    payload = {
        "summary": f"Scope-specific planning order for {project.title}: verify the existing conditions, confirm materials, then complete the detected work in dependency order.",
        "questions": [
            {"id": "q1", "question": f"Which measurements or site conditions must be confirmed for this scope: {clean_text(scope, 220)}?"},
            {"id": "q2", "question": "Which exact products, finishes, quantities, compatibility requirements, and warranty limitations must be confirmed before ordering?"},
        ],
        "phases": [
            {"client_id": "scope", "title": "Verify the specific scope and site conditions", "description": scope, "tasks": [
                {"client_id": "document", "title": "Confirm the supplied scope against the room", "description": f"Desired outcome: {scope} Existing conditions: {conditions}", "participation_type": "DO_IT_MYSELF", "professional_review_recommended": False, "reason": "The saved plan should remain traceable to the homeowner's stated project."},
                {"client_id": "measure", "title": "Verify measurements, clearances, and quantities", "description": requirements, "participation_type": "DO_IT_MYSELF", "professional_review_recommended": high_risk, "reason": "Ordering and task sequence depend on verified dimensions and product requirements."},
            ]},
            {"client_id": "materials", "title": "Select, verify, and stage materials", "description": "Resolve product compatibility and quantities before demolition, cutting, coating, or installation.", "tasks": material_tasks},
            {"client_id": "prepare", "title": "Protect the area and prepare existing surfaces", "description": conditions, "tasks": [
                {"client_id": "protect", "title": "Protect retained finishes and isolate the work area", "description": "Photograph the starting condition, identify shutoffs and utilities, protect retained fixtures and paths, and plan dust, debris, and material storage.", "participation_type": "DO_IT_MYSELF", "professional_review_recommended": high_risk, "reason": "Protection and safe access precede removal or finish work."},
                {"client_id": "inspect", "title": "Inspect exposed conditions before continuing", "description": "After limited removal or cleaning, pause for moisture, damage, unsafe utilities, incompatible substrates, or conditions outside the stated scope.", "participation_type": "NEED_GUIDANCE" if high_risk else "DO_IT_MYSELF", "professional_review_recommended": high_risk, "reason": "Hidden conditions can change the safe sequence and product choice."},
            ]},
            {"client_id": "execute", "title": "Complete the scoped work in material dependency order", "description": "The tasks below follow the detected finish and installation dependencies. Review product instructions before starting each task.", "tasks": execution_tasks},
            {"client_id": "closeout", "title": "Inspect, test, and document the finished work", "description": "Confirm function, finish, cleanup, and records before marking the project complete.", "tasks": [
                {"client_id": "quality", "title": "Complete the final quality and safety review", "description": "Check alignment, clearances, finish cure, transitions, fasteners, leaks where applicable, cleanup, and any manufacturer-required follow-up.", "participation_type": "NEED_GUIDANCE" if high_risk else "DO_IT_MYSELF", "professional_review_recommended": high_risk, "reason": "Closeout checks help identify issues before the space returns to normal use."},
                {"client_id": "records", "title": "Save completion photos, receipts, product data, and warranties", "description": "Record final conditions and retain installation instructions, batch or model information, receipts, warranties, and maintenance requirements.", "participation_type": "DO_IT_MYSELF", "professional_review_recommended": False, "reason": "Project records support maintenance, warranty, and future professional help."},
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
                    "Build the plan from the supplied project rather than a generic renovation template. Name the actual scope "
                    "items and materials in phase and task text, preserve homeowner-provided quantities as assumptions to verify, "
                    "separate product selection and compatibility checks from installation, and order execution tasks by material "
                    "and dependency sequence so later work does not damage or conceal earlier work. Include preparation, cure or "
                    "acclimation time, inspection hold points, functional testing, and record retention when relevant. Do not add "
                    "work merely because an existing retained item is mentioned. Recommend local professional review for electrical, "
                    "plumbing, gas, roofing, structural, or hazardous work."
                )},
                {"role": "user", "content": json.dumps(context)},
            ],
        )
        raw = json.loads(response.output_text)
        if not _plan_is_contextual(raw, project):
            return validate_plan_payload(fallback)
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
