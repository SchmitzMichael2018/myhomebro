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
        "patterns": [r"\binground pool\b", r"\bin-?ground pool\b", r"\bpool house\b", r"\bpool installation\b"],
        "project_type": "Pool",
        "project_subtype": "Inground Pool and Pool House",
        "project_title": "Inground Pool and Pool House",
        "summary": "Work includes installing or building the inground pool and pool house described by the customer, including excavation, structural work, mechanical systems, finishes, and cleanup as applicable.",
    },
    {
        "patterns": [r"\bfinish(?:ing|ed)? basement\b", r"\bbasement finishing\b", r"\bbasement remodel\b", r"\bbasement\b"],
        "project_type": "Remodel",
        "project_subtype": "Basement",
        "project_title": "Basement Finishing",
        "summary": "Work includes finishing the basement space described by the customer, including preparation, framing or layout changes, insulation, drywall, flooring, trim, and cleanup as applicable.",
    },
    {
        "patterns": [r"\bhome theater\b", r"\bmedia room\b", r"\bentertainment room\b", r"\bprojector\b", r"\bspeaker\b", r"\bsound system\b"],
        "project_type": "Remodel",
        "project_subtype": "Home Theater / Media Room",
        "project_title": "Home Theater Installation",
        "summary": "Work includes building the media room or home theater described by the customer, including framing, drywall, electrical, lighting zones, AV equipment, and finish work as applicable.",
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


def _format_scope_as_bullets(value: Any) -> str:
    raw = str(value or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""
    has_bullets = bool(re.search(r"(?m)^\s*[-*]\s+\S", raw))
    has_numbered = bool(re.search(r"(?m)^\s*\d+[.)]\s+\S", raw))
    if has_bullets and not has_numbered:
        return raw

    normalized = re.sub(r"(?m)^\s*\d+[.)]\s+", "", raw)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    sentences = [
        re.sub(r"[.!?]+$", "", part).strip()
        for part in re.split(r"(?<=[.!?])\s+", normalized)
        if part.strip()
    ]
    if len(sentences) < 2 and not has_numbered and "," not in normalized:
        return raw

    included: list[str] = []
    exclusions: list[str] = []
    customer: list[str] = []
    for sentence in sentences:
        item = re.sub(r"^(scope of work|work includes|included work|includes)\s*[:,-]?\s*", "", sentence, flags=re.I).strip()
        if not item:
            continue
        if re.search(r"\b(not included|excluded|exclusions?|unless specified|unless added)\b", item, flags=re.I):
            exclusions.append(re.sub(r"^not included unless specified\s*[:,-]?\s*", "", item, flags=re.I).strip())
        elif re.search(r"\bcustomer\b", item, flags=re.I) and re.search(r"\b(provide|confirm|responsib|select|approve|access)\b", item, flags=re.I):
            customer.append(item)
        else:
            included.append(item)

    defaults = [
        "Verify site conditions, measurements, access, and material requirements before work begins",
        "Coordinate agreed labor, materials, installation activities, and job sequencing",
        "Protect adjacent areas affected by the work and maintain a reasonably clean work area",
        "Complete the described installation, repair, replacement, or removal work for the project area",
        "Perform final cleanup and review completed work with the customer",
    ]
    for item in defaults:
        if len(included) >= 5:
            break
        if item.lower() not in {existing.lower() for existing in included}:
            included.append(item)

    max_bullets = 12
    capped_included = included[: max(5, max_bullets - len(exclusions) - len(customer))]
    capped_exclusions = exclusions[: max(0, max_bullets - len(capped_included) - len(customer))]
    capped_customer = customer[: max(0, max_bullets - len(capped_included) - len(capped_exclusions))]

    lines = ["Included Work", *[f"- {item}" for item in capped_included]]
    if capped_exclusions:
        lines.extend(["", "Exclusions", *[f"- {item}" for item in capped_exclusions]])
    if capped_customer:
        lines.extend(["", "Customer Responsibilities", *[f"- {item}" for item in capped_customer]])
    return "\n".join(lines).strip()


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

    fallback_description = _format_scope_as_bullets(
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
        "- Always return bullet lists, not paragraph prose.\n"
        "- Use section headings exactly as needed: Included Work, Exclusions, Customer Responsibilities.\n"
        "- Return 5 to 12 total bullets.\n"
        "- Use one work item per bullet.\n"
        "- Put exclusions in separate bullets under Exclusions.\n"
        "- Do not use numbered lists.\n"
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

    desc = _format_scope_as_bullets((payload.get("description") or "").strip())
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
