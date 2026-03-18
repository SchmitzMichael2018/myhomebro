from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List

from django.conf import settings

logger = logging.getLogger(__name__)


def _require_openai_client():
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError("OpenAI SDK not installed. Run: pip install openai") from e

    api_key = (
        getattr(settings, "OPENAI_API_KEY", None)
        or getattr(settings, "AI_OPENAI_API_KEY", None)
    )
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=api_key)


def _model_name() -> str:
    return (
        getattr(settings, "AI_OPENAI_MODEL_TEMPLATE_BUILDER", None)
        or getattr(settings, "AI_OPENAI_MODEL_SCOPE_WRITER", None)
        or getattr(settings, "AI_OPENAI_MODEL", None)
        or "gpt-4.1-mini"
    )


def _safe_str(v: Any) -> str:
    return str(v or "").strip()


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        if v in (None, ""):
            return default
        return int(v)
    except Exception:
        return default


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v in (None, ""):
            return default
        return float(v)
    except Exception:
        return default


def _normalize_keyish(value: Any) -> str:
    s = _safe_str(value).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s


CANONICAL_CLARIFICATION_KEYS: Dict[str, Dict[str, Any]] = {
    "materials_responsibility": {
        "label": "Who will purchase materials?",
        "type": "select",
        "options": ["Contractor", "Homeowner", "Split"],
        "help": "Clarify procurement responsibility for the project.",
        "required": True,
    },
    "permits_responsibility": {
        "label": "Who obtains necessary building permits?",
        "type": "select",
        "options": ["Contractor", "Homeowner", "Split / depends"],
        "help": "Clarify who handles permits and inspections.",
        "required": True,
    },
    "measurements_provided": {
        "label": "Are detailed measurements provided?",
        "type": "select",
        "options": ["Yes", "No", "Pending"],
        "help": "Confirm whether measurements and counts are already verified.",
        "required": True,
    },
    "site_access_working_hours": {
        "label": "Site Access & Working Hours",
        "type": "text",
        "options": [],
        "help": "Clarify access constraints and working-hour limitations.",
        "required": False,
    },
    "material_delivery_coordination": {
        "label": "Material Delivery Coordination",
        "type": "text",
        "options": [],
        "help": "Clarify who orders and coordinates deliveries.",
        "required": False,
    },
    "waste_removal_responsibility": {
        "label": "Waste / Debris Removal",
        "type": "text",
        "options": [],
        "help": "Clarify debris removal and disposal responsibility.",
        "required": False,
    },
    "unforeseen_conditions_change_orders": {
        "label": "Unforeseen Conditions / Change Orders",
        "type": "text",
        "options": [],
        "help": "Clarify hidden conditions and extra-work approval expectations.",
        "required": False,
    },
}


def _canonicalize_questions(raw_questions: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_questions, list):
        return []

    out: Dict[str, Dict[str, Any]] = {}

    for raw in raw_questions[:25]:
        if not isinstance(raw, dict):
            continue

        raw_key = _normalize_keyish(
            raw.get("key") or raw.get("label") or raw.get("question")
        )
        key = raw_key if raw_key in CANONICAL_CLARIFICATION_KEYS else raw_key

        if not key:
            continue

        spec = CANONICAL_CLARIFICATION_KEYS.get(key, {})
        label = _safe_str(
            raw.get("label")
            or raw.get("question")
            or spec.get("label")
            or key.replace("_", " ").title()
        )
        qtype = _safe_str(raw.get("type") or spec.get("type") or "text").lower()
        options = (
            raw.get("options")
            if isinstance(raw.get("options"), list)
            else spec.get("options", [])
        )
        help_txt = _safe_str(raw.get("help") or spec.get("help"))
        required = bool(raw.get("required", spec.get("required", False)))

        normalized = {
            "key": key,
            "label": label,
            "question": _safe_str(raw.get("question") or label),
            "type": "select" if qtype in {"select", "radio", "boolean"} else "text",
            "required": required,
            "options": [str(x).strip() for x in options if str(x).strip()],
            "help": help_txt,
        }
        out[key] = normalized

    if not out:
        for key in [
            "materials_responsibility",
            "permits_responsibility",
            "measurements_provided",
        ]:
            spec = CANONICAL_CLARIFICATION_KEYS[key]
            out[key] = {
                "key": key,
                "label": spec["label"],
                "question": spec["label"],
                "type": spec["type"],
                "required": spec["required"],
                "options": spec["options"],
                "help": spec["help"],
            }

    return list(out.values())


