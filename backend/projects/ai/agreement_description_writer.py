# backend/projects/ai/agreement_description_writer.py
# v2026-01-22 — AI Description Writer for Agreement Step 1 (generate/improve)

from __future__ import annotations

import json
import logging
import re
from typing import Dict, Any

from django.conf import settings

logger = logging.getLogger(__name__)


def _milestone_completion_fallback(*, milestone_title: str, current_description: str) -> str:
    title = _safe_text(milestone_title) or "Milestone"
    current = str(current_description or "").strip()
    if current and _safe_text(current).lower() != title.lower():
        return current
    return (
        f"- The {title.lower()} work described for this milestone is complete.\n"
        "- The work area is cleared and ready for customer review and the next scheduled phase."
    )


def improve_milestone_completion_description(
    *,
    milestone_title: str,
    current_description: str,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    agreement_scope: str = "",
) -> Dict[str, Any]:
    """Improve one milestone's acceptance criteria without rewriting agreement scope."""
    title = _safe_text(milestone_title)
    current = str(current_description or "").strip()
    if not title:
        raise RuntimeError("Milestone title is required.")

    fallback = _milestone_completion_fallback(
        milestone_title=title,
        current_description=current,
    )
    try:
        client = _require_openai_client()
    except Exception as exc:
        logger.warning("OpenAI unavailable for milestone completion writer; using fallback: %s", exc)
        return {"description": fallback, "_model": "fallback", "_mode": "improve"}

    system = (
        "You improve the completion criteria for exactly one construction payment milestone.\n"
        "Return only 1 to 3 short bullet lines describing visible, reviewable results for this milestone.\n"
        "Do not rewrite the agreement scope, mention other milestones, add prices or dates, or output section headings.\n"
        "Do not invent brands, dimensions, quantities, permits, code requirements, or customer responsibilities.\n"
        "Use the agreement scope only as factual context. Include only facts relevant to the selected milestone."
    )
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"description": {"type": "string"}},
        "required": ["description"],
    }
    try:
        response = client.responses.create(
            model=_model_name(),
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({
                    "project_title": _safe_text(project_title),
                    "project_type": _safe_text(project_type),
                    "project_subtype": _safe_text(project_subtype),
                    "milestone_title": title,
                    "current_completion_criteria": current,
                    "agreement_scope_context": str(agreement_scope or "").strip(),
                }, ensure_ascii=False)},
            ],
            text={"format": {
                "type": "json_schema",
                "name": "milestone_completion_description",
                "schema": schema,
                "strict": True,
            }},
        )
        payload = json.loads(getattr(response, "output_text", "") or "{}")
        description = str(payload.get("description") or "").strip()
        lines = [line.strip() for line in description.splitlines() if line.strip()]
        cleaned_lines = []
        for line in lines[:3]:
            normalized = re.sub(r"^(?:[-*]|[•‣▪])\s*", "", line).strip()
            if normalized:
                cleaned_lines.append(f"- {normalized}")
        cleaned = "\n".join(cleaned_lines)
        if not cleaned:
            raise ValueError("Empty milestone completion description")
        return {"description": cleaned, "_model": _model_name(), "_mode": "improve"}
    except Exception:
        logger.warning("Milestone completion AI call failed; using fallback.", exc_info=True)
        return {"description": fallback, "_model": "fallback", "_mode": "improve"}


