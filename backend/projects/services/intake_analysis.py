from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db.models import Q

from projects.models_templates import ProjectTemplate
from projects.models_project_intake import ProjectIntake


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _lower(value: Any) -> str:
    return _safe_str(value).lower()


def _split_words(*parts: Any) -> set[str]:
    words: set[str] = set()
    for part in parts:
        text = _lower(part)
        if not text:
            continue
        for token in text.replace("/", " ").replace("-", " ").replace(",", " ").split():
            token = token.strip()
            if len(token) >= 3:
                words.add(token)
    return words


def _template_milestones_payload(template: ProjectTemplate) -> list[dict[str, Any]]:
    rows = []
    milestones = template.milestones.all().order_by("sort_order", "id")
    for idx, ms in enumerate(milestones, start=1):
        rows.append(
            {
                "order": idx,
                "sort_order": getattr(ms, "sort_order", idx),
                "title": _safe_str(getattr(ms, "title", "")),
                "description": _safe_str(getattr(ms, "description", "")),
                "recommended_days_from_start": getattr(ms, "recommended_days_from_start", None),
                "recommended_duration_days": getattr(ms, "recommended_duration_days", None),
                "suggested_amount_percent": getattr(ms, "suggested_amount_percent", None),
                "suggested_amount_fixed": getattr(ms, "suggested_amount_fixed", None),
                "materials_hint": _safe_str(getattr(ms, "materials_hint", "")),
                "is_optional": bool(getattr(ms, "is_optional", False)),
            }
        )
    return rows


def _template_clarification_payload(template: ProjectTemplate) -> list[dict[str, Any]]:
    raw = getattr(template, "default_clarifications", None)
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        return [raw]
    return []


def _score_template(template: ProjectTemplate, intake: ProjectIntake) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    accomplishment = _safe_str(intake.accomplishment_text)
    accomplishment_l = accomplishment.lower()

    intake_type = _safe_str(getattr(intake, "ai_project_type", ""))
    intake_subtype = _safe_str(getattr(intake, "ai_project_subtype", ""))

    tpl_type = _safe_str(getattr(template, "project_type", ""))
    tpl_subtype = _safe_str(getattr(template, "project_subtype", ""))
    tpl_name = _safe_str(getattr(template, "name", ""))
    tpl_desc = _safe_str(getattr(template, "description", ""))

    if intake_type and tpl_type and intake_type.lower() == tpl_type.lower():
        score += 40
        reasons.append(f'exact project type match: "{tpl_type}"')

    if intake_subtype and tpl_subtype and intake_subtype.lower() == tpl_subtype.lower():
        score += 55
        reasons.append(f'exact subtype match: "{tpl_subtype}"')

    haystack = " ".join([tpl_name, tpl_type, tpl_subtype, tpl_desc]).lower()
    shared = sorted(_split_words(accomplishment) & _split_words(haystack))
    if shared:
        bonus = min(len(shared) * 8, 32)
        score += bonus
        reasons.append(f"shared keywords: {', '.join(shared[:6])}")

    if tpl_subtype and tpl_subtype.lower() in accomplishment_l:
        score += 25
        reasons.append(f'subtype keyword present: "{tpl_subtype}"')

    if tpl_type and tpl_type.lower() in accomplishment_l:
        score += 15
        reasons.append(f'type keyword present: "{tpl_type}"')

    return score, reasons


def _match_quality(score: int | None) -> str:
    if score is None or score < 20:
        return "none"
    if score >= 70:
        return "strong"
    if score >= 35:
        return "medium"
    return "weak"


def _confidence_from_score(score: int | None) -> str:
    if score is None or score < 20:
        return "none"
    if score >= 70:
        return "recommended"
    return "possible"


