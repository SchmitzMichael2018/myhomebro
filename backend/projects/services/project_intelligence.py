from __future__ import annotations

from typing import Any


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize(value: Any) -> str:
    return " ".join(_safe_text(value).lower().replace("&", " and ").split())


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