_FALLBACK_HINTS = [
    {
        "patterns": [r"\bdryer\b.*\b(noise|noises|loud|rattle|grind|squeal|repair|service)\b", r"\b(noise|noises|loud|rattle|grind|squeal)\b.*\bdryer\b"],
        "project_type": "Appliance Repair",
        "project_subtype": "Dryer Repair",
        "project_title": "Dryer Repair",
        "summary": "Work includes diagnosing and repairing the dryer issue described by the customer, including checking accessible appliance components, venting concerns, and operating condition as applicable.",
    },
    {
        "patterns": [r"\b(refrigerator|fridge|freezer)\b.*\b(not cooling|warm|repair|service|not working)\b", r"\bnot cooling\b.*\b(refrigerator|fridge|freezer)\b"],
        "project_type": "Appliance Repair",
        "project_subtype": "Refrigerator Repair",
        "project_title": "Refrigerator Repair",
        "summary": "Work includes diagnosing and repairing the refrigerator cooling issue described by the customer, including checking accessible appliance components and operating condition as applicable.",
    },
    {
        "patterns": [r"\b(hvac|air conditioner|ac unit|a/c|furnace|heat pump|mini-?split)\b.*\b(noise|loud|rattle|buzz|not cooling|not heating|repair|service)\b"],
        "project_type": "HVAC",
        "project_subtype": "HVAC Repair",
        "project_title": "HVAC Repair",
        "summary": "Work includes diagnosing and servicing the HVAC issue described by the customer, including checking accessible equipment operation, airflow, noise concerns, and recommended follow-up repairs.",
    },
    {
        "patterns": [r"\b(toilet leaking|leaking toilet|toilet leak|toilet is leaking)\b"],
        "project_type": "Plumbing",
        "project_subtype": "Plumbing Repair",
        "project_title": "Toilet Leak Repair",
        "summary": "Work includes diagnosing and repairing the toilet leak described by the customer, including checking accessible fixture connections, seals, and related plumbing components.",
    },
    {
        "patterns": [r"\b(roof leak|leaking roof|roof is leaking|water coming through roof)\b"],
        "project_type": "Roofing",
        "project_subtype": "Repair",
        "project_title": "Roof Leak Repair",
        "summary": "Work includes diagnosing and repairing the roof leak described by the customer, including checking accessible roofing, flashing, and leak source areas.",
    },
    {
        "patterns": [r"\b(install new gutters|new gutters|gutters and downspouts|gutter installation|downspout installation)\b"],
        "project_type": "Gutters",
        "project_subtype": "Gutter Installation",
        "project_title": "Gutter Installation",
        "summary": "Work includes installing the gutters and downspouts described by the customer, including confirming roofline measurements, drainage locations, hangers, outlets, and cleanup.",
    },
    {
        "patterns": [r"\b(ceiling water damage|water damage on ceiling|ceiling has water damage|ceiling leak damage)\b"],
        "project_type": "Drywall",
        "project_subtype": "Drywall Repair",
        "project_title": "Ceiling Drywall Repair",
        "summary": "Work includes repairing the ceiling water damage described by the customer after the leak source is addressed, including damaged drywall or finish repair and cleanup as applicable.",
    },
    {
        "patterns": [r"\b(water heater|hot water heater|tankless water heater)\b.*\b(no hot water|not producing hot water|not heating|cold water|repair|service|leak|leaking)\b"],
        "project_type": "Plumbing",
        "project_subtype": "Water Heater Replacement",
        "project_title": "Water Heater Service",
        "summary": "Work includes diagnosing the water heater hot water issue described by the customer, including checking accessible plumbing connections, heater operation, and whether repair or replacement is appropriate.",
    },
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


def _sanitize_improved_scope(value: Any, *, source_facts: Any = "") -> str:
    """Reject commercial/schedule prose even when a provider ignores the prompt."""
    prohibited_heading = re.compile(
        r"^(estimate pricing|pricing|requested timing|schedule|payment(?: information| timing| terms)?|incidentals reserve|total funding)\s*:?​?$",
        re.IGNORECASE,
    )
    heading = re.compile(r"^[A-Za-z][A-Za-z /&-]{2,60}:?$")
    prohibited_line = re.compile(
        r"(?:\$|\b(?:subtotal|unit price|incidentals reserve|total funding|payment due|payment schedule|requested start|requested completion)\b)",
        re.IGNORECASE,
    )
    kept: list[str] = []
    skipping = False
    source_text = _safe_text(source_facts).lower()
    unsupported_concepts = (
        (("hidden condition",), ("hidden condition",)),
        (("engineering",), ("engineering",)),
        (("permit",), ("permit",)),
        (("utility relocation",), ("utility relocation",)),
        (("specialty upgrade",), ("specialty upgrade",)),
        (("site access", "access requirement"), ("site access", "access requirement", "access notes")),
        (("material selection",), ("material selection",)),
        (("verify measurements",), ("measurement",)),
    )
    for raw_line in str(value or "").replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if prohibited_heading.match(line):
            skipping = True
            continue
        if skipping and heading.match(line) and not prohibited_heading.match(line):
            skipping = False
        normalized_line = line.lower()
        unsupported = any(
            any(term in normalized_line for term in output_terms)
            and not any(evidence in source_text for evidence in source_terms)
            for output_terms, source_terms in unsupported_concepts
        )
        if skipping or prohibited_line.search(line) or unsupported:
            continue
        kept.append(raw_line)
    compacted: list[str] = []
    for index, raw_line in enumerate(kept):
        line = raw_line.strip()
        if heading.match(line):
            following = next((item.strip() for item in kept[index + 1 :] if item.strip()), "")
            if not following or heading.match(following):
                continue
        compacted.append(raw_line)
    return "\n".join(compacted).strip()


def _format_scope_as_bullets(value: Any, *, add_defaults: bool = True) -> str:
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
    if add_defaults:
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
        "project_title": inferred_title,
        "project_type": inferred_type,
        "project_subtype": inferred_subtype,
        "description": fallback_description,
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
      { "project_title": "...", "project_type": "...", "project_subtype": "...", "description": "..." }
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
        if mode == "improve":
            return {
                "project_title": _safe_text(project_title),
                "project_type": _safe_text(project_type),
                "project_subtype": _safe_text(project_subtype),
                "description": _format_scope_as_bullets(current_description, add_defaults=False),
                "recommendation_source": "fallback",
                "confidence": "fallback",
                "_model": "fallback",
                "_mode": mode,
            }
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    improve_rules = (
        "For improve mode, act only as a contractual scope editor.\n"
        "- Use only facts present in the supplied scope context.\n"
        "- Organize supported work into clear work-category sections derived from the input.\n"
        "- Preserve existing exclusions, assumptions, allowances, owner responsibilities, access requirements, and existing-condition qualifications only when supplied.\n"
        "- Do not output prices, dollar amounts, quantities used only for pricing, tax, discounts, incidentals reserve, funding totals, payment terms, requested dates, or schedule timing.\n"
        "- Do not invent dimensions, quantities, brands, materials, fixtures, finishes, code requirements, dates, responsibilities, exclusions, allowances, or legal/commercial terms.\n"
        "- If a qualifier is not supported by the input, omit it.\n"
        if mode == "improve" else ""
    )
    system = (
        "You are a construction agreement draft writer.\n"
        "Create a practical first draft from the contractor's short project description.\n"
        "Rules:\n"
        "- Generate the project identity directly from the description.\n"
        "- project_title should be concise and trade-specific.\n"
        "- project_type and project_subtype should be natural trade labels, not taxonomy enum values.\n"
        "- Do not use generic labels like 'Installation Project', 'General Project', or 'Custom Project' when the trade is inferable.\n"
        "- Be specific and measurable.\n"
        "- Avoid vague phrases like 'as needed', 'minor fixes', 'etc'.\n"
        "- Include exclusions only when they are supported by the input.\n"
        "- Always return bullet lists, not paragraph prose.\n"
        "- Use section headings exactly as needed: Included Work, Exclusions, Customer Responsibilities.\n"
        "- Return 5 to 12 total bullets.\n"
        "- Use one work item per bullet.\n"
        "- Put exclusions in separate bullets under Exclusions.\n"
        "- Do not use numbered lists.\n"
        "- Do NOT provide legal advice.\n"
        + improve_rules
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
                "project_title": {"type": "string"},
                "project_type": {"type": "string"},
                "project_subtype": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["project_title", "project_type", "project_subtype", "description"],
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
        if mode == "improve":
            return {
                "project_title": _safe_text(project_title),
                "project_type": _safe_text(project_type),
                "project_subtype": _safe_text(project_subtype),
                "description": _format_scope_as_bullets(current_description, add_defaults=False),
                "recommendation_source": "fallback",
                "confidence": "fallback",
                "_model": "fallback",
                "_mode": mode,
            }
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
        if mode == "improve":
            return {
                "project_title": _safe_text(project_title),
                "project_type": _safe_text(project_type),
                "project_subtype": _safe_text(project_subtype),
                "description": _format_scope_as_bullets(current_description, add_defaults=False),
                "recommendation_source": "fallback",
                "confidence": "fallback",
                "_model": "fallback",
                "_mode": mode,
            }
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    candidate_description = (payload.get("description") or "").strip()
    if mode == "improve":
        candidate_description = _sanitize_improved_scope(
            candidate_description, source_facts=current_description
        )
    desc = _format_scope_as_bullets(candidate_description, add_defaults=mode != "improve")
    draft_title = _safe_text(payload.get("project_title"))
    draft_type = _safe_text(payload.get("project_type"))
    draft_subtype = _safe_text(payload.get("project_subtype"))
    if not desc or not any([draft_title, draft_type, draft_subtype]):
        logger.warning("AI returned an empty description; using fallback.")
        if mode == "improve":
            return {
                "project_title": _safe_text(project_title),
                "project_type": _safe_text(project_type),
                "project_subtype": _safe_text(project_subtype),
                "description": _format_scope_as_bullets(current_description, add_defaults=False),
                "recommendation_source": "fallback",
                "confidence": "fallback",
                "_model": "fallback",
                "_mode": mode,
            }
        return {
            **_fallback_from_context(
                project_title=project_title,
                project_type=project_type,
                project_subtype=project_subtype,
                current_description=current_description,
            ),
            "_mode": mode,
        }

    return {
        "project_title": draft_title,
        "project_type": draft_type,
        "project_subtype": draft_subtype,
        "description": desc,
        "_model": model,
        "_mode": mode,
        "recommendation_source": "ai",
    }
