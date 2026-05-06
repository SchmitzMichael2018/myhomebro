# backend/projects/ai/agreement_description_writer.py
# v2026-01-22 — AI Description Writer for Agreement Step 1 (generate/improve)

from __future__ import annotations

import json
import logging
import re
from typing import Dict, Any

from django.conf import settings

logger = logging.getLogger(__name__)


_FALLBACK_HINTS = [
    {
        "patterns": [r"\breplace siding\b", r"\bsiding replacement\b", r"\bsiding\b"],
        "project_type": "Siding",
        "project_subtype": "Siding Replacement",
        "project_title": "Siding Replacement",
        "summary": "Work includes removal and replacement of exterior siding on the areas identified in the project description.",
    },
    {
        "patterns": [r"\bfinish(?:ing|ed)? basement\b", r"\bbasement finishing\b", r"\bbasement remodel\b", r"\bbasement\b"],
        "project_type": "Remodel",
        "project_subtype": "Basement",
        "project_title": "Basement Finishing",
        "summary": "Work includes finishing the basement space described by the customer, including preparation, framing or layout changes, insulation, drywall, flooring, trim, and cleanup as applicable.",
    },
    {
        "patterns": [r"\bwet bar\b", r"\bbar cabinet\b", r"\bbar countertop\b", r"\bbar sink\b", r"\bcabinetry\b.*\bcountertop\b"],
        "project_type": "Remodel",
        "project_subtype": "Wet Bar Installation",
        "project_title": "Wet Bar Installation",
        "summary": "Work includes installing or remodeling the wet bar area described by the customer, including cabinetry, countertops, sink or plumbing fixture work, lighting, and finish carpentry as applicable.",
    },
    {
        "patterns": [r"\bpaint bedroom\b", r"\bbedroom paint\b", r"\binterior paint\b", r"\bpainting\b"],
        "project_type": "Painting",
        "project_subtype": "Interior Painting",
        "project_title": "Interior Painting",
        "summary": "Work includes interior painting for the areas described by the customer.",
    },
    {
        "patterns": [r"\bfix leaking faucet\b", r"\bfaucet repair\b", r"\bfaucet\b"],
        "project_type": "Plumbing",
        "project_subtype": "Faucet Repair",
        "project_title": "Faucet Repair",
        "summary": "Work includes repairing or replacing the leaking faucet and confirming the fixture connections before closeout.",
    },
    {
        "patterns": [r"\binstall tile\b", r"\btile installation\b", r"\btile\b"],
        "project_type": "Tile",
        "project_subtype": "Tile Installation",
        "project_title": "Tile Installation",
        "summary": "Work includes tile installation in the areas described by the customer.",
    },
    {
        "patterns": [r"\breplace roof\b", r"\broof replacement\b", r"\broofing\b", r"\broof\b"],
        "project_type": "Roofing",
        "project_subtype": "Roof Replacement",
        "project_title": "Roof Replacement",
        "summary": "Work includes roof replacement or roof repair work for the structure described in the project details.",
    },
    {
        "patterns": [r"\bremodel bathroom\b", r"\bbathroom remodel\b", r"\bbathroom\b"],
        "project_type": "Bathroom Remodeling",
        "project_subtype": "Bathroom Remodel",
        "project_title": "Bathroom Remodel",
        "summary": "Work includes bathroom remodeling for the spaces identified in the project description.",
    },
    {
        "patterns": [r"\binstall fence\b", r"\bfence installation\b", r"\bfence\b"],
        "project_type": "Fencing",
        "project_subtype": "Fence Installation",
        "project_title": "Fence Installation",
        "summary": "Work includes fence installation for the property area described by the customer.",
    },
    {
        "patterns": [r"\brepair drywall\b", r"\bdrywall repair\b", r"\bdrywall\b"],
        "project_type": "Drywall",
        "project_subtype": "Drywall Repair",
        "project_title": "Drywall Repair",
        "summary": "Work includes drywall repair and finishing in the affected areas described by the customer.",
    },
]


def _safe_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _fallback_from_context(*, project_title: str, project_type: str, project_subtype: str, current_description: str) -> Dict[str, Any]:
    haystack = " ".join(
        part for part in [_safe_text(project_title), _safe_text(project_type), _safe_text(project_subtype), _safe_text(current_description)] if part
    ).lower()

    matched = None
    for hint in _FALLBACK_HINTS:
        if any(re.search(pattern, haystack) for pattern in hint["patterns"]):
            matched = hint
            break

    inferred_type = matched["project_type"] if matched else (_safe_text(project_type) or "General Contracting")
    inferred_subtype = matched["project_subtype"] if matched else (_safe_text(project_subtype) or "General Project")
    inferred_title = matched["project_title"] if matched else (_safe_text(project_title) or inferred_subtype or "Project Starting Point")
    summary = matched["summary"] if matched else "Work includes the project described by the customer."

    fallback_description = (
        f"{summary} Contractor will verify measurements, site conditions, material selections, and access before work begins. "
        "Not included unless specified: hidden condition repairs, engineering, permits, utility relocation, or specialty upgrades."
    )

    return {
        "description": fallback_description,
        "project_title": inferred_title,
        "project_type": inferred_type,
        "project_subtype": inferred_subtype,
        "recommendation_source": "fallback",
        "confidence": "fallback",
        "confidence_label": "Recommended from your description",
        "next_step_guidance": "Review the recommended starting point, then keep editing before you continue.",
        "reason": "Recommended from your description.",
        "_model": "fallback",
    }


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

    if not any((_safe_text(project_title), _safe_text(project_type), _safe_text(project_subtype), _safe_text(current_description))):
        raise RuntimeError("Please enter a description before using AI.")

    model = _model_name()

    try:
        client = _require_openai_client()
    except Exception as exc:
        logger.warning("OpenAI unavailable for agreement description writer; using fallback: %s", exc)
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

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
        logger.warning("OpenAI call failed for agreement description writer; using fallback.", exc_info=True)
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    raw = getattr(resp, "output_text", "") or ""
    try:
        payload = json.loads(raw)
    except Exception:
        logger.warning("AI description returned invalid JSON; using fallback.")
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    desc = (payload.get("description") or "").strip()
    if not desc:
        logger.warning("AI returned an empty description; using fallback.")
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    return {"description": desc, "_model": model, "_mode": mode, "recommendation_source": "ai"}