def _normalize_milestones(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    out: List[Dict[str, Any]] = []

    for idx, row in enumerate(raw, start=1):
        if not isinstance(row, dict):
            continue

        raw_start_day = row.get("recommended_days_from_start")
        start_day = _safe_int(raw_start_day, 0)

        raw_duration = row.get("recommended_duration_days")
        duration_days = _safe_int(raw_duration, 0)

        fixed_amount = _safe_float(row.get("suggested_amount_fixed"), 0.0)
        low_amount = _safe_float(row.get("suggested_amount_low"), 0.0)
        high_amount = _safe_float(row.get("suggested_amount_high"), 0.0)

        # Repair incomplete pricing so milestones never come back empty.
        if low_amount <= 0 and high_amount > 0:
            low_amount = round(high_amount * 0.65, 2)

        if high_amount <= 0 and low_amount > 0:
            high_amount = round(low_amount * 1.35, 2)

        if low_amount <= 0 and high_amount <= 0 and fixed_amount > 0:
            low_amount = round(fixed_amount * 0.85, 2)
            high_amount = round(fixed_amount * 1.15, 2)

        if fixed_amount <= 0 and low_amount > 0 and high_amount > 0:
            fixed_amount = round((low_amount + high_amount) / 2, 2)

        if low_amount > 0 and high_amount > 0 and low_amount > high_amount:
            low_amount, high_amount = high_amount, low_amount

        confidence = _safe_str(row.get("pricing_confidence")).lower()
        if confidence not in {"low", "medium", "high"}:
            confidence = "low" if not (low_amount or high_amount or fixed_amount) else "medium"

        source_note = _safe_str(row.get("pricing_source_note"))
        if not source_note:
            source_note = "AI estimate based on typical residential contractor pricing."

        out.append(
            {
                "title": _safe_str(row.get("title")) or f"Milestone {idx}",
                "description": _safe_str(row.get("description")),
                "sort_order": _safe_int(row.get("sort_order"), idx),
                "normalized_milestone_type": _safe_str(
                    row.get("normalized_milestone_type")
                ),
                "suggested_amount_fixed": fixed_amount or None,
                "suggested_amount_low": low_amount or None,
                "suggested_amount_high": high_amount or None,
                "pricing_confidence": confidence,
                "pricing_source_note": source_note,
                "recommended_days_from_start": (
                    None if raw_start_day in (None, "") and idx > 1 else max(start_day, 0)
                ),
                "recommended_duration_days": (
                    max(duration_days, 1) if raw_duration not in (None, "") else None
                ),
                "materials_hint": _safe_str(row.get("materials_hint")),
                "is_optional": bool(row.get("is_optional", False)),
            }
        )

    out.sort(key=lambda x: x.get("sort_order") or 999999)

    for idx, row in enumerate(out, start=1):
        row["sort_order"] = idx
        if idx == 1 and row.get("recommended_days_from_start") is None:
            row["recommended_days_from_start"] = 0

    return out


def improve_template_description(
    *,
    name: str,
    project_type: str,
    project_subtype: str,
    description: str,
) -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    system = (
        "You are a construction template writer.\n"
        "Rewrite a reusable project template description.\n"
        "Rules:\n"
        "- Make it generic and repeatable.\n"
        "- Do NOT include exact measurements, exact counts, or exact quantities.\n"
        "- Do NOT hardcode project-specific dimensions.\n"
        "- Put job-specific details into clarifications later, not into the template description.\n"
        "- Keep it professional, concise, and reusable across similar jobs.\n"
        "- Return only JSON.\n"
    )

    user_json = {
        "name": name,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "description": description,
    }

    schema = {
        "name": "template_description_improve",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "description": {"type": "string"},
            },
            "required": ["description"],
        },
    }

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

    payload = json.loads(getattr(resp, "output_text", "") or "{}")
    description_out = _safe_str(payload.get("description"))
    if not description_out:
        raise RuntimeError("AI returned an empty template description.")
    return {"description": description_out, "_model": model}


