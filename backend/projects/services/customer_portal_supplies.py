from __future__ import annotations

import re
from datetime import date
from urllib.parse import urlencode

from django.conf import settings
from django.utils import timezone

from projects.models_customer_portal import PropertyHomeSystem
from projects.services.home_system_reminders import build_home_system_reminder


RISKY_SYSTEM_TYPES = {
    PropertyHomeSystem.SYSTEM_ELECTRICAL,
    PropertyHomeSystem.SYSTEM_ROOF,
    PropertyHomeSystem.SYSTEM_PLUMBING,
    PropertyHomeSystem.SYSTEM_FOUNDATION,
    PropertyHomeSystem.SYSTEM_SEPTIC_SEWER,
    PropertyHomeSystem.SYSTEM_SOLAR,
}

SUPPLY_RULES = {
    PropertyHomeSystem.SYSTEM_HVAC: [
        {
            "name": "HVAC filter",
            "reason": "Filters are a recurring upkeep item for most forced-air systems.",
            "interval": "Every 1-3 months",
            "query": "HVAC air filter",
        },
        {
            "name": "Furnace humidifier pad",
            "reason": "Homes with furnace humidifiers may need replacement pads during heating season.",
            "interval": "Seasonally",
            "query": "furnace humidifier pad",
        },
    ],
    PropertyHomeSystem.SYSTEM_WATER_HEATER: [
        {
            "name": "Water heater maintenance kit",
            "reason": "Anode rod and flushing supplies may support routine water heater maintenance.",
            "interval": "Annually",
            "query": "water heater anode rod flush kit",
        }
    ],
    PropertyHomeSystem.SYSTEM_APPLIANCE: [
        {
            "name": "Appliance replacement filter",
            "reason": "Some refrigerators, dryers, and dishwashers use recurring filters or cleaning supplies.",
            "interval": "Model dependent",
            "query": "appliance replacement filter",
        },
        {
            "name": "Refrigerator water filter",
            "reason": "Refrigerators with water dispensers usually need model-specific filters.",
            "interval": "Every 6 months",
            "query": "refrigerator water filter",
        },
    ],
    PropertyHomeSystem.SYSTEM_POOL_SPA: [
        {
            "name": "Pool filter cartridge",
            "reason": "Pool systems often need recurring filter cleaning or replacement.",
            "interval": "Seasonally or as needed",
            "query": "pool filter cartridge",
        },
        {
            "name": "Pool test strips",
            "reason": "Water testing supplies help track routine pool maintenance.",
            "interval": "Weekly during pool season",
            "query": "pool water test strips",
        },
    ],
    PropertyHomeSystem.SYSTEM_SEPTIC_SEWER: [
        {
            "name": "Septic treatment",
            "reason": "Some homeowners track septic treatment as part of recurring system upkeep.",
            "interval": "Monthly or per provider guidance",
            "query": "septic tank treatment",
        }
    ],
    PropertyHomeSystem.SYSTEM_ELECTRICAL: [
        {
            "name": "Smoke detector batteries",
            "reason": "Smoke and CO detector batteries are a common recurring safety supply.",
            "interval": "Every 6-12 months",
            "query": "smoke detector batteries",
        }
    ],
    PropertyHomeSystem.SYSTEM_PLUMBING: [
        {
            "name": "Water softener salt",
            "reason": "Homes with water softeners may need recurring salt refills.",
            "interval": "Monthly or as needed",
            "query": "water softener salt",
        }
    ],
}


def _safe_text(value) -> str:
    return str(value or "").strip()


def amazon_search_url(query: str) -> str:
    params = {"k": _safe_text(query)}
    tag = _safe_text(getattr(settings, "AMAZON_AFFILIATE_TAG", ""))
    if tag:
        params["tag"] = tag
    return f"https://www.amazon.com/s?{urlencode(params)}"


