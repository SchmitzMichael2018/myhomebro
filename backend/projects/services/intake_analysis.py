from __future__ import annotations

from decimal import Decimal
import re
from typing import Any

from django.db.models import Q

from projects.models_templates import ProjectTemplate
from projects.models_project_intake import ProjectIntake
from projects.services.project_intelligence import build_project_intelligence_context


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


def _score_template(template: ProjectTemplate, intake: ProjectIntake, *, search_text: str = "") -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    accomplishment = _safe_str(intake.accomplishment_text)
    search_text_l = _safe_str(search_text or accomplishment).lower()

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
    shared = sorted(_split_words(search_text_l) & _split_words(haystack))
    if shared:
        bonus = min(len(shared) * 8, 32)
        score += bonus
        reasons.append(f"shared keywords: {', '.join(shared[:6])}")

    if tpl_subtype and tpl_subtype.lower() in search_text_l:
        score += 25
        reasons.append(f'subtype keyword present: "{tpl_subtype}"')

    if tpl_type and tpl_type.lower() in search_text_l:
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


def _recommend_template(intake: ProjectIntake, *, search_text: str = ""):
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
        score, reasons = _score_template(template, intake, search_text=search_text)
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

    if "kitchen" in subtype_l:
        return [
            {
                "order": 1,
                "title": "Removal and Site Preparation",
                "description": "Protect surrounding areas, remove existing cabinets or finishes if included, and prepare the kitchen for installation work.",
            },
            {
                "order": 2,
                "title": "Cabinet and Related Work",
                "description": "Install new cabinets and complete any related countertop, backsplash, or appliance coordination included in the scope.",
            },
            {
                "order": 3,
                "title": "Finish Details and Cleanup",
                "description": "Complete finish details, final adjustments, and site cleanup.",
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
    if "roof" in text:
        if any(keyword in text for keyword in ["replacement", "replace", "full replacement"]):
            return 14
        return 7
    if "kitchen" in text and "cabinet" in text and any(keyword in text for keyword in ["install", "installation"]):
        return 10
    if "kitchen" in text:
        return 21
    if "bathroom" in text and any(keyword in text for keyword in ["repair", "update"]):
        return 7
    if "bathroom" in text:
        return 14
    if "floor" in text and any(keyword in text for keyword in ["install", "installation"]):
        return 5
    mapping = [
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
    if "roof" in text:
        if any(keyword in text for keyword in ["replacement", "replace", "full replacement"]):
            return Decimal("14000.00")
        return Decimal("7000.00")
    if "kitchen" in text and "cabinet" in text and any(keyword in text for keyword in ["install", "installation"]):
        return Decimal("15000.00")
    if "kitchen" in text:
        return Decimal("25000.00")
    if "bathroom" in text and any(keyword in text for keyword in ["repair", "update"]):
        return Decimal("8500.00")
    if "bathroom" in text:
        return Decimal("18000.00")
    if "floor" in text and any(keyword in text for keyword in ["install", "installation"]):
        return Decimal("8000.00")
    mapping = [
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


def _clarification_answer_text(answers: dict[str, Any]) -> str:
    return " ".join(_safe_str(value) for value in (answers or {}).values() if _safe_str(value))


def _answer_value(answers: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = _safe_str((answers or {}).get(key))
        if value:
            return value
    return ""


def _answer_contains(answers: dict[str, Any], *keys: str, needles: list[str]) -> bool:
    return _contains_any(" ".join(_answer_value(answers, key) for key in keys), needles)


def _summary_sentence(text: str) -> str:
    cleaned = " ".join(_safe_str(text).split()).strip(" .")
    return f"{cleaned}." if cleaned else ""


def _build_project_classification(
    *,
    accomplishment: str,
    answers: dict[str, Any],
) -> dict[str, str]:
    combined = _clarification_text(accomplishment, _clarification_answer_text(answers))
    family_context = build_project_intelligence_context(
        project_title="",
        project_type="",
        project_subtype="",
        description=combined,
    )
    family_key = _safe_str(family_context.get("family_key")) or "general"
    family_label = _safe_str(family_context.get("family_label") or family_context.get("family_cue_label")) or "General project"

    scope = _answer_value(answers, "scope_kind").lower()
    materials = _answer_value(answers, "materials_ready").lower()
    layout = _answer_value(answers, "layout_changes").lower()
    related = _answer_value(answers, "related_work").lower()
    damage = _answer_value(answers, "damage_urgency").lower()
    inspection = _answer_value(answers, "inspection_before_pricing").lower()
    area_count = _answer_value(answers, "area_count")
    task_list = _answer_value(answers, "task_list")

    if family_key == "roofing":
        if any(keyword in " ".join([scope, combined]) for keyword in ["replacement", "full replacement"]):
            project_type, project_subtype = "Replacement", "Roof Replacement"
        else:
            project_type, project_subtype = "Repair", "Roof Repair"
    elif family_key == "bathroom_remodel":
        if any(keyword in " ".join([scope, layout, combined]) for keyword in ["smaller update", "repair", "update"]):
            project_type, project_subtype = "Repair", "Bathroom Repair"
        else:
            project_type, project_subtype = "Remodel", "Bathroom Remodel"
    elif family_key == "kitchen_remodel":
        if any(keyword in " ".join([scope, combined]) for keyword in ["install", "installation", "new cabinets only", "cabinets only"]):
            project_type, project_subtype = "Installation", "Kitchen Cabinet Installation"
        elif any(keyword in " ".join([scope, layout, related, combined]) for keyword in ["remodel", "layout", "appliance", "countertop", "backsplash"]):
            project_type, project_subtype = "Remodel", "Kitchen Remodel"
        else:
            project_type, project_subtype = "Installation", "Kitchen Cabinet Installation"
    elif family_key == "flooring":
        project_type, project_subtype = "Installation", "Flooring Installation"
    elif family_key == "painting":
        if "exterior" in combined and "interior" in combined:
            project_type, project_subtype = "Painting", "Interior / Exterior Painting"
        elif "exterior" in combined:
            project_type, project_subtype = "Painting", "Exterior Painting"
        else:
            project_type, project_subtype = "Painting", "Interior Painting"
    elif family_key == "electrical":
        if any(keyword in " ".join([scope, combined]) for keyword in ["install", "installation", "new"]):
            project_type, project_subtype = "Installation", "Electrical Installation"
        else:
            project_type, project_subtype = "Repair", "Electrical Repair"
    elif family_key == "plumbing":
        if any(keyword in " ".join([scope, combined]) for keyword in ["install", "installation", "new"]):
            project_type, project_subtype = "Installation", "Plumbing Installation"
        else:
            project_type, project_subtype = "Repair", "Plumbing Repair"
    elif family_key == "exterior_siding":
        if any(keyword in " ".join([scope, combined]) for keyword in ["replacement", "replace", "new"]):
            project_type, project_subtype = "Replacement", "Exterior / Siding Replacement"
        else:
            project_type, project_subtype = "Repair", "Exterior / Siding Repair"
    elif family_key == "windows_doors":
        if any(keyword in " ".join([scope, combined]) for keyword in ["install", "installation", "replace", "replacement", "new"]):
            project_type, project_subtype = "Installation", "Window / Door Installation"
        else:
            project_type, project_subtype = "Repair", "Window / Door Repair"
    elif family_key == "handyman":
        project_type, project_subtype = "Repair", "General Repair"
    else:
        if any(keyword in " ".join([scope, combined]) for keyword in ["replacement", "replace"]):
            project_type, project_subtype = "Replacement", "General Replacement"
        elif any(keyword in " ".join([scope, combined]) for keyword in ["remodel", "layout"]):
            project_type, project_subtype = "Remodel", "General Remodel"
        elif any(keyword in " ".join([scope, combined]) for keyword in ["install", "installation", "new"]):
            project_type, project_subtype = "Installation", "General Installation"
        else:
            project_type, project_subtype = "Repair", "General Repair"

    return {
        "family_key": family_key,
        "family_label": family_label,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "scope": scope,
        "materials": materials,
        "layout": layout,
        "related": related,
        "damage": damage,
        "inspection": inspection,
        "area_count": area_count,
        "task_list": task_list,
        "combined_text": combined,
    }


def _build_project_summary(
    *,
    classification: dict[str, str],
    accomplishment: str,
    answers: dict[str, Any],
    photo_count: int = 0,
) -> str:
    project_type = classification.get("project_type", "")
    project_subtype = classification.get("project_subtype", "")
    family_key = classification.get("family_key", "general")
    family_label = classification.get("family_label", "project")
    scope = classification.get("scope", "")
    materials = classification.get("materials", "")
    layout = classification.get("layout", "")
    related = classification.get("related", "")
    damage = classification.get("damage", "")
    inspection = classification.get("inspection", "")
    area_count = classification.get("area_count", "")
    task_list = classification.get("task_list", "")

    sentences: list[str] = []

    if family_key == "roofing":
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["replacement", "full replacement"]):
            opening = "Roof replacement request"
        else:
            opening = "Roof repair request"
        if damage:
            if any(keyword in damage for keyword in ["no"]):
                opening = f"{opening} with no interior water damage reported yet"
            elif any(keyword in damage for keyword in ["yes", "active", "reported", "leak", "water", "damage"]):
                opening = f"{opening} with active leak or water damage concerns"
        if area_count:
            opening = f"{opening} affecting {area_count.lower()}"
        sentences.append(f"{opening}.")
        if inspection:
            sentences.append("Contractor inspection requested before final pricing.")

    elif family_key == "bathroom_remodel":
        if any(keyword in " ".join([scope, layout, accomplishment]).lower() for keyword in ["smaller update", "repair", "update"]):
            opening = "Bathroom update/repair request"
        else:
            opening = "Bathroom remodel request"
        if area_count:
            opening = f"{opening} for {area_count.lower()}"
        sentences.append(f"{opening}.")
        if layout and any(keyword in layout for keyword in ["some", "major"]):
            sentences.append(f"Layout changes are planned: {layout}.")
        if materials:
            if any(keyword in materials for keyword in ["already selected", "already on site"]):
                sentences.append("Fixtures or materials are already selected.")
            elif "not yet" in materials or "not sure" in materials:
                sentences.append("Fixtures or materials have not been selected yet.")

    elif family_key == "kitchen_remodel":
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["install", "installation", "new cabinets only", "cabinets only"]):
            opening = "Kitchen cabinet installation request"
        else:
            opening = "Kitchen remodel request"
        if area_count:
            opening = f"{opening} for {area_count.lower()}"
        sentences.append(f"{opening}.")
        cabinet_bits: list[str] = []
        if any(keyword in " ".join([scope, accomplishment, _answer_value(answers, "demo_removal")]).lower() for keyword in ["remove", "removal", "demo", "tear out"]):
            cabinet_bits.append("removal of existing cabinets")
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["install", "installation", "new cabinets", "cabinet"]):
            if any(keyword in materials for keyword in ["already on site", "already selected"]):
                cabinet_bits.append("installation of new cabinets already on site")
            else:
                cabinet_bits.append("installation of new cabinets")
        if related:
            if "backsplash" in related:
                cabinet_bits.append("related backsplash work")
            elif "countertop" in related or "countertops" in related:
                cabinet_bits.append("related countertop work")
            elif "appliance" in related:
                cabinet_bits.append("related appliance moves")
        if layout and any(keyword in layout for keyword in ["some", "major"]):
            cabinet_bits.append(f"layout changes: {layout}")
        if cabinet_bits:
            sentences.append(f"Includes {', '.join(cabinet_bits)}.")

    elif family_key == "flooring":
        opening = "Flooring installation request"
        if area_count:
            opening = f"{opening} for {area_count.lower()}"
        sentences.append(f"{opening}.")
        if any(keyword in accomplishment.lower() for keyword in ["remove", "replacement", "demo", "tear out"]):
            sentences.append("Existing flooring removal is part of the scope.")
        if any(keyword in classification.get("combined_text", "").lower() for keyword in ["subfloor", "underlayment", "leveling", "sagging"]):
            sentences.append("The subfloor may need review or repair.")
        if materials:
            sentences.append("Flooring material is already selected." if any(keyword in materials for keyword in ["already selected", "already on site"]) else "Flooring material still needs to be confirmed.")

    elif family_key == "painting":
        opening = "Painting request"
        if "exterior" in classification.get("combined_text", "") and "interior" in classification.get("combined_text", ""):
            opening = "Interior and exterior painting request"
        elif "exterior" in classification.get("combined_text", ""):
            opening = "Exterior painting request"
        elif "interior" in classification.get("combined_text", ""):
            opening = "Interior painting request"
        if area_count:
            opening = f"{opening} for {area_count.lower()}"
        sentences.append(f"{opening}.")
        if any(keyword in accomplishment.lower() for keyword in ["prep", "patch", "repair", "fix"]):
            sentences.append("Prep and surface repairs may be part of the work.")
        if materials:
            sentences.append("Color and finish selections are already known." if any(keyword in materials for keyword in ["already selected", "picked"] ) else "Color and finish selections still need to be confirmed.")

    elif family_key == "electrical":
        opening = "Electrical request"
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["install", "installation", "new"]):
            opening = "Electrical installation request"
        elif any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["troubleshooting", "issue", "repair"]):
            opening = "Electrical repair request"
        sentences.append(f"{opening}.")
        if any(keyword in classification.get("combined_text", "").lower() for keyword in ["panel", "outlet", "switch", "lighting"]):
            sentences.append("The affected electrical area has been identified.")
        if any(keyword in damage for keyword in ["yes", "safety", "urgent"]):
            sentences.append("There may be an active safety concern or urgent issue.")
        if inspection:
            sentences.append("A site visit before final pricing is expected.")

    elif family_key == "plumbing":
        opening = "Plumbing request"
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["install", "installation", "new"]):
            opening = "Plumbing installation request"
        elif any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["repair", "leak", "replace"]):
            opening = "Plumbing repair request"
        sentences.append(f"{opening}.")
        if any(keyword in classification.get("combined_text", "").lower() for keyword in ["sink", "toilet", "shower", "pipe", "drain", "faucet"]):
            sentences.append("The affected fixture or line has been identified.")
        if any(keyword in damage for keyword in ["yes", "urgent", "active"]):
            sentences.append("There may be an active leak or urgent issue.")
        if inspection:
            sentences.append("A site visit before final pricing is expected.")

    elif family_key == "exterior_siding":
        opening = "Exterior / siding request"
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["replace", "replacement", "new"]):
            opening = "Exterior / siding replacement request"
        elif any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["repair", "patch", "fix"]):
            opening = "Exterior / siding repair request"
        sentences.append(f"{opening}.")
        if area_count:
            sentences.append(f"The work covers {area_count.lower()}.")
        if damage:
            sentences.append("Weather exposure or existing damage may need review.")
        if inspection:
            sentences.append("An on-site inspection is expected before final pricing.")

    elif family_key == "windows_doors":
        opening = "Window / door request"
        if any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["install", "installation", "replace", "replacement", "new"]):
            opening = "Window / door installation request"
        elif any(keyword in " ".join([scope, accomplishment]).lower() for keyword in ["repair", "fix"]):
            opening = "Window / door repair request"
        sentences.append(f"{opening}.")
        if area_count:
            sentences.append(f"The work covers {area_count.lower()}.")
        if materials:
            sentences.append("Trim or weatherproofing details have been partly defined." if any(keyword in materials for keyword in ["already selected", "already on site"]) else "Trim and weatherproofing details still need confirmation.")
        if inspection:
            sentences.append("A site visit before final pricing is expected.")

    elif family_key == "handyman":
        opening = "General repair / handyman request"
        if task_list:
            opening = f"{opening} covering {task_list.lower()}"
        sentences.append(f"{opening}.")
        if materials:
            sentences.append("Material responsibility should be confirmed before pricing.")

    else:
        vague_input = _safe_str(accomplishment).lower()
        if any(keyword in vague_input for keyword in ["need help", "project", "quote", "estimate", "some work", "something", "need work", "general"]):
            opening = "General repair request" if _safe_str(project_type).lower() == "repair" else f"{project_type or family_label} request"
        else:
            opening = _safe_str(accomplishment) or f"{project_subtype or project_type or family_label} project"
        sentences.append(_summary_sentence(opening))
        if area_count:
            sentences.append(f"The work covers {area_count.lower()}.")
        if materials:
            sentences.append("Materials are already selected or on site." if any(keyword in materials for keyword in ["already selected", "already on site"]) else "Materials still need to be confirmed.")
        if inspection:
            sentences.append("Contractor inspection requested before final pricing.")
        if damage:
            sentences.append("There may be an active issue or urgency to review.")

    if photo_count > 0:
        sentences.append(f"{photo_count} photo{'s' if photo_count != 1 else ''} attached for reference.")

    cleaned = [sentence.strip() for sentence in sentences if sentence and sentence.strip()]
    return " ".join(cleaned).strip() or _safe_str(accomplishment) or f"{project_subtype or project_type or family_label} project"