def suggest_template_type_subtype(
    *,
    name: str,
    description: str,
) -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    system = (
        "You are a construction project classifier.\n"
        "Suggest a broad project type and a more specific subtype.\n"
        "Return short, contractor-friendly values.\n"
        "Examples:\n"
        "- Type: Addition / Subtype: Bedroom Addition\n"
        "- Type: Remodel / Subtype: Bathroom Remodel\n"
        "- Type: Outdoor / Subtype: Deck Build\n"
        "Return only JSON.\n"
    )

    user_json = {
        "name": name,
        "description": description,
    }

    schema = {
        "name": "template_type_subtype",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "project_type": {"type": "string"},
                "project_subtype": {"type": "string"},
            },
            "required": ["project_type", "project_subtype"],
        },
    }

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

    payload = json.loads(getattr(resp, "output_text", "") or "{}")
    return {
        "project_type": _safe_str(payload.get("project_type")),
        "project_subtype": _safe_str(payload.get("project_subtype")),
        "_model": model,
    }


def create_template_from_scope(
    *,
    name: str,
    project_type: str,
    project_subtype: str,
    description: str,
) -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    system = (
        "You are an AI contractor assistant building reusable construction project templates.\n"
        "Create a reusable template draft from a rough scope.\n"
        "Rules:\n"
        "- Template description must be generic and reusable.\n"
        "- Do NOT include exact measurements, exact counts, or exact quantities in reusable descriptions.\n"
        "- Put missing specifics into clarification questions.\n"
        "- Milestone descriptions must be generic and repeatable.\n"
        "- Include milestone pricing guidance, schedule hints, and materials hints.\n"
        "- Suggest project-level materials guidance as a broad list, not exact takeoff quantities.\n"
        "- project_materials_hint must contain useful project-level material categories, not vague filler text.\n"
        "- materials_hint for each milestone must list realistic materials, tools, or consumables commonly associated with that milestone.\n"
        "- For roofing, include realistic items like shingles, underlayment, drip edge, flashing, fasteners, sealants, vents, disposal materials, and safety gear where appropriate.\n"
        "- Avoid generic phrases like 'materials as needed', 'tools required', or other vague filler language.\n"
        "- The first milestone must start on day 0.\n"
        "- Milestone start days must be sequential and realistic.\n"
        "- recommended_duration_days must be at least 1 when provided.\n"
        "- Every milestone MUST include pricing guidance.\n"
        "- Do NOT leave pricing fields blank.\n"
        "- Every milestone MUST include suggested_amount_low and suggested_amount_high greater than 0.\n"
        "- suggested_amount_fixed should be a realistic target price within the low/high range.\n"
        "- pricing_confidence must always be one of: low, medium, high.\n"
        "- pricing_source_note must briefly explain the basis for the estimate.\n"
        "- Estimate pricing using realistic U.S. residential contractor patterns.\n"
        "- Consider labor intensity, specialty trade involvement, inspection needs, material handling complexity, and project risk.\n"
        "- If the scope suggests specialty trades like roofing, HVAC, electrical, plumbing, finish carpentry, or structural framing, price accordingly.\n"
        "- If project_type or project_subtype suggests higher complexity, increase pricing appropriately.\n"
        "- When exact measurements are missing, still provide practical pricing ranges based on typical small-to-mid-sized residential jobs.\n"
        "- Return only JSON.\n"
    )

    user_json = {
        "name": name,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "description": description,
    }

    schema = {
        "name": "template_from_scope",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "name": {"type": "string"},
                "project_type": {"type": "string"},
                "project_subtype": {"type": "string"},
                "description": {"type": "string"},
                "estimated_days": {"type": "integer"},
                "project_materials_hint": {"type": "string"},
                "default_clarifications": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "key": {"type": "string"},
                            "label": {"type": "string"},
                            "type": {"type": "string"},
                            "required": {"type": "boolean"},
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "help": {"type": "string"},
                        },
                        "required": [
                            "key",
                            "label",
                            "type",
                            "required",
                            "options",
                            "help",
                        ],
                    },
                },
                "milestones": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "sort_order": {"type": "integer"},
                            "normalized_milestone_type": {"type": "string"},
                            "suggested_amount_fixed": {"type": "number"},
                            "suggested_amount_low": {"type": "number"},
                            "suggested_amount_high": {"type": "number"},
                            "pricing_confidence": {"type": "string"},
                            "pricing_source_note": {"type": "string"},
                            "recommended_days_from_start": {"type": "integer"},
                            "recommended_duration_days": {"type": "integer"},
                            "materials_hint": {"type": "string"},
                            "is_optional": {"type": "boolean"},
                        },
                        "required": [
                            "title",
                            "description",
                            "sort_order",
                            "normalized_milestone_type",
                            "suggested_amount_fixed",
                            "suggested_amount_low",
                            "suggested_amount_high",
                            "pricing_confidence",
                            "pricing_source_note",
                            "recommended_days_from_start",
                            "recommended_duration_days",
                            "materials_hint",
                            "is_optional",
                        ],
                    },
                },
            },
            "required": [
                "name",
                "project_type",
                "project_subtype",
                "description",
                "estimated_days",
                "project_materials_hint",
                "default_clarifications",
                "milestones",
            ],
        },
    }

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

    payload = json.loads(getattr(resp, "output_text", "") or "{}")

    milestones = _normalize_milestones(payload.get("milestones"))
    questions = _canonicalize_questions(payload.get("default_clarifications"))

    if not milestones:
        raise RuntimeError("AI returned no template milestones.")

    return {
        "name": _safe_str(payload.get("name")) or _safe_str(name) or "New Template Draft",
        "project_type": _safe_str(payload.get("project_type")) or _safe_str(project_type),
        "project_subtype": _safe_str(payload.get("project_subtype")) or _safe_str(project_subtype),
        "description": _safe_str(payload.get("description")) or _safe_str(description),
        "estimated_days": max(_safe_int(payload.get("estimated_days"), 1), 1),
        "project_materials_hint": _safe_str(payload.get("project_materials_hint")),
        "default_scope": _safe_str(payload.get("description")) or _safe_str(description),
        "default_clarifications": questions,
        "milestones": milestones,
        "_model": model,
    }