def _system_query(system: PropertyHomeSystem, fallback: str) -> str:
    parts = [
        _safe_text(system.manufacturer),
        _safe_text(system.model_number),
        fallback,
    ]
    return " ".join(part for part in parts if part)


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def _supply_card(system: PropertyHomeSystem, rule: dict, index: int) -> dict:
    query = _system_query(system, rule["query"])
    next_due = None
    reminder = build_home_system_reminder(system)
    if reminder.next_recommended_service_date:
        next_due = reminder.next_recommended_service_date.isoformat()
    return {
        "id": f"system-{system.id}-supply-{index}",
        "kind": "supply",
        "system_id": system.id,
        "system": system.display_name,
        "system_type": system.system_type,
        "system_type_label": system.get_system_type_display(),
        "title": rule["name"],
        "supply_name": rule["name"],
        "reason": rule["reason"],
        "suggested_interval": rule["interval"],
        "next_due_date": next_due,
        "compatibility_warning": "Confirm size, model, quantity, and compatibility before purchasing.",
        "priority": "medium" if reminder.maintenance_status in {"due_soon", "overdue"} else "low",
        "confidence": "medium",
        "source_note": "Based on the saved home system type and maintenance records.",
        "provider_links": [
            {
                "provider": "amazon",
                "label": "Search on Amazon",
                "url": amazon_search_url(query),
            }
        ],
        "actions": [
            {"type": "amazon_search", "label": "Search on Amazon", "url": amazon_search_url(query), "provider": "amazon"},
            {"type": "diy_help", "label": "Get DIY help"},
        ],
    }


def _end_of_life_card(system: PropertyHomeSystem, today: date) -> dict | None:
    reminder = build_home_system_reminder(system, today=today)
    if reminder.maintenance_status != "lifespan_attention":
        return None
    replacement_query = f"{system.get_system_type_display()} replacement contractor"
    return {
        "id": f"system-{system.id}-end-of-life",
        "kind": "end_of_life",
        "system_id": system.id,
        "system": system.display_name,
        "system_type": system.system_type,
        "system_type_label": system.get_system_type_display(),
        "title": f"{system.display_name} may be approaching expected service life",
        "reason": "This system may be approaching its expected service life based on available records.",
        "suggested_interval": "",
        "next_due_date": reminder.next_recommended_service_date.isoformat() if reminder.next_recommended_service_date else "",
        "compatibility_warning": "",
        "priority": reminder.priority,
        "confidence": "medium",
        "source_note": "Based on install date and expected lifespan saved in Home Systems.",
        "actions": [
            {"type": "find_contractor", "label": "Find Contractor", "query": replacement_query},
            {"type": "view_options", "label": "View replacement options", "url": amazon_search_url(f"{system.get_system_type_display()} replacement options")},
        ],
        "safety_note": "For major replacement work, compare contractor options before planning DIY work.",
    }


def build_home_system_supply_recommendations(systems, *, today: date | None = None) -> list[dict]:
    today = today or timezone.localdate()
    recommendations: list[dict] = []
    for system in systems:
        if getattr(system, "is_archived", False):
            continue
        for index, rule in enumerate(SUPPLY_RULES.get(system.system_type, [])[:2], start=1):
            recommendations.append(_supply_card(system, rule, index))
        end_of_life = _end_of_life_card(system, today)
        if end_of_life:
            recommendations.append(end_of_life)
    return recommendations


def _clean_material_hint(value: str) -> list[str]:
    text = _safe_text(value)
    if not text:
        return []
    pieces = re.split(r"[\n;,]+", text)
    return [piece.strip(" .:-") for piece in pieces if piece.strip(" .:-")][:4]


def build_project_material_recommendations(project_row: dict, milestone_rows: list[dict] | None = None) -> list[dict]:
    materials: list[dict] = []
    seen = set()
    source_rows = milestone_rows or []
    for row in source_rows:
        for material in _clean_material_hint(row.get("materials_hint", "")):
            key = material.lower()
            if key in seen:
                continue
            seen.add(key)
            materials.append(
                {
                    "id": f"project-{project_row.get('id')}-material-{len(materials) + 1}",
                    "name": material,
                    "category": "Project material",
                    "reason": "Suggested from saved milestone material guidance.",
                    "related_milestone": _safe_text(row.get("title")),
                    "quantity": "",
                    "unit": "",
                    "compatibility_warning": "Confirm exact product, size, quantity, and compatibility before purchasing.",
                    "provider_links": [
                        {
                            "provider": "amazon",
                            "label": "Search on Amazon",
                            "url": amazon_search_url(material),
                        }
                    ],
                }
            )
    if not materials:
        project_type = _safe_text(project_row.get("project_class_label") or project_row.get("title"))
        if project_type:
            materials.append(
                {
                    "id": f"project-{project_row.get('id')}-material-general",
                    "name": f"{project_type} project supplies",
                    "category": "Planning",
                    "reason": "Use this as a broad planning search only; contractor specifications should control final purchases.",
                    "related_milestone": "",
                    "quantity": "",
                    "unit": "",
                    "compatibility_warning": "Confirm exact product, size, quantity, and compatibility before purchasing.",
                    "provider_links": [
                        {
                            "provider": "amazon",
                            "label": "Search on Amazon",
                            "url": amazon_search_url(f"{project_type} project supplies"),
                        }
                    ],
                }
            )
    return materials[:6]
