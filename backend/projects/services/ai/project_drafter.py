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
        "kitchen", "bathroom", "shower", "tub", "vanity", "cabinet", "demo",
    ],
    "Repair": [
        "repair", "fix", "replace damaged", "leak", "broken", "patch", "restore",
    ],
    "Installation": [
        "install", "installation", "mount", "replace", "put in", "hook up",
        "appliance", "fixture",
    ],
    "Painting": [
        "paint", "painting", "stain", "refinish", "cabinet paint",
    ],
    "Outdoor": [
        "deck", "fence", "patio", "pergola", "gazebo", "landscape", "yard",
        "retaining wall", "outdoor", "fire pit",
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
    "Custom": [],
}

SUBTYPE_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "Remodel": {
        "Kitchen": ["kitchen", "cabinet", "countertop", "backsplash"],
        "Bathroom": ["bathroom", "shower", "tub", "toilet", "vanity"],
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
    "Painting": {
        "Interior": ["interior", "inside", "room", "ceiling", "wall"],
        "Exterior": ["exterior", "outside", "siding", "trim", "fascia"],
        "Cabinets": ["cabinet", "cabinetry"],
    },
    "Outdoor": {
        "Fence": ["fence", "gate"],
        "Deck": ["deck", "railing", "stairs"],
        "Patio": ["patio", "paver", "concrete"],
        "Landscaping": ["landscape", "mulch", "rock", "plant", "drainage", "sod"],
        "Pergola": ["pergola", "gazebo", "shade structure"],
    },
    "Inspection": {
        "Estimate Visit": ["estimate", "inspection", "site visit", "assessment"],
    },
    "DIY Help": {
        "Assist": ["assist", "help", "diy"],
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
        return ["Yes", "No", "Pending"]

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
    requested_type: str = "",
    requested_subtype: str = "",
) -> tuple[str, str, str]:
    if not _safe_str(requested_type):
        roof_type, roof_subtype, roof_reason = _roofing_force_override(project_title, description)
        if roof_type:
            return roof_type, roof_subtype or "", roof_reason or "Roofing detected."

    if _safe_str(requested_type):
        project_type = _safe_str(requested_type)
        project_subtype = _safe_str(requested_subtype)
        if not project_subtype:
            project_subtype = best_subtype_for_type(project_type, f"{project_title}\n{description}")
        return project_type, project_subtype, "Using provided type/subtype."

    hay = f"{project_title}\n{description}"
    hay_norm = _norm_text(hay)

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


def best_subtype_for_type(project_type: str, text: str) -> str:
    subtype_map = SUBTYPE_KEYWORDS.get(project_type, {})
    if not subtype_map:
        return "Custom" if project_type == "Custom" else ""

    text_norm = _norm_text(text)
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

    if template.is_system:
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
        qs = qs.filter(Q(is_system=True) | Q(contractor=contractor))
    else:
        qs = qs.filter(is_system=True)

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
    return out


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

    return out


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

    pricing_summary = estimate_project_total(
        project_type=project_type,
        project_subtype=project_subtype,
        project_title=project_title,
        description=description,
    )
    suggested_total = pricing_summary["suggested_total"]

    matched_template, template_score, template_reason, confidence = find_best_template(
        contractor=contractor,
        project_type=project_type,
        project_subtype=project_subtype,
        project_title=project_title,
        description=description,
    )

    proposal_draft = build_proposal_draft(
        agreement=agreement,
        contractor=contractor,
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description,
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
        normalized_description = description or (
            matched_template.description if matched_template and _safe_str(matched_template.description) else ""
        )
    if not normalized_description:
        normalized_description = f"{project_subtype or project_type} project: {project_title}".strip(": ")

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