def generate_materials_from_scope(
    *,
    name: str,
    project_type: str,
    project_subtype: str,
    description: str,
    milestones: List[Dict[str, Any]],
) -> Dict[str, Any]:
    client = _require_openai_client()
    model = _model_name()

    system = (
        "You are an AI contractor assistant focused ONLY on materials planning.\n"
        "Generate realistic material suggestions for a reusable construction template.\n"
        "Rules:\n"
        "- Do NOT generate pricing, schedule, clarification questions, or new milestones.\n"
        "- Only return materials guidance.\n"
        "- Project-level materials should be broad categories commonly needed across the whole job.\n"
        "- Milestone materials should be specific to that phase of work.\n"
        "- Avoid vague phrases like 'materials as needed', 'tools required', 'miscellaneous supplies', or other filler text.\n"
        "- Be trade-aware for roofing, framing, drywall, painting, flooring, plumbing, electrical, finish work, demolition, cleanup, and exterior projects.\n"
        "- For roofing include realistic items like shingles, underlayment, drip edge, flashing, vents, sealants, fasteners, disposal materials, ladders, fall protection, tarps, and safety gear where appropriate.\n"
        "- Keep descriptions practical, contractor-friendly, and reusable.\n"
        "- Return only JSON.\n"
    )

    user_json = {
        "name": name,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "description": description,
        "milestones": [
            {
                "title": _safe_str(m.get("title")),
                "description": _safe_str(m.get("description")),
                "normalized_milestone_type": _safe_str(m.get("normalized_milestone_type")),
            }
            for m in (milestones or [])
            if isinstance(m, dict)
        ],
    }

    schema = {
        "name": "materials_only",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "project_materials_hint": {"type": "string"},
                "milestones": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "title": {"type": "string"},
                            "materials_hint": {"type": "string"},
                        },
                        "required": ["title", "materials_hint"],
                    },
                },
            },
            "required": ["project_materials_hint", "milestones"],
        },
    }

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

    payload = json.loads(getattr(resp, "output_text", "") or "{}")

    incoming_milestones = payload.get("milestones")
    if not isinstance(incoming_milestones, list):
        incoming_milestones = []

    normalized_milestones = []
    for idx, row in enumerate(incoming_milestones, start=1):
        if not isinstance(row, dict):
            continue
        normalized_milestones.append(
            {
                "title": _safe_str(row.get("title")) or f"Milestone {idx}",
                "materials_hint": _safe_str(row.get("materials_hint")),
            }
        )

    return {
        "project_materials_hint": _safe_str(payload.get("project_materials_hint")),
        "milestones": normalized_milestones,
        "_model": model,
    }