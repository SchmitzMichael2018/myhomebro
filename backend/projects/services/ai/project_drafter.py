# backend/projects/services/ai/project_drafter.py
from __future__ import annotations

import json
import os
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.conf import settings
from django.db.models import Q

from projects.models import Agreement, Contractor
from projects.models_templates import ProjectTemplate
from projects.services.proposal_learning import build_proposal_draft


PROJECT_TYPE_HINTS: dict[str, list[str]] = {
    "Remodel": [
        "remodel", "renovate", "renovation", "convert", "conversion", "update",
        "kitchen", "bathroom", "basement", "wet bar", "shower", "tub", "vanity", "cabinet", "countertop", "demo",
    ],
    "Repair": [
        "repair", "fix", "replace damaged", "leak", "broken", "patch", "restore",
    ],
    "Installation": [
        "install", "installation", "mount", "replace", "put in", "hook up",
        "appliance", "fixture",
    ],
    "Siding": [
        "siding", "siding replacement", "replace siding", "siding repair", "new siding",
    ],
    "Electrical": [
        "electrical", "wire", "wiring", "panel", "breaker", "lighting", "light fixture",
        "recessed light", "outlet", "switch", "fan", "ceiling fan", "ev charger",
    ],
    "Painting": [
        "paint", "painting", "stain", "refinish", "cabinet paint",
    ],
    "Outdoor": [
        "deck", "fence", "patio", "pergola", "gazebo", "landscape", "yard",
        "retaining wall", "outdoor", "fire pit", "shed", "outbuilding",
        "garage", "carport", "storage shed", "tool shed", "garden shed", "backyard shed",
    ],
    "Outdoor Living": [
        "outdoor kitchen", "patio kitchen", "grill island", "outdoor bar", "patio extension",
        "outdoor living", "weather-resistant cabinets", "weather resistant cabinets",
        "outdoor countertop", "outdoor sink", "outdoor cooking",
    ],
    "Concrete": [
        "concrete", "slab", "slab pour", "pour slab", "cement",
        "driveway", "sidewalk", "pad", "foundation pour",
    ],
    "Inspection": [
        "inspect", "inspection", "estimate visit", "site visit", "assessment",
    ],
    "DIY Help": [
        "help me", "assist", "assist with", "diy", "homeowner help",
    ],
    "Roofing": [
        "roof", "roofing", "roof leak", "roof repair", "roof replacement",
        "new roof", "reroof", "re-roof", "shingle", "shingles", "ridge vent",
        "underlayment", "flashing", "drip edge", "metal roof", "tile roof",
        "clay tile", "concrete tile", "asphalt shingle",
    ],
    "Pool": [
        "pool", "pool house", "inground pool", "in-ground pool", "pool installation", "pool remodel",
    ],
    "Junk Removal": [
        "junk removal", "debris removal", "appliance removal", "furniture removal", "haul away", "haul-away", "trash out", "construction debris",
    ],
    "Custom": [],
}

SUBTYPE_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "Remodel": {
        "Kitchen": ["kitchen", "cabinet", "countertop", "backsplash"],
        "Bathroom": ["bathroom", "shower", "tub", "toilet", "vanity"],
        "Basement": ["basement", "finish basement", "basement finishing", "basement remodel"],
        "Home Theater / Media Room": ["home theater", "media room", "entertainment room", "projector", "speaker", "sound system"],
        "Wet Bar Installation": ["wet bar", "bar cabinet", "bar countertop", "bar sink", "wet bar installation"],
        "Cabinetry and Countertops": ["cabinet", "cabinetry", "countertop", "quartz", "granite"],
        "Flooring": ["floor", "tile", "lvp", "vinyl plank", "hardwood", "laminate"],
        "Drywall": ["drywall", "sheetrock", "texture", "tape and float"],
        "General Remodel": ["remodel", "renovation", "update"],
    },
    "Repair": {
        "Plumbing Repair": ["plumbing", "pipe", "leak", "faucet", "drain", "toilet"],
        "Electrical Repair": ["electrical", "outlet", "switch", "breaker", "light"],
        "Roof Repair": ["roof", "shingle", "flashing", "leak"],
        "General Repair": ["repair", "fix", "patch", "broken"],
    },
    "Installation": {
        "Appliance Install": ["appliance", "dishwasher", "range", "oven", "microwave", "hood"],
        "Fixture Install": ["fixture", "fan", "light", "sink", "faucet", "toilet"],
        "Floor Install": ["floor", "tile", "lvp", "vinyl plank", "hardwood", "laminate"],
        "General Install": ["install", "mount", "replace"],
    },
    "Electrical": {
        "Panel": ["panel", "breaker", "subpanel", "service upgrade"],
        "Rewire": ["rewire", "wiring", "wire", "circuit"],
        "Lighting": ["lighting", "light fixture", "recessed light", "light install"],
        "EV Charger": ["ev charger", "charger", "tesla"],
    },
    "Siding": {
        "Siding Replacement": ["siding replacement", "replace siding", "new siding", "siding install"],
        "Siding Repair": ["siding repair", "repair siding", "patch siding"],
    },
    "Painting": {
        "Interior": ["interior", "inside", "room", "ceiling", "wall"],
        "Exterior": ["exterior", "outside", "siding", "trim", "fascia"],
        "Cabinets": ["cabinet", "cabinetry"],
    },
    "Roofing": {
        "Repair": [
            "roof repair", "leak repair", "repair", "patch", "flashing repair",
            "replace shingles", "wind damage", "storm damage",
        ],
        "Replacement": [
            "roof replacement", "replace roof", "new roof", "full reroof",
            "tear off", "re-roof", "reroof",
        ],
        "Inspection": [
            "roof inspection", "inspection", "quote", "estimate", "assessment",
        ],
        "New Install": [
            "new install", "new construction", "install roof", "roof install",
        ],
    },
    "Pool": {
        "Inground Pool and Pool House": ["inground pool", "in-ground pool", "pool house", "pool installation", "pool remodel"],
        "Pool House Construction": ["pool house construction", "pool house", "pool pavilion", "pool cabana"],
        "Pool Installation": ["pool installation", "new pool", "pool build", "pool project"],
    },
    "Outdoor Living": {
        "Outdoor Kitchen": ["outdoor kitchen", "patio kitchen", "outdoor cooking", "weather-resistant cabinets", "weather resistant cabinets", "outdoor countertop", "outdoor sink"],
        "Patio Kitchen": ["patio kitchen", "outdoor kitchen", "patio cooking surface"],
        "Outdoor Bar": ["outdoor bar", "backyard bar", "patio bar"],
        "Grill Island": ["grill island", "bbq island", "bbq station"],
        "Patio Extension": ["patio extension", "patio expansion", "extend patio"],
    },
    "Junk Removal": {
        "Junk Removal": ["junk removal", "debris removal", "haul away", "haul-away", "trash out"],
        "Debris Removal": ["debris removal", "construction debris", "demo debris", "jobsite debris"],
        "Appliance Removal": ["appliance removal", "remove appliance", "haul away appliance", "old appliance"],
        "Furniture Removal": ["furniture removal", "haul away furniture", "old furniture", "sofa removal"],
        "Construction Debris Removal": ["construction debris", "demo debris", "construction waste", "renovation debris"],
    },
    "Outdoor": {
        "Shed Build": ["shed", "shed build", "outbuilding", "storage shed", "tool shed", "garden shed", "backyard shed"],
        "Fence": ["fence", "gate"],
        "Deck": ["deck", "railing", "stairs"],
        "Patio": ["patio", "paver", "concrete"],
        "Landscaping": ["landscape", "mulch", "rock", "plant", "drainage", "sod"],
        "Pergola": ["pergola", "gazebo", "shade structure"],
    },
    "Concrete": {
        "Concrete Slab": [
            "concrete slab", "slab", "slab pour", "pour slab", "foundation", "pad", "driveway", "sidewalk",
        ],
        "Foundation": ["foundation", "footing", "stem wall"],
        "Driveway": ["driveway", "approach"],
        "Patio": ["patio", "paver", "concrete patio"],
    },
    "Inspection": {
        "Estimate Visit": ["estimate", "inspection", "site visit", "assessment"],
    },
    "DIY Help": {
        "Assist": ["assist", "help", "diy"],
    },
    "Custom": {
        "Custom": [],
    },
}