def _template_match_payload(
    template: ProjectTemplate,
    *,
    score: int,
    reasons: list[str],
) -> dict[str, Any]:
    reason = "; ".join(reasons) if reasons else "Template match found."
    return {
        "id": template.id,
        "name": _safe_str(getattr(template, "name", "")),
        "project_type": _safe_str(getattr(template, "project_type", "")),
        "project_subtype": _safe_str(getattr(template, "project_subtype", "")),
        "description": _safe_str(getattr(template, "description", "")),
        "score": score,
        "confidence": _confidence_from_score(score),
        "match_quality": _match_quality(score),
        "reason": reason,
        "milestone_count": template.milestones.count(),
        "is_system": bool(getattr(template, "is_system", False)),
    }


def _recommend_template(intake: ProjectIntake):
    contractor = getattr(intake, "contractor", None)
    accomplishment = _safe_str(intake.accomplishment_text)

    if not contractor or not accomplishment:
        return None, "none", "", None, []

    qs = (
        ProjectTemplate.objects.filter(is_active=True)
        .filter(Q(is_system=True) | Q(contractor=contractor))
        .prefetch_related("milestones")
        .order_by("-is_system", "name")
    )

    ranked: list[tuple[int, ProjectTemplate, list[str]]] = []

    for template in qs:
        score, reasons = _score_template(template, intake)
        ranked.append((score, template, reasons))

    ranked.sort(
        key=lambda item: (
            item[0],
            1 if getattr(item[1], "project_subtype", None) else 0,
            1 if getattr(item[1], "project_type", None) else 0,
        ),
        reverse=True,
    )

    candidates = [
        _template_match_payload(template, score=score, reasons=reasons)
        for score, template, reasons in ranked[:3]
        if score > 0
    ]

    if not ranked:
        return None, "none", "", None, []

    best_score, best_template, best_reasons = ranked[0]

    if best_template is None or best_score < 20:
        return None, "none", "No matching template found.", best_score if best_score >= 0 else None, candidates

    confidence = _confidence_from_score(best_score)

    reason = "; ".join(best_reasons) if best_reasons else "Template match found."
    return best_template, confidence, reason, best_score, candidates


def _infer_type_and_subtype(accomplishment: str) -> tuple[str, str]:
    text = accomplishment.lower()

    mapping = [
        (["roof", "roofing", "shingle"], ("Repair", "Roof Repair")),
        (["tile", "shower", "bathroom", "vanity"], ("Remodel", "Bathroom Remodel")),
        (["kitchen", "cabinet", "countertop"], ("Remodel", "Kitchen Remodel")),
        (["floor", "flooring", "vinyl plank", "laminate", "hardwood"], ("Installation", "Flooring Installation")),
        (["paint", "painting", "repaint"], ("Painting", "Interior Painting")),
        (["drywall", "sheetrock"], ("Repair", "Drywall Repair")),
        (["fence", "gate"], ("Installation", "Fence Installation")),
        (["deck", "patio", "pergola"], ("Outdoor", "Deck / Patio")),
        (["electrical", "outlet", "breaker", "panel"], ("Repair", "Electrical")),
        (["plumbing", "pipe", "water heater", "toilet", "sink"], ("Repair", "Plumbing")),
        (["window", "door"], ("Installation", "Window / Door")),
    ]

    for keywords, result in mapping:
        if any(k in text for k in keywords):
            return result

    return "Repair", "General Repair"


def _build_title(accomplishment: str, project_type: str, project_subtype: str) -> str:
    short = accomplishment.strip()
    if short:
        words = short.split()
        truncated = " ".join(words[:8]).strip()
        if len(words) > 8:
            truncated += "…"
        return truncated[0].upper() + truncated[1:] if truncated else f"{project_subtype or project_type or 'Project'}"
    return project_subtype or project_type or "New Project"


