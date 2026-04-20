from __future__ import annotations

from typing import Any


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize(value: Any) -> str:
    return " ".join(_safe_text(value).lower().replace("&", " and ").split())


def _contains_any(text: str, needles: list[str]) -> bool:
    haystack = _normalize(text)
    return any(_normalize(needle) and _normalize(needle) in haystack for needle in needles)


PROJECT_TYPE_FAMILIES: list[dict[str, Any]] = [
    {
        "key": "roofing",
        "label": "Roofing",
        "cue_label": "Roofing-focused review",
        "keywords": [
            "roofing",
            "roof",
            "roof leak",
            "roof repair",
            "roof replacement",
            "reroof",
            "re roof",
            "shingle",
            "shingles",
            "underlayment",
            "flashing",
            "drip edge",
            "ridge vent",
            "metal roof",
            "tile roof",
        ],
        "prep_items": [
            "Confirm the leak location and affected areas.",
            "Verify whether repair or replacement is expected.",
            "Review roof age, prior repairs, and access conditions.",
            "Check weather exposure and temporary protection needs.",
        ],
        "response_starter": "I reviewed the roofing details and can confirm the affected areas, timing, and next steps before pricing.",
        "create_bid_context": "Roofing work often depends on leak location, roof age, and whether a repair or replacement is expected.",
        "draft_focus_line": "Roofing projects are clearer when the leak location, roof condition, and weather exposure are confirmed before final pricing.",
    },
    {
        "key": "bathroom_remodel",
        "label": "Bathroom Remodel",
        "cue_label": "Bathroom remodel-focused review",
        "keywords": [
            "bathroom",
            "bath remodel",
            "bathroom remodel",
            "shower",
            "tub",
            "vanity",
            "tile",
            "waterproof",
            "toilet",
            "fixtures",
        ],
        "prep_items": [
            "Clarify full versus partial remodel scope.",
            "Confirm any layout changes or fixture moves.",
            "Review fixture, tile, and finish selections.",
            "Verify plumbing or electrical changes if relevant.",
        ],
        "response_starter": "I reviewed the bathroom remodel details and can confirm the scope, selections, and next steps before pricing.",
        "create_bid_context": "Bathroom remodels are clearer when layout, fixtures, and finish selections are confirmed.",
        "draft_focus_line": "Bathroom remodels benefit from confirming layout changes, fixture selections, and any plumbing or electrical shifts before final pricing.",
    },
    {
        "key": "kitchen_remodel",
        "label": "Kitchen Remodel",
        "cue_label": "Kitchen remodel-focused review",
        "keywords": [
            "kitchen",
            "kitchen remodel",
            "cabinet",
            "cabinets",
            "countertop",
            "countertops",
            "backsplash",
            "island",
            "appliance",
        ],
        "prep_items": [
            "Clarify full versus partial remodel scope.",
            "Confirm cabinets, countertops, and backsplash selections.",
            "Review any layout or appliance changes.",
            "Verify plumbing or electrical changes if relevant.",
        ],
        "response_starter": "I reviewed the kitchen remodel details and can confirm the scope, selections, and next steps before pricing.",
        "create_bid_context": "Kitchen remodels are clearer when cabinets, countertops, layout changes, and appliance needs are confirmed.",
        "draft_focus_line": "Kitchen remodels benefit from confirming cabinets, countertops, layout changes, and any plumbing or electrical shifts before final pricing.",
    },
    {
        "key": "flooring",
        "label": "Flooring",
        "cue_label": "Flooring-focused review",
        "keywords": [
            "flooring",
            "floor",
            "lvp",
            "vinyl plank",
            "laminate",
            "hardwood",
            "tile floor",
            "floor install",
            "floor replacement",
        ],
        "prep_items": [
            "Confirm square footage and the rooms included.",
            "Review subfloor condition and any prep work needed.",
            "Confirm the flooring material and finish.",
            "Note removal, demo, or furniture moving needs.",
        ],
        "response_starter": "I reviewed the flooring details and can confirm the rooms, material, and next steps before pricing.",
        "create_bid_context": "Flooring work is clearer when square footage, subfloor condition, and removal needs are confirmed.",
        "draft_focus_line": "Flooring projects benefit from confirming square footage, subfloor condition, and removal or prep needs before final pricing.",
    },
    {
        "key": "painting",
        "label": "Painting",
        "cue_label": "Painting-focused review",
        "keywords": [
            "painting",
            "paint",
            "repaint",
            "stain",
            "refinish",
            "interior paint",
            "exterior paint",
            "cabinet paint",
        ],
        "prep_items": [
            "Confirm interior or exterior scope.",
            "Review surface prep, patching, and repairs.",
            "Clarify the rooms or surfaces included.",
            "Note finish level and coating expectations.",
        ],
        "response_starter": "I reviewed the painting details and can confirm the surfaces, prep needs, and next steps before pricing.",
        "create_bid_context": "Painting work is clearer when the surfaces, prep needs, and finish expectations are confirmed.",
        "draft_focus_line": "Painting projects benefit from confirming the surfaces involved, prep needs, and finish expectations before final pricing.",
    },
    {
        "key": "electrical",
        "label": "Electrical",
        "cue_label": "Electrical-focused review",
        "keywords": [
            "electrical",
            "electric",
            "outlet",
            "switch",
            "breaker",
            "panel",
            "wiring",
            "lighting",
            "light fixture",
        ],
        "prep_items": [
            "Clarify repair versus new install scope.",
            "Identify the panel, circuits, outlets, or lighting involved.",
            "Confirm any safety concerns or troubleshooting needs.",
            "Verify whether a site visit is needed before quoting.",
        ],
        "response_starter": "I reviewed the electrical details and can confirm the affected system, safety points, and next steps before pricing.",
        "create_bid_context": "Electrical work is clearer when the affected circuit, fixture, or panel area is confirmed.",
        "draft_focus_line": "Electrical work benefits from confirming the affected circuit, fixture, or panel area before final pricing.",
    },
    {
        "key": "plumbing",
        "label": "Plumbing",
        "cue_label": "Plumbing-focused review",
        "keywords": [
            "plumbing",
            "pipe",
            "faucet",
            "leak",
            "toilet",
            "drain",
            "sink",
            "water heater",
            "fixture",
        ],
        "prep_items": [
            "Clarify repair versus replacement scope.",
            "Identify the affected fixture, line, or leak area.",
            "Confirm access, shutoff, and troubleshooting needs.",
            "Note any related finish or restoration work.",
        ],
        "response_starter": "I reviewed the plumbing details and can confirm the affected area, access, and next steps before pricing.",
        "create_bid_context": "Plumbing work is clearer when the affected fixture or line and any access concerns are confirmed.",
        "draft_focus_line": "Plumbing work benefits from confirming the affected fixture or line, access, and whether repair or replacement is expected before final pricing.",
    },
    {
        "key": "exterior_siding",
        "label": "Exterior / Siding",
        "cue_label": "Exterior / siding-focused review",
        "keywords": [
            "exterior",
            "siding",
            "fascia",
            "soffit",
            "trim",
            "facade",
            "cladding",
            "outside",
            "exterior paint",
        ],
        "prep_items": [
            "Confirm the elevations or exterior areas included.",
            "Review siding, trim, and finish repair needs.",
            "Note weather exposure and temporary protection needs.",
            "Clarify whether painting or related repairs are included.",
        ],
        "response_starter": "I reviewed the exterior details and can confirm the affected areas, protection needs, and next steps before pricing.",
        "create_bid_context": "Exterior work is clearer when the affected elevations, siding or trim details, and weather exposure are confirmed.",
        "draft_focus_line": "Exterior projects benefit from confirming the affected elevations, siding or trim details, and weather exposure before final pricing.",
    },
    {
        "key": "windows_doors",
        "label": "Windows / Doors",
        "cue_label": "Windows / doors-focused review",
        "keywords": [
            "window",
            "windows",
            "door",
            "doors",
            "entry door",
            "patio door",
            "sliding door",
            "replacement window",
            "replace window",
            "replace door",
        ],
        "prep_items": [
            "Confirm the number of openings and sizes.",
            "Clarify repair versus replacement scope.",
            "Review trim, finish, and access details.",
            "Note any weatherproofing or lead-time needs.",
        ],
        "response_starter": "I reviewed the window and door details and can confirm the openings, scope, and next steps before pricing.",
        "create_bid_context": "Window and door work is clearer when sizes, scope, and trim or weatherproofing needs are confirmed.",
        "draft_focus_line": "Window and door projects benefit from confirming the openings, sizes, trim details, and weatherproofing needs before final pricing.",
    },
    {
        "key": "handyman",
        "label": "General Repair / Handyman",
        "cue_label": "General repair-focused review",
        "keywords": [
            "handyman",
            "general repair",
            "repair",
            "fix",
            "small repair",
            "misc repair",
            "punch list",
            "odd jobs",
            "home repair",
        ],
        "prep_items": [
            "List the individual tasks and priorities.",
            "Confirm which materials the contractor provides.",
            "Review access, timing, and any repeat visit needs.",
            "Call out anything that may need a specialty trade.",
        ],
        "response_starter": "I reviewed the repair details and can help confirm the task list, priorities, and next steps before pricing.",
        "create_bid_context": "General repair work is clearer when the task list, materials, and any specialty trade needs are confirmed.",
        "draft_focus_line": "General repair projects benefit from confirming the task list, materials, and any specialty trade needs before final pricing.",
    },
]

