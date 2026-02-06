# backend/projects/ai/agreement_description_writer.py
# v2026-01-22 — AI Description Writer for Agreement Step 1 (generate/improve)

from __future__ import annotations

import json
import logging
from typing import Dict, Any

from django.conf import settings

logger = logging.getLogger(__name__)


def _require_openai_client():
    """
    Lazy import so server won't fail when OpenAI isn't installed and AI is off.
    """
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
        getattr(settings, "AI_OPENAI_MODEL_SCOPE_WRITER", None)
        or getattr(settings, "AI_OPENAI_MODEL", None)
        or "gpt-4.1-mini"
    )


def generate_or_improve_description(
    *,
    mode: str,
    project_title: str,
    project_type: str,
    project_subtype: str,
    current_description: str,
) -> Dict[str, Any]:
    """
    mode:
      - "generate": create a starter scope from title/type/subtype
      - "improve": rewrite existing description to be clearer and dispute-resistant

    Returns:
      { "description": "..." }
    """
    mode = (mode or "").strip().lower()
    if mode not in ("generate", "improve"):
        mode = "improve" if (current_description or "").strip() else "generate"

    client = _require_openai_client()
    model = _model_name()

    system = (
        "You are a construction agreement scope writer.\n"
        "Write clear, dispute-resistant project descriptions.\n"
        "Rules:\n"
        "- Be specific and measurable.\n"
        "- Avoid vague phrases like 'as needed', 'minor fixes', 'etc'.\n"
        "- Include key inclusions and exclusions.\n"
        "- Keep it concise (6-12 bullet-like sentences max).\n"
        "- Do NOT provide legal advice.\n"
    )

    user_json = {
        "mode": mode,
        "project_title": project_title or "",
        "project_type": project_type or "",
        "project_subtype": project_subtype or "",
        "current_description": current_description or "",
    }

    schema = {
        "name": "agreement_description",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "description": {"type": "string"},
            },
            "required": ["description"],
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
        logger.exception("OpenAI call failed for agreement description writer.")
        raise RuntimeError(f"AI description generation failed: {e}") from e

    raw = getattr(resp, "output_text", "") or ""
    try:
        payload = json.loads(raw)
    except Exception:
        raise RuntimeError("AI description returned invalid JSON.")

    desc = (payload.get("description") or "").strip()
    if not desc:
        raise RuntimeError("AI returned an empty description.")

    return {"description": desc, "_model": model, "_mode": mode}
