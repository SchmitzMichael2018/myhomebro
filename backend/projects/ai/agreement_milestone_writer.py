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