def _clarification_assumptions_from_answers(answers: dict[str, Any]) -> list[str]:
    assumptions: list[str] = []
    scope_depth = _format_answer(answers.get("scope_depth"))
    layout_changes = _format_answer(answers.get("layout_changes"))
    materials = _format_answer(answers.get("materials_responsibility"))
    timeline = _format_answer(answers.get("timeline_clarity"))
    measurement = _measurement_display(answers.get("measurement_handling"))

    if scope_depth:
        assumptions.append(f"Scope depth: {scope_depth}.")
    if layout_changes:
        assumptions.append(f"Layout changes: {layout_changes}.")
    if materials:
        assumptions.append(f"Materials responsibility: {materials}.")
    if timeline:
        assumptions.append(f"Timeline clarity: {timeline}.")
    if measurement:
        assumptions.append(f"Measurements: {measurement}.")
    return assumptions


def _clarification_text(*parts: Any) -> str:
    return " ".join(_safe_str(part) for part in parts if _safe_str(part)).lower()


def _contains_any(text: str, needles: list[str]) -> bool:
    return any(needle in text for needle in needles if needle)


def _clarification_item(
    key: str,
    label: str,
    *,
    question: str | None = None,
    qtype: str = "select",
    input_type: str = "radio",
    help_text: str = "",
    options: list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "question": question or label,
        "type": qtype,
        "inputType": input_type,
        "required": False,
        "help": help_text,
        "options": list(options or []),
        "source": "analysis",
    }


