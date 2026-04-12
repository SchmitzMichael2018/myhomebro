# backend/projects/services/agreements/create.py
from __future__ import annotations

from typing import Any, Dict

from projects.models import Agreement


NON_MODEL_FIELDS = {
    # generic aliases
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "zip",
    "zip_code",

    # project-prefixed aliases
    "project_address_line1",
    "project_address_line2",
    "project_address_city",
    "project_address_state",
    "project_postal_code",

    # UI-only helpers
    "project_address_same_as_homeowner",
    "use_default_warranty",
    "custom_warranty_text",
    "project_title",
    "title",

    # AI scope / serializer-only fields
    "ai_scope",
    "ai_scope_input",
    "scope_clarifications",
    "scope_text",
    "questions",
    "answers",
}


def strip_non_model_fields(validated: Dict[str, Any]) -> Dict[str, Any]:
    """Remove serializer/UI fields that are NOT Agreement model fields."""
    data = dict(validated)
    for k in NON_MODEL_FIELDS:
        data.pop(k, None)
    return data


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _hydrate_project_title_from_payload(agreement: Agreement, validated: Dict[str, Any]) -> None:
    """
    Project title is usually owned by the related Project model, not Agreement.
    Preserve early Step 1 values such as project_title/title when a draft is created.
    """
    project = getattr(agreement, "project", None)
    if project is None:
        return

    requested_title = (
        _safe_str(validated.get("project_title"))
        or _safe_str(validated.get("title"))
    )
    if not requested_title:
        return

    current_title = _safe_str(getattr(project, "title", ""))
    if current_title == requested_title:
        return

    if not current_title or current_title.lower() in {
        "untitled project",
        "new project",
        "draft agreement",
    }:
        project.title = requested_title
        project.save(update_fields=["title"])


def create_agreement_from_validated(validated: Dict[str, Any]) -> Agreement:
    """Create an Agreement safely from validated data.

    - Strips non-model / UI-only fields
    - Creates Agreement
    - Resets signature-related fields to a clean draft state
    - Preserves early draft title flow by hydrating related Project.title
    """
    original = dict(validated)
    data = strip_non_model_fields(validated)

    # Draft-friendly safety: allow empty description during early Step 1 flow.
    if data.get("description", None) is None:
        data["description"] = ""
    if not _safe_str(data.get("project_class")):
        data["project_class"] = "residential"

    ag = Agreement.objects.create(**data)

    # Reset signing state (draft)
    if hasattr(ag, "signed_by_contractor"):
        ag.signed_by_contractor = False
    if hasattr(ag, "signed_by_homeowner"):
        ag.signed_by_homeowner = False

    if hasattr(ag, "contractor_signature"):
        ag.contractor_signature = None
    if hasattr(ag, "homeowner_signature"):
        ag.homeowner_signature = None

    if hasattr(ag, "contractor_signature_name"):
        ag.contractor_signature_name = ""
    if hasattr(ag, "homeowner_signature_name"):
        ag.homeowner_signature_name = ""

    if hasattr(ag, "signed_at_contractor"):
        ag.signed_at_contractor = None
    if hasattr(ag, "signed_at_homeowner"):
        ag.signed_at_homeowner = None

    if hasattr(ag, "contractor_signed_at"):
        ag.contractor_signed_at = None
    if hasattr(ag, "homeowner_signed_at"):
        ag.homeowner_signed_at = None

    if hasattr(ag, "contractor_signed_ip"):
        ag.contractor_signed_ip = None
    if hasattr(ag, "homeowner_signed_ip"):
        ag.homeowner_signed_ip = None

    ag.save()

    _hydrate_project_title_from_payload(ag, original)

    return ag