GENERIC_PROJECT_INTELLIGENCE = {
    "key": "general",
    "label": "General project review",
    "cue_label": "",
    "keywords": [],
    "prep_items": [
        "Confirm the scope, measurements, and timing before you respond.",
    ],
    "response_starter": "I’ll review the request and follow up if anything needs clarification.",
    "create_bid_context": "Review the request details and create your bid when you’re ready.",
    "draft_focus_line": "Review the project details and confirm the scope before final pricing.",
}


def _infer_scope_mode(text: str, family_key: str) -> str:
    normalized = _normalize(text)

    if family_key == "roofing":
        if _contains_any(normalized, ["replacement", "replace", "full replacement", "tear off", "tear-off"]):
            return "replacement"
        return "repair"

    if family_key == "bathroom_remodel":
        if _contains_any(normalized, ["repair", "update", "refresh", "fix", "small"]):
            return "repair"
        return "remodel"

    if family_key == "kitchen_remodel":
        if _contains_any(normalized, ["cabinet", "cabinetry"]) and _contains_any(
            normalized, ["install", "installation", "remove", "removal", "replace", "replacement"]
        ):
            return "install_removal"
        if _contains_any(normalized, ["remodel", "layout", "countertop", "backsplash", "appliance", "island"]):
            return "remodel"
        return "install"

    if family_key == "flooring":
        return "install"

    if family_key == "painting":
        if "exterior" in normalized and "interior" in normalized:
            return "interior_exterior"
        if "exterior" in normalized:
            return "exterior"
        return "interior"

    if family_key in {"electrical", "plumbing"}:
        if _contains_any(normalized, ["install", "installation", "new"]):
            return "install"
        return "repair"

    if family_key == "exterior_siding":
        if _contains_any(normalized, ["replacement", "replace", "new"]):
            return "replacement"
        return "repair"

    if family_key == "windows_doors":
        if _contains_any(normalized, ["repair", "fix", "adjust"]):
            return "repair"
        return "replacement"

    return "general"


