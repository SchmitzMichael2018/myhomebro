# backend/projects/ai/agreement_milestone_writer.py
# v2026-03-13-source-canonical-clarifications
#
# Fixes:
# - Resolve clarification duplication at the source
# - Require AI to use canonical clarification keys when applicable
# - Canonicalize returned questions before they leave this service
# - Normalize inputType / options / labels for consistent frontend rendering
#
# OpenAI strict JSON schema requirements:
# - For every object schema: additionalProperties must be provided AND must be false
# - For every object schema: required must include EVERY key in properties

from __future__ import annotations

import json
import logging
import re
from decimal import Decimal
from typing import Dict, Any, List

from django.conf import settings

logger = logging.getLogger(__name__)


CANONICAL_CLARIFICATION_KEYS: Dict[str, Dict[str, Any]] = {
    "materials_responsibility": {
        "label": "Who will purchase materials?",
        "type": "select",
        "inputType": "radio",
        "options": ["Contractor", "Homeowner", "Split"],
        "help": "Clarify procurement responsibility to avoid delays or disputes.",
        "required": True,
    },
    "permits_responsibility": {
        "label": "Who obtains necessary building permits?",
        "type": "select",
        "inputType": "radio",
        "options": ["Contractor", "Homeowner", "Split / depends"],
        "help": "Clarify who pulls permits and coordinates inspections.",
        "required": True,
    },
    "measurements_provided": {
        "label": "Are detailed measurements provided?",
        "type": "select",
        "inputType": "radio",
        "options": ["Yes", "No", "Pending"],
        "help": "Confirm whether measurements and interface dimensions are already verified.",
        "required": True,
    },
    "site_access_working_hours": {
        "label": "Site Access & Working Hours",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify access restrictions, neighborhood constraints, and allowed work hours.",
        "required": False,
    },
    "material_delivery_coordination": {
        "label": "Material Delivery Coordination",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify who orders materials and who coordinates deliveries.",
        "required": False,
    },
    "waste_removal_responsibility": {
        "label": "Waste / Debris Removal",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify who handles debris haul-off and disposal.",
        "required": False,
    },
    "unforeseen_conditions_change_orders": {
        "label": "Unforeseen Conditions / Change Orders",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify expectations for hidden conditions, extra work, and change approval.",
        "required": False,
    },
    "flooring_finishes_later": {
        "label": "Will any flooring finishes beyond subfloor installation be requested later?",
        "type": "select",
        "inputType": "radio",
        "options": ["Yes", "No", "Unsure"],
        "help": "Clarify whether finish flooring is included now or deferred.",
        "required": False,
    },
    "window_specifications": {
        "label": "Confirm window style and specifications",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify manufacturer, style, glazing, or matching requirements.",
        "required": False,
    },
    "plumbing_scope_future": {
        "label": "Will any plumbing work be required now or possibly requested during this project?",
        "type": "select",
        "inputType": "radio",
        "options": ["No plumbing work", "Yes, to be specified"],
        "help": "Clarify plumbing exclusions or possible later additions.",
        "required": False,
    },
    "access_upper_floor_construction": {
        "label": "Access to second floor during construction",
        "type": "text",
        "inputType": "textarea",
        "options": [],
        "help": "Clarify how and when access will be provided for upper-floor work.",
        "required": False,
    },
}


def _require_openai_client():
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError("OpenAI SDK not installed. Run: pip install openai") from e

    api_key = getattr(settings, "OPENAI_API_KEY", None) or getattr(settings, "AI_OPENAI_API_KEY", None)
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=api_key)


def _model_name() -> str:
    return (
        getattr(settings, "AI_OPENAI_MODEL_MILESTONE_WRITER", None)
        or getattr(settings, "AI_OPENAI_MODEL", None)
        or "gpt-4.1-mini"
    )


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except Exception:
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        if v is None:
            return default
        return int(v)
    except Exception:
        return default


def _safe_str(v: Any) -> str:
    return (v or "").__str__().strip()