def _generate_default_milestones(project_type: str, project_subtype: str, accomplishment: str) -> list[dict[str, Any]]:
    subtype_l = project_subtype.lower()

    if "roof" in subtype_l:
        return [
            {
                "order": 1,
                "title": "Roof Removal and Deck Inspection",
                "description": "Remove existing roofing materials in affected areas, inspect decking, and document any damaged substrate requiring replacement.",
            },
            {
                "order": 2,
                "title": "Underlayment and Flashing Installation",
                "description": "Install or replace underlayment and flashing as needed to prepare the roof for final roofing material installation.",
            },
            {
                "order": 3,
                "title": "Shingle Installation and Site Cleanup",
                "description": "Install final roofing materials, complete cleanup, and confirm the work area is free of debris.",
            },
        ]

    if "bathroom" in subtype_l:
        return [
            {
                "order": 1,
                "title": "Demolition and Preparation",
                "description": "Protect surrounding areas, remove existing finishes/fixtures as agreed, and prepare the space for remodel work.",
            },
            {
                "order": 2,
                "title": "Core Installation Work",
                "description": "Complete rough and finish installation work for the agreed bathroom remodel scope.",
            },
            {
                "order": 3,
                "title": "Finish, Punch List, and Cleanup",
                "description": "Complete finish details, final walkthrough items, and site cleanup.",
            },
        ]

    if "floor" in subtype_l:
        return [
            {
                "order": 1,
                "title": "Prep and Demolition",
                "description": "Prepare rooms, remove existing flooring where included, and ready the substrate for installation.",
            },
            {
                "order": 2,
                "title": "Flooring Installation",
                "description": "Install new flooring materials in the agreed areas, including transitions where included.",
            },
            {
                "order": 3,
                "title": "Final Touches and Cleanup",
                "description": "Complete trim/transition details, final cleanup, and walkthrough.",
            },
        ]

    return [
        {
            "order": 1,
            "title": "Preparation and Assessment",
            "description": f"Review and prepare for the requested work: {accomplishment}",
        },
        {
            "order": 2,
            "title": "Primary Work Completion",
            "description": "Complete the main project work according to the agreed scope.",
        },
        {
            "order": 3,
            "title": "Final Review and Cleanup",
            "description": "Finish remaining details, perform cleanup, and confirm completion.",
        },
    ]


def _generate_default_clarifications(project_type: str, project_subtype: str) -> list[dict[str, Any]]:
    subtype_l = project_subtype.lower()

    if "roof" in subtype_l:
        return [
            {"key": "decking_replacement", "label": "Is decking replacement included?", "type": "boolean", "required": False},
            {"key": "flashing_replacement", "label": "Is flashing replacement included?", "type": "boolean", "required": False},
            {"key": "haul_off", "label": "Is haul-off and debris removal included?", "type": "boolean", "required": False},
            {"key": "permit_responsibility", "label": "Who handles permits, if required?", "type": "text", "required": False},
        ]

    if "bathroom" in subtype_l:
        return [
            {"key": "demo_included", "label": "Is demolition included?", "type": "boolean", "required": False},
            {"key": "fixture_supply", "label": "Who supplies fixtures/materials?", "type": "text", "required": False},
            {"key": "plumbing_changes", "label": "Are plumbing relocation changes included?", "type": "boolean", "required": False},
            {"key": "waterproofing_scope", "label": "What waterproofing is included?", "type": "text", "required": False},
        ]

    if "floor" in subtype_l:
        return [
            {"key": "demo_included", "label": "Is flooring demolition/removal included?", "type": "boolean", "required": False},
            {"key": "subfloor_repair", "label": "Is subfloor repair included if needed?", "type": "boolean", "required": False},
            {"key": "material_supply", "label": "Who supplies flooring materials?", "type": "text", "required": False},
            {"key": "transitions_included", "label": "Are transitions/trim included?", "type": "boolean", "required": False},
        ]

    return [
        {"key": "materials_supply", "label": "Who supplies materials?", "type": "text", "required": False},
        {"key": "demo_included", "label": "Is demolition/removal included?", "type": "boolean", "required": False},
        {"key": "permit_required", "label": "Are permits expected for this scope?", "type": "boolean", "required": False},
        {"key": "special_conditions", "label": "Any special site conditions or exclusions?", "type": "text", "required": False},
    ]