def _clarification_flags(text: str) -> dict[str, bool]:
    return {
        "scope_kind": _contains_any(text, ["repair", "replacement", "replace", "remodel", "install", "installation", "new install", "new installation"]),
        "materials_ready": _contains_any(text, ["selected", "picked out", "on site", "already purchased", "owner supplied", "materials ready", "ready to go"]),
        "damage_urgency": _contains_any(text, ["leak", "damage", "mold", "water", "urgent", "emergency", "broken", "storm", "rot", "sagging", "backed up", "no power"]),
        "layout_changes": _contains_any(text, ["layout", "move", "reconfigure", "relocate", "wall move", "fixture move", "open up"]),
        "demo_removal": _contains_any(text, ["demo", "demolition", "remove", "tear out", "take out", "remove existing", "old", "existing", "gut"]),
        "inspection": _contains_any(text, ["inspect", "inspection", "site visit", "quote", "estimate", "before final pricing", "before pricing", "assess", "look at"]),
        "quantity_detail": bool(re.search(r"\b\d+\b", text))
        or _contains_any(text, ["one area", "multiple areas", "multiple", "several", "whole house", "whole home", "all rooms", "entire", "one bathroom", "multiple bathrooms", "one room", "multiple rooms"]),
        "interior_exterior": _contains_any(text, ["interior", "exterior"]),
        "related_work": _contains_any(text, ["countertop", "countertops", "backsplash", "appliance", "trim", "weatherproof", "panel", "outlet", "switch", "lighting", "fixture", "tile", "paint", "shower", "vanity"]),
        "access": _contains_any(text, ["access", "shutoff", "occupied", "tight space", "crawlspace", "attic", "ladder"]),
        "subfloor": _contains_any(text, ["subfloor", "underlayment", "leveling", "sagging floor"]),
        "task_list": _contains_any(text, ["task", "tasks", "punch list", "odd jobs", "list", "items"]),
    }


