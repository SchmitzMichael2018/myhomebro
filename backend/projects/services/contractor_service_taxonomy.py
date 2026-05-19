from __future__ import annotations

import re
from typing import Any


GENERIC_GOOGLE_TERMS = {
    "point of interest",
    "establishment",
    "store",
    "home goods store",
    "building materials store",
    "general store",
}

SERVICE_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Flooring", ("flooring", "floor", "hardwood", "carpet", "tile floor", "floor covering")),
    ("Roofing", ("roofing", "roof repair", "roofer", "roof")),
    ("Concrete", ("concrete", "cement", "driveway", "slab")),
    ("Remodeling", ("remodeling", "renovation", "kitchen remodel", "bathroom remodel", "remodel")),
    ("Electrical", ("electrician", "electrical", "electric")),
    ("Plumbing", ("plumber", "plumbing")),
    ("HVAC", ("hvac", "heating", "cooling", "air conditioning", "air conditioner")),
    ("Home Addition", ("home addition", "room addition", "bedroom addition", "bedroom extension", "house extension", "add a room")),
    ("General Contracting", ("general contractor", "construction", "contractor")),
]


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_taxonomy_text(value: Any) -> str:
    text = _safe_text(value).lower().replace("_", " ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(part for part in text.split() if part)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def clean_raw_services(values: Any) -> list[str]:
    cleaned: list[str] = []
    for value in _as_list(values):
        text = normalize_taxonomy_text(value)
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def _append_unique(values: list[str], item: str) -> None:
    if item and item not in values:
        values.append(item)


def normalize_contractor_services(
    *,
    business_name: Any = "",
    website_domain: Any = "",
    raw_services: Any = None,
    search_term: Any = "",
    project_type: Any = "",
    project_subtype: Any = "",
) -> dict[str, Any]:
    raw_cleaned = clean_raw_services(raw_services)
    searchable_parts = [
        normalize_taxonomy_text(business_name),
        normalize_taxonomy_text(website_domain),
        normalize_taxonomy_text(search_term),
        normalize_taxonomy_text(project_type),
        normalize_taxonomy_text(project_subtype),
        *(term for term in raw_cleaned if term not in GENERIC_GOOGLE_TERMS),
    ]
    searchable = " ".join(part for part in searchable_parts if part)

    normalized: list[str] = []
    for label, keywords in SERVICE_RULES:
        if label == "General Contracting" and normalized and "Home Addition" not in normalized:
            continue
        if any(keyword in searchable for keyword in keywords):
            _append_unique(normalized, label)

    if "Home Addition" in normalized:
        _append_unique(normalized, "General Contracting")

    return {
        "raw_services": raw_cleaned,
        "normalized_services": normalized,
        "primary_service": normalized[0] if normalized else "",
        "status": "auto" if normalized else "not_started",
    }