def _normalize_keyish(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s


def _normalize_labelish(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\(e\.g\.[^)]+\)", " ", s)
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _canonical_question_group(item: Dict[str, Any]) -> str:
    raw_key = _normalize_keyish(item.get("key"))
    raw_label = _normalize_labelish(item.get("label") or item.get("question"))
    text = f"{raw_key} {raw_label}"

    if "materials" in text and (
        "purchase" in text or
        "purchasing" in text or
        "purchases" in text or
        "responsible" in text or
        "providing" in text
    ):
        return "materials_responsibility"

    if "permit" in text:
        return "permits_responsibility"

    if "measurement" in text:
        return "measurements_provided"

    if "working hours" in text or "site access" in text or "access constraints" in text:
        return "site_access_working_hours"

    if "delivery" in text:
        return "material_delivery_coordination"

    if "debris" in text or "waste" in text:
        return "waste_removal_responsibility"

    if "change order" in text or "unforeseen" in text:
        return "unforeseen_conditions_change_orders"

    if "floor" in text and "later" in text:
        return "flooring_finishes_later"

    if "window" in text and (
        "style" in text or
        "manufacturer" in text or
        "specification" in text or
        "double glazed" in text or
        "glazed" in text
    ):
        return "window_specifications"

    if "plumbing" in text:
        return "plumbing_scope_future"

    if "second floor" in text or "upper floor" in text:
        return "access_upper_floor_construction"

    return raw_key or _normalize_keyish(raw_label)


def _normalize_question_type(item: Dict[str, Any], canonical_key: str) -> tuple[str, str]:
    raw_type = _safe_str(item.get("type")).lower()
    spec = CANONICAL_CLARIFICATION_KEYS.get(canonical_key, {})
    spec_type = _safe_str(spec.get("type")).lower()
    spec_input = _safe_str(spec.get("inputType")).lower()

    if spec_type and spec_input:
        return spec_type, spec_input

    if raw_type in {"boolean", "select", "radio", "single_choice"}:
        return "select", "radio"

    return "text", "textarea"


def _normalize_question_options(item: Dict[str, Any], canonical_key: str) -> List[str]:
    opts = item.get("options")
    if isinstance(opts, list):
        clean = [_safe_str(o) for o in opts if _safe_str(o)]
        if clean:
            return clean

    spec = CANONICAL_CLARIFICATION_KEYS.get(canonical_key, {})
    spec_opts = spec.get("options")
    if isinstance(spec_opts, list):
        return [_safe_str(o) for o in spec_opts if _safe_str(o)]

    return []


def _question_score(item: Dict[str, Any]) -> int:
    score = 0
    if item.get("required"):
        score += 5
    if _safe_str(item.get("help")):
        score += 2
    if _safe_str(item.get("placeholder")):
        score += 1
    if isinstance(item.get("options"), list) and item.get("options"):
        score += 3
    if _safe_str(item.get("inputType")) and _safe_str(item.get("inputType")) != "textarea":
        score += 2
    if _safe_str(item.get("label")):
        score += 1
    return score


def _canonicalize_questions(raw_questions: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_questions, list):
        return []

    by_key: Dict[str, Dict[str, Any]] = {}

    for raw in raw_questions[:25]:
        if not isinstance(raw, dict):
            continue

        key = _canonical_question_group(raw)
        if not key:
            continue

        spec = CANONICAL_CLARIFICATION_KEYS.get(key, {})
        q_type, input_type = _normalize_question_type(raw, key)
        options = _normalize_question_options(raw, key)

        label = (
            _safe_str(raw.get("label"))
            or _safe_str(raw.get("question"))
            or _safe_str(spec.get("label"))
            or key.replace("_", " ").title()
        )

        help_txt = (
            _safe_str(raw.get("help"))
            or _safe_str(spec.get("help"))
        )

        required = bool(raw.get("required", spec.get("required", False)))

        normalized = {
            "key": key,
            "label": label,
            "question": _safe_str(raw.get("question")) or label,
            "type": q_type,
            "inputType": input_type,
            "required": required,
            "options": options,
            "help": help_txt,
            "source": "ai",
        }

        if key not in by_key:
            by_key[key] = normalized
            continue

        prev = by_key[key]
        winner = normalized if _question_score(normalized) > _question_score(prev) else prev

        by_key[key] = {
            **winner,
            "key": key,
            "required": bool(prev.get("required")) or bool(normalized.get("required")),
            "help": _safe_str(winner.get("help")) or _safe_str(prev.get("help")) or help_txt,
            "options": winner.get("options") or prev.get("options") or options,
        }

    return list(by_key.values())


def _normalize_milestones(raw: Any) -> List[Dict[str, Any]]:
    """
    Output items include:
      - order, title, description, amount
      - start_date, completion_date
    Also mirrors start/end for backward compatibility.
    """
    if not isinstance(raw, list):
        return []

    out: List[Dict[str, Any]] = []
    for i, m in enumerate(raw):
        if not isinstance(m, dict):
            continue

        order = _safe_int(m.get("order", i + 1), i + 1)
        title = str(m.get("title") or "").strip() or f"Milestone {order}"
        description = str(m.get("description") or "").strip()
        amount = _safe_float(m.get("amount", 0), 0.0)

        start_date = str(m.get("start_date") or "").strip()
        completion_date = str(m.get("completion_date") or "").strip()

        out.append(
            {
                "order": order,
                "title": title,
                "description": description,
                "amount": amount,
                "start_date": start_date,
                "completion_date": completion_date,
                "start": start_date,
                "end": completion_date,
            }
        )

    out.sort(key=lambda x: x.get("order", 999999))
    for idx, item in enumerate(out, start=1):
        item["order"] = idx
    return out


def _agreement_answers_snapshot(agreement: Any) -> Dict[str, Any]:
    try:
        scope_obj = getattr(agreement, "ai_scope", None)
        answers = getattr(scope_obj, "answers", None) if scope_obj else None
        return answers if isinstance(answers, dict) else {}
    except Exception:
        return {}


def _answer_text(answers: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        raw = answers.get(key)
        text = _safe_str(raw)
        if text:
            return text
    return ""


def _parse_numeric(text: str) -> float:
    if not text:
        return 0.0
    try:
        cleaned = text.replace(",", " ")
        match = re.search(r"(\d+(?:\.\d+)?)", cleaned)
        return float(match.group(1)) if match else 0.0
    except Exception:
        return 0.0


def _material_multipliers(material_type: str) -> tuple[float, float, str]:
    raw = _safe_str(material_type).lower()
    if not raw:
        return 1.0, 1.0, ""
    if any(token in raw for token in ("economy", "builder grade", "standard", "basic")):
        return 0.97, 0.94, _safe_str(material_type)
    if any(token in raw for token in ("premium", "designer", "custom", "luxury", "high end")):
        return 1.08, 1.16, _safe_str(material_type)
    if any(token in raw for token in ("slate", "tile", "clay", "copper")):
        return 1.10, 1.22, _safe_str(material_type)
    if any(token in raw for token in ("metal", "standing seam")):
        return 1.08, 1.16, _safe_str(material_type)
    if any(token in raw for token in ("cedar", "shake", "wood")):
        return 1.07, 1.14, _safe_str(material_type)
    if any(token in raw for token in ("architectural", "laminate", "composite", "designer")):
        return 1.04, 1.08, _safe_str(material_type)
    if any(token in raw for token in ("asphalt", "shingle")):
        return 1.0, 1.0, _safe_str(material_type)
    return 1.03, 1.06, _safe_str(material_type)


def _collect_answer_text(answers: Dict[str, Any], *preferred_keys: str) -> str:
    parts: List[str] = []
    for key in preferred_keys:
        txt = _answer_text(answers, key)
        if txt:
            parts.append(txt)
    for key, value in answers.items():
        if key in preferred_keys:
            continue
        txt = _safe_str(value)
        if txt:
            parts.append(txt)
    return " ".join(parts).lower()


def _extract_quantity_context(answers: Dict[str, Any], project_label: str) -> Dict[str, Any]:
    direct_specs = [
        ("sqft", ("roof_area", "project_size_sqft", "square_feet", "sqft", "area_sqft", "wall_area_sqft", "floor_area_sqft")),
        ("linear_feet", ("linear_feet", "lf", "fence_length", "run_length_feet")),
        ("rooms", ("room_count", "rooms")),
        ("fixtures", ("fixture_count", "fixtures_count", "device_count", "outlet_count", "window_count", "door_count", "gate_count")),
    ]
    for unit, keys in direct_specs:
        for key in keys:
            value = _safe_float(answers.get(key), 0.0)
            if value > 0:
                return {"unit": unit, "value": value}

    text = _collect_answer_text(answers, "measurement_notes", "measurements_notes", "allowances_selections")
    patterns = [
        ("sqft", r"(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b"),
        ("linear_feet", r"(\d[\d,]*(?:\.\d+)?)\s*(?:linear\s*feet|linear\s*ft|lf)\b"),
        ("rooms", r"(\d+(?:\.\d+)?)\s*rooms?\b"),
        ("fixtures", r"(\d+(?:\.\d+)?)\s*(?:fixtures?|windows?|doors?|gates?|outlets?|switches?)\b"),
    ]
    for unit, pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            try:
                return {"unit": unit, "value": float(match.group(1).replace(",", ""))}
            except Exception:
                continue

    if "fence" in project_label:
        gates = _parse_numeric(text)
        if gates > 0:
            return {"unit": "fixtures", "value": gates}
    return {"unit": "", "value": 0.0}


def _quantity_factor(quantity: Dict[str, Any]) -> tuple[float, List[str]]:
    value = _safe_float(quantity.get("value"), 0.0)
    unit = _safe_str(quantity.get("unit")).lower()
    notes: List[str] = []
    if value <= 0 or not unit:
        return 1.0, notes

    if unit == "sqft":
        if value < 500:
            factor = 0.92
        elif value < 1200:
            factor = 1.0
        elif value < 2200:
            factor = 1.08
        elif value < 3500:
            factor = 1.16
        else:
            factor = 1.24
        notes.append(f"~{int(round(value))} sqft")
        return factor, notes

    if unit == "linear_feet":
        if value < 80:
            factor = 0.95
        elif value < 180:
            factor = 1.0
        elif value < 320:
            factor = 1.08
        else:
            factor = 1.16
        notes.append(f"~{int(round(value))} linear ft")
        return factor, notes

    if unit == "rooms":
        if value <= 1:
            factor = 0.95
        elif value <= 3:
            factor = 1.0
        elif value <= 6:
            factor = 1.1
        else:
            factor = 1.18
        notes.append(f"{int(round(value))} rooms")
        return factor, notes

    if unit == "fixtures":
        if value <= 2:
            factor = 0.96
        elif value <= 6:
            factor = 1.0
        elif value <= 12:
            factor = 1.1
        else:
            factor = 1.2
        notes.append(f"{int(round(value))} fixtures/items")
        return factor, notes

    return 1.0, notes


def _material_type_from_answers(answers: Dict[str, Any], project_label: str) -> str:
    explicit = _answer_text(
        answers,
        "roofing_material_type",
        "material_type",
        "materials_type",
        "finish_material",
        "paint_type",
        "flooring_type",
        "tile_type",
        "fence_material",
        "fixture_type",
    )
    if explicit:
        return explicit

    text = _collect_answer_text(answers, "allowances_selections", "material_delivery_coordination", "measurement_notes")
    keywords = [
        "asphalt shingle",
        "metal",
        "tile",
        "hardwood",
        "laminate",
        "lvp",
        "vinyl",
        "epoxy",
        "copper",
        "pvc",
        "wood",
        "cedar",
        "chain link",
        "wrought iron",
        "premium paint",
    ]
    for keyword in keywords:
        if keyword in text:
            return keyword
    return ""


def _generic_complexity_factor(answers: Dict[str, Any], project_label: str) -> tuple[float, List[str]]:
    factor = 1.0
    notes: List[str] = []
    text = _collect_answer_text(
        answers,
        "site_access_working_hours",
        "access_upper_floor_construction",
        "material_delivery_coordination",
        "measurement_notes",
        "measurements_notes",
        "allowances_selections",
    )

    if any(token in text for token in ("limited", "restricted", "narrow", "tight", "ladder", "upper floor", "second floor", "stairs", "occupied", "furnished")):
        factor *= 1.08
        notes.append("access constraints")
    if any(token in text for token in ("demo", "demolition", "tear out", "tear-out", "removal", "prep", "skim", "patch", "texture", "multi coat", "two coat", "three coat")):
        factor *= 1.07
        notes.append("prep/demo complexity")
    if any(token in text for token in ("custom", "detail", "pattern", "mosaic", "trim", "finish carpentry", "layout", "code upgrade", "reroute")):
        factor *= 1.08
        notes.append("specialty labor")

    pitch_raw = _answer_text(answers, "roof_pitch")
    pitch_lower = pitch_raw.lower()
    numeric_pitch = _parse_numeric(pitch_lower)
    if "roof" in project_label:
        if "steep" in pitch_lower or numeric_pitch >= 8:
            factor *= 1.12
            notes.append("steep pitch")
        elif "medium" in pitch_lower or numeric_pitch >= 6:
            factor *= 1.06
            notes.append("moderate pitch")

    if "painting" in project_label and any(token in text for token in ("exterior", "high ceiling", "vaulted", "scaffold")):
        factor *= 1.07
        notes.append("painting access complexity")
    if "fence" in project_label and any(token in text for token in ("slope", "terrain", "rocky", "uneven")):
        factor *= 1.08
        notes.append("terrain complexity")

    return factor, notes


def _condition_factor(answers: Dict[str, Any], project_label: str) -> tuple[float, List[str]]:
    factor = 1.0
    notes: List[str] = []
    combined = _collect_answer_text(
        answers,
        "decking_condition",
        "unforeseen_conditions_change_orders",
        "measurement_notes",
        "measurements_notes",
        "allowances_selections",
    )

    if any(token in combined for token in ("rot", "rotten", "replace", "replacement", "soft", "damaged", "damage", "bad", "water damage", "mold")):
        factor *= 1.14
        notes.append("repair/condition risk")
    elif any(token in combined for token in ("repair", "patch", "worn", "aging", "crack", "uneven", "subfloor", "settlement")):
        factor *= 1.08
        notes.append("condition risk")

    if "floor" in project_label and "subfloor" in combined:
        factor *= 1.05
        if "subfloor condition" not in notes:
            notes.append("subfloor condition")

    return factor, notes


def _urgency_factor(answers: Dict[str, Any]) -> tuple[float, List[str]]:
    text = _collect_answer_text(
        answers,
        "site_access_working_hours",
        "material_delivery_coordination",
        "unforeseen_conditions_change_orders",
        "measurement_notes",
        "measurements_notes",
    )
    factor = 1.0
    notes: List[str] = []
    if any(token in text for token in ("urgent", "rush", "asap", "expedite", "quick turnaround", "weekend only", "after hours")):
        factor *= 1.06
        notes.append("schedule pressure")
    return factor, notes


def _uncertainty_widening(answers: Dict[str, Any], quantity: Dict[str, Any]) -> tuple[float, List[str]]:
    widen = 1.0
    notes: List[str] = []
    measurements = _answer_text(answers, "measurements_provided").lower()
    if measurements in {"no", "pending", "false"}:
        widen = max(widen, 1.14)
        notes.append("measurement uncertainty")
    if _safe_float(quantity.get("value"), 0.0) <= 0:
        widen = max(widen, 1.08)
        notes.append("quantity unverified")
    return widen, notes


def _build_pricing_context(agreement: Any, answers: Dict[str, Any], pricing_mode: str) -> Dict[str, Any]:
    project_type = _safe_str(getattr(agreement, "project_type", ""))
    project_subtype = _safe_str(getattr(agreement, "project_subtype", ""))
    project_label = f"{project_type} {project_subtype}".strip().lower()

    quantity = _extract_quantity_context(answers, project_label)
    quantity_factor, quantity_notes = _quantity_factor(quantity)
    material_type = _material_type_from_answers(answers, project_label)
    labor_material_factor, materials_material_factor, material_label = _material_multipliers(material_type)
    complexity_factor, complexity_notes = _generic_complexity_factor(answers, project_label)
    condition_factor, condition_notes = _condition_factor(answers, project_label)
    urgency_factor, urgency_notes = _urgency_factor(answers)
    uncertainty_widening, uncertainty_notes = _uncertainty_widening(answers, quantity)

    labor_multiplier = quantity_factor * labor_material_factor * complexity_factor * condition_factor * urgency_factor
    materials_multiplier = quantity_factor * materials_material_factor * max(condition_factor, 1.0)
    if pricing_mode == "labor_only":
        total_multiplier = (labor_multiplier * 0.7) + (materials_multiplier * 0.3)
    elif pricing_mode == "hybrid":
        total_multiplier = (labor_multiplier * 0.6) + (materials_multiplier * 0.4)
    else:
        total_multiplier = (labor_multiplier * 0.5) + (materials_multiplier * 0.5)

    notes = []
    if project_type:
        notes.append(project_type)
    if project_subtype:
        notes.append(project_subtype)
    notes.extend(quantity_notes)
    if material_label:
        notes.append(material_label)
    notes.extend(complexity_notes)
    notes.extend(condition_notes)
    notes.extend(urgency_notes)
    notes.extend(uncertainty_notes)

    return {
        "project_type": project_type,
        "project_subtype": project_subtype,
        "quantity_unit": _safe_str(quantity.get("unit")),
        "quantity_value": int(round(_safe_float(quantity.get("value"), 0.0))) if _safe_float(quantity.get("value"), 0.0) > 0 else None,
        "material_type": material_label or "",
        "measurements_provided": _answer_text(answers, "measurements_provided"),
        "roof_pitch": _answer_text(answers, "roof_pitch"),
        "decking_condition": _answer_text(answers, "decking_condition"),
        "site_access": _answer_text(answers, "site_access_working_hours", "access_upper_floor_construction"),
        "materials_responsibility": _answer_text(answers, "materials_responsibility"),
        "labor_multiplier": round(labor_multiplier, 4),
        "materials_multiplier": round(materials_multiplier, 4),
        "total_multiplier": round(total_multiplier, 4),
        "uncertainty_widening": round(uncertainty_widening, 4),
        "context_notes": notes[:5],
    }


def _clamp_multiplier(value: float, low: float = 0.85, high: float = 1.45) -> float:
    return max(low, min(high, value))


def _scale_range(low: Any, high: Any, multiplier: float, *, widen: float = 1.0) -> tuple[float | None, float | None]:
    lo = _safe_float(low, 0.0)
    hi = _safe_float(high, 0.0)
    if lo <= 0 and hi <= 0:
        return None, None
    if lo <= 0:
        lo = hi
    if hi <= 0:
        hi = lo
    if hi < lo:
        lo, hi = hi, lo

    center = ((lo + hi) / 2.0) * _clamp_multiplier(multiplier)
    base_width = max((hi - lo) / 2.0, center * 0.04)
    width = base_width * max(widen, 1.0)
    scaled_low = max(center - width, 0.0)
    scaled_high = max(center + width, scaled_low)
    return round(scaled_low, 2), round(scaled_high, 2)


def _downgrade_confidence(confidence: str, widen: float, risky: bool) -> str:
    order = ["low", "medium", "high"]
    normalized = _safe_str(confidence).lower() or "medium"
    if normalized not in order:
        normalized = "medium"
    steps = 0
    if widen >= 1.12:
        steps += 1
    if risky:
        steps += 1
    idx = max(0, order.index(normalized) - steps)
    return order[idx]


def _merge_pricing_source_note(base_note: str, context_notes: List[str]) -> str:
    base = _safe_str(base_note) or "AI pricing preview refreshed from current clarification answers."
    if not context_notes:
        return base[:255]
    extra = f"Adjusted for {', '.join(context_notes[:4])}."
    if extra.lower() in base.lower():
        return base[:255]
    merged = f"{base.rstrip('.')}." + f" {extra}"
    return merged[:255]


def _apply_pricing_context_adjustments(
    pricing_estimates: List[Dict[str, Any]],
    pricing_context: Dict[str, Any],
    *,
    pricing_mode: str,
) -> List[Dict[str, Any]]:
    if not pricing_estimates:
        return pricing_estimates

    labor_multiplier = _clamp_multiplier(_safe_float(pricing_context.get("labor_multiplier"), 1.0))
    materials_multiplier = _clamp_multiplier(_safe_float(pricing_context.get("materials_multiplier"), 1.0))
    total_multiplier = _clamp_multiplier(_safe_float(pricing_context.get("total_multiplier"), 1.0))
    widen = max(_safe_float(pricing_context.get("uncertainty_widening"), 1.0), 1.0)
    context_notes = pricing_context.get("context_notes") if isinstance(pricing_context.get("context_notes"), list) else []
    risky = any("risk" in _safe_str(note).lower() for note in context_notes)
    material_label = _safe_str(pricing_context.get("material_type"))

    adjusted: List[Dict[str, Any]] = []
    for item in pricing_estimates:
        next_item = dict(item)

        labor_low, labor_high = _scale_range(
            item.get("labor_estimate_low"),
            item.get("labor_estimate_high"),
            labor_multiplier,
            widen=widen,
        )
        materials_low, materials_high = _scale_range(
            item.get("materials_estimate_low"),
            item.get("materials_estimate_high"),
            materials_multiplier,
            widen=widen,
        )
        total_low, total_high = _scale_range(
            item.get("suggested_amount_low"),
            item.get("suggested_amount_high"),
            total_multiplier,
            widen=widen,
        )

        next_item["labor_estimate_low"] = labor_low
        next_item["labor_estimate_high"] = labor_high
        next_item["materials_estimate_low"] = materials_low
        next_item["materials_estimate_high"] = materials_high
        next_item["suggested_amount_low"] = total_low
        next_item["suggested_amount_high"] = total_high
        next_item["pricing_confidence"] = _downgrade_confidence(item.get("pricing_confidence", ""), widen, risky)
        next_item["pricing_source_note"] = _merge_pricing_source_note(item.get("pricing_source_note", ""), context_notes)
        if not _safe_str(next_item.get("materials_hint")) and material_label:
            next_item["materials_hint"] = material_label
        next_item["pricing_mode"] = pricing_mode
        adjusted.append(next_item)

    return adjusted


def _derive_pricing_mode_from_answers(answers: Any) -> str:
    if not isinstance(answers, dict):
        return "full_service"

    raw = _safe_str(answers.get("materials_responsibility")).lower()
    if not raw:
        return "full_service"

    if "split" in raw or "hybrid" in raw or "shared" in raw or "depend" in raw:
        return "hybrid"

    if (
        "homeowner" in raw
        or "customer" in raw
        or "owner" in raw
        or "client" in raw
    ):
        return "labor_only"

    return "full_service"


def _current_milestones_snapshot(agreement: Any) -> List[Dict[str, Any]]:
    answers = _agreement_answers_snapshot(agreement)
    pricing_mode = _derive_pricing_mode_from_answers(answers)
    try:
        qs = getattr(agreement, "milestones", None)
        rows = list(qs.all().order_by("order", "id")) if qs is not None else []
    except Exception:
        rows = []

    out: List[Dict[str, Any]] = []
    for idx, m in enumerate(rows, start=1):
        out.append(
            {
                "milestone_id": getattr(m, "id", None),
                "order": getattr(m, "order", None) or idx,
                "title": _safe_str(getattr(m, "title", "")) or f"Milestone {idx}",
                "description": _safe_str(getattr(m, "description", "")),
                "amount": _safe_float(getattr(m, "amount", 0), 0.0),
                "normalized_milestone_type": _safe_str(getattr(m, "normalized_milestone_type", "")),
                "suggested_amount_low": _safe_float(getattr(m, "suggested_amount_low", 0), 0.0),
                "suggested_amount_high": _safe_float(getattr(m, "suggested_amount_high", 0), 0.0),
                "labor_estimate_low": _safe_float(getattr(m, "labor_estimate_low", 0), 0.0),
                "labor_estimate_high": _safe_float(getattr(m, "labor_estimate_high", 0), 0.0),
                "materials_estimate_low": _safe_float(getattr(m, "materials_estimate_low", 0), 0.0),
                "materials_estimate_high": _safe_float(getattr(m, "materials_estimate_high", 0), 0.0),
                "pricing_confidence": _safe_str(getattr(m, "pricing_confidence", "")),
                "pricing_source_note": _safe_str(getattr(m, "pricing_source_note", "")),
                "recommended_duration_days": _safe_int(getattr(m, "recommended_duration_days", 0), 0),
                "materials_hint": _safe_str(getattr(m, "materials_hint", "")),
                "pricing_mode": pricing_mode,
            }
        )
    return out


def _normalize_pricing_estimates(
    raw: Any,
    fallback_milestones: List[Dict[str, Any]],
    *,
    default_pricing_mode: str = "full_service",
) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raw = []

    fallback_by_order = {
        int(row.get("order") or idx): row
        for idx, row in enumerate(fallback_milestones, start=1)
    }

    out: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue

        order = _safe_int(item.get("order"), idx)
        base = fallback_by_order.get(order, fallback_milestones[idx - 1] if idx - 1 < len(fallback_milestones) else {})
        amount = _safe_float(base.get("amount"), 0.0)
        low = max(_safe_float(item.get("suggested_amount_low"), 0.0), 0.0)
        high = max(_safe_float(item.get("suggested_amount_high"), 0.0), 0.0)
        labor_low = max(_safe_float(item.get("labor_estimate_low"), 0.0), 0.0)
        labor_high = max(_safe_float(item.get("labor_estimate_high"), 0.0), 0.0)
        materials_low = max(_safe_float(item.get("materials_estimate_low"), 0.0), 0.0)
        materials_high = max(_safe_float(item.get("materials_estimate_high"), 0.0), 0.0)

        if high <= 0 and amount > 0:
            high = amount
        if low <= 0 and amount > 0:
            low = round(amount * 0.9, 2)
        if high > 0 and low > high:
            low = high
        if labor_high > 0 and labor_low > labor_high:
            labor_low = labor_high
        if materials_high > 0 and materials_low > materials_high:
            materials_low = materials_high

        out.append(
            {
                "milestone_id": item.get("milestone_id") or base.get("milestone_id"),
                "order": order,
                "title": _safe_str(item.get("title")) or _safe_str(base.get("title")) or f"Milestone {order}",
                "suggested_amount_low": low or None,
                "suggested_amount_high": high or None,
                "labor_estimate_low": labor_low or None,
                "labor_estimate_high": labor_high or None,
                "materials_estimate_low": materials_low or None,
                "materials_estimate_high": materials_high or None,
                "pricing_confidence": _safe_str(item.get("pricing_confidence")).lower() or "low",
                "pricing_source_note": (
                    _safe_str(item.get("pricing_source_note"))
                    or "AI pricing preview refreshed from current clarification answers."
                )[:255],
                "recommended_duration_days": max(_safe_int(item.get("recommended_duration_days"), 0), 1),
                "materials_hint": _safe_str(item.get("materials_hint")) or _safe_str(base.get("materials_hint")),
                "pricing_mode": default_pricing_mode,
            }
        )

    if out:
        return out

    fallback_out: List[Dict[str, Any]] = []
    for idx, base in enumerate(fallback_milestones, start=1):
        amount = _safe_float(base.get("amount"), 0.0)
        low = round(amount * 0.9, 2) if amount > 0 else 0.0
        high = round(amount * 1.1, 2) if amount > 0 else 0.0
        fallback_out.append(
            {
                "milestone_id": base.get("milestone_id"),
                "order": base.get("order") or idx,
                "title": _safe_str(base.get("title")) or f"Milestone {idx}",
                "suggested_amount_low": low or None,
                "suggested_amount_high": high or None,
                "labor_estimate_low": _safe_float(base.get("labor_estimate_low"), 0.0) or None,
                "labor_estimate_high": _safe_float(base.get("labor_estimate_high"), 0.0) or None,
                "materials_estimate_low": _safe_float(base.get("materials_estimate_low"), 0.0) or None,
                "materials_estimate_high": _safe_float(base.get("materials_estimate_high"), 0.0) or None,
                "pricing_confidence": _safe_str(base.get("pricing_confidence")).lower() or "low",
                "pricing_source_note": (
                    _safe_str(base.get("pricing_source_note"))
                    or "AI pricing preview refreshed from current clarification answers."
                )[:255],
                "recommended_duration_days": max(_safe_int(base.get("recommended_duration_days"), 1), 1),
                "materials_hint": _safe_str(base.get("materials_hint")),
                "pricing_mode": default_pricing_mode,
            }
        )
    return fallback_out


def suggest_scope_and_milestones(*, agreement: Any, notes: str = "") -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    total_cost = float(getattr(agreement, "total_cost", 0) or 0)
    milestone_count = int(getattr(agreement, "milestone_count", 3) or 3)

    start_date = str(getattr(agreement, "start", "") or "")
    end_date = str(getattr(agreement, "end", "") or "")

    canonical_keys_prompt = "\n".join(
        f"- {key}: {spec.get('label', '')}"
        for key, spec in CANONICAL_CLARIFICATION_KEYS.items()
    )

    system = (
        "You are a construction project assistant.\n"
        "Write clear, dispute-resistant scopes of work and milestone breakdowns.\n"
        "Rules:\n"
        "- Milestones must be measurable deliverables.\n"
        "- Each milestone must have a clear completion condition.\n"
        "- Avoid vague terms and hidden scope.\n"
        "- Amounts should sum approximately to the total budget (within rounding).\n"
        "- Provide 3 to 10 milestones depending on the target.\n"
        "- Use YYYY-MM-DD for dates if provided, otherwise return empty string.\n"
        "\n"
        "Also produce a short list of contractor clarification questions that reduce ambiguity.\n"
        "Use canonical keys whenever applicable.\n"
        "Do not create multiple questions for the same business concept.\n"
        "Do not create alternate phrasings of the same concept.\n"
        "Use textarea/text for open-ended note questions.\n"
        "Use select/radio for standard choose-one questions.\n"
        "\n"
        "Known canonical clarification keys:\n"
        f"{canonical_keys_prompt}\n"
        "\n"
        "IMPORTANT: Always include options (array) and help (string) on each question, even if empty.\n"
        "IMPORTANT: Return only JSON that matches the schema.\n"
    )

    user_json = {
        "agreement_id": getattr(agreement, "id", None),
        "project_title": getattr(getattr(agreement, "project", None), "title", "") or "",
        "project_type": getattr(agreement, "project_type", "") or "",
        "project_subtype": getattr(agreement, "project_subtype", "") or "",
        "description": getattr(agreement, "description", "") or "",
        "notes": notes or "",
        "total_budget": total_cost,
        "milestone_count_target": milestone_count,
        "start_date": start_date,
        "end_date": end_date,
    }

    schema = {
        "name": "agreement_scope_milestones_questions",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "scope_text": {"type": "string"},
                "milestones": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "order": {"type": "integer"},
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "amount": {"type": "number"},
                            "start_date": {"type": "string"},
                            "completion_date": {"type": "string"},
                        },
                        "required": ["order", "title", "description", "amount", "start_date", "completion_date"],
                    },
                },
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "key": {"type": "string"},
                            "label": {"type": "string"},
                            "type": {"type": "string"},
                            "required": {"type": "boolean"},
                            "options": {"type": "array", "items": {"type": "string"}},
                            "help": {"type": "string"},
                        },
                        "required": ["key", "label", "type", "required", "options", "help"],
                    },
                },
            },
            "required": ["scope_text", "milestones", "questions"],
        },
    }

    try:
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user_json, ensure_ascii=False)},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": schema["name"],
                    "schema": schema["schema"],
                    "strict": True,
                }
            },
        )
    except Exception as e:
        logger.exception("OpenAI call failed for agreement milestone writer.")
        raise RuntimeError(f"AI milestone suggestion failed: {e}") from e

    raw = getattr(resp, "output_text", "") or ""
    try:
        payload = json.loads(raw)
    except Exception:
        raise RuntimeError("AI milestone suggestion returned invalid JSON.")

    scope_text = _safe_str(payload.get("scope_text"))
    milestones_raw = payload.get("milestones") or []
    questions_raw = payload.get("questions") or []

    if not scope_text:
        raise RuntimeError("AI returned empty scope_text.")

    milestones = _normalize_milestones(milestones_raw)
    if not milestones:
        raise RuntimeError("AI returned no milestones.")

    questions = _canonicalize_questions(questions_raw)

    if not questions:
        fallback_questions = [
            {"key": "materials_responsibility"},
            {"key": "measurements_provided"},
            {"key": "permits_responsibility"},
            {"key": "site_access_working_hours"},
        ]
        questions = _canonicalize_questions(fallback_questions)

    try:
        total_budget_dec = Decimal(str(total_cost or "0"))
        milestone_sum = sum(Decimal(str(m.get("amount", 0))) for m in milestones)
        logger.info(
            "AI milestones: agreement=%s model=%s count=%s sum=%s budget=%s questions=%s",
            getattr(agreement, "id", None),
            model,
            len(milestones),
            str(milestone_sum),
            str(total_budget_dec),
            len(questions),
        )
    except Exception:
        pass

    return {
        "scope_text": scope_text,
        "milestones": milestones,
        "questions": questions,
        "_model": model,
    }


