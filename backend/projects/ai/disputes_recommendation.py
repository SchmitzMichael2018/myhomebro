# backend/projects/ai/disputes_recommendation.py
# AI dispute recommendations (advisory only).

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import ValidationError

logger = logging.getLogger(__name__)


@dataclass
class AIRecommendationResult:
    artifact_type: str
    payload: Dict[str, Any]
    model: str
    cached: bool = False


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------
def _cache_key(dispute_id: int) -> str:
    return f"mhb:ai:dispute:{dispute_id}:recommendation:v1"


def _get_cache_ttl_seconds() -> int:
    return int(getattr(settings, "AI_DISPUTE_RECOMMENDATION_CACHE_TTL_SECONDS", 86400))


def _safe_json_load(s: str) -> Optional[dict]:
    try:
        return json.loads(s)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# OpenAI client (SAFE + LAZY)
# ---------------------------------------------------------------------------
def _require_openai_client():
    """
    Create an OpenAI client only when AI is enabled and a key exists.

    Key lookup order:
      1) settings.OPENAI_API_KEY
      2) settings.AI_OPENAI_API_KEY (legacy alias)
      3) os.environ["OPENAI_API_KEY"] (OpenAI SDK default)

    Raises DRF ValidationError so the API returns:
      {"detail": "..."}
    """

    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise ValidationError(
            "OpenAI SDK is not installed. Install it or disable AI features."
        ) from e

    api_key = (
        getattr(settings, "OPENAI_API_KEY", None)
        or getattr(settings, "AI_OPENAI_API_KEY", None)
        or os.getenv("OPENAI_API_KEY")
    )

    if not api_key:
        raise ValidationError("OPENAI_API_KEY is not set.")

    return OpenAI(api_key=api_key)


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------
def build_dispute_recommendation_prompt(
    *, dispute: Any, evidence_context: Dict[str, Any]
) -> Dict[str, Any]:
    model = getattr(settings, "AI_OPENAI_MODEL_DISPUTE_RECOMMENDATION", None) or getattr(
        settings, "AI_OPENAI_MODEL", "gpt-4o-mini"
    )

    system = (
        "You are an impartial dispute resolution assistant for a contractor/homeowner platform.\n"
        "Your job is to propose fair, practical, and auditable settlement options.\n"
        "Rules:\n"
        "- Advisory only. Never claim to execute refunds, transfers, chargebacks, or legal decisions.\n"
        "- Base recommendations strictly on the provided evidence context.\n"
        "- If evidence is insufficient, say what is missing and ask for it.\n"
        "- Avoid legal advice; provide procedural suggestions and neutral language.\n"
        "- Produce output that can be shown to both parties.\n"
    )

    user = {
        "dispute": {
            "id": getattr(dispute, "id", None),
            "status": getattr(dispute, "status", None),
            "created_at": str(getattr(dispute, "created_at", "")),
            "agreement_id": getattr(dispute, "agreement_id", None),
            "invoice_id": getattr(dispute, "invoice_id", None),
            "title": getattr(dispute, "title", None) or "Dispute",
            "summary": getattr(dispute, "summary", None),
            "requested_outcome": getattr(dispute, "requested_outcome", None),
            "amount_in_dispute": getattr(dispute, "amount_in_dispute", None),
            "homeowner_position": getattr(dispute, "homeowner_position", None),
            "contractor_position": getattr(dispute, "contractor_position", None),
        },
        "evidence_context": evidence_context,
    }

    json_schema = {
        "name": "dispute_recommendation",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "overview": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "neutral_summary": {"type": "string"},
                        "main_issues": {"type": "array", "items": {"type": "string"}},
                        "missing_info": {"type": "array", "items": {"type": "string"}},
                        "risk_flags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": [
                        "neutral_summary",
                        "main_issues",
                        "missing_info",
                        "risk_flags",
                    ],
                },
                "recommendation": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "recommended_option_id": {"type": "string"},
                        "why_this_option": {"type": "string"},
                        "confidence": {"type": "number"},
                        "notes_for_parties": {"type": "string"},
                    },
                    "required": [
                        "recommended_option_id",
                        "why_this_option",
                        "confidence",
                        "notes_for_parties",
                    ],
                },
                "options": {"type": "array"},
                "draft_resolution_agreement": {"type": "object"},
            },
            "required": [
                "overview",
                "recommendation",
                "options",
                "draft_resolution_agreement",
            ],
        },
    }

    return {
        "model": model,
        "system": system,
        "user_json": user,
        "json_schema": json_schema,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def generate_dispute_recommendation(
    *, dispute: Any, evidence_context: Dict[str, Any], force: bool = False
) -> AIRecommendationResult:
    key = _cache_key(int(dispute.id))
    if not force:
        cached = cache.get(key)
        if isinstance(cached, dict):
            return AIRecommendationResult(
                artifact_type="recommendation",
                payload=cached,
                model=str(cached.get("_model", "")),
                cached=True,
            )

    prompt = build_dispute_recommendation_prompt(
        dispute=dispute, evidence_context=evidence_context
    )
    client = _require_openai_client()

    model = prompt["model"]

    try:
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": prompt["system"]},
                {
                    "role": "user",
                    "content": json.dumps(
                        prompt["user_json"], ensure_ascii=False
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": prompt["json_schema"]["name"],
                    "schema": prompt["json_schema"]["schema"],
                    "strict": True,
                }
            },
        )
    except Exception as e:
        logger.exception("OpenAI call failed for dispute recommendation.")
        raise ValidationError(f"AI recommendation failed: {e}") from e

    raw = getattr(resp, "output_text", None) or ""
    payload = _safe_json_load(raw)
    if not isinstance(payload, dict):
        raise ValidationError("AI recommendation returned invalid JSON output.")

    payload["_artifact_type"] = "recommendation"
    payload["_model"] = model

    cache.set(key, payload, timeout=_get_cache_ttl_seconds())

    return AIRecommendationResult(
        artifact_type="recommendation",
        payload=payload,
        model=model,
        cached=False,
    )