def infer_project_scope_mode(*, text: str, family_key: str) -> str:
    return _infer_scope_mode(text, family_key)


def build_project_setup_recommendation(
    *,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    description: str = "",
    template_id: Any = None,
    template_name: str = "",
) -> dict[str, Any]:
    family = infer_project_intelligence(
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description,
    )
    family_key = family.get("key", "general")
    family_label = family.get("label", "General project review")
    scope_text = _normalize(" ".join([project_title, project_type, project_subtype, description]))
    scope_mode = infer_project_scope_mode(text=scope_text, family_key=family_key)

    recommended_project_type = project_type or family_label
    recommended_project_subtype = project_subtype or family_label
    suggested_workflow = family.get("cue_label") or "General project review"
    suggested_template_label = ""
    recommendation_note = family.get("draft_focus_line", "") or "Review the project details before you finalize the setup."

    if family_key == "roofing":
        if scope_mode == "replacement":
            recommended_project_type = "Roof Replacement"
            recommended_project_subtype = "Roof Replacement"
            suggested_workflow = "Replacement workflow"
            suggested_template_label = "Roof Replacement Template"
            recommendation_note = "Roof replacement jobs are clearer when the roof condition, weather exposure, and scope boundary are confirmed."
        else:
            recommended_project_type = "Roof Repair"
            recommended_project_subtype = "Roof Repair"
            suggested_workflow = "Repair + inspection"
            suggested_template_label = "Roof Repair Template"
            recommendation_note = "Roof repairs are clearer when the leak location, affected areas, and inspection needs are confirmed."
    elif family_key == "bathroom_remodel":
        if scope_mode == "repair":
            recommended_project_type = "Bathroom Repair"
            recommended_project_subtype = "Bathroom Repair"
            suggested_workflow = "Repair / refresh workflow"
            suggested_template_label = "Bathroom Repair Template"
            recommendation_note = "Bathroom repair work is clearer when the fixture, finish, and any plumbing or layout changes are confirmed."
        else:
            recommended_project_type = "Bathroom Remodel"
            recommended_project_subtype = "Bathroom Remodel"
            suggested_workflow = "Remodel workflow"
            suggested_template_label = "Bathroom Remodel Template"
            recommendation_note = "Bathroom remodels benefit from confirming layout changes, fixtures, and finish selections before pricing."
    elif family_key == "kitchen_remodel":
        if scope_mode == "install_removal":
            recommended_project_type = "Kitchen Cabinet Installation"
            recommended_project_subtype = "Kitchen Cabinet Installation"
            suggested_workflow = "Install + removal"
            suggested_template_label = "Kitchen Cabinet Install Template"
            recommendation_note = "Kitchen cabinet projects are clearer when cabinet removal, installation, and related finish work are defined up front."
        else:
            recommended_project_type = "Kitchen Remodel"
            recommended_project_subtype = "Kitchen Remodel"
            suggested_workflow = "Remodel workflow"
            suggested_template_label = "Kitchen Remodel Template"
            recommendation_note = "Kitchen remodels benefit from confirming cabinets, countertops, layout changes, and related work before final pricing."
    elif family_key == "flooring":
        recommended_project_type = "Flooring Installation"
        recommended_project_subtype = "Flooring Installation"
        suggested_workflow = "Install workflow"
        suggested_template_label = "Flooring Installation Template"
        recommendation_note = "Flooring jobs are clearer when square footage, subfloor condition, and any removal or prep needs are confirmed."
    elif family_key == "painting":
        if scope_mode == "exterior":
            recommended_project_type = "Exterior Painting"
            recommended_project_subtype = "Exterior Painting"
            suggested_workflow = "Prep + paint workflow"
            suggested_template_label = "Exterior Painting Template"
            recommendation_note = "Exterior painting is clearer when the surfaces, prep work, and weather exposure are confirmed."
        else:
            recommended_project_type = "Interior Painting"
            recommended_project_subtype = "Interior Painting"
            suggested_workflow = "Prep + paint workflow"
            suggested_template_label = "Painting Template"
            recommendation_note = "Painting jobs benefit from confirming the rooms or surfaces included and any prep or repair needs."
    elif family_key == "electrical":
        if scope_mode == "install":
            recommended_project_type = "Electrical Installation"
            recommended_project_subtype = "Electrical Installation"
            suggested_workflow = "Install workflow"
            suggested_template_label = "Electrical Installation Template"
            recommendation_note = "Electrical installs are clearer when the affected circuits, fixtures, and access are confirmed."
        else:
            recommended_project_type = "Electrical Repair"
            recommended_project_subtype = "Electrical Repair"
            suggested_workflow = "Troubleshooting workflow"
            suggested_template_label = "Electrical Repair Template"
            recommendation_note = "Electrical repair work is clearer when the affected circuit, panel, or fixture is confirmed."
    elif family_key == "plumbing":
        if scope_mode == "install":
            recommended_project_type = "Plumbing Installation"
            recommended_project_subtype = "Plumbing Installation"
            suggested_workflow = "Install workflow"
            suggested_template_label = "Plumbing Installation Template"
            recommendation_note = "Plumbing installs are clearer when the fixture, line, and access needs are confirmed."
        else:
            recommended_project_type = "Plumbing Repair"
            recommended_project_subtype = "Plumbing Repair"
            suggested_workflow = "Troubleshooting workflow"
            suggested_template_label = "Plumbing Repair Template"
            recommendation_note = "Plumbing repairs are clearer when the affected fixture, leak area, and access are confirmed."
    elif family_key == "exterior_siding":
        if scope_mode == "replacement":
            recommended_project_type = "Exterior / Siding Replacement"
            recommended_project_subtype = "Exterior / Siding Replacement"
            suggested_workflow = "Replacement workflow"
            suggested_template_label = "Exterior / Siding Replacement Template"
            recommendation_note = "Exterior replacement work is clearer when the affected elevations, trim, and weather exposure are confirmed."
        else:
            recommended_project_type = "Exterior / Siding Repair"
            recommended_project_subtype = "Exterior / Siding Repair"
            suggested_workflow = "Repair workflow"
            suggested_template_label = "Exterior / Siding Repair Template"
            recommendation_note = "Exterior repair work is clearer when the affected elevations, trim, and protection needs are confirmed."
    elif family_key == "windows_doors":
        if scope_mode == "repair":
            recommended_project_type = "Window / Door Repair"
            recommended_project_subtype = "Window / Door Repair"
            suggested_workflow = "Repair workflow"
            suggested_template_label = "Window / Door Repair Template"
            recommendation_note = "Window and door repairs are clearer when the openings, trim, and access details are confirmed."
        else:
            recommended_project_type = "Windows / Doors Installation"
            recommended_project_subtype = "Windows / Doors Installation"
            suggested_workflow = "Replacement workflow"
            suggested_template_label = "Windows / Doors Installation Template"
            recommendation_note = "Window and door installs are clearer when the openings, sizes, and weatherproofing needs are confirmed."
    elif family_key == "handyman":
        recommended_project_type = "General Repair"
        recommended_project_subtype = "General Repair"
        suggested_workflow = "General repair workflow"
        suggested_template_label = "General Repair Template"
        recommendation_note = "General repair work is clearer when the task list, materials, and specialty trade needs are confirmed."

    recommended_template_id = None if template_id in (None, "") else template_id
    recommended_template_name = _safe_text(template_name) or suggested_template_label
    is_strong_template_match = bool(recommended_template_id)

    return {
        "project_family_key": family_key,
        "project_family_label": family_label,
        "recommended_project_type": recommended_project_type,
        "recommended_project_subtype": recommended_project_subtype,
        "suggested_workflow": suggested_workflow,
        "suggested_template_label": suggested_template_label,
        "recommended_template_id": recommended_template_id,
        "recommended_template_name": recommended_template_name,
        "recommendation_note": recommendation_note,
        "strong_template_match": is_strong_template_match,
    }



