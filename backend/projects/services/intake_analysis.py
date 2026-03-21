from __future__ import annotations

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
        return None, "none", "", None

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


def analyze_project_intake(*, intake: ProjectIntake) -> dict[str, Any]:
    accomplishment = _safe_str(intake.accomplishment_text)

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
            "description": _safe_str(template.description) or accomplishment,
            "milestones": _template_milestones_payload(template),
            "clarification_questions": _template_clarification_payload(template),
        }

    project_type, project_subtype = _infer_type_and_subtype(accomplishment)
    project_title = _build_title(
        accomplishment=accomplishment,
        project_type=project_type,
        project_subtype=project_subtype,
    )

    description = accomplishment or f"{project_subtype} project."

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
        "milestones": _generate_default_milestones(project_type, project_subtype, accomplishment),
        "clarification_questions": _generate_default_clarifications(project_type, project_subtype),
    }