def _clarification_target_count(text: str, family_key: str, photo_count: int = 0) -> int:
    flags = _clarification_flags(text)
    ambiguity = 0
    if len(text) < 25:
        ambiguity += 2
    elif len(text) < 60:
        ambiguity += 1
    if _contains_any(text, ["help", "need help", "some work", "project", "quote", "estimate", "not sure", "something", "fix something", "need work", "general"]):
        ambiguity += 1
    if family_key == "general":
        ambiguity += 1
    if not flags["scope_kind"]:
        ambiguity += 1
    if not flags["quantity_detail"]:
        ambiguity += 1

    detail = sum(
        1
        for value in [
            flags["scope_kind"],
            flags["materials_ready"],
            flags["damage_urgency"],
            flags["layout_changes"],
            flags["demo_removal"],
            flags["inspection"],
            flags["quantity_detail"],
            flags["related_work"],
            flags["access"],
            flags["subfloor"],
        ]
        if value
    )
    if photo_count > 0:
        detail += 1

    if detail >= 3 and ambiguity <= 1:
        return 0
    if ambiguity >= 4:
        return 4
    if ambiguity >= 2:
        return 3
    return 2


def _clarification_questions(project_type: str, project_subtype: str, accomplishment: str, photo_count: int = 0) -> list[dict[str, Any]]:
    text = _clarification_text(project_type, project_subtype, accomplishment)
    family_context = build_project_intelligence_context(
        project_title="",
        project_type=project_type,
        project_subtype=project_subtype,
        description=accomplishment,
    )
    family_key = _safe_str(family_context.get("family_key")) or "general"
    family_label = _safe_str(family_context.get("family_label") or family_context.get("family_cue_label"))
    flags = _clarification_flags(text)
    target_count = _clarification_target_count(text, family_key, photo_count=photo_count)
    if target_count <= 0:
        return []

    questions: list[dict[str, Any]] = []

    def add(item: dict[str, Any]) -> None:
        key = _safe_str(item.get("key"))
        if not key or any(existing.get("key") == key for existing in questions):
            return
        questions.append(item)

    if family_key == "roofing":
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this a repair, leak issue, or full roof replacement?", options=["Repair", "Leak issue", "Full replacement", "Not sure"], help_text="This helps contractors understand the level of work involved."))
        if not flags["damage_urgency"]:
            add(_clarification_item("damage_urgency", "Have you noticed active leaks or interior water damage?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor understand how urgent the work may be."))
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Is the issue affecting one area or multiple areas of the roof?", options=["One area", "Multiple areas", "Not sure"], help_text="This helps narrow the scope quickly."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="A roof inspection can help confirm the scope before final pricing."))

    elif family_key == "bathroom_remodel":
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this a full remodel or a smaller update/repair?", options=["Full remodel", "Smaller update/repair", "Not sure"], help_text="This helps contractors understand how broad the project is."))
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Is the work for one bathroom or multiple bathrooms?", options=["One bathroom", "Multiple bathrooms", "Not sure"], help_text="This helps size the job correctly."))
        if not flags["layout_changes"]:
            add(_clarification_item("layout_changes", "Are any layout changes or fixture moves planned?", options=["No changes", "Some changes", "Major changes", "Not sure"], help_text="This helps the contractor know whether extra coordination may be needed."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Do you already have fixtures or materials picked out?", options=["Already selected", "Not yet", "Not sure"], help_text="Selections can affect pricing and lead time."))

    elif family_key == "kitchen_remodel":
        if not flags["demo_removal"]:
            add(_clarification_item("demo_removal", "Are you installing new cabinets only, or removing old cabinets too?", options=["New cabinets only", "Remove old cabinets too", "Not sure"], help_text="This helps the contractor understand the scope more accurately."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Do you already have the cabinets or materials on site?", options=["Already on site", "Already selected", "Not yet", "Not sure"], help_text="This can change the schedule and pricing."))
        if not flags["related_work"]:
            add(_clarification_item("related_work", "Will countertops, backsplash, or other related work be part of this project?", options=["Yes", "No", "Not sure"], help_text="This helps define the full scope of the kitchen work."))
        if not flags["layout_changes"]:
            add(_clarification_item("layout_changes", "Will any layout changes or appliance moves be part of the project?", options=["No changes", "Some changes", "Major changes", "Not sure"], help_text="This helps the contractor understand whether planning work may be needed."))

    elif family_key == "flooring":
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Which rooms or areas are included?", qtype="text", input_type="textarea", help_text="This helps contractors understand how much flooring is involved."))
        if not flags["demo_removal"]:
            add(_clarification_item("demo_removal", "Will old flooring need to be removed?", options=["Yes", "No", "Not sure"], help_text="Removal work can change the schedule and bid."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Have you chosen the flooring material yet?", options=["Already selected", "Not yet", "Not sure"], help_text="Material selection helps contractors understand the project better."))
        if not flags["subfloor"]:
            add(_clarification_item("subfloor_condition", "Does the subfloor need repair or review?", options=["Yes", "No", "Not sure"], help_text="This can affect the final scope and pricing."))

    elif family_key == "painting":
        if not flags["interior_exterior"]:
            add(_clarification_item("interior_exterior", "Is this interior or exterior work?", options=["Interior", "Exterior", "Both", "Not sure"], help_text="This helps the contractor frame the project correctly."))
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Are multiple rooms or surfaces included?", options=["One area", "Multiple areas", "Not sure"], help_text="This helps contractors understand the size of the painting project."))
        if not flags["demo_removal"]:
            add(_clarification_item("prep_scope", "Will prep, patching, or repairs be needed?", options=["Yes", "No", "Not sure"], help_text="Preparation can change the time and cost of the job."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Are paint colors or finish levels already chosen?", options=["Already selected", "Not yet", "Not sure"], help_text="Selections help the contractor understand what is included."))

    elif family_key == "electrical":
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this a repair, troubleshooting issue, or new install?", options=["Repair", "Troubleshooting", "New install", "Not sure"], help_text="This helps the contractor understand the kind of electrical work involved."))
        if not flags["related_work"]:
            add(_clarification_item("affected_system", "Which area is affected: panel, outlets, switches, or lighting?", options=["Panel", "Outlets", "Switches", "Lighting", "Not sure"], help_text="This helps narrow the scope and the safety review."))
        if not flags["damage_urgency"]:
            add(_clarification_item("damage_urgency", "Are there any safety concerns or recurring issues?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor know if the work needs quicker attention."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="Electrical work is often clearer after a quick review."))

    elif family_key == "plumbing":
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this a repair, leak issue, or replacement?", options=["Repair", "Leak issue", "Replacement", "Not sure"], help_text="This helps the contractor understand the starting point."))
        if not flags["related_work"]:
            add(_clarification_item("affected_fixture", "Which fixture or line is affected?", options=["Sink", "Toilet", "Shower/tub", "Pipe/line", "Not sure"], help_text="This helps narrow the plumbing scope quickly."))
        if not flags["access"]:
            add(_clarification_item("access_conditions", "Is there easy access to the problem area?", options=["Easy access", "Somewhat limited", "Difficult", "Not sure"], help_text="Access can affect how the contractor prepares for the job."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like an inspection before final pricing?", options=["Yes", "No", "Not sure"], help_text="A quick review can help confirm the scope before pricing."))

    elif family_key == "exterior_siding":
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Which exterior areas are included?", qtype="text", input_type="textarea", help_text="This helps contractors understand the size of the exterior project."))
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this repair, replacement, or repainting?", options=["Repair", "Replacement", "Repainting", "Not sure"], help_text="This helps the contractor understand the kind of exterior work involved."))
        if not flags["damage_urgency"]:
            add(_clarification_item("damage_urgency", "Any water damage, rot, or weather exposure to note?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor understand what may need extra attention."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="Exterior work is often clearer after a quick on-site review."))

    elif family_key == "windows_doors":
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "How many openings are involved?", qtype="text", input_type="textarea", help_text="This helps contractors understand the size of the job."))
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this repair or replacement?", options=["Repair", "Replacement", "Not sure"], help_text="This helps the contractor understand the type of work needed."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Are trim or weatherproofing details already known?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor estimate more accurately."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="Window and door work is often clearer after a quick review."))

    elif family_key == "handyman":
        if not flags["task_list"]:
            add(_clarification_item("task_list", "What are the main tasks you want done?", qtype="text", input_type="textarea", help_text="A quick list helps contractors understand the work better."))
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Is this one item or several?", options=["One item", "Several items", "Not sure"], help_text="This helps size the project correctly."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Are materials already selected or on site?", options=["Already selected", "Already on site", "Not yet", "Not sure"], help_text="That can change the timeline and scope."))
        if not flags["related_work"]:
            add(_clarification_item("specialty_trade", "Is there anything that may need a specialty trade?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor plan the work."))

    else:
        if not flags["scope_kind"]:
            add(_clarification_item("scope_kind", "Is this a repair, replacement, remodel, or new installation?", options=["Repair", "Replacement", "Remodel", "New installation", "Not sure"], help_text="This helps contractors understand the starting point of the project."))
        if not flags["quantity_detail"]:
            add(_clarification_item("area_count", "Is this for one area or multiple areas?", options=["One area", "Multiple areas", "Not sure"], help_text="This helps contractors understand the size of the job."))
        if not flags["materials_ready"]:
            add(_clarification_item("materials_ready", "Are materials already selected or on site?", options=["Already selected", "Already on site", "Not yet", "Not sure"], help_text="This can affect timing and pricing."))
        if not flags["inspection"]:
            add(_clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="A site visit can help confirm the scope when details are still flexible."))
        if not flags["damage_urgency"]:
            add(_clarification_item("damage_urgency", "Is there any active damage or urgency the contractor should know about?", options=["Yes", "No", "Not sure"], help_text="This helps the contractor understand whether the project needs priority attention."))

    if len(questions) < 2:
        fallback = [
            _clarification_item("scope_kind", "Is this a repair, replacement, remodel, or new installation?", options=["Repair", "Replacement", "Remodel", "New installation", "Not sure"], help_text="This helps contractors understand the starting point of the project."),
            _clarification_item("area_count", "Is this for one area or multiple areas?", options=["One area", "Multiple areas", "Not sure"], help_text="This helps contractors understand the size of the job."),
            _clarification_item("materials_ready", "Are materials already selected or on site?", options=["Already selected", "Already on site", "Not yet", "Not sure"], help_text="This can affect timing and pricing."),
            _clarification_item("inspection_before_pricing", "Would you like the contractor to inspect before final pricing?", options=["Yes", "No", "Not sure"], help_text="A site visit can help confirm the scope when details are still flexible."),
        ]
        for item in fallback:
            if len(questions) >= target_count:
                break
            if any(existing.get("key") == item["key"] for existing in questions):
                continue
            questions.append(item)

    return questions[:target_count]


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
    clarification_answers = _clarification_answers_map(intake)
    photo_count = 0
    try:
        photo_count = int(getattr(getattr(intake, "clarification_photos", None), "count", lambda: 0)() or 0)
    except Exception:
        photo_count = 0
    combined_text = _clarification_text(
        accomplishment,
        _clarification_answer_text(clarification_answers),
        _safe_str(getattr(intake, "ai_project_type", "")),
        _safe_str(getattr(intake, "ai_project_subtype", "")),
    )
    classification = _build_project_classification(
        accomplishment=accomplishment,
        answers=clarification_answers,
    )
    clarification_questions = _clarification_questions(
        _safe_str(getattr(intake, "ai_project_type", "")),
        _safe_str(getattr(intake, "ai_project_subtype", "")),
        accomplishment,
        photo_count=photo_count,
    )
    measurement_handling = _safe_str(getattr(intake, "measurement_handling", "")) or _safe_str(
        clarification_answers.get("measurement_handling", "")
    )
    if measurement_handling:
        clarification_answers = dict(clarification_answers)
        clarification_answers.setdefault("measurement_handling", measurement_handling)

    template, confidence, reason, score, template_matches = _recommend_template(intake, search_text=combined_text)
    match_quality = _match_quality(score)
    fallback_options = {
        "continue_without_template": True,
        "create_template_draft_later": True,
    }

    if template is not None and confidence in {"recommended", "possible"}:
        project_title = _build_title(
            accomplishment=accomplishment,
            project_type=classification["project_type"],
            project_subtype=classification["project_subtype"],
        )
        timeline_days = _estimate_timeline_days(
            classification["project_type"],
            classification["project_subtype"],
            combined_text,
        )
        budget = _estimate_budget(
            classification["project_type"],
            classification["project_subtype"],
            combined_text,
        )
        refined_description = _build_project_summary(
            classification=classification,
            accomplishment=accomplishment,
            answers=clarification_answers,
            photo_count=photo_count,
        )
        assumptions = _clarification_assumptions_from_answers(clarification_answers)
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
            "project_type": classification["project_type"],
            "project_subtype": classification["project_subtype"],
            "project_family_key": classification["family_key"],
            "project_family_label": classification["family_label"],
            "project_scope_summary": refined_description,
            "description": refined_description,
            "project_timeline_days": timeline_days,
            "project_budget": str(budget),
            "milestones": milestones,
            "clarification_questions": clarification_questions,
            "clarification_answers": clarification_answers,
            "clarification_assumptions": assumptions,
            "measurement_handling": measurement_handling,
            "photo_count": photo_count,
        }

    project_type = classification["project_type"]
    project_subtype = classification["project_subtype"]
    project_title = _build_title(
        accomplishment=accomplishment,
        project_type=project_type,
        project_subtype=project_subtype,
    )
    timeline_days = _estimate_timeline_days(project_type, project_subtype, combined_text)
    budget = _estimate_budget(project_type, project_subtype, combined_text)
    description = _build_project_summary(
        classification=classification,
        accomplishment=accomplishment,
        answers=clarification_answers,
        photo_count=photo_count,
    )
    assumptions = _clarification_assumptions_from_answers(clarification_answers)
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
        "project_family_key": classification["family_key"],
        "project_family_label": classification["family_label"],
        "project_scope_summary": description,
        "description": description,
        "project_timeline_days": timeline_days,
        "project_budget": str(budget),
        "milestones": milestones,
        "clarification_questions": clarification_questions,
        "clarification_answers": clarification_answers,
        "clarification_assumptions": assumptions,
        "measurement_handling": measurement_handling,
        "photo_count": photo_count,
    }
