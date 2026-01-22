# backend/projects/services/ai/dispute_summary.py
from __future__ import annotations

import json
from typing import Any, Dict

from django.conf import settings

# Evidence context builder (Phase 1)
from .evidence_context import build_dispute_evidence_context


def _json_dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


def _get_openai_client():
    """
    Lazily import OpenAI SDK so environments without it fail gracefully.
    """
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "OpenAI SDK not available. Install with: pip install openai"
        ) from e

    # OpenAI SDK reads OPENAI_API_KEY from environment by default
    return OpenAI()


def generate_dispute_ai_summary(dispute) -> Dict[str, Any]:
    """
    Generate an evidence-based neutral summary for a dispute.

    Rules:
    - Read-only
    - Evidence-based
    - No money actions
    - No blame
    - Must cite internal record IDs (milestone/invoice/evidence)

    Returns a JSON-safe dict suitable for API response.
    """
    ctx = build_dispute_evidence_context(dispute)

    # Model selection (configurable)
    model = getattr(settings, "OPENAI_DISPUTE_SUMMARY_MODEL", None) or getattr(
        settings, "OPENAI_MODEL", None
    ) or "gpt-4o-mini"

    client = _get_openai_client()

    # We ask for strict JSON output so frontend can render predictably.
    schema_hint = {
        "summary": "string (neutral, 6-10 bullet points)",
        "timeline": [
            {
                "when": "string date/time if known, else null",
                "event": "string",
                "citations": ["array of citation ids like dispute:ID, milestone:ID, invoice:ID, evidence:ID"],
            }
        ],
        "issues": [
            {
                "label": "string",
                "why_it_matters": "string",
                "citations": ["array of citation ids"],
            }
        ],
        "missing_evidence": [
            {
                "item": "string",
                "why_needed": "string",
            }
        ],
        "neutral_options": [
            {
                "title": "string",
                "description": "string",
                "prerequisites": ["array of strings"],
                "citations": ["array of citation ids"],
            }
        ],
        "notes": "string (limitations and what could change the analysis)",
    }

    system = (
        "You are a neutral dispute assistant for a contractor-homeowner platform. "
        "You MUST be evidence-based: only state what is supported by the provided JSON context. "
        "Do NOT assign blame. Do NOT mention prices unless they appear in the context. "
        "Do NOT recommend any money movement. Provide multiple neutral resolution options. "
        "Every key claim MUST include citations referencing internal IDs (dispute:X, milestone:X, invoice:X, evidence:X). "
        "If evidence is insufficient, say so and list missing evidence.\n\n"
        "Return ONLY valid JSON. Do not wrap in markdown."
    )

    user = (
        "Generate an evidence-based neutral dispute summary and options from this context.\n\n"
        f"EXPECTED_JSON_SCHEMA:\n{_json_dump(schema_hint)}\n\n"
        f"DISPUTE_CONTEXT_JSON:\n{_json_dump(ctx)}\n"
    )

    # Using Responses API (recommended by OpenAI docs) :contentReference[oaicite:0]{index=0}
    resp = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )

    text = getattr(resp, "output_text", None)
    if not text:
        # Fallback: older SDKs sometimes structure differently
        text = getattr(resp, "output", None)
        if isinstance(text, list):
            text = json.dumps(text, default=str)

    # Parse JSON safely
    try:
        data = json.loads(text)
    except Exception:
        # Fail-safe: return raw text so you can debug prompt/format issues
        return {
            "ok": False,
            "error": "Model returned non-JSON output.",
            "raw": text,
            "model": model,
        }

    return {
        "ok": True,
        "model": model,
        "context_meta": ctx.get("meta", {}),
        "result": data,
    }
