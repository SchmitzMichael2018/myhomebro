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
from django.core.serializers.json import DjangoJSONEncoder
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


LEGAL_CONCLUSION_REPLACEMENTS = {
    "liable": "responsible under the agreement context",
    "liability": "responsibility under the agreement context",
    "negligent": "unsupported by the available evidence",
    "negligence": "an unsupported legal conclusion",
    "breached": "may not align with the agreement record",
    "breach": "agreement alignment issue",
    "entitled": "may request review",
    "violation": "possible mismatch with the record",
    "guilty": "not determined by this review",
    "at fault": "associated with the disputed issue",
    "you should": "a reviewer may consider",
}


def _neutralize_legal_language(value: Any) -> Any:
    if isinstance(value, str):
        text = value
        for unsafe, replacement in LEGAL_CONCLUSION_REPLACEMENTS.items():
            text = text.replace(unsafe, replacement)
            text = text.replace(unsafe.title(), replacement)
            text = text.replace(unsafe.upper(), replacement)
        return text
    if isinstance(value, list):
        return [_neutralize_legal_language(item) for item in value]
    if isinstance(value, dict):
        return {key: _neutralize_legal_language(item) for key, item in value.items()}
    return value


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
        "You are Project Assistant acting as a neutral Resolution Assistant for a contractor/homeowner platform.\n"
        "Your job is to prepare a neutral, practical, and auditable review aid for a human reviewer.\n"
        "Rules:\n"
        "- Advisory only. Humans decide all outcomes and all financial actions remain explicit separate steps.\n"
        "- Never determine fault, liability, negligence, fraud, legal responsibility, or who wins.\n"
        "- Never instruct the platform to release funds, refund funds, split funds, or create a binding outcome.\n"
        "- Base recommendations strictly on the provided evidence context.\n"
        "- First separate the submission into individual performance/payment claims. Preserve allegations as allegations; never restate them as proven facts.\n"
        "- For each claim report milestone connection (direct, partial, unrelated), evidence status, materiality, cure availability, missing information, and recommended hold action.\n"
        "- A concern may be documented even when it does not qualify for a continued payment hold. Do not treat payment-hold qualification as a decision on the underlying merits or warranty rights.\n"
        "- Flag credible safety danger, active property damage, unauthorized payment, falsified completion, abandonment, threats, harassment, serious misconduct, or legal restrictions for urgent human review. Do not make legal or criminal findings.\n"
        "- Ignore discriminatory or identity-based assertions when analyzing work performance, while preserving that a conduct-review flag may be appropriate.\n"
        "- Never infer that the entire project must stop from a milestone payment dispute. Work-pause requests are a separate human workflow.\n"
        "- Follow this evidence-first sequence: customer complaint and requested outcome, signed agreement terms and scope, area-specific photos or video, then the contractor's current statement.\n"
        "- Treat a complaint as specific only when it identifies the affected area or item, describes the observed condition, and states the requested correction.\n"
        "- If the complaint is not specific enough, make the first recommendation a request for the missing location, condition, and requested correction details.\n"
        "- If area-specific photos or video are absent, make the first recommendation a request for clear overview and close-up images of the exact complained-about area. Say precisely what the images need to show.\n"
        "- Do not request redundant visual evidence. When the complaint identifies the affected item and observed problem and at least one customer photo is present, treat that as sufficient visual evidence unless the record explicitly says the image is unreadable, unrelated, or fails to show the complained-about condition.\n"
        "- A single clear photo plus a specific complaint can be enough to evaluate corrective action. Do not require both overview and close-up images as a rigid checklist.\n"
        "- If the contractor has not provided a separate current statement, request the contractor's version only after the customer details and visual evidence are recorded.\n"
        "- A resolution recommendation may be drafted only when the record includes a sufficiently specific customer complaint, relevant signed-agreement content, visual evidence when the issue can be photographed, and a contractor statement. Otherwise recommend evidence collection, identify every missing item, and keep confidence low.\n"
        "- Do not treat a machine-formatted proposal receipt or proposal metadata as a substitute for either party's statement.\n"
        "- When the contractor has proposed a solution, review it for alignment with the signed agreement and available evidence, clear corrective actions, responsible party, target dates, completion evidence, payment impact, and homeowner review or acknowledgment.\n"
        "- Once a specific complaint, relevant signed-agreement scope, at least one relevant customer photo, and a contractor statement or proposed solution are present, favor evaluating or improving the corrective-action proposal over requesting more evidence.\n"
        "- Preserve the contractor's practical intent. Identify concrete gaps and draft a clearer improved version when useful; never overwrite, send, accept, or apply the contractor's proposal automatically.\n"
        "- Explain briefly why the recommended course is favored over each alternative, using the evidence and current risks rather than generic language.\n"
        "- The recommendation confidence means confidence that the recommended next action is appropriate. Report final-resolution readiness separately; missing evidence can make final-resolution readiness low even when confidence in an evidence-gathering next action is high.\n"
        "- If contractor_review_request.selected_coa is present, draft a concise customer-facing contractor response that follows that course of action. The draft must be reviewable and must not be sent automatically.\n"
        "- If the contractor supplied their own response, assess its clarity, agreement alignment, missing commitments, tone, evidentiary gaps, and practical risks; then suggest specific improvements.\n"
        "- Use neutral headings such as Neutral Case Summary, Timeline, Evidence Used, Missing Evidence, Open Questions, and Courses of Action.\n"
        "- Avoid legal advice; provide procedural suggestions and neutral language.\n"
        "- Use phrases like 'Based on the available evidence...', 'The agreement appears to state...', 'The evidence supports...', and 'Insufficient evidence to determine...'.\n"
        "- Do not use these words or phrases: liable, negligent, breached, entitled, violation, guilty, at fault, you should.\n"
        "- Do not say 'customer is correct', 'contractor is liable', 'release payment', or 'refund homeowner'.\n"
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
            "expected_result": getattr(dispute, "expected_result", None),
            "requested_resolution": getattr(dispute, "requested_resolution", None),
            "qualification_status": getattr(dispute, "qualification_status", None),
            "missing_information": getattr(dispute, "missing_information", None),
            "urgent_review": getattr(dispute, "urgent_review", None),
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
                "qualification_assessment": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "claims": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "claim": {"type": "string"},
                                    "milestone_connection": {"type": "string", "enum": ["direct", "partial", "unrelated"]},
                                    "qualification_result": {"type": "string", "enum": ["qualified", "insufficient_information", "unqualified", "urgent_human_review"]},
                                    "evidence_status": {"type": "string", "enum": ["sufficient", "incomplete", "conflicting", "unavailable", "not_reasonably_applicable"]},
                                    "missing_information": {"type": "array", "items": {"type": "string"}},
                                    "materiality": {"type": "string", "enum": ["minor", "material", "potentially_critical"]},
                                    "cure_availability": {"type": "string"},
                                    "neutral_expertise_may_be_needed": {"type": "boolean"},
                                    "recommended_hold_action": {"type": "string", "enum": ["maintain", "request_information", "release", "escalate"]},
                                    "confidence": {"type": "number"},
                                    "neutral_explanation": {"type": "string"},
                                },
                                "required": ["claim", "milestone_connection", "qualification_result", "evidence_status", "missing_information", "materiality", "cure_availability", "neutral_expertise_may_be_needed", "recommended_hold_action", "confidence", "neutral_explanation"],
                            },
                        },
                        "urgent_human_review": {"type": "boolean"},
                        "conduct_review_flag": {"type": "boolean"},
                        "advisory_note": {"type": "string"},
                    },
                    "required": ["claims", "urgent_human_review", "conduct_review_flag", "advisory_note"],
                },
                "overview": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "neutral_summary": {"type": "string"},
                        "timeline": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "date": {"type": "string"},
                                    "event": {"type": "string"},
                                    "source": {"type": "string"},
                                },
                                "required": ["date", "event", "source"],
                            },
                        },
                        "disputed_facts": {"type": "array", "items": {"type": "string"}},
                        "undisputed_facts": {"type": "array", "items": {"type": "string"}},
                        "relevant_agreement_sections": {"type": "array", "items": {"type": "string"}},
                        "evidence_used": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "type": {"type": "string"},
                                    "label": {"type": "string"},
                                    "supports": {"type": "string"},
                                },
                                "required": ["type", "label", "supports"],
                            },
                        },
                        "main_issues": {"type": "array", "items": {"type": "string"}},
                        "missing_info": {"type": "array", "items": {"type": "string"}},
                        "missing_evidence": {"type": "array", "items": {"type": "string"}},
                        "risk_flags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": [
                        "neutral_summary",
                        "timeline",
                        "disputed_facts",
                        "undisputed_facts",
                        "relevant_agreement_sections",
                        "evidence_used",
                        "main_issues",
                        "missing_info",
                        "missing_evidence",
                        "risk_flags",
                    ],
                },
                "recommendation": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "recommended_option_id": {"type": "string"},
                        "why_this_option": {"type": "string"},
                        "favored_over_alternatives": {"type": "string"},
                        "confidence": {"type": "number"},
                        "final_resolution_readiness": {"type": "string", "enum": ["low", "medium", "high"]},
                        "readiness_explanation": {"type": "string"},
                        "supporting_evidence": {"type": "array", "items": {"type": "string"}},
                        "missing_evidence": {"type": "array", "items": {"type": "string"}},
                        "notes_for_parties": {"type": "string"},
                        "advisory_boundary": {"type": "string"},
                    },
                    "required": [
                        "recommended_option_id",
                        "why_this_option",
                        "favored_over_alternatives",
                        "confidence",
                        "final_resolution_readiness",
                        "readiness_explanation",
                        "supporting_evidence",
                        "missing_evidence",
                        "notes_for_parties",
                        "advisory_boundary",
                    ],
                },
                "contractor_solution_review": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "solution_present": {"type": "boolean"},
                        "summary": {"type": "string"},
                        "strengths": {"type": "array", "items": {"type": "string"}},
                        "gaps": {"type": "array", "items": {"type": "string"}},
                        "risks": {"type": "array", "items": {"type": "string"}},
                        "recommended_improvements": {"type": "array", "items": {"type": "string"}},
                        "improved_solution": {"type": "string"},
                        "human_review_required": {"type": "string"},
                    },
                    "required": ["solution_present", "summary", "strengths", "gaps", "risks", "recommended_improvements", "improved_solution", "human_review_required"],
                },
                "contractor_response_draft": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "selected_option_id": {"type": "string"},
                        "subject": {"type": "string"},
                        "response": {"type": "string"},
                        "review_note": {"type": "string"},
                    },
                    "required": ["selected_option_id", "subject", "response", "review_note"],
                },
                "courses_of_action": {
                    "type": "array",
                    "minItems": 3,
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "option_id": {"type": "string"},
                            "label": {"type": "string"},
                            "description": {"type": "string"},
                            "pros": {"type": "array", "items": {"type": "string"}},
                            "cons": {"type": "array", "items": {"type": "string"}},
                            "evidence_supporting": {"type": "array", "items": {"type": "string"}},
                            "risks": {"type": "array", "items": {"type": "string"}},
                            "estimated_impact": {"type": "string"},
                        },
                        "required": [
                            "option_id",
                            "label",
                            "description",
                            "pros",
                            "cons",
                            "evidence_supporting",
                            "risks",
                            "estimated_impact",
                        ],
                    },
                },
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "option_id": {"type": "string"},
                            "label": {"type": "string"},
                            "outcome": {"type": "string"},
                        },
                        "required": ["option_id", "label", "outcome"],
                    },
                },
                "draft_resolution_agreement": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "terms": {"type": "array", "items": {"type": "string"}},
                        "signature_block": {"type": "string"},
                        "human_approval_required": {"type": "string"},
                    },
                    "required": ["title", "terms", "signature_block", "human_approval_required"],
                },
            },
            "required": [
                "qualification_assessment",
                "overview",
                "recommendation",
                "contractor_solution_review",
                "contractor_response_draft",
                "courses_of_action",
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
                        prompt["user_json"],
                        ensure_ascii=False,
                        cls=DjangoJSONEncoder,
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

    payload = _neutralize_legal_language(payload)
    payload["_artifact_type"] = "recommendation"
    payload["_model"] = model

    cache.set(key, payload, timeout=_get_cache_ttl_seconds())

    return AIRecommendationResult(
        artifact_type="recommendation",
        payload=payload,
        model=model,
        cached=False,
    )
