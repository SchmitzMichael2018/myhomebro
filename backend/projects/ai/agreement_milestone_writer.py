# backend/projects/ai/agreement_milestone_writer.py
# v2026-01-25d — FIX strict JSON schema requirements (additionalProperties=false everywhere)
#
# OpenAI strict JSON schema requirements we must satisfy:
# - For every object schema: additionalProperties must be provided AND must be false
# - For every object schema: `required` must include EVERY key in `properties`
#
# Therefore:
# - milestones.items: additionalProperties false, required includes all props
# - questions.items: additionalProperties false, required includes all props including options/help
#   (options can be [], help can be "")

from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Dict, Any, List

from django.conf import settings

logger = logging.getLogger(__name__)


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
                "start": start_date,          # mirror
                "end": completion_date,       # mirror
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
        "Also produce a short list of contractor questions that would reduce ambiguity.\n"
        "Examples: measurements needed, who purchases materials, allowance items, permits, access constraints.\n"
        "Return questions as structured objects.\n"
        "\n"
        "IMPORTANT: Always include options (array) and help (string) on each question, even if empty.\n"
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

    # ✅ STRICT schema that satisfies OpenAI requirements
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
                        # ✅ required includes ALL keys in properties
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

    scope_text = (payload.get("scope_text") or "").strip()
    milestones_raw = payload.get("milestones") or []
    questions_raw = payload.get("questions") or []

    if not scope_text:
        raise RuntimeError("AI returned empty scope_text.")

    milestones = _normalize_milestones(milestones_raw)
    if not milestones:
        raise RuntimeError("AI returned no milestones.")

    questions: List[Dict[str, Any]] = []
    if isinstance(questions_raw, list):
        for q in questions_raw[:25]:
            if not isinstance(q, dict):
                continue

            key = str(q.get("key") or "").strip()
            label = str(q.get("label") or "").strip()
            qtype = str(q.get("type") or "").strip() or "text"
            required = bool(q.get("required", False))

            options = q.get("options", [])
            help_txt = q.get("help", "")

            if not isinstance(options, list):
                options = []
            help_txt = "" if help_txt is None else str(help_txt)

            if not key:
                continue
            if not label:
                label = key.replace("_", " ").strip().title()

            questions.append(
                {
                    "key": key,
                    "label": label,
                    "type": qtype,
                    "required": required,
                    "options": [str(o) for o in options if str(o).strip()],
                    "help": help_txt.strip(),
                }
            )

    if not questions:
        questions = [
            {
                "key": "materials_responsibility",
                "label": "Who is purchasing materials?",
                "type": "select",
                "required": True,
                "options": ["Homeowner", "Contractor", "Split"],
                "help": "Clarify responsibility for buying/supplying materials and fixtures.",
            },
            {
                "key": "measurements_needed",
                "label": "What measurements are needed (and who will provide them)?",
                "type": "text",
                "required": False,
                "options": [],
                "help": "Examples: tile sq ft, linear feet, wall height, vanity width, etc.",
            },
            {
                "key": "allowances",
                "label": "Any allowance items (tile, fixtures, vanity, etc.)?",
                "type": "text",
                "required": False,
                "options": [],
                "help": "If yes, specify allowances or selection rules.",
            },
            {
                "key": "permits",
                "label": "Any permits/inspections required (and who pulls them)?",
                "type": "text",
                "required": False,
                "options": [],
                "help": "If applicable, specify responsibility and expected lead times.",
            },
        ]

    try:
        total_budget = Decimal(str(total_cost or "0"))
        milestone_sum = sum(Decimal(str(m.get("amount", 0))) for m in milestones)
        logger.info(
            "AI milestones: agreement=%s model=%s count=%s sum=%s budget=%s",
            getattr(agreement, "id", None),
            model,
            len(milestones),
            str(milestone_sum),
            str(total_budget),
        )
    except Exception:
        pass

    return {
        "scope_text": scope_text,
        "milestones": milestones,
        "questions": questions,
        "_model": model,
    }