FALLBACK_CLARIFICATIONS: dict[str, list[dict[str, Any]]] = {
    "Deck": [
        {"question": "Approximate deck size (sq ft)?", "type": "number", "required": False},
        {"question": "Railing type?", "type": "select", "options": ["Wood", "Aluminum", "Cable", "Composite"], "required": False},
        {"question": "Are stairs included?", "type": "boolean", "required": False},
    ],
    "Bathroom": [
        {"question": "Tub, shower, or full bath remodel?", "type": "select", "options": ["Tub", "Shower", "Tub to Shower Conversion", "Full Bathroom Remodel"], "required": False},
        {"question": "Tile area size / square footage?", "type": "number", "required": False},
        {"question": "Glass enclosure included?", "type": "boolean", "required": False},
    ],
    "Basement": [
        {"question": "Approximate basement square footage?", "type": "number", "required": False},
        {"question": "Is framing or layout change included?", "type": "boolean", "required": False},
        {"question": "Are flooring and trim included?", "type": "boolean", "required": False},
    ],
    "Wet Bar Installation": [
        {"question": "Is sink/plumbing included?", "type": "boolean", "required": False},
        {"question": "Are cabinets or countertop included?", "type": "boolean", "required": False},
        {"question": "Are lighting or electrical updates included?", "type": "boolean", "required": False},
    ],
    "Pool": [
        {"question": "Is this an inground pool?", "type": "boolean", "required": False},
        {"question": "Is a pool house included?", "type": "boolean", "required": False},
        {"question": "Are decking or coping included?", "type": "boolean", "required": False},
    ],
    "Cabinetry and Countertops": [
        {"question": "Are cabinets included?", "type": "boolean", "required": False},
        {"question": "Are countertops included?", "type": "boolean", "required": False},
        {"question": "Is sink or plumbing included?", "type": "boolean", "required": False},
    ],
    "Kitchen": [
        {"question": "Cabinet replacement or refinishing?", "type": "select", "options": ["Replace", "Refinish", "Partial"], "required": False},
        {"question": "Countertop replacement included?", "type": "boolean", "required": False},
        {"question": "Backsplash included?", "type": "boolean", "required": False},
    ],
    "Fence": [
        {"question": "Fence length (linear feet)?", "type": "number", "required": False},
        {"question": "Fence material?", "type": "select", "options": ["Wood", "Metal", "Vinyl", "Composite"], "required": False},
        {"question": "Gate included?", "type": "boolean", "required": False},
    ],
    "Roofing": [
        {
            "question": "Roofing material?",
            "type": "select",
            "options": ["Asphalt Shingle", "Metal", "Clay Tile", "Concrete Tile", "TPO", "Modified Bitumen", "Other"],
            "required": False,
        },
        {
            "question": "Project scope?",
            "type": "select",
            "options": ["Repair", "Replacement", "Inspection", "New Install"],
            "required": False,
        },
        {
            "question": "Existing solar or rooftop structures?",
            "type": "select",
            "options": ["None", "Solar Panels", "Satellite Dish", "HVAC Units", "Skylights", "Multiple"],
            "required": False,
        },
        {
            "question": "Approximate roof complexity?",
            "type": "select",
            "options": ["Low", "Standard", "Steep", "Complex / Multi-Level"],
            "required": False,
        },
        {
            "question": "Tear-off or overlay?",
            "type": "select",
            "options": ["Tear-off", "Overlay", "Unsure"],
            "required": False,
        },
        {
            "question": "Insurance claim involved?",
            "type": "boolean",
            "required": False,
        },
    ],
}

