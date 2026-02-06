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
}


def strip_non_model_fields(validated: Dict[str, Any]) -> Dict[str, Any]:
    """Remove serializer/UI fields that are NOT Agreement model fields."""
    data = dict(validated)
    for k in NON_MODEL_FIELDS:
        data.pop(k, None)
    return data


def create_agreement_from_validated(validated: Dict[str, Any]) -> Agreement:
    """Create an Agreement safely from validated data.

    - Strips non-model / UI-only fields (including address aliases)
    - Creates Agreement
    - Resets signature-related fields to a clean draft state
    """
    data = strip_non_model_fields(validated)
    ag = Agreement.objects.create(**data)

    # Reset signing state (draft)
    ag.signed_by_contractor = False
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

    if hasattr(ag, "contractor_signed_ip"):
        ag.contractor_signed_ip = None
    if hasattr(ag, "homeowner_signed_ip"):
        ag.homeowner_signed_ip = None

    ag.save()
    return ag