def infer_project_intelligence(*, project_title: str = "", project_type: str = "", project_subtype: str = "", description: str = "") -> dict[str, Any]:
    text = _normalize(" ".join([project_title, project_type, project_subtype, description]))
    best = GENERIC_PROJECT_INTELLIGENCE
    best_score = 0

    for family in PROJECT_TYPE_FAMILIES:
        score = 0
        for keyword in family.get("keywords", []):
            normalized_keyword = _normalize(keyword)
            if normalized_keyword and normalized_keyword in text:
                score += 2 if " " in normalized_keyword else 1

        normalized_type = _normalize(project_type)
        normalized_subtype = _normalize(project_subtype)
        if family["key"] in normalized_type or family["key"] in normalized_subtype:
            score += 3

        if score > best_score:
            best = family
            best_score = score

    if best_score <= 0:
        return {**GENERIC_PROJECT_INTELLIGENCE, "is_generic": True}

    return {**best, "is_generic": best["key"] == "general"}


def build_project_intelligence_context(**kwargs: Any) -> dict[str, Any]:
    family = infer_project_intelligence(**kwargs)
    return {
        "family_key": family["key"],
        "family_label": family["label"],
        "family_cue_label": family.get("cue_label", ""),
        "prep_items": list(family.get("prep_items", [])),
        "response_starter": _safe_text(family.get("response_starter", "")),
        "create_bid_context": _safe_text(family.get("create_bid_context", "")),
        "draft_focus_line": _safe_text(family.get("draft_focus_line", "")),
        "is_generic": bool(family.get("is_generic")),
    }
