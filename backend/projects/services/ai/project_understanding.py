from __future__ import annotations

import re
from typing import Any

from projects.ai.agreement_description_writer import _fallback_from_context, generate_or_improve_description
from projects.models import Contractor
from projects.services.ai.project_classifier import build_project_taxonomy_snapshot, classify_project_from_scope


def _safe_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _plain_description_fallback(description: str) -> str:
    text = _safe_text(description)
    text = re.sub(r"^(i|we)?\s*need\s+to\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(i|we)\s+want\s+to\s+", "", text, flags=re.IGNORECASE)
    if not text:
        return ""
    return text[:1].upper() + text[1:].rstrip(".") + "."


def _infer_urgency(description: str, fallback: str = "") -> str:
    text = description.lower()
    if any(term in text for term in ["emergency", "flooding", "active leak", "no heat", "sparking", "gas smell"]):
        return "emergency"
    if any(term in text for term in ["urgent", "asap", "as soon as possible", "not cooling", "no hot water", "leaking"]):
        return "urgent"
    if any(term in text for term in ["soon", "before summer", "before winter", "this week"]):
        return "soon"
    return fallback or "normal"


def _clarifying_questions(description: str, project_type: str, project_subtype: str) -> list[str]:
    text = description.lower()
    questions: list[str] = []
    if len(description.strip()) < 50:
        questions.append("Which room, area, system, or appliance needs attention?")
    if project_type == "Appliance Repair":
        questions.append("What brand/model is the appliance, and when did the issue start?")
    if project_type == "HVAC":
        questions.append("Is the issue affecting heating, cooling, airflow, or unusual noise?")
    if project_type == "Roofing":
        questions.append("Where is the leak visible, and when does it happen?")
    if project_type == "Plumbing" and "water heater" in project_subtype.lower():
        questions.append("Is the water heater leaking, failing to heat, or showing an error/pilot issue?")
    if "leak" in text and project_type not in {"Roofing", "Plumbing"}:
        questions.append("Do you know the source of the leak, or only where damage is visible?")
    return questions[:3]


def _document_suggestions(description: str, project_type: str, project_subtype: str) -> list[str]:
    text = f"{description} {project_type} {project_subtype}".lower()
    suggestions = ["Photos of the affected area"]
    if "appliance" in project_type.lower() or any(term in text for term in ["dryer", "refrigerator", "washer", "dishwasher"]):
        suggestions.append("Photo of the appliance model/serial label")
        suggestions.append("Recent service records or warranty information")
    elif project_type == "HVAC":
        suggestions.append("Photo of the equipment label or thermostat/error message")
        suggestions.append("Recent service records or filter information")
    elif project_type == "Roofing":
        suggestions.append("Photos of interior water stains and exterior roof area if safely available")
    elif project_type == "Plumbing":
        suggestions.append("Photos of visible leaks, fixtures, valves, or equipment labels")
    elif "damage" in text:
        suggestions.append("Photos showing the damage and when it appeared")
    return suggestions[:4]


def understand_project_request(
    *,
    description: str,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    mode: str = "improve",
    urgency: str = "",
    contractor: Contractor | None = None,
    taxonomy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a shared advisory understanding result for intake/request flows.

    The plain-language description is intentionally the strongest signal. Existing
    structured values are passed as context, but the classifier can override them
    when the description clearly points elsewhere.
    """

    clean_description = _safe_text(description)
    clean_title = _safe_text(project_title)
    clean_type = _safe_text(project_type)
    clean_subtype = _safe_text(project_subtype)
    taxonomy = taxonomy or build_project_taxonomy_snapshot(contractor=contractor)

    classification = classify_project_from_scope(
        description=clean_description,
        scope=clean_description,
        taxonomy=taxonomy,
        current_values={
            "project_title": clean_title,
            "project_type": clean_type,
            "project_subtype": clean_subtype,
        },
        contractor=contractor,
    )

    final_title = _safe_text(classification.get("project_title")) or clean_title
    final_type = _safe_text(classification.get("project_type")) or clean_type
    final_subtype = _safe_text(classification.get("project_subtype")) or clean_subtype

    try:
        written = generate_or_improve_description(
            mode=mode,
            project_title=final_title,
            project_type=final_type,
            project_subtype=final_subtype,
            current_description=clean_description,
        )
        source = "ai"
    except Exception:
        written = _fallback_from_context(
            project_title=final_title,
            project_type=final_type,
            project_subtype=final_subtype,
            current_description=clean_description,
        )
        source = "fallback"

    improved_description = _safe_text(written.get("description")) or clean_description
    if (
        source == "fallback"
        and clean_description
        and "project described by the customer" in improved_description.lower()
    ):
        improved_description = _plain_description_fallback(clean_description)
    written_title = _safe_text(written.get("project_title"))
    written_type = _safe_text(written.get("project_type"))
    written_subtype = _safe_text(written.get("project_subtype"))
    classification_confidence = _safe_text(classification.get("confidence")).lower()
    generic_type = final_type.lower() in {"installation", "repair", "maintenance", "general", "project"}
    use_writer_structure = bool(written_type or written_subtype) and (
        classification_confidence not in {"high", "medium"} or generic_type
    )
    output_title = written_title or final_title or "Project request"
    output_type = written_type if use_writer_structure and written_type else final_type
    output_subtype = written_subtype if use_writer_structure and written_subtype else final_subtype

    return {
        "suggested_title": output_title,
        "project_title": output_title,
        "project_type": output_type,
        "project_subtype": output_subtype,
        "urgency": _infer_urgency(clean_description, urgency),
        "improved_description": improved_description,
        "description": improved_description,
        "scope": improved_description,
        "clarifying_questions": _clarifying_questions(clean_description, final_type, final_subtype),
        "suggested_documents_or_photos": _document_suggestions(clean_description, final_type, final_subtype),
        "confidence": classification.get("confidence") or written.get("confidence") or "low",
        "confidence_label": classification.get("confidence_label") or written.get("confidence_label") or "",
        "reason": classification.get("reason") or written.get("reason") or "",
        "warnings": [] if classification.get("confidence") in {"high", "medium"} else ["Review the suggested type and subtype before applying."],
        "classification": classification,
        "recommendation_source": written.get("recommendation_source") or source,
        "source": source,
    }
