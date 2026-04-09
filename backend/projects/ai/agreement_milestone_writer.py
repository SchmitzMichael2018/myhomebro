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


BASELINE_PRICING_BY_TYPE: Dict[str, Dict[str, Any]] = {
    "default": {
        "labor_ratio": 0.65,
        "materials_ratio": 0.35,
        "low_factor": 0.90,
        "high_factor": 1.15,
    },
    "roofing": {
        "labor_ratio": 0.42,
        "materials_ratio": 0.58,
        "low_factor": 0.92,
        "high_factor": 1.18,
        "subtypes": {
            "repair": {"labor_ratio": 0.62, "materials_ratio": 0.38, "low_factor": 0.88, "high_factor": 1.14},
            "replacement": {"labor_ratio": 0.40, "materials_ratio": 0.60, "low_factor": 0.95, "high_factor": 1.20},
        },
    },
    "flooring": {
        "labor_ratio": 0.55,
        "materials_ratio": 0.45,
        "low_factor": 0.90,
        "high_factor": 1.17,
        "subtypes": {
            "hardwood": {"labor_ratio": 0.58, "materials_ratio": 0.42},
            "lvp": {"labor_ratio": 0.50, "materials_ratio": 0.50},
            "tile": {"labor_ratio": 0.60, "materials_ratio": 0.40, "high_factor": 1.18},
        },
    },
    "painting": {
        "labor_ratio": 0.74,
        "materials_ratio": 0.26,
        "low_factor": 0.88,
        "high_factor": 1.14,
        "subtypes": {
            "interior": {"labor_ratio": 0.76, "materials_ratio": 0.24},
            "exterior": {"labor_ratio": 0.70, "materials_ratio": 0.30, "high_factor": 1.16},
        },
    },
    "tile": {
        "labor_ratio": 0.62,
        "materials_ratio": 0.38,
        "low_factor": 0.92,
        "high_factor": 1.18,
    },
    "drywall": {
        "labor_ratio": 0.70,
        "materials_ratio": 0.30,
        "low_factor": 0.90,
        "high_factor": 1.15,
    },
    "fencing": {
        "labor_ratio": 0.50,
        "materials_ratio": 0.50,
        "low_factor": 0.91,
        "high_factor": 1.16,
        "subtypes": {
            "repair": {"labor_ratio": 0.68, "materials_ratio": 0.32, "low_factor": 0.87, "high_factor": 1.12},
            "install": {"labor_ratio": 0.48, "materials_ratio": 0.52},
        },
    },
    "plumbing": {
        "labor_ratio": 0.80,
        "materials_ratio": 0.20,
        "low_factor": 0.89,
        "high_factor": 1.16,
    },
    "electrical": {
        "labor_ratio": 0.82,
        "materials_ratio": 0.18,
        "low_factor": 0.90,
        "high_factor": 1.16,
    },
    "remodel": {
        "labor_ratio": 0.64,
        "materials_ratio": 0.36,
        "low_factor": 0.92,
        "high_factor": 1.18,
    },
    "handyman": {
        "labor_ratio": 0.86,
        "materials_ratio": 0.14,
        "low_factor": 0.88,
        "high_factor": 1.12,
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


def _normalize_baseline_key(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _baseline_pricing_profile(project_type: Any, project_subtype: Any) -> Dict[str, float]:
    normalized_type = _normalize_baseline_key(project_type)
    normalized_subtype = _normalize_baseline_key(project_subtype)

    selected_key = "default"
    for key in BASELINE_PRICING_BY_TYPE.keys():
        if key == "default":
            continue
        if key in normalized_type or key in normalized_subtype:
            selected_key = key
            break

    base = dict(BASELINE_PRICING_BY_TYPE["default"])
    type_profile = BASELINE_PRICING_BY_TYPE.get(selected_key, {})
    base.update({k: v for k, v in type_profile.items() if k != "subtypes"})

    subtype_profiles = type_profile.get("subtypes", {}) if isinstance(type_profile.get("subtypes"), dict) else {}
    for key, subtype_profile in subtype_profiles.items():
        if key in normalized_subtype:
            base.update(subtype_profile)
            break

    labor_ratio = float(base.get("labor_ratio", 0.65))
    materials_ratio = float(base.get("materials_ratio", 0.35))
    total_ratio = labor_ratio + materials_ratio
    if total_ratio <= 0:
        labor_ratio, materials_ratio = 0.65, 0.35
        total_ratio = 1.0

    return {
        "type_key": selected_key,
        "labor_ratio": round(labor_ratio / total_ratio, 4),
        "materials_ratio": round(materials_ratio / total_ratio, 4),
        "low_factor": float(base.get("low_factor", 0.90)),
        "high_factor": float(base.get("high_factor", 1.15)),
    }


def _refine_baseline_with_template(
    agreement: Any,
    base_profile: Dict[str, float],
    fallback_milestones: List[Dict[str, Any]],
) -> Dict[str, float]:
    profile = dict(base_profile or {})

    template_name = _safe_str(getattr(agreement, "selected_template_name_snapshot", ""))
    selected_template = getattr(agreement, "selected_template", None)
    template_bits = [
        template_name,
        _safe_str(getattr(selected_template, "name", "")) if selected_template is not None else "",
        _safe_str(getattr(selected_template, "description", "")) if selected_template is not None else "",
        _safe_str(getattr(selected_template, "default_scope", "")) if selected_template is not None else "",
    ]
    milestone_type_bits = [
        _safe_str(row.get("normalized_milestone_type"))
        for row in (fallback_milestones or [])
        if _safe_str(row.get("normalized_milestone_type"))
    ]
    template_text = " ".join(bit for bit in [*template_bits, *milestone_type_bits] if bit).lower()

    has_template_anchor = any(_safe_float(row.get("template_suggested_amount"), 0.0) > 0 for row in (fallback_milestones or []))
    if not template_text and not has_template_anchor:
        return profile

    labor_ratio = float(profile.get("labor_ratio", 0.65))
    materials_ratio = float(profile.get("materials_ratio", 0.35))
    low_factor = float(profile.get("low_factor", 0.90))
    high_factor = float(profile.get("high_factor", 1.15))

    if any(token in template_text for token in ("premium", "designer", "custom", "luxury", "high end", "architectural")):
        materials_ratio += 0.04
        high_factor += 0.02

    if any(token in template_text for token in ("repair", "patch", "service", "troubleshoot")):
        labor_ratio += 0.05
        materials_ratio -= 0.03
        low_factor -= 0.01
        high_factor -= 0.01

    if any(token in template_text for token in ("replace", "replacement", "install", "installation", "new build")):
        materials_ratio += 0.03
        high_factor += 0.01

    if any(token in template_text for token in ("demo", "demolition", "tear out", "tear-out", "prep", "skim", "texture")):
        labor_ratio += 0.04
        high_factor += 0.01

    if any(token in template_text for token in ("exterior", "weather", "weatherproof", "sealant")):
        labor_ratio += 0.02
        high_factor += 0.01

    if has_template_anchor:
        high_factor += 0.01

    total_ratio = max(labor_ratio + materials_ratio, 0.01)
    profile["labor_ratio"] = round(max(labor_ratio, 0.05) / total_ratio, 4)
    profile["materials_ratio"] = round(max(materials_ratio, 0.05) / total_ratio, 4)
    profile["low_factor"] = max(round(low_factor, 4), 0.82)
    profile["high_factor"] = min(max(round(high_factor, 4), profile["low_factor"] + 0.05), 1.28)
    return profile


def _anchor_range(anchor: float, profile: Dict[str, float]) -> tuple[float, float]:
    low = round(anchor * float(profile.get("low_factor", 0.90)), 2)
    high = round(anchor * float(profile.get("high_factor", 1.15)), 2)
    if high < low:
        low = high
    return low, high


def _blend_values(primary: float, baseline: float, *, primary_weight: float = 0.7) -> float:
    if primary > 0 and baseline > 0:
        return round((primary * primary_weight) + (baseline * (1 - primary_weight)), 2)
    if primary > 0:
        return round(primary, 2)
    if baseline > 0:
        return round(baseline, 2)
    return 0.0


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


def _normalize_yes_no_answer(value: Any) -> str:
    normalized = _safe_str(value).lower()
    if normalized in {"yes", "true"}:
        return "yes"
    if normalized in {"no", "false"}:
        return "no"
    return ""


def _append_milestone_detail(base_text: Any, detail: Any) -> str:
    base = _safe_str(base_text)
    extra = _safe_str(detail)
    if not extra:
        return base
    if not base:
        return extra
    trimmed_base = re.sub(r"[.]+$", "", base)
    return f"{trimmed_base}. {extra}"


def _insert_milestone_row(rows: List[Dict[str, Any]], index: int, row: Dict[str, Any]) -> List[Dict[str, Any]]:
    next_rows = list(rows or [])
    safe_index = max(0, min(index, len(next_rows)))
    next_rows.insert(safe_index, row)
    return next_rows


def _default_milestone_amounts(count: int, total_budget: Any) -> List[float]:
    safe_count = max(1, int(count or 0))
    normalized_total = _safe_float(total_budget, 0.0)
    fallback_total = normalized_total if normalized_total > 0 else (4000.0 if safe_count <= 4 else 6000.0)
    weight_sets = {
        4: [0.2, 0.35, 0.3, 0.15],
        5: [0.12, 0.18, 0.28, 0.26, 0.16],
        6: [0.1, 0.15, 0.2, 0.2, 0.2, 0.15],
        7: [0.08, 0.12, 0.16, 0.18, 0.18, 0.16, 0.12],
    }
    weights = weight_sets.get(safe_count) or [round(1 / safe_count, 6)] * safe_count
    allocated = 0.0
    amounts: List[float] = []
    for idx, weight in enumerate(weights):
        if idx == len(weights) - 1:
            amounts.append(round(fallback_total - allocated, 2))
        else:
            next_amount = round(fallback_total * float(weight), 2)
            allocated += next_amount
            amounts.append(next_amount)
    return amounts


def _shape_milestone_rows_for_clarifications(
    *,
    project_type: Any,
    project_subtype: Any,
    description: Any,
    clarification_answers: Dict[str, Any] | None = None,
    total_budget: Any = 0,
    amount_mode: str = "default",
    base_milestones: List[Dict[str, Any]] | None = None,
) -> List[Dict[str, Any]]:
    answers = clarification_answers if isinstance(clarification_answers, dict) else {}
    type_key = _normalize_baseline_key(project_type)
    subtype_key = _normalize_baseline_key(project_subtype)
    text = f"{subtype_key} {_normalize_baseline_key(description)}"
    layout_changes = _normalize_yes_no_answer(answers.get("layout_changes"))
    cabinet_scope = _normalize_yes_no_answer(answers.get("cabinet_scope"))
    wet_area_tile = _normalize_yes_no_answer(answers.get("wet_area_tile"))
    demo_required = _normalize_yes_no_answer(answers.get("demo_required"))
    hardware_included = _normalize_yes_no_answer(answers.get("hardware_included"))
    connection_ready = _normalize_yes_no_answer(answers.get("connection_ready"))
    haul_away_existing = _normalize_yes_no_answer(answers.get("haul_away_existing"))
    tear_off_scope = _normalize_yes_no_answer(answers.get("tear_off_scope"))
    decking_allowance = _normalize_yes_no_answer(answers.get("decking_allowance"))
    subfloor_prep = _normalize_yes_no_answer(answers.get("subfloor_prep"))
    finish_scope_notes = _safe_str(answers.get("finish_scope_notes"))
    fixture_upgrade_notes = _safe_str(answers.get("fixture_upgrade_notes"))
    cabinet_style_notes = _safe_str(answers.get("cabinet_style_notes"))
    appliance_scope_notes = _safe_str(answers.get("appliance_scope_notes"))
    roofing_notes = _safe_str(answers.get("roofing_notes"))
    flooring_notes = _safe_str(answers.get("flooring_notes"))

    rows: List[Dict[str, Any]] = []

    if "kitchen remodel" in subtype_key:
        rows = [
            {"title": "Planning & protection", "description": "Confirm selections, protect adjacent areas, and stage materials."},
            {"title": "Demolition & rough-in", "description": "Remove existing finishes and complete rough adjustments for the new layout."},
            {"title": "Cabinets & surfaces", "description": "Install cabinetry, countertops, and major kitchen surfaces."},
            {"title": "Fixtures & appliances", "description": "Set fixtures, connect appliances, and complete trim details."},
            {"title": "Punch list & walkthrough", "description": "Finish punch items, final cleanup, and customer walkthrough."},
        ]
        if layout_changes == "yes":
            rows = _insert_milestone_row(rows, 1, {
                "title": "Layout review & utility changes",
                "description": "Confirm layout changes, coordinate updated appliance locations, and complete the major utility adjustments before finish installation.",
            })
            rows[2] = {
                "title": "Selective demolition & rough-in",
                "description": "Remove existing finishes and complete rough framing, plumbing, or electrical work needed for the updated kitchen layout.",
            }
        cabinets_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Cabinets & surfaces"), -1)
        if cabinet_scope == "yes" and cabinets_index >= 0:
            rows[cabinets_index] = {
                "title": "Cabinet installation",
                "description": "Install cabinetry, secure boxes in the planned layout, and prepare for final countertop or trim work.",
            }
            rows = _insert_milestone_row(rows, cabinets_index + 1, {
                "title": "Countertops & surface finishes",
                "description": "Install countertops, backsplash, and the major kitchen surface finishes that complete the cabinetry phase.",
            })
        elif cabinet_scope == "no" and cabinets_index >= 0:
            rows[cabinets_index] = {
                "title": "Countertops, surfaces & finishes",
                "description": "Complete countertop work, backsplash or wall finishes, and other major kitchen surface upgrades without cabinet replacement.",
            }
        if finish_scope_notes:
            finish_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Countertops & surface finishes"), -1)
            if finish_index < 0:
                finish_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Fixtures & appliances"), -1)
            if finish_index >= 0:
                rows[finish_index]["description"] = _append_milestone_detail(
                    rows[finish_index].get("description"),
                    f"Included finish scope: {finish_scope_notes}.",
                )
    elif "bathroom remodel" in subtype_key:
        rows = [
            {"title": "Protection & demolition", "description": "Protect nearby finishes and remove existing bathroom components."},
            {"title": "Rough plumbing & electrical", "description": "Complete rough adjustments needed for the updated bathroom layout."},
            {"title": "Walls, waterproofing & tile", "description": "Prep surfaces, waterproof wet areas, and install tile finishes."},
            {"title": "Vanity, fixtures & trim", "description": "Install vanity, fixtures, accessories, and finish details."},
            {"title": "Final cleanup & walkthrough", "description": "Complete punch work, cleanup, and final customer review."},
        ]
        if layout_changes == "yes":
            rows = _insert_milestone_row(rows, 1, {
                "title": "Layout changes & rough-ins",
                "description": "Complete plumbing and electrical rough changes needed for the updated bathroom layout before finish work starts.",
            })
        wet_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Walls, waterproofing & tile"), -1)
        if wet_area_tile == "yes" and wet_index >= 0:
            rows[wet_index] = {
                "title": "Walls & waterproofing prep",
                "description": "Prep backing, wall surfaces, and wet-area protection so the finish tile work has a clean installation base.",
            }
            rows = _insert_milestone_row(rows, wet_index + 1, {
                "title": "Tile & waterproofing finish",
                "description": "Install tile finishes, seal wet areas, and complete the detailed waterproofing work included in the remodel scope.",
            })
        elif wet_area_tile == "no" and wet_index >= 0:
            rows = [row for idx, row in enumerate(rows) if idx != wet_index]
            fixture_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Vanity, fixtures & trim"), -1)
            if fixture_index >= 0:
                rows[fixture_index]["description"] = _append_milestone_detail(
                    rows[fixture_index].get("description"),
                    "Include wall touch-up and non-tile surface prep needed before the fixture phase.",
                )
        if fixture_upgrade_notes:
            fixture_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Vanity, fixtures & trim"), -1)
            if fixture_index >= 0:
                rows[fixture_index]["description"] = _append_milestone_detail(
                    rows[fixture_index].get("description"),
                    f"Included upgrades: {fixture_upgrade_notes}.",
                )
    elif "cabinet installation" in subtype_key:
        rows = [
            {"title": "Measurements & prep", "description": "Confirm cabinet layout, site readiness, and delivery staging."},
            {"title": "Cabinet installation", "description": "Install and secure new cabinets in the planned configuration."},
            {"title": "Hardware & adjustments", "description": "Align doors and drawers, install hardware, and complete trim adjustments."},
            {"title": "Final walkthrough", "description": "Review fit and finish, cleanup, and confirm punch items with the customer."},
        ]
        if demo_required == "yes":
            rows = _insert_milestone_row(rows, 0, {
                "title": "Demo & site prep",
                "description": "Remove existing cabinetry if needed, protect surrounding finishes, and prepare the space for the new cabinet install.",
            })
        hardware_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Hardware & adjustments"), -1)
        if hardware_included == "yes" and hardware_index >= 0:
            rows[hardware_index] = {
                "title": "Hardware, fillers & trim",
                "description": "Install pulls, fillers, panels, and trim pieces that complete the cabinetry scope.",
            }
            rows = _insert_milestone_row(rows, hardware_index + 1, {
                "title": "Alignment & final adjustments",
                "description": "Align doors and drawers, fine tune reveals, and complete final fit checks before walkthrough.",
            })
        elif hardware_included == "no" and hardware_index >= 0:
            rows[hardware_index] = {
                "title": "Alignment & adjustments",
                "description": "Align doors and drawers, confirm fit, and complete final adjustment work without hardware or trim installation scope.",
            }
        install_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Cabinet installation"), -1)
        if cabinet_style_notes and install_index >= 0:
            rows[install_index]["description"] = _append_milestone_detail(
                rows[install_index].get("description"),
                f"Layout details: {cabinet_style_notes}.",
            )
    elif "countertop installation" in subtype_key:
        rows = [
            {"title": "Template & prep", "description": "Confirm measurements, protect work areas, and prep cabinet surfaces."},
            {"title": "Countertop installation", "description": "Install countertops, seams, and edge details."},
            {"title": "Sink & fixture reconnect", "description": "Reconnect sink and finish related countertop details."},
            {"title": "Cleanup & walkthrough", "description": "Complete cleanup, seal where needed, and review the finished install."},
        ]
    elif "appliance installation" in subtype_key:
        rows = [
            {"title": "Delivery & staging", "description": "Stage appliances, verify openings, and prep the install area."},
            {"title": "Installation", "description": "Set appliances in place and complete all required connections."},
            {"title": "Testing & adjustments", "description": "Test operation, fine tune fit, and complete any adjustments."},
            {"title": "Cleanup & customer review", "description": "Clean the area and review operation and handoff details with the customer."},
        ]
        if haul_away_existing == "yes":
            rows = _insert_milestone_row(rows, 1, {
                "title": "Disconnect & haul-away",
                "description": "Disconnect existing appliances safely, remove them from the work area, and prep the site for the new installation.",
            })
        if connection_ready == "no":
            rows = _insert_milestone_row(rows, 2 if haul_away_existing == "yes" else 1, {
                "title": "Utility prep",
                "description": "Prepare required hookups, shutoffs, or connection points so the appliance installation can proceed cleanly.",
            })
            install_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Installation"), -1)
            if install_index >= 0:
                rows[install_index]["description"] = "Set appliances in place, complete final hookups, and secure the finished installation once utilities are ready."
        install_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Installation"), -1)
        if appliance_scope_notes and install_index >= 0:
            rows[install_index]["description"] = _append_milestone_detail(
                rows[install_index].get("description"),
                f"Included appliance details: {appliance_scope_notes}.",
            )
    elif "roof replacement" in subtype_key or "roof" in type_key:
        rows = [
            {"title": "Protection & tear-off", "description": "Protect the site and remove existing roofing materials."},
            {"title": "Decking & prep", "description": "Inspect decking, complete repairs, and prep the roof system."},
            {"title": "Roof system installation", "description": "Install underlayment, roofing materials, and required flashings."},
            {"title": "Cleanup & final review", "description": "Complete cleanup, magnetic sweep, and final walkthrough."},
        ]
        if tear_off_scope == "no":
            rows[0] = {
                "title": "Protection & roof prep",
                "description": "Protect the site, prep the existing roof surface, and ready the system for the new roofing work without a full tear-off.",
            }
        if decking_allowance == "yes":
            rows = _insert_milestone_row(rows, 2, {
                "title": "Deck repair allowance",
                "description": "Complete minor decking repairs or spot replacement where needed before the roofing system is closed in.",
            })
        install_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Roof system installation"), -1)
        if roofing_notes and install_index >= 0:
            rows[install_index]["description"] = _append_milestone_detail(
                rows[install_index].get("description"),
                f"System details: {roofing_notes}.",
            )
    elif "floor" in type_key:
        rows = [
            {"title": "Prep & materials", "description": "Confirm material staging and prepare the work areas."},
            {"title": "Surface preparation", "description": "Demo or prep the substrate for the new flooring system."},
            {"title": "Flooring installation", "description": "Install flooring materials and transitions."},
            {"title": "Trim & cleanup", "description": "Complete trim details, cleanup, and final walkthrough."},
        ]
        if demo_required == "yes":
            rows = _insert_milestone_row(rows, 1, {
                "title": "Demo & disposal",
                "description": "Remove existing flooring materials, dispose of debris, and leave the work areas ready for substrate prep.",
            })
        prep_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Surface preparation"), -1)
        if subfloor_prep == "yes" and prep_index >= 0:
            rows[prep_index] = {
                "title": "Subfloor prep & leveling",
                "description": "Complete subfloor repairs, patching, or leveling work needed before finish flooring installation begins.",
            }
        elif subfloor_prep == "no" and prep_index >= 0:
            rows[prep_index] = {
                "title": "Surface readiness check",
                "description": "Verify the substrate is ready for installation and complete only minor prep before flooring work begins.",
            }
        install_index = next((idx for idx, row in enumerate(rows) if row.get("title") == "Flooring installation"), -1)
        if flooring_notes and install_index >= 0:
            rows[install_index]["description"] = _append_milestone_detail(
                rows[install_index].get("description"),
                f"Material details: {flooring_notes}.",
            )
    else:
        limited_scope = bool(re.search(r"\binstall(?:ation)?\b", text)) and not bool(re.search(r"\b(remodel|renovation|addition)\b", text))
        rows = (
            [
                {"title": "Prep & materials", "description": "Confirm scope, stage materials, and prep the work area."},
                {"title": "Primary installation", "description": "Complete the core installation or replacement work."},
                {"title": "Adjustments & finish", "description": "Make adjustments, complete finish details, and test where needed."},
                {"title": "Cleanup & walkthrough", "description": "Clean the site and review the finished work with the customer."},
            ]
            if limited_scope
            else [
                {"title": "Planning & prep", "description": "Confirm scope, materials, and site readiness for the project."},
                {"title": "Core work phase 1", "description": "Begin the main work and complete the first major phase."},
                {"title": "Core work phase 2", "description": "Continue the main work and complete the next major phase."},
                {"title": "Finish work", "description": "Complete finish details, punch items, and final quality checks."},
                {"title": "Cleanup & handoff", "description": "Complete cleanup and customer walkthrough before closeout."},
            ]
        )

    default_amounts = _default_milestone_amounts(len(rows), total_budget)
    shaped: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows):
        base_amount = 0.0
        if isinstance(base_milestones, list) and idx < len(base_milestones) and isinstance(base_milestones[idx], dict):
            base_amount = _safe_float(base_milestones[idx].get("amount"), 0.0)
        amount = base_amount if amount_mode == "preserve_base" else default_amounts[idx]
        shaped.append(
            {
                "order": idx + 1,
                "title": row["title"],
                "description": row["description"],
                "amount": amount,
                "start_date": "",
                "completion_date": "",
                "start": "",
                "end": "",
            }
        )
    return shaped


def _answer_text(answers: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        raw = answers.get(key)
        txt = _safe_str(raw)
        if txt:
            return txt
    return ""


def _parse_first_number(text: str) -> float:
    raw = _safe_str(text)
    if not raw:
        return 0.0
    match = re.search(r"(\d[\d,]*(?:\.\d+)?)", raw)
    if not match:
        return 0.0
    try:
        return float(match.group(1).replace(",", ""))
    except Exception:
        return 0.0


def _extract_quantity_signal(answers: Dict[str, Any]) -> tuple[str, float]:
    direct_specs = [
        ("sqft", ("roof_area", "project_size_sqft", "square_feet", "sqft", "area_sqft", "floor_area_sqft", "wall_area_sqft")),
        ("linear_feet", ("linear_feet", "lf", "fence_length", "run_length_feet")),
        ("rooms", ("room_count", "rooms")),
        ("fixtures", ("fixture_count", "fixtures_count", "device_count", "outlet_count", "window_count", "door_count", "gate_count")),
    ]
    for unit, keys in direct_specs:
        for key in keys:
            value = _parse_first_number(answers.get(key))
            if value > 0:
                return unit, value

    note_blob = " ".join(
        _safe_str(answers.get(key))
        for key in ("measurement_notes", "measurements_notes", "allowances_selections")
    )
    patterns = [
        ("sqft", r"(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b"),
        ("linear_feet", r"(\d[\d,]*(?:\.\d+)?)\s*(?:linear\s*feet|linear\s*ft|lf)\b"),
        ("rooms", r"(\d+(?:\.\d+)?)\s*rooms?\b"),
        ("fixtures", r"(\d+(?:\.\d+)?)\s*(?:fixtures?|windows?|doors?|gates?|outlets?|switches?)\b"),
    ]
    for unit, pattern in patterns:
        match = re.search(pattern, note_blob, re.I)
        if match:
            try:
                return unit, float(match.group(1).replace(",", ""))
            except Exception:
                continue
    return "", 0.0


def _quantity_reason(unit: str, value: float) -> str:
    if value <= 0:
        return ""
    if unit == "sqft":
        if value >= 1800:
            return "larger project size"
        if value <= 500:
            return "smaller project size"
    if unit == "linear_feet" and value >= 180:
        return "longer project run"
    if unit == "rooms" and value >= 4:
        return "multi-room scope"
    if unit == "fixtures" and value >= 6:
        return "higher item count"
    return ""


def _material_reason(answers: Dict[str, Any]) -> str:
    material = _answer_text(
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
    ).lower()
    if not material:
        return ""
    if any(token in material for token in ("premium", "designer", "custom", "luxury", "high end", "tile", "metal", "slate", "copper", "hardwood")):
        return "premium material selection"
    if any(token in material for token in ("builder grade", "standard", "basic", "economy")):
        return "basic material selection"
    return "selected material type"


def _access_reason(answers: Dict[str, Any]) -> str:
    text = " ".join(
        _safe_str(answers.get(key)).lower()
        for key in ("site_access_working_hours", "access_upper_floor_construction", "material_delivery_coordination")
    )
    if any(token in text for token in ("limited", "restricted", "narrow", "tight", "ladder", "stairs", "upper floor", "second floor", "occupied")):
        return "access difficulty"
    return ""


def _condition_reason(answers: Dict[str, Any]) -> str:
    text = " ".join(
        _safe_str(answers.get(key)).lower()
        for key in ("decking_condition", "unforeseen_conditions_change_orders", "measurement_notes", "measurements_notes")
    )
    if any(token in text for token in ("rot", "rotten", "replace", "replacement", "soft", "damaged", "damage", "water damage", "mold", "repair", "patch", "subfloor")):
        return "repair risk"
    return ""


def _uncertainty_reason(answers: Dict[str, Any], quantity_value: float) -> str:
    measurements = _answer_text(answers, "measurements_provided").lower()
    if measurements in {"no", "pending", "false"} or quantity_value <= 0:
        return "project details are still limited"
    return ""


def _short_pricing_reason(answers: Dict[str, Any], pricing_mode: str) -> str:
    unit, quantity_value = _extract_quantity_signal(answers)
    quantity = _quantity_reason(unit, quantity_value)
    material = _material_reason(answers)
    access = _access_reason(answers)
    condition = _condition_reason(answers)
    uncertainty = _uncertainty_reason(answers, quantity_value)

    if uncertainty:
        return "Estimate range widened because project details are still limited."

    labor_drivers = [reason for reason in (access, condition, quantity) if reason][:2]
    if pricing_mode == "labor_only":
        if labor_drivers:
            return f"Higher labor due to {' and '.join(labor_drivers)}."
        return "Lower materials exposure because customer supplies materials."

    if material and any(token in material for token in ("premium", "selected material type")):
        return f"Materials estimate reflects {material}."

    if labor_drivers:
        return f"Higher labor due to {' and '.join(labor_drivers)}."

    if material:
        return f"Materials estimate reflects {material}."

    if pricing_mode == "hybrid":
        return "Estimate reflects shared materials responsibility."

    return ""


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
                "template_suggested_amount": _safe_float(getattr(m, "template_suggested_amount", 0), 0.0),
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
    default_pricing_reason: str = "",
    baseline_profile: Dict[str, float] | None = None,
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
        template_anchor = _safe_float(base.get("template_suggested_amount"), 0.0)
        anchor_amount = template_anchor or amount
        low = max(_safe_float(item.get("suggested_amount_low"), 0.0), 0.0)
        high = max(_safe_float(item.get("suggested_amount_high"), 0.0), 0.0)
        labor_low = max(_safe_float(item.get("labor_estimate_low"), 0.0), 0.0)
        labor_high = max(_safe_float(item.get("labor_estimate_high"), 0.0), 0.0)
        materials_low = max(_safe_float(item.get("materials_estimate_low"), 0.0), 0.0)
        materials_high = max(_safe_float(item.get("materials_estimate_high"), 0.0), 0.0)

        baseline_low = baseline_high = 0.0
        baseline_labor_low = baseline_labor_high = 0.0
        baseline_materials_low = baseline_materials_high = 0.0
        if anchor_amount > 0 and baseline_profile:
            baseline_low, baseline_high = _anchor_range(anchor_amount, baseline_profile)
            labor_ratio = float(baseline_profile.get("labor_ratio", 0.65))
            materials_ratio = float(baseline_profile.get("materials_ratio", 0.35))
            baseline_labor_low = round(baseline_low * labor_ratio, 2)
            baseline_labor_high = round(baseline_high * labor_ratio, 2)
            baseline_materials_low = round(baseline_low * materials_ratio, 2)
            baseline_materials_high = round(baseline_high * materials_ratio, 2)

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

        low = _blend_values(low, baseline_low)
        high = _blend_values(high, baseline_high)
        labor_low = _blend_values(labor_low, baseline_labor_low)
        labor_high = _blend_values(labor_high, baseline_labor_high)
        materials_low = _blend_values(materials_low, baseline_materials_low)
        materials_high = _blend_values(materials_high, baseline_materials_high)

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
                    or default_pricing_reason
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
        template_anchor = _safe_float(base.get("template_suggested_amount"), 0.0)
        anchor_amount = template_anchor or amount
        if anchor_amount > 0 and baseline_profile:
            low, high = _anchor_range(anchor_amount, baseline_profile)
            labor_ratio = float(baseline_profile.get("labor_ratio", 0.65))
            materials_ratio = float(baseline_profile.get("materials_ratio", 0.35))
            labor_low = round(low * labor_ratio, 2)
            labor_high = round(high * labor_ratio, 2)
            materials_low = round(low * materials_ratio, 2)
            materials_high = round(high * materials_ratio, 2)
        else:
            low = round(anchor_amount * 0.9, 2) if anchor_amount > 0 else 0.0
            high = round(anchor_amount * 1.1, 2) if anchor_amount > 0 else 0.0
            labor_low = _safe_float(base.get("labor_estimate_low"), 0.0)
            labor_high = _safe_float(base.get("labor_estimate_high"), 0.0)
            materials_low = _safe_float(base.get("materials_estimate_low"), 0.0)
            materials_high = _safe_float(base.get("materials_estimate_high"), 0.0)
        fallback_out.append(
            {
                "milestone_id": base.get("milestone_id"),
                "order": base.get("order") or idx,
                "title": _safe_str(base.get("title")) or f"Milestone {idx}",
                "suggested_amount_low": low or None,
                "suggested_amount_high": high or None,
                "labor_estimate_low": labor_low or None,
                "labor_estimate_high": labor_high or None,
                "materials_estimate_low": materials_low or None,
                "materials_estimate_high": materials_high or None,
                "pricing_confidence": _safe_str(base.get("pricing_confidence")).lower() or "low",
                "pricing_source_note": (
                    _safe_str(base.get("pricing_source_note"))
                    or default_pricing_reason
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
    answers = _agreement_answers_snapshot(agreement)

    if not scope_text:
        raise RuntimeError("AI returned empty scope_text.")

    milestones = _normalize_milestones(milestones_raw)
    if not milestones:
        raise RuntimeError("AI returned no milestones.")

    milestones = _shape_milestone_rows_for_clarifications(
        project_type=getattr(agreement, "project_type", "") or "",
        project_subtype=getattr(agreement, "project_subtype", "") or "",
        description=getattr(agreement, "description", "") or scope_text,
        clarification_answers=answers,
        total_budget=total_cost,
        amount_mode="preserve_base",
        base_milestones=milestones,
    )

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
        "clarification_shaped": True,
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
    pricing_reason = _short_pricing_reason(answers, pricing_mode)
    baseline_profile = _baseline_pricing_profile(
        getattr(agreement, "project_type", ""),
        getattr(agreement, "project_subtype", ""),
    )
    baseline_profile = _refine_baseline_with_template(agreement, baseline_profile, milestones)

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
        "Use project_type/project_subtype as the primary baseline and treat template context as a secondary refinement, not the final answer.\n"
        "If clarification answers increase uncertainty, widen ranges and reduce confidence.\n"
        "If materials, size, pitch, or decking condition imply higher complexity, increase ranges accordingly.\n"
        "Return only JSON that matches the schema.\n"
    )

    user_json = {
        "agreement_id": getattr(agreement, "id", None),
        "project_title": getattr(getattr(agreement, "project", None), "title", "") or "",
        "project_type": getattr(agreement, "project_type", "") or "",
        "project_subtype": getattr(agreement, "project_subtype", "") or "",
        "selected_template_name": getattr(agreement, "selected_template_name_snapshot", "") or "",
        "description": getattr(agreement, "description", "") or "",
        "total_budget": _safe_float(getattr(agreement, "total_cost", 0), 0.0),
        "pricing_mode": pricing_mode,
        "baseline_profile": baseline_profile,
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
        default_pricing_reason=pricing_reason,
        baseline_profile=baseline_profile,
    )

    return {
        "pricing_estimates": pricing_estimates,
        "_model": model,
    }