def suggest_pricing_refresh(*, agreement: Any) -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    milestones = _current_milestones_snapshot(agreement)
    if not milestones:
        return {
            "pricing_estimates": [],
            "_model": model,
        }

    answers = _agreement_answers_snapshot(agreement)
    pricing_mode = _derive_pricing_mode_from_answers(answers)
    pricing_context = _build_pricing_context(agreement, answers, pricing_mode)

    system = (
        "You are a construction pricing assistant.\n"
        "Refresh pricing guidance for the CURRENT milestone list using the current agreement details and clarification answers.\n"
        "Do NOT create, remove, split, or rename milestones.\n"
        "Do NOT change actual milestone amounts.\n"
        "Return only pricing guidance preview fields for each milestone.\n"
        "Use realistic U.S. residential contractor pricing patterns.\n"
        "Respect pricing_mode:\n"
        "- full_service: guidance includes labor + materials\n"
        "- labor_only: guidance should emphasize contractor labor while treating materials as customer-supplied context\n"
        "- hybrid: guidance should reflect mixed/shared material responsibility\n"
        "Use suggested_amount_low/high as the combined total estimate guidance.\n"
        "When possible, also return labor_estimate_low/high and materials_estimate_low/high as advisory breakdowns.\n"
        "If pricing_mode is labor_only, labor estimates should be primary and materials estimates may be omitted or de-emphasized.\n"
        "pricing_source_note should briefly explain the pricing mode and the main labor/material drivers.\n"
        "If clarification answers increase uncertainty, widen ranges and reduce confidence.\n"
        "If materials, size, pitch, or decking condition imply higher complexity, increase ranges accordingly.\n"
        "Use pricing_context as the primary structured signal for normalized pricing factors.\n"
        "Treat quantity/size, material profile, labor complexity, access difficulty, condition risk, scheduling pressure, and materials responsibility as the main drivers.\n"
        "When project-specific context exists, layer it in without assuming the project is roofing-only.\n"
        "Scale labor estimates with quantity, install complexity, access, urgency, and condition risk.\n"
        "Scale materials estimates with quantity, material profile, and condition risk.\n"
        "Return only JSON that matches the schema.\n"
    )

    user_json = {
        "agreement_id": getattr(agreement, "id", None),
        "project_title": getattr(getattr(agreement, "project", None), "title", "") or "",
        "project_type": getattr(agreement, "project_type", "") or "",
        "project_subtype": getattr(agreement, "project_subtype", "") or "",
        "description": getattr(agreement, "description", "") or "",
        "total_budget": _safe_float(getattr(agreement, "total_cost", 0), 0.0),
        "pricing_mode": pricing_mode,
        "pricing_context": pricing_context,
        "clarification_answers": answers,
        "milestones": milestones,
    }

    schema = {
        "name": "agreement_pricing_refresh",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "pricing_estimates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "milestone_id": {"type": ["integer", "null"]},
                            "order": {"type": "integer"},
                            "title": {"type": "string"},
                            "suggested_amount_low": {"type": "number"},
                            "suggested_amount_high": {"type": "number"},
                            "labor_estimate_low": {"type": "number"},
                            "labor_estimate_high": {"type": "number"},
                            "materials_estimate_low": {"type": "number"},
                            "materials_estimate_high": {"type": "number"},
                            "pricing_confidence": {"type": "string"},
                            "pricing_source_note": {"type": "string"},
                            "recommended_duration_days": {"type": "integer"},
                            "materials_hint": {"type": "string"},
                            "pricing_mode": {"type": "string"},
                        },
                        "required": [
                            "milestone_id",
                            "order",
                            "title",
                            "suggested_amount_low",
                            "suggested_amount_high",
                            "labor_estimate_low",
                            "labor_estimate_high",
                            "materials_estimate_low",
                            "materials_estimate_high",
                            "pricing_confidence",
                            "pricing_source_note",
                            "recommended_duration_days",
                            "materials_hint",
                            "pricing_mode",
                        ],
                    },
                }
            },
            "required": ["pricing_estimates"],
        },
    }

    try:
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user_json, ensure_ascii=False)},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": schema["name"],
                    "schema": schema["schema"],
                    "strict": True,
                }
            },
        )
    except Exception as e:
        logger.exception("OpenAI call failed for agreement pricing refresh.")
        raise RuntimeError(f"AI pricing refresh failed: {e}") from e

    raw = getattr(resp, "output_text", "") or ""
    try:
        payload = json.loads(raw)
    except Exception:
        raise RuntimeError("AI pricing refresh returned invalid JSON.")

    pricing_estimates = _normalize_pricing_estimates(
        payload.get("pricing_estimates"),
        milestones,
        default_pricing_mode=pricing_mode,
    )
    pricing_estimates = _apply_pricing_context_adjustments(
        pricing_estimates,
        pricing_context,
        pricing_mode=pricing_mode,
    )

    return {
        "pricing_estimates": pricing_estimates,
        "_model": model,
    }