def _estimate_timeline_days(project_type: str, project_subtype: str, accomplishment: str) -> int:
    text = " ".join([project_type, project_subtype, accomplishment]).lower()
    mapping = [
        (["roof"], 7),
        (["bathroom"], 14),
        (["kitchen"], 21),
        (["floor", "flooring"], 5),
        (["paint", "painting"], 3),
        (["drywall"], 4),
        (["electrical"], 4),
        (["plumbing"], 4),
        (["landscap"], 5),
        (["deck", "patio"], 10),
    ]
    for keywords, days in mapping:
        if any(keyword in text for keyword in keywords):
            return days
    return 10


def _estimate_budget(project_type: str, project_subtype: str, accomplishment: str) -> Decimal:
    text = " ".join([project_type, project_subtype, accomplishment]).lower()
    mapping = [
        (["roof"], Decimal("12000.00")),
        (["bathroom"], Decimal("18000.00")),
        (["kitchen"], Decimal("25000.00")),
        (["floor", "flooring"], Decimal("8000.00")),
        (["paint", "painting"], Decimal("4500.00")),
        (["drywall"], Decimal("3500.00")),
        (["electrical"], Decimal("5500.00")),
        (["plumbing"], Decimal("6000.00")),
        (["landscap"], Decimal("7000.00")),
        (["deck", "patio"], Decimal("10000.00")),
    ]
    for keywords, budget in mapping:
        if any(keyword in text for keyword in keywords):
            return budget
    return Decimal("5000.00")


def _project_label(project_type: str, project_subtype: str, accomplishment: str) -> str:
    for value in (project_subtype, project_type, accomplishment):
        text = _safe_str(value)
        if text:
            return text.split(",")[0].strip()
    return "project"


def _clarification_questions(project_type: str, project_subtype: str, accomplishment: str) -> list[dict[str, Any]]:
    label = _project_label(project_type, project_subtype, accomplishment)
    label_lower = label.lower()

    scope_label = f"How much of the {label_lower} should be included?"
    if "roof" in label_lower:
        scope_label = "What roof areas and repairs should be included?"
    elif "bathroom" in label_lower:
        scope_label = "Which bathroom areas are included in the scope?"
    elif "kitchen" in label_lower:
        scope_label = "Which kitchen areas are included in the scope?"

    layout_label = "Are any layout changes, moves, or reconfiguration included?"
    if "roof" in label_lower:
        layout_label = "Are any structural changes, decking changes, or rework included?"
    elif "floor" in label_lower:
        layout_label = "Are any transitions, leveling, or subfloor changes included?"

    materials_label = "Who is responsible for supplying the materials?"
    if "paint" in label_lower:
        materials_label = "Who supplies paint, trim, and related materials?"
    elif "electrical" in label_lower or "plumbing" in label_lower:
        materials_label = "Who supplies fixtures, devices, or specialty materials?"

    timeline_label = "How clear is the timeline for this project?"
    measurement_label = "How should measurements be handled before work starts?"

    return [
        {
            "key": "scope_depth",
            "label": scope_label,
            "question": scope_label,
            "type": "text",
            "inputType": "textarea",
            "required": False,
            "help": "A short answer is fine.",
            "options": [],
            "source": "analysis",
        },
        {
            "key": "layout_changes",
            "label": layout_label,
            "question": layout_label,
            "type": "select",
            "inputType": "radio",
            "required": False,
            "help": "This helps us decide whether extra layout or verification steps are needed.",
            "options": ["No", "Some changes", "Yes, major changes", "Not sure"],
            "source": "analysis",
        },
        {
            "key": "materials_responsibility",
            "label": materials_label,
            "question": materials_label,
            "type": "select",
            "inputType": "radio",
            "required": False,
            "help": "Materials responsibility affects schedule and agreement wording.",
            "options": ["Contractor", "Customer", "Split", "Not sure"],
            "source": "analysis",
        },
        {
            "key": "timeline_clarity",
            "label": timeline_label,
            "question": timeline_label,
            "type": "select",
            "inputType": "radio",
            "required": False,
            "help": "If the timing is flexible, we can keep the agreement wording lighter.",
            "options": ["Flexible", "Target date", "Fixed deadline", "Not sure"],
            "source": "analysis",
        },
        {
            "key": "measurement_handling",
            "label": measurement_label,
            "question": measurement_label,
            "type": "select",
            "inputType": "radio",
            "required": False,
            "help": "Measurements can come from the customer, a site visit, or be confirmed later.",
            "options": ["provided", "site_visit_required", "not_sure"],
            "source": "analysis",
        },
    ]