FALLBACK_MILESTONES: dict[str, list[dict[str, Any]]] = {
    "Deck": [
        {"title": "Site Prep & Layout", "description": "Verify measurements, access, and staging.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Posts / Framing", "description": "Install or repair structural framing and supports.", "percent": Decimal("30.00"), "duration_days": 2},
        {"title": "Decking Installation", "description": "Install decking boards and fasteners.", "percent": Decimal("30.00"), "duration_days": 2},
        {"title": "Railing / Stairs", "description": "Install railing and stairs if included.", "percent": Decimal("20.00"), "duration_days": 1},
        {"title": "Punch / Cleanup", "description": "Final cleanup and completion walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Bathroom": [
        {"title": "Demolition & Prep", "description": "Protect area and remove existing finishes/fixtures as needed.", "percent": Decimal("12.00"), "duration_days": 1},
        {"title": "Plumbing / Electrical Rough-In", "description": "Complete rough-in work for revised layout or fixtures.", "percent": Decimal("20.00"), "duration_days": 1},
        {"title": "Waterproofing / Substrate", "description": "Install backer, waterproofing, and substrate prep.", "percent": Decimal("18.00"), "duration_days": 1},
        {"title": "Tile / Finish Surfaces", "description": "Install tile and finish surfaces.", "percent": Decimal("28.00"), "duration_days": 2},
        {"title": "Fixture Install / Final", "description": "Install fixtures, trim, punch, and final walkthrough.", "percent": Decimal("22.00"), "duration_days": 1},
    ],
    "Kitchen": [
        {"title": "Demo & Protection", "description": "Protect adjacent areas and remove existing items as needed.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Rough-In / Prep", "description": "Prepare walls, rough-ins, and layout.", "percent": Decimal("20.00"), "duration_days": 1},
        {"title": "Cabinet / Core Install", "description": "Install cabinets and major project components.", "percent": Decimal("35.00"), "duration_days": 2},
        {"title": "Countertops / Backsplash / Finish", "description": "Install finish surfaces and trim items.", "percent": Decimal("25.00"), "duration_days": 2},
        {"title": "Final Punch", "description": "Final adjustments, cleanup, and walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Basement": [
        {"title": "Site Prep & Layout", "description": "Confirm basement measurements, access, and layout before work begins.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Framing / Insulation / Rough Prep", "description": "Complete framing, insulation, and rough prep for the finished basement scope.", "percent": Decimal("25.00"), "duration_days": 2},
        {"title": "Walls / Ceiling / Core Build-Out", "description": "Install drywall, ceiling components, and other core finish elements.", "percent": Decimal("30.00"), "duration_days": 2},
        {"title": "Flooring / Trim / Finishes", "description": "Install flooring, trim, and finish details for the basement area.", "percent": Decimal("25.00"), "duration_days": 2},
        {"title": "Cleanup / Walkthrough", "description": "Complete cleanup, punch list work, and final walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Wet Bar Installation": [
        {"title": "Layout & Prep", "description": "Confirm dimensions, access, and installation layout for the wet bar area.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Cabinetry & Base Build", "description": "Install base cabinetry, framing, and related rough supports.", "percent": Decimal("25.00"), "duration_days": 1},
        {"title": "Countertop & Sink Install", "description": "Install countertop, sink, and related plumbing fixture components.", "percent": Decimal("30.00"), "duration_days": 1},
        {"title": "Lighting & Finish Details", "description": "Complete lighting, trim, backsplash, and finishing details.", "percent": Decimal("25.00"), "duration_days": 1},
        {"title": "Cleanup / Walkthrough", "description": "Finish cleanup, punch list work, and walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Pool": [
        {"title": "Layout & Site Prep", "description": "Confirm layout, access, utility locations, and prepare the site for pool work.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Excavation & Structure", "description": "Complete excavation, shell, and structural pool installation work.", "percent": Decimal("30.00"), "duration_days": 2},
        {"title": "Mechanical & Plumbing", "description": "Install pool plumbing, equipment, and related mechanical systems.", "percent": Decimal("25.00"), "duration_days": 2},
        {"title": "Pool House / Finish Details", "description": "Complete pool house framing or finish work and final pool details.", "percent": Decimal("25.00"), "duration_days": 2},
        {"title": "Cleanup / Walkthrough", "description": "Complete cleanup, testing, and final walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Cabinetry and Countertops": [
        {"title": "Layout & Prep", "description": "Confirm measurements and prepare the work area for cabinetry and countertop installation.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Cabinet Installation", "description": "Set and secure cabinetry, verify alignment, and complete fitment.", "percent": Decimal("30.00"), "duration_days": 1},
        {"title": "Countertop Installation", "description": "Install countertop surfaces and confirm proper fit and finish.", "percent": Decimal("30.00"), "duration_days": 1},
        {"title": "Plumbing / Finish Details", "description": "Complete sink, faucet, trim, and finishing details as needed.", "percent": Decimal("20.00"), "duration_days": 1},
        {"title": "Cleanup / Walkthrough", "description": "Complete cleanup and walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "Fence": [
        {"title": "Layout & Prep", "description": "Mark layout and prep work area.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Posts / Structure", "description": "Set posts and structural framing.", "percent": Decimal("35.00"), "duration_days": 1},
        {"title": "Panels / Pickets", "description": "Install fence body.", "percent": Decimal("35.00"), "duration_days": 1},
        {"title": "Gate / Finish", "description": "Install gate hardware and finish details.", "percent": Decimal("20.00"), "duration_days": 1},
    ],
    "Roofing": [
        {"title": "Inspection / Measurements", "description": "Verify roof size, condition, penetrations, and access requirements.", "percent": Decimal("10.00"), "duration_days": 1},
        {"title": "Material Procurement / Scheduling", "description": "Confirm material selections, delivery, dumpster, and crew schedule.", "percent": Decimal("15.00"), "duration_days": 1},
        {"title": "Tear-Off / Repair Prep", "description": "Remove existing roofing as needed and prepare substrate / repairs.", "percent": Decimal("30.00"), "duration_days": 1},
        {"title": "Install Roofing System", "description": "Install underlayment, flashing, ventilation, and roofing material.", "percent": Decimal("35.00"), "duration_days": 2},
        {"title": "Cleanup / Final Walkthrough", "description": "Magnet sweep, debris cleanup, and final walkthrough.", "percent": Decimal("10.00"), "duration_days": 1},
    ],
    "General": [
        {"title": "Preparation", "description": "Prepare work area and confirm scope.", "percent": Decimal("20.00"), "duration_days": 1},
        {"title": "Core Work", "description": "Perform the main scope of work.", "percent": Decimal("60.00"), "duration_days": 1},
        {"title": "Finalization", "description": "Punch, cleanup, and final walkthrough.", "percent": Decimal("20.00"), "duration_days": 1},
    ],
}


def _safe_str(v: Any) -> str:
    return (v or "").__str__().strip()


def _norm_text(s: str) -> str:
    s = _safe_str(s).lower()
    s = re.sub(r"[^a-z0-9\s/-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


_MILESTONE_TITLE_STOP_WORDS = {
    "a",
    "an",
    "and",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "without",
    "within",
    "final",
    "main",
    "major",
    "phase",
    "project",
    "site",
    "stage",
    "step",
    "work",
    "primary",
}


def _milestone_title_fingerprint(value: Any) -> str:
    raw = _norm_text(_safe_str(value)).replace("&", " and ")
    tokens = [token for token in raw.split() if token and token not in _MILESTONE_TITLE_STOP_WORDS]
    if not tokens:
        return ""
    return " ".join(sorted(set(tokens)))


def _dedupe_milestone_rows(rows: list[dict[str, Any]], *, max_count: int = 8) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in rows or []:
        if not isinstance(row, dict):
            continue
        fingerprint = _milestone_title_fingerprint(row.get("title"))
        if not fingerprint or fingerprint in seen:
            continue
        seen.add(fingerprint)
        out.append(dict(row))

    if max_count and len(out) > max_count:
        out = out[:max_count]

    for idx, row in enumerate(out, start=1):
        row["order"] = idx

    return out


def _qmoney(v: Decimal | float | int | str) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _env_openai_api_key() -> str:
    return (
        getattr(settings, "OPENAI_API_KEY", None)
        or os.getenv("OPENAI_API_KEY", "")
        or ""
    )


def _try_json_loads(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except Exception:
        return None


def _normalize_question_keyish(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s


def _normalize_question_labelish(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\(e\.g\.[^)]+\)", " ", s)
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _clarification_group(item: dict[str, Any]) -> str:
    raw_key = _normalize_question_keyish(item.get("key"))
    raw_label = _normalize_question_labelish(item.get("label") or item.get("question"))
    text = f"{raw_key} {raw_label}"

    if "materials" in text and (
        "purchase" in text or
        "purchasing" in text or
        "purchases" in text or
        "responsible" in text
    ):
        return "materials_responsibility"

    if "permit" in text:
        return "permits_responsibility"

    if "measurement" in text or "measurements" in text:
        return "measurements_provided"

    if "floor" in text and "later" in text:
        return "flooring_finishes_later"

    if "access" in text or "working hours" in text:
        return "site_access_working_hours"

    if "debris" in text or "waste" in text:
        return "waste_removal_responsibility"

    if "delivery" in text:
        return "material_delivery_coordination"

    if "change order" in text or "unforeseen" in text:
        return "unforeseen_conditions_change_orders"

    return raw_key or _normalize_question_keyish(raw_label)


def _clarification_input_type(item: dict[str, Any], key: str) -> str:
    qtype = _safe_str(item.get("inputType") or item.get("response_type") or item.get("type")).lower()

    if qtype in {"radio", "boolean", "select"}:
        return "radio"

    if key in {
        "materials_responsibility",
        "permits_responsibility",
        "measurements_provided",
        "flooring_finishes_later",
    }:
        return "radio"

    return "textarea"


def _clarification_options(key: str, item: dict[str, Any]) -> list[Any]:
    opts = item.get("options")
    if isinstance(opts, list) and opts:
        return opts

    if key == "materials_responsibility":
        return ["Contractor", "Homeowner", "Split"]

    if key == "permits_responsibility":
        return ["Contractor", "Homeowner", "Split / depends"]

    if key == "measurements_provided":
        return ["Yes", "No", "Not yet"]

    if key == "flooring_finishes_later":
        return ["Yes", "No", "Unsure"]

    qtype = _safe_str(item.get("type")).lower()
    if qtype == "boolean":
        return ["Yes", "No"]

    return []


def _clarification_score(item: dict[str, Any]) -> int:
    score = 0
    if item.get("required"):
        score += 5
    if item.get("help"):
        score += 2
    if item.get("placeholder"):
        score += 1
    if item.get("options"):
        score += 3
    if item.get("inputType") == "radio":
        score += 2
    if item.get("label"):
        score += 1
    return score


def _canonicalize_clarifications(items: list[Any], source: str = "unknown") -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}

    for raw in items or []:
        if not isinstance(raw, dict):
            continue

        key = _clarification_group(raw)
        if not key:
            continue

        label = raw.get("label") or raw.get("question") or key.replace("_", " ").title()
        input_type = _clarification_input_type(raw, key)
        options = _clarification_options(key, raw)

        normalized = {
            "key": key,
            "label": label,
            "question": raw.get("question") or label,
            "help": raw.get("help") or "",
            "placeholder": raw.get("placeholder") or "",
            "required": bool(raw.get("required", False)),
            "inputType": input_type,
            "type": raw.get("type") or ("boolean" if input_type == "radio" and options == ["Yes", "No"] else "text"),
            "options": options,
            "source": raw.get("source") or source,
        }

        if key not in by_key:
            by_key[key] = normalized
            continue

        prev = by_key[key]
        winner = normalized if _clarification_score(normalized) > _clarification_score(prev) else prev

        by_key[key] = {
            **winner,
            "key": key,
            "required": bool(prev.get("required")) or bool(normalized.get("required")),
            "help": winner.get("help") or prev.get("help") or normalized.get("help") or "",
            "placeholder": winner.get("placeholder") or prev.get("placeholder") or normalized.get("placeholder") or "",
            "options": winner.get("options") or prev.get("options") or normalized.get("options") or [],
        }

    return list(by_key.values())


def _roofing_force_override(project_title: str, description: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    hay = _norm_text(f"{project_title}\n{description}")
    shed_signals = [
        "shed", "outbuilding", "storage shed", "tool shed", "garden shed", "backyard shed",
    ]
    concrete_primary_signals = [
        "pour concrete slab",
        "slab only",
        "pour slab",
        "slab pour",
        "foundation pour",
    ]
    if any(sig in hay for sig in shed_signals) and not any(sig in hay for sig in concrete_primary_signals):
        return None, None, None
    if any(sig in hay for sig in concrete_primary_signals) and not any(sig in hay for sig in shed_signals):
        subtype = "Concrete Slab"
        if any(sig in hay for sig in ["driveway", "sidewalk"]):
            subtype = "Concrete Slab"
        reason = f"Detected concrete-specific scope. Using type 'Concrete' and subtype '{subtype}'."
        return "Concrete", subtype, reason
    roof_signals = [
        "roof", "roofing", "roof leak", "roof repair", "roof replacement",
        "new roof", "reroof", "re-roof", "shingle", "shingles", "flashing",
        "underlayment", "drip edge", "ridge vent", "metal roof", "tile roof",
        "clay tile", "concrete tile", "asphalt shingle",
    ]
    if not any(sig in hay for sig in roof_signals):
        return None, None, None

    subtype = "Repair"
    if any(sig in hay for sig in ["replace roof", "roof replacement", "new roof", "reroof", "re-roof", "tear off"]):
        subtype = "Replacement"
    elif any(sig in hay for sig in ["inspection", "inspect", "assessment"]):
        subtype = "Inspection"
    elif any(sig in hay for sig in ["new install", "new construction", "install roof", "roof install"]):
        subtype = "New Install"

    reason = f"Detected roofing-specific scope. Using type 'Roofing' and subtype '{subtype}'."
    return "Roofing", subtype, reason


def classify_type_subtype(
    *,
    project_title: str,
    description: str,
    scope_text: str = "",
    requested_type: str = "",
    requested_subtype: str = "",
) -> tuple[str, str, str]:
    hay = f"{project_title}\n{description}\n{scope_text}"
    hay_norm = _norm_text(hay)

    media_room_signals = ["home theater", "media room", "entertainment room", "projector", "speaker", "sound system", "av equipment", "media wall", "screen wall"]
    media_room_support = ["framing", "drywall", "electrical", "lighting", "soundproof", "acoustic", "wired", "audio", "video"]
    media_room_hits = sum(1 for sig in media_room_signals if sig in hay_norm)
    media_room_support_hits = sum(1 for sig in media_room_support if sig in hay_norm)
    if media_room_hits >= 2 or (media_room_hits >= 1 and media_room_support_hits >= 2):
        return (
            "Remodel",
            "Home Theater / Media Room",
            "Detected media-room scope. Using type 'Remodel' and subtype 'Home Theater / Media Room'.",
        )

    outdoor_kitchen_signals = [
        "outdoor kitchen",
        "patio kitchen",
        "grill island",
        "outdoor bar",
        "patio extension",
        "weather resistant cabinet",
        "weather-resistant cabinet",
        "outdoor countertop",
        "outdoor sink",
        "outdoor cooking",
        "grill station",
        "backyard kitchen",
    ]
    outdoor_kitchen_hits = sum(1 for sig in outdoor_kitchen_signals if sig in hay_norm)
    outdoor_context_hits = sum(
        1 for sig in ["outdoor", "patio", "backyard", "outside", "exterior", "grill", "al fresco"] if sig in hay_norm
    )
    if "patio extension" in hay_norm or "patio expansion" in hay_norm or "extend patio" in hay_norm:
        return (
            "Outdoor Living",
            "Patio Extension",
            "Detected outdoor-living scope. Using type 'Outdoor Living' and subtype 'Patio Extension'.",
        )
    if "grill island" in hay_norm or "bbq island" in hay_norm or "bbq station" in hay_norm:
        return (
            "Outdoor Living",
            "Grill Island",
            "Detected outdoor-living scope. Using type 'Outdoor Living' and subtype 'Grill Island'.",
        )
    if "outdoor bar" in hay_norm or "backyard bar" in hay_norm or "patio bar" in hay_norm:
        return (
            "Outdoor Living",
            "Outdoor Bar",
            "Detected outdoor-living scope. Using type 'Outdoor Living' and subtype 'Outdoor Bar'.",
        )
    if outdoor_kitchen_hits >= 2 or (
        outdoor_kitchen_hits >= 1 and outdoor_context_hits >= 1
    ) or (
        "kitchen" in hay_norm and outdoor_context_hits >= 2
    ):
        return (
            "Outdoor Living",
            "Outdoor Kitchen",
            "Detected outdoor-kitchen scope. Using type 'Outdoor Living' and subtype 'Outdoor Kitchen'.",
        )

    junk_removal_signals = [
        "junk removal",
        "debris removal",
        "appliance removal",
        "furniture removal",
        "haul away",
        "haul-away",
        "trash out",
        "demo debris",
        "construction debris",
    ]
    junk_hits = sum(1 for sig in junk_removal_signals if sig in hay_norm)
    if junk_hits >= 2 or (
        junk_hits >= 1 and any(sig in hay_norm for sig in ["sofa", "couch", "mattress", "appliance", "furniture", "debris", "trash", "remove"])
    ) or ("junk" in hay_norm and "remove" in hay_norm):
        return (
            "Junk Removal",
            "Junk Removal",
            "Detected junk-removal scope. Using type 'Junk Removal' and subtype 'Junk Removal'.",
        )

    if not _safe_str(requested_type):
        hay = hay_norm
        shed_signals = [
            "shed",
            "outbuilding",
            "storage shed",
            "tool shed",
            "garden shed",
            "backyard shed",
        ]
        concrete_primary_signals = [
            "pour concrete slab",
            "slab only",
            "pour slab",
            "slab pour",
            "foundation pour",
            "driveway",
            "sidewalk",
        ]
        if any(sig in hay for sig in shed_signals) and not any(sig in hay for sig in concrete_primary_signals):
            return "Outdoor", "Shed Build", "Detected shed/outbuilding scope. Using type 'Outdoor' and subtype 'Shed Build'."
        if any(sig in hay for sig in concrete_primary_signals) and not any(sig in hay for sig in shed_signals):
            return "Concrete", "Concrete Slab", "Detected concrete-specific scope. Using type 'Concrete' and subtype 'Concrete Slab'."

        concrete_type, concrete_subtype, concrete_reason = _roofing_force_override(
            project_title, description
        )
        if concrete_type:
            return concrete_type, concrete_subtype or "", concrete_reason or "Concrete detected."

    if any(sig in hay_norm for sig in ["finish basement", "basement finishing", "basement remodel", "basement renovation", "basement"]):
        return "Remodel", "Basement", "Detected basement-specific scope. Using type 'Remodel' and subtype 'Basement'."

    pool_signals = ["inground pool", "in-ground pool", "pool house", "pool installation", "new pool", "pool build", "pool"]
    if any(sig in hay_norm for sig in pool_signals):
        return "Pool", "Inground Pool and Pool House", "Detected pool-specific scope. Using type 'Pool' and subtype 'Inground Pool and Pool House'."

    siding_signals = ["replace siding", "siding replacement", "new siding", "siding repair", "siding"]
    if any(sig in hay_norm for sig in siding_signals):
        return "Siding", "Siding Replacement", "Detected siding-specific scope. Using type 'Siding' and subtype 'Siding Replacement'."

    wet_bar_signals = ["wet bar", "bar cabinet", "bar countertop", "bar sink", "wet bar installation"]
    cabinetry_signals = ["cabinet", "cabinetry", "countertop", "quartz", "granite"]
    plumbing_signals = ["plumb", "sink", "faucet"]
    lighting_signals = ["lighting", "light fixture", "recessed light", "light install", "under-cabinet light"]
    wet_bar_signal_count = sum(1 for sig in wet_bar_signals if sig in hay_norm)
    wet_bar_support_count = sum(1 for sig in cabinetry_signals + plumbing_signals + lighting_signals if sig in hay_norm)
    if (wet_bar_signal_count or wet_bar_support_count >= 3) and not any(
        sig in hay_norm for sig in ["outdoor", "patio", "backyard", "outside", "exterior", "grill"]
    ):
        if wet_bar_signal_count or wet_bar_support_count >= 4 or sum(1 for sig in cabinetry_signals + plumbing_signals if sig in hay_norm) >= 2:
            return "Remodel", "Wet Bar Installation", "Detected wet-bar/remodel scope. Using type 'Remodel' and subtype 'Wet Bar Installation'."

    if _safe_str(requested_type):
        project_type = _safe_str(requested_type)
        project_subtype = _safe_str(requested_subtype)
        if not project_subtype:
            project_subtype = best_subtype_for_type(project_type, f"{project_title}\n{description}\n{scope_text}")
        return project_type, project_subtype, "Using provided type/subtype."

    best_type = "Custom"
    best_type_score = -1

    for project_type, keywords in PROJECT_TYPE_HINTS.items():
        score = sum(1 for kw in keywords if kw in hay_norm)
        if score > best_type_score:
            best_type = project_type
            best_type_score = score

    project_subtype = best_subtype_for_type(best_type, hay)
    reason = f"Detected type '{best_type}' and subtype '{project_subtype}' from project text."
    return best_type, project_subtype, reason


def build_classification_title(project_type: str, project_subtype: str, project_title: str, description: str) -> str:
    text = _norm_text(f"{project_title}\n{project_subtype}\n{description}")
    if project_type == "Junk Removal":
        return "Junk Removal"
    if project_type == "Remodel" and project_subtype == "Home Theater / Media Room":
        return "Home Theater Installation"
    if project_type == "Remodel" and project_subtype == "Basement":
        return "Basement Finishing"
    if project_type == "Siding" and project_subtype == "Siding Replacement":
        return "Siding Replacement"
    if project_type == "Pool" and project_subtype == "Inground Pool and Pool House":
        return "Inground Pool and Pool House"
    if project_type == "Outdoor Living":
        if project_subtype in {"Outdoor Kitchen", "Patio Kitchen", "Outdoor Bar", "Grill Island", "Patio Extension"}:
            return project_subtype
        return "Outdoor Kitchen"
    if project_type == "Roofing" and project_subtype == "Roof Replacement":
        return "Roof Replacement"
    if project_type == "Painting":
        if "bedroom" in text:
            return "Bedroom Painting"
        if "exterior" in text:
            return "Exterior Painting"
        return "Painting Project"
    if project_type == "Plumbing" and project_subtype == "Faucet Repair":
        return "Faucet Repair"
    if project_type == "Electrical" and project_subtype == "Lighting":
        return "Lighting Installation"
    if project_subtype:
        return project_subtype
    if project_type:
        return f"{project_type} Project"
    return "Project Starting Point"


def classify_project_classification(
    *,
    project_title: str = "",
    description: str = "",
    scope_text: str = "",
    requested_type: str = "",
    requested_subtype: str = "",
) -> dict[str, str]:
    from projects.services.ai.project_classifier import classify_project_from_scope

    classification = classify_project_from_scope(
        description=description,
        scope=scope_text or description,
        current_values={
            "project_title": project_title,
            "project_type": requested_type,
            "project_subtype": requested_subtype,
        },
    )
    return {
        "project_type": classification.get("project_type", ""),
        "project_subtype": classification.get("project_subtype", ""),
        "project_title": classification.get("project_title", ""),
        "classification_reason": classification.get("reason", ""),
        "confidence": classification.get("confidence", "low"),
        "confidence_label": classification.get("confidence_label", ""),
        "alternatives": classification.get("alternatives", []),
        "recommended_custom_subtype": classification.get("recommended_custom_subtype", ""),
    }


def best_subtype_for_type(project_type: str, text: str) -> str:
    subtype_map = SUBTYPE_KEYWORDS.get(project_type, {})
    if not subtype_map:
        return "Custom" if project_type == "Custom" else ""

    text_norm = _norm_text(text)

    if project_type == "Remodel":
        if any(sig in text_norm for sig in ["home theater", "media room", "entertainment room", "projector", "speaker", "sound system"]):
            return "Home Theater / Media Room"
        if any(sig in text_norm for sig in ["finish basement", "basement finishing", "basement remodel", "basement renovation", "basement"]):
            return "Basement"
        wet_bar_terms = ["wet bar", "bar cabinet", "bar countertop", "bar sink", "wet bar installation"]
        cabinet_terms = ["cabinet", "cabinetry", "countertop", "quartz", "granite"]
        plumbing_terms = ["plumb", "sink", "faucet"]
        lighting_terms = ["lighting", "light fixture", "recessed light", "light install", "under-cabinet light"]
        wet_bar_hits = sum(1 for sig in wet_bar_terms if sig in text_norm)
        cabinet_hits = sum(1 for sig in cabinet_terms if sig in text_norm)
        plumbing_hits = sum(1 for sig in plumbing_terms if sig in text_norm)
        lighting_hits = sum(1 for sig in lighting_terms if sig in text_norm)
        if wet_bar_hits or (cabinet_hits >= 2 and (plumbing_hits >= 1 or lighting_hits >= 1)):
            return "Wet Bar Installation"
        if cabinet_hits >= 1 and plumbing_hits == 0 and lighting_hits == 0 and wet_bar_hits == 0:
            return "Cabinetry and Countertops"
    if project_type == "Pool":
        if any(sig in text_norm for sig in ["inground pool", "in-ground pool", "pool house", "pool installation", "pool build", "new pool"]):
            return "Inground Pool and Pool House"
        if any(sig in text_norm for sig in ["pool house construction", "pool cabana", "pool pavilion"]):
            return "Pool House Construction"
        if any(sig in text_norm for sig in ["pool installation", "pool project", "pool"]):
            return "Pool Installation"
    if project_type == "Outdoor Living":
        if any(sig in text_norm for sig in ["patio extension", "patio expansion", "extend patio"]):
            return "Patio Extension"
        if any(sig in text_norm for sig in ["grill island", "bbq island", "bbq station"]):
            return "Grill Island"
        if any(sig in text_norm for sig in ["outdoor bar", "backyard bar", "patio bar"]):
            return "Outdoor Bar"
        if any(sig in text_norm for sig in ["patio kitchen", "outdoor kitchen", "outdoor cooking", "weather-resistant cabinets", "weather resistant cabinets", "outdoor countertop", "outdoor sink"]):
            return "Outdoor Kitchen"
    if project_type == "Siding":
        if any(sig in text_norm for sig in ["siding replacement", "replace siding", "new siding", "siding install", "siding"]):
            return "Siding Replacement"
        if any(sig in text_norm for sig in ["siding repair", "repair siding", "patch siding"]):
            return "Siding Repair"
    if project_type == "Electrical":
        if any(sig in text_norm for sig in ["lighting", "light fixture", "recessed light", "light install", "under-cabinet light"]):
            return "Lighting"
        if any(sig in text_norm for sig in ["panel", "breaker", "subpanel", "service upgrade"]):
            return "Panel"
        if any(sig in text_norm for sig in ["rewire", "wiring", "wire", "circuit"]):
            return "Rewire"
    best_subtype = ""
    best_score = -1

    for subtype, keywords in subtype_map.items():
        if not keywords:
            if best_score < 0:
                best_subtype = subtype
                best_score = 0
            continue
        score = sum(1 for kw in keywords if kw in text_norm)
        if score > best_score:
            best_subtype = subtype
            best_score = score

    return best_subtype or next(iter(subtype_map.keys()), "")


def _template_text_blob(template: ProjectTemplate) -> str:
    parts = [
        template.name,
        template.project_type,
        template.project_subtype,
        template.description,
        template.default_scope,
    ]
    try:
        if template.default_clarifications:
            parts.append(json.dumps(template.default_clarifications))
    except Exception:
        pass
    return _norm_text(" ".join(_safe_str(x) for x in parts))


def _score_template(template: ProjectTemplate, *, project_type: str, project_subtype: str, project_title: str, description: str) -> tuple[int, str]:
    score = 0
    reasons: list[str] = []
    blob = _template_text_blob(template)

    if _safe_str(project_type) and _safe_str(template.project_type).lower() == _safe_str(project_type).lower():
        score += 40
        reasons.append("type match")

    if _safe_str(project_subtype) and _safe_str(template.project_subtype).lower() == _safe_str(project_subtype).lower():
        score += 30
        reasons.append("subtype match")

    title_tokens = [t for t in re.split(r"\s+", _norm_text(project_title)) if len(t) >= 4]
    desc_tokens = [t for t in re.split(r"\s+", _norm_text(description)) if len(t) >= 4]
    uniq_tokens = list(dict.fromkeys(title_tokens + desc_tokens))

    token_hits = sum(1 for tok in uniq_tokens if tok in blob)
    if token_hits:
        score += min(token_hits * 4, 24)
        reasons.append(f"{token_hits} keyword hit(s)")

    if template.is_system_template:
        score += 2
        reasons.append("system template")

    return score, ", ".join(reasons) if reasons else "general similarity"


def find_best_template(
    *,
    contractor: Optional[Contractor],
    project_type: str,
    project_subtype: str,
    project_title: str,
    description: str,
) -> tuple[Optional[ProjectTemplate], int, str, str]:
    qs = ProjectTemplate.objects.filter(is_active=True)

    if contractor is not None:
        qs = qs.filter(Q(is_system_template=True, is_published=True) | Q(contractor=contractor))
    else:
        qs = qs.filter(is_system_template=True, is_published=True)

    candidates = list(qs.prefetch_related("milestones")[:200])

    if not candidates:
        return None, 0, "", "none"

    ranked: list[tuple[int, ProjectTemplate, str]] = []
    for tpl in candidates:
        s, reason = _score_template(
            tpl,
            project_type=project_type,
            project_subtype=project_subtype,
            project_title=project_title,
            description=description,
        )
        ranked.append((s, tpl, reason))

    ranked.sort(key=lambda x: (-x[0], x[1].name.lower()))
    best_score, best_tpl, best_reason = ranked[0]

    if best_score >= 65:
        confidence = "recommended"
    elif best_score >= 35:
        confidence = "possible"
    else:
        confidence = "none"

    if confidence == "none":
        return None, best_score, best_reason, confidence

    return best_tpl, best_score, best_reason, confidence


def estimate_project_total(
    *,
    project_type: str,
    project_subtype: str,
    project_title: str,
    description: str,
) -> dict[str, Decimal]:
    hay = _norm_text(f"{project_title} {description}")

    low = Decimal("1500.00")
    high = Decimal("3500.00")

    if "deck" in hay:
        low, high = Decimal("6000.00"), Decimal("14000.00")
    elif any(x in hay for x in ["bathroom", "shower", "tub", "vanity"]):
        low, high = Decimal("7000.00"), Decimal("18000.00")
    elif any(x in hay for x in ["kitchen", "cabinet", "backsplash", "countertop"]):
        low, high = Decimal("9000.00"), Decimal("30000.00")
    elif any(x in hay for x in ["fence", "gate"]):
        low, high = Decimal("2500.00"), Decimal("9000.00")
    elif any(x in hay for x in ["paint", "painting"]):
        low, high = Decimal("1500.00"), Decimal("7000.00")
    elif any(x in hay for x in ["tile", "floor", "flooring", "lvp", "hardwood"]):
        low, high = Decimal("2500.00"), Decimal("12000.00")
    elif any(x in hay for x in ["roof", "roofing", "shingle", "metal roof", "tile roof"]):
        low, high = Decimal("5000.00"), Decimal("22000.00")
    elif project_type == "Inspection":
        low, high = Decimal("150.00"), Decimal("750.00")

    if any(x in hay for x in ["large", "full", "complete", "custom", "structural", "addition"]):
        low *= Decimal("1.25")
        high *= Decimal("1.35")
    if any(x in hay for x in ["small", "minor", "patch", "simple"]):
        low *= Decimal("0.80")
        high *= Decimal("0.85")

    suggested = (low + high) / Decimal("2")
    return {
        "estimated_total_low": _qmoney(low),
        "estimated_total_high": _qmoney(high),
        "suggested_total": _qmoney(suggested),
    }


def _clarifications_from_template(template: Optional[ProjectTemplate], project_subtype: str, project_type: str = "") -> list[dict[str, Any]]:
    raw_items: list[dict[str, Any]] = []

    if template and isinstance(template.default_clarifications, list) and template.default_clarifications:
        raw_items = template.default_clarifications
    else:
        for key, qs in FALLBACK_CLARIFICATIONS.items():
            if key.lower() in _safe_str(project_subtype).lower() or key.lower() in _safe_str(project_type).lower():
                raw_items = qs
                break

    return _canonicalize_clarifications(raw_items, source="template" if template else "fallback")


def _fallback_milestone_blueprint(project_subtype: str, project_type: str = "") -> list[dict[str, Any]]:
    for key, rows in FALLBACK_MILESTONES.items():
        if key.lower() in _safe_str(project_subtype).lower() or key.lower() in _safe_str(project_type).lower():
            return rows
    return FALLBACK_MILESTONES["General"]


def _template_milestones_to_payload(
    template: ProjectTemplate,
    *,
    suggested_total: Decimal,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    rows = list(template.milestones.all().order_by("sort_order", "id"))
    for idx, row in enumerate(rows, start=1):
        amount = row.resolved_amount(suggested_total)
        out.append(
            {
                "order": idx,
                "title": row.title,
                "description": row.description or "",
                "suggested_amount": float(_qmoney(amount)),
                "pricing_percent": float(row.suggested_amount_percent) if row.suggested_amount_percent is not None else None,
                "duration_days": row.recommended_duration_days,
                "materials_hint": row.materials_hint or "",
                "is_optional": bool(row.is_optional),
                "source": "template",
            }
        )
    return _dedupe_milestone_rows(out)


def _fallback_milestones_to_payload(project_subtype: str, *, suggested_total: Decimal, project_type: str = "") -> list[dict[str, Any]]:
    rows = _fallback_milestone_blueprint(project_subtype, project_type)
    out: list[dict[str, Any]] = []

    for idx, row in enumerate(rows, start=1):
        pct = Decimal(str(row.get("percent", "0")))
        amount = _qmoney((Decimal(suggested_total) * pct) / Decimal("100"))
        out.append(
            {
                "order": idx,
                "title": row["title"],
                "description": row.get("description", ""),
                "suggested_amount": float(amount),
                "pricing_percent": float(pct),
                "duration_days": row.get("duration_days"),
                "materials_hint": row.get("materials_hint", ""),
                "is_optional": bool(row.get("is_optional", False)),
                "source": "fallback",
            }
        )

    if out:
        drift = _qmoney(Decimal(suggested_total) - sum(Decimal(str(m["suggested_amount"])) for m in out))
        if drift != Decimal("0.00"):
            last_amt = Decimal(str(out[-1]["suggested_amount"]))
            out[-1]["suggested_amount"] = float(_qmoney(last_amt + drift))

    return _dedupe_milestone_rows(out)


def _openai_refine_scope(
    *,
    project_title: str,
    description: str,
    project_type: str,
    project_subtype: str,
) -> Optional[dict]:
    api_key = _env_openai_api_key()
    if not api_key:
        return None

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)

    prompt = f"""
You are drafting structured residential contractor agreement data.

Return JSON only with keys:
- normalized_description: string
- milestone_titles: array of strings (3 to 7 items)
- clarifications: array of objects with keys: question, type, options(optional), required(optional)

Project title: {project_title}
Project type: {project_type}
Project subtype: {project_subtype}
Project description: {description}

Rules:
- Keep the description reusable and professional.
- Milestones should be practical for contractor billing and customer review.
- Clarifications should be job-specific variables.
- Clarifications should avoid duplicates and use stable wording when possible.
- Prefer concise, contractor-friendly phrasing.
- Do not include markdown fences.
"""

    try:
        resp = client.responses.create(
            model=getattr(settings, "OPENAI_PROJECT_DRAFTER_MODEL", "gpt-4.1-mini"),
            input=prompt,
            temperature=0.2,
        )
        text = getattr(resp, "output_text", "") or ""
        data = _try_json_loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        return None

    return None


def draft_project_structure(
    *,
    agreement: Optional[Agreement] = None,
    contractor: Optional[Contractor] = None,
    project_title: str = "",
    description: str = "",
    requested_type: str = "",
    requested_subtype: str = "",
) -> dict[str, Any]:
    if agreement is not None and contractor is None:
        contractor = getattr(agreement, "contractor", None)

    project_title = _safe_str(project_title) or _safe_str(getattr(getattr(agreement, "project", None), "title", ""))
    description = _safe_str(description) or _safe_str(getattr(agreement, "description", ""))

    project_type, project_subtype, type_reason = classify_type_subtype(
        project_title=project_title,
        description=description,
        requested_type=requested_type,
        requested_subtype=requested_subtype,
    )

    openai_data = _openai_refine_scope(
        project_title=project_title,
        description=description,
        project_type=project_type,
        project_subtype=project_subtype,
    )

    normalized_description = (
        _safe_str(openai_data.get("normalized_description"))
        if isinstance(openai_data, dict)
        else ""
    )
    if not normalized_description:
        normalized_description = description
    if not normalized_description:
        normalized_description = f"{project_subtype or project_type} project: {project_title}".strip(": ")

    from projects.services.ai.project_classifier import (
        build_project_taxonomy_snapshot,
        classify_project_from_scope,
    )

    taxonomy = build_project_taxonomy_snapshot(contractor=contractor)
    classification = classify_project_from_scope(
        description=description,
        scope=normalized_description,
        taxonomy=taxonomy,
        current_values={
            "project_title": project_title,
            "project_type": requested_type or project_type,
            "project_subtype": requested_subtype or project_subtype,
        },
        contractor=contractor,
    )
    if classification.get("project_type"):
        project_type = classification["project_type"]
    if classification:
        project_subtype = classification.get("project_subtype") or ""
    if classification.get("reason"):
        type_reason = classification["reason"]

    pricing_summary = estimate_project_total(
        project_type=project_type,
        project_subtype=project_subtype,
        project_title=project_title,
        description=normalized_description or description,
    )
    suggested_total = pricing_summary["suggested_total"]

    matched_template, template_score, template_reason, confidence = find_best_template(
        contractor=contractor,
        project_type=project_type,
        project_subtype=project_subtype,
        project_title=project_title,
        description=normalized_description or description,
    )

    proposal_draft = build_proposal_draft(
        agreement=agreement,
        contractor=contractor,
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=normalized_description or description,
    )

    if matched_template:
        milestones = _template_milestones_to_payload(
            matched_template,
            suggested_total=suggested_total,
        )
        clarifications = _clarifications_from_template(matched_template, project_subtype, project_type)
    else:
        milestones = _fallback_milestones_to_payload(
            project_subtype,
            suggested_total=suggested_total,
            project_type=project_type,
        )
        clarifications = _clarifications_from_template(None, project_subtype, project_type)

    if isinstance(openai_data, dict):
        ai_milestone_titles = openai_data.get("milestone_titles") or []
        if not matched_template and isinstance(ai_milestone_titles, list) and ai_milestone_titles:
            for idx, title in enumerate(ai_milestone_titles[: len(milestones)]):
                if _safe_str(title):
                    milestones[idx]["title"] = _safe_str(title)

        ai_clarifications = openai_data.get("clarifications") or []
        if isinstance(ai_clarifications, list) and ai_clarifications:
            # AI clarifications replace fallback/template clarifications for the draft result,
            # but are canonicalized so reruns are more stable.
            clarifications = _canonicalize_clarifications(ai_clarifications, source="ai")

    milestones = _dedupe_milestone_rows(milestones)

    total_days = 0
    for m in milestones:
        try:
            total_days += int(m.get("duration_days") or 0)
        except Exception:
            pass
    if total_days <= 0:
        total_days = int(getattr(matched_template, "estimated_days", 0) or 1)

    suggested_template = None
    if matched_template:
        suggested_template = {
            "id": matched_template.id,
            "name": matched_template.name,
            "project_type": matched_template.project_type,
            "project_subtype": matched_template.project_subtype,
            "description": matched_template.description,
            "estimated_days": matched_template.estimated_days,
            "milestone_count": matched_template.milestone_count,
            "is_system": bool(matched_template.is_system),
            "is_system_template": bool(getattr(matched_template, "is_system_template", False)),
            "is_published": bool(getattr(matched_template, "is_published", False)),
        }

    taxonomy_warning = None
    if project_type == "Roofing" and requested_type and _safe_str(requested_type).lower() != "roofing":
        taxonomy_warning = (
            f"Based on the title/description, '{requested_type}' may not be the best fit. "
            "AI recommends 'Roofing' as the project type."
        )

    return {
        "agreement_id": getattr(agreement, "id", None),
        "project_title": project_title,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "classification_reason": type_reason,
        "classification": classification,
        "taxonomy_warning": taxonomy_warning,
        "normalized_description": normalized_description,
        "suggested_template": suggested_template,
        "template_confidence": confidence,
        "template_score": template_score,
        "template_reason": template_reason,
        "milestones": milestones,
        "clarifications": clarifications,
        "proposal_draft": proposal_draft,
        "proposal_learning": proposal_draft.get("learning") or {
            "template_name": "",
            "sample_size": 0,
            "learned_opening": "",
            "learned_close": "",
            "highlights": [],
            "based_on_successful_projects": False,
        },
        "used_successful_learning": bool(
            (proposal_draft.get("learning") or {}).get("based_on_successful_projects")
        ),
        "used_brand_voice": bool((proposal_draft.get("summary") or {}).get("brandVoiceApplied")),
        "pricing_summary": {
            "estimated_total_low": float(pricing_summary["estimated_total_low"]),
            "estimated_total_high": float(pricing_summary["estimated_total_high"]),
            "suggested_total": float(pricing_summary["suggested_total"]),
        },
        "estimated_days": total_days,
        "can_save_template": True,
        "used_openai_refinement": bool(openai_data),
    }
