from __future__ import annotations

import re
from typing import Any


INVALID_PROJECT_TITLES = {
    "untitled project",
    "custom project",
    "select type",
    "select subtype",
    "project",
}

ADDITION_PATTERNS = [
    r"\bbedroom\s+extension\b",
    r"\broom\s+addition\b",
    r"\bhome\s+addition\b",
    r"\bhouse\s+extension\b",
    r"\badd(?:ing)?\s+(?:a\s+)?room\b",
    r"\badd(?:ing)?\s+(?:a\s+)?bedroom\b",
    r"\bbuilding?\s+(?:an?\s+)?addition\b",
]


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _is_usable_title(value: Any) -> bool:
    text = _clean_text(value)
    return bool(text) and text.lower() not in INVALID_PROJECT_TITLES


def _description_text(*values: Any) -> str:
    return " ".join(_clean_text(value) for value in values if _clean_text(value)).lower()


def is_home_addition_description(*values: Any) -> bool:
    text = _description_text(*values)
    return any(re.search(pattern, text) for pattern in ADDITION_PATTERNS)


def classify_project_from_description(*, description: Any = "", refined_description: Any = "") -> dict[str, str]:
    text = _description_text(refined_description, description)
    if is_home_addition_description(description, refined_description):
        subtype = "Bedroom Addition" if "bedroom" in text else "Home Addition"
        return {"project_type": "General Contracting", "project_subtype": subtype}
    return {"project_type": "", "project_subtype": ""}


def normalize_project_classification(
    *,
    project_type: Any = "",
    project_subtype: Any = "",
    description: Any = "",
    refined_description: Any = "",
) -> dict[str, str]:
    description_classification = classify_project_from_description(
        description=description,
        refined_description=refined_description,
    )
    if description_classification["project_type"]:
        return description_classification
    return {
        "project_type": _clean_text(project_type),
        "project_subtype": _clean_text(project_subtype),
    }


def generate_project_title(
    *,
    project_title: Any = "",
    project_type: Any = "",
    project_subtype: Any = "",
    description: Any = "",
    refined_description: Any = "",
    room_area: Any = "",
    measurements: Any = None,
) -> str:
    """Return a homeowner-friendly project title, never a placeholder."""

    type_text = _clean_text(project_type)
    subtype_text = _clean_text(project_subtype)
    description_context = _description_text(refined_description, description)
    if is_home_addition_description(description, refined_description):
        return "Bedroom Extension Project" if "bedroom extension" in description_context else "Bedroom Addition Project"

    if _is_usable_title(project_title):
        return _clean_text(project_title)

    context = " ".join(
        _clean_text(value)
        for value in [type_text, subtype_text, room_area, refined_description, description, measurements]
        if _clean_text(value)
    ).lower()

    if any(term in context for term in ["kitchen", "cabinet", "carpentry"]):
        if "cabinet" in context or "carpentry" in context:
            return "Kitchen Cabinet Installation"
        return "Kitchen Remodeling Project"
    if any(term in context for term in ["countertop", "quartz", "granite"]):
        return "Countertop Installation Project"
    if any(term in context for term in ["floor", "flooring", "hardwood", "laminate", "vinyl", "tile"]):
        if any(term in context for term in ["replace", "replacement", "remove old"]):
            return "Flooring Replacement Project"
        return "Flooring Installation Project"
    if any(term in context for term in ["patio", "concrete", "slab", "driveway", "walkway", "hardscape", "masonry"]):
        if "patio" in context:
            return "Patio Concrete Project"
        return "Concrete Project"
    if any(term in context for term in ["bathroom", "shower", "tub", "vanity"]):
        return "Bathroom Remodel Project"
    if any(term in context for term in ["roof", "roofing", "shingle", "leak"]):
        return "Roof Repair Request" if "repair" in context or "leak" in context else "Roofing Project"
    if any(term in context for term in ["paint", "painting", "painter"]):
        return "Painting Project"
    if any(term in context for term in ["drywall", "sheetrock"]):
        return "Drywall Project"
    if any(term in context for term in ["electrical", "electrician", "panel", "wiring"]):
        return "Electrical Project"
    if any(term in context for term in ["plumbing", "plumber", "pipe", "drain"]):
        return "Plumbing Project"
    if any(term in context for term in ["hvac", "heating", "cooling", "air conditioning", "furnace"]):
        return "HVAC Project"

    if _is_usable_title(subtype_text):
        return f"{subtype_text} Project"
    if _is_usable_title(type_text):
        return f"{type_text} Project"
    return "Home Improvement Project"