def _clarification_answers_map(intake: ProjectIntake) -> dict[str, Any]:
    raw = getattr(intake, "ai_clarification_answers", None)
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, list):
        out: dict[str, Any] = {}
        for row in raw:
            if not isinstance(row, dict):
                continue
            key = _safe_str(row.get("key"))
            if not key:
                continue
            out[key] = row.get("answer")
        return out
    return {}


def _format_answer(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return _safe_str(value)


def _measurement_display(value: Any) -> str:
    mapping = {
        "provided": "provided by the customer",
        "site_visit_required": "confirmed during a site visit",
        "not_sure": "not yet clear",
    }
    return mapping.get(_safe_str(value), _safe_str(value))


def _refine_description(base_description: str, answers: dict[str, Any]) -> tuple[str, list[str]]:
    description = _safe_str(base_description).strip()
    assumptions: list[str] = []

    scope_depth = _format_answer(answers.get("scope_depth"))
    if scope_depth:
        assumptions.append(f"Scope depth: {scope_depth}.")

    layout_changes = _format_answer(answers.get("layout_changes"))
    if layout_changes:
        assumptions.append(f"Layout changes: {layout_changes}.")

    materials = _format_answer(answers.get("materials_responsibility"))
    if materials:
        assumptions.append(f"Materials responsibility: {materials}.")

    timeline = _format_answer(answers.get("timeline_clarity"))
    if timeline:
        assumptions.append(f"Timeline clarity: {timeline}.")

    measurement = _measurement_display(answers.get("measurement_handling"))
    if measurement:
        assumptions.append(f"Measurements: {measurement}.")

    clarification_lines = [line for line in assumptions if line]
    if clarification_lines:
        clarification_block = "Clarifications and assumptions: " + " ".join(clarification_lines)
        if description:
            description = f"{description}\n\n{clarification_block}"
        else:
            description = clarification_block

    return description, assumptions


def _refine_milestones(milestones: list[dict[str, Any]], answers: dict[str, Any]) -> list[dict[str, Any]]:
    out = [dict(row) for row in milestones or []]
    if not out:
        return out

    measurement = _safe_str(answers.get("measurement_handling"))
    layout_changes = _safe_str(answers.get("layout_changes"))
    materials = _safe_str(answers.get("materials_responsibility"))

    verification_bits: list[str] = []
    if measurement == "site_visit_required":
        verification_bits.append("site visit measurement verification")
    elif measurement == "not_sure":
        verification_bits.append("measurement verification")

    if layout_changes and layout_changes.lower() not in {"no", "not sure"}:
        verification_bits.append("layout confirmation")

    if materials:
        verification_bits.append(f"materials responsibility: {materials.lower()}")

    if verification_bits:
        first = out[0]
        base_title = _safe_str(first.get("title")) or "Preparation"
        base_description = _safe_str(first.get("description"))
        note = f"Confirm {', '.join(verification_bits)} before the main work begins."
        first["title"] = base_title if "verification" in base_title.lower() else "Site Verification and Setup"
        first["description"] = f"{base_description} {note}".strip()
        out[0] = first

    return out


def analyze_project_intake(*, intake: ProjectIntake) -> dict[str, Any]:
    accomplishment = _safe_str(intake.accomplishment_text)
    clarification_questions = _clarification_questions(
        _safe_str(getattr(intake, "ai_project_type", "")),
        _safe_str(getattr(intake, "ai_project_subtype", "")),
        accomplishment,
    )
    clarification_answers = _clarification_answers_map(intake)
    measurement_handling = _safe_str(getattr(intake, "measurement_handling", "")) or _safe_str(
        clarification_answers.get("measurement_handling", "")
    )
    if measurement_handling:
        clarification_answers = dict(clarification_answers)
        clarification_answers.setdefault("measurement_handling", measurement_handling)

    template, confidence, reason, score, template_matches = _recommend_template(intake)
    match_quality = _match_quality(score)
    fallback_options = {
        "continue_without_template": True,
        "create_template_draft_later": True,
    }

    if template is not None and confidence in {"recommended", "possible"}:
        project_title = _build_title(
            accomplishment=accomplishment,
            project_type=_safe_str(template.project_type),
            project_subtype=_safe_str(template.project_subtype),
        )
        timeline_days = _estimate_timeline_days(
            _safe_str(template.project_type),
            _safe_str(template.project_subtype),
            accomplishment,
        )
        budget = _estimate_budget(
            _safe_str(template.project_type),
            _safe_str(template.project_subtype),
            accomplishment,
        )
        description = _safe_str(template.description) or accomplishment
        refined_description, assumptions = _refine_description(description, clarification_answers)
        milestones = _template_milestones_payload(template)
        milestones = _refine_milestones(milestones, clarification_answers)

        return {
            "project_title": project_title,
            "template_id": template.id,
            "template_name": _safe_str(template.name),
            "confidence": confidence,
            "score": score,
            "match_quality": match_quality,
            "has_strong_template_match": match_quality == "strong",
            "reason": reason,
            "template_matches": template_matches,
            "fallback_options": fallback_options,
            "project_type": _safe_str(template.project_type),
            "project_subtype": _safe_str(template.project_subtype),
            "description": refined_description,
            "project_timeline_days": timeline_days,
            "project_budget": str(budget),
            "milestones": milestones,
            "clarification_questions": clarification_questions,
            "clarification_answers": clarification_answers,
            "clarification_assumptions": assumptions,
            "measurement_handling": measurement_handling,
        }

    project_type, project_subtype = _infer_type_and_subtype(accomplishment)
    project_title = _build_title(
        accomplishment=accomplishment,
        project_type=project_type,
        project_subtype=project_subtype,
    )
    timeline_days = _estimate_timeline_days(project_type, project_subtype, accomplishment)
    budget = _estimate_budget(project_type, project_subtype, accomplishment)

    description = accomplishment or f"{project_subtype} project."
    description, assumptions = _refine_description(description, clarification_answers)
    milestones = _generate_default_milestones(project_type, project_subtype, accomplishment)
    milestones = _refine_milestones(milestones, clarification_answers)

    return {
        "project_title": project_title,
        "template_id": None,
        "template_name": "",
        "confidence": "none",
        "score": score,
        "match_quality": match_quality,
        "has_strong_template_match": False,
        "reason": "No matching template found; generated a suggested project structure.",
        "template_matches": template_matches,
        "fallback_options": fallback_options,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "description": description,
        "project_timeline_days": timeline_days,
        "project_budget": str(budget),
        "milestones": milestones,
        "clarification_questions": clarification_questions,
        "clarification_answers": clarification_answers,
        "clarification_assumptions": assumptions,
        "measurement_handling": measurement_handling,
    }
