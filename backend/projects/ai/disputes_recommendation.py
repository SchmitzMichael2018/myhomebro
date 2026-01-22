# backend/projects/ai/disputes_recommendation.py
# v2026-01-21 — AI Dispute Recommendations (Advisory Only)

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


@dataclass
class AIRecommendationResult:
    artifact_type: str
    payload: Dict[str, Any]
    model: str
    cached: bool = False


def _ai_enabled() -> bool:
    return bool(getattr(settings, "AI_ENABLED", False)) and bool(getattr(settings, "AI_DISPUTES_ENABLED", False))


def _recommendations_enabled() -> bool:
    # Optional third flag so you can enable summaries but keep recommendations off
    return bool(getattr(settings, "AI_DISPUTE_RECOMMENDATIONS_ENABLED", True))


def _cache_key(dispute_id: int) -> str:
    return f"mhb:ai:dispute:{dispute_id}:recommendation:v1"


def _get_cache_ttl_seconds() -> int:
    # Default cache TTL: 24 hours. You can override in settings.
    return int(getattr(settings, "AI_DISPUTE_RECOMMENDATION_CACHE_TTL_SECONDS", 86400))


def _safe_json_load(s: str) -> Optional[dict]:
    try:
        return json.loads(s)
    except Exception:
        return None


def _require_openai_client():
    """
    Lazy import so the server doesn't error if the OpenAI package isn't installed
    while AI is disabled.
    """
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "OpenAI SDK not installed. Install it (pip install openai) or keep AI disabled."
        ) from e

    api_key = getattr(settings, "OPENAI_API_KEY", None) or getattr(settings, "AI_OPENAI_API_KEY", None)
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set. Keep AI disabled or configure key in environment/settings.")

    return OpenAI(api_key=api_key)


def build_dispute_recommendation_prompt(*, dispute: Any, evidence_context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produces a JSON-schema driven instruction set for the model.

    evidence_context should be the exact structure your evidence pipeline outputs
    (messages, photos, docs, milestones, invoice data, dispute metadata, etc).
    """
    # You can override the model in settings.
    model = getattr(settings, "AI_OPENAI_MODEL_DISPUTE_RECOMMENDATION", None) or getattr(
        settings, "AI_OPENAI_MODEL", "gpt-4.1-mini"
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

    # This is the “what the AI sees”. Keep it deterministic and auditable.
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
                    "required": ["neutral_summary", "main_issues", "missing_info", "risk_flags"],
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
                    "required": ["recommended_option_id", "why_this_option", "confidence", "notes_for_parties"],
                },
                "options": {
                    "type": "array",
                    "minItems": 3,
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "option_id": {"type": "string"},
                            "label": {"type": "string"},
                            "outcome": {"type": "string"},
                            "proposed_financials": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "refund_to_homeowner": {"type": "number"},
                                    "payout_to_contractor": {"type": "number"},
                                    "hold_in_escrow": {"type": "number"},
                                    "explanation": {"type": "string"},
                                },
                                "required": ["refund_to_homeowner", "payout_to_contractor", "hold_in_escrow", "explanation"],
                            },
                            "action_plan": {"type": "array", "items": {"type": "string"}},
                            "evidence_citations": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "properties": {
                                        "source": {"type": "string"},
                                        "id": {"type": "string"},
                                        "why_it_matters": {"type": "string"},
                                    },
                                    "required": ["source", "id", "why_it_matters"],
                                },
                            },
                        },
                        "required": ["option_id", "label", "outcome", "proposed_financials", "action_plan", "evidence_citations"],
                    },
                },
                "draft_resolution_agreement": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "terms": {"type": "array", "items": {"type": "string"}},
                        "signature_block": {"type": "string"},
                    },
                    "required": ["title", "terms", "signature_block"],
                },
            },
            "required": ["overview", "recommendation", "options", "draft_resolution_agreement"],
        },
    }

    return {
        "model": model,
        "system": system,
        "user_json": user,
        "json_schema": json_schema,
    }


def generate_dispute_recommendation(*, dispute: Any, evidence_context: Dict[str, Any], force: bool = False) -> AIRecommendationResult:
    """
    Returns a structured, display-ready recommendation payload.
    Uses cache to avoid repeated model calls.
    """
    if not _ai_enabled() or not _recommendations_enabled():
        raise PermissionError("AI dispute recommendations are disabled by settings.")

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

    prompt = build_dispute_recommendation_prompt(dispute=dispute, evidence_context=evidence_context)
    client = _require_openai_client()

    # Using Responses API with JSON schema enforcement (works with modern OpenAI SDKs)
    model = prompt["model"]

    try:
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": prompt["system"]},
                {"role": "user", "content": json.dumps(prompt["user_json"], ensure_ascii=False)},
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
        raise RuntimeError(f"AI recommendation failed: {e}") from e

    # SDK returns output_text that should be JSON when using json_schema format
    raw = getattr(resp, "output_text", None) or ""
    payload = _safe_json_load(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("AI recommendation returned invalid JSON output.")

    # Attach metadata for debugging/audit (safe, no secrets)
    payload["_artifact_type"] = "recommendation"
    payload["_model"] = model

    cache.set(key, payload, timeout=_get_cache_ttl_seconds())

    return AIRecommendationResult(
        artifact_type="recommendation",
        payload=payload,
        model=model,
        cached=False,
    )
