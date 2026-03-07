# backend/projects/services/agreements/editability.py
from __future__ import annotations

from typing import Set, Dict, Any

from rest_framework.exceptions import ValidationError

from projects.models import Agreement

RETENTION_YEARS = 3  # keep consistent with legacy usage

# Fields that are always OK even after signing/locking
ALWAYS_OK_FIELDS: Set[str] = {
    "reviewed",
    "reviewed_at",
    "reviewed_by",
    "pdf_archived",
    "is_archived",
}

# Fields intended to be editable only while not locked
DRAFT_ONLY_FIELDS: Set[str] = {
    "project_type",
    "project_subtype",
    "standardized_category",
    "description",
    "warranty_type",
    "warranty_text_snapshot",
    "total_cost",
    "total_time_estimate",
    "milestone_count",
    "start",
    "end",
    "terms_text",
    "privacy_text",
    "contractor",
    "homeowner",
}

# Signature requirement toggles (waivers) — editable until customer signs
SIGNATURE_REQUIREMENT_FIELDS: Set[str] = {
    "require_contractor_signature",
    "require_customer_signature",
}


def changed_fields(instance: Agreement, data: Dict[str, Any]) -> Set[str]:
    changed: Set[str] = set()
    for k, v in data.items():
        if not hasattr(instance, k):
            continue
        try:
            cur = getattr(instance, k)
            if (cur is None and v not in (None, "")) or (cur is not None and str(cur) != str(v)):
                changed.add(k)
        except Exception:
            changed.add(k)
    return changed


# ---------------------------------------------------------------------
# Backwards-compatible exports (permissions.py imports these)
# ---------------------------------------------------------------------
def is_fully_signed(ag: Agreement) -> bool:
    """
    Backwards-compatible name.
    Prefer waiver/policy-aware property if available.
    """
    try:
        v = getattr(ag, "signature_is_satisfied", None)
        if isinstance(v, bool):
            return v
    except Exception:
        pass
    return bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))


def fully_signed_at(ag: Agreement):
    """
    Backwards-compatible name.
    Return latest of contractor/homeowner signed timestamps when present.
    """
    ch = getattr(ag, "signed_at_contractor", None) or getattr(ag, "contractor_signed_at", None)
    hh = getattr(ag, "signed_at_homeowner", None) or getattr(ag, "homeowner_signed_at", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return ch or hh


def is_customer_signed(ag: Agreement) -> bool:
    return bool(getattr(ag, "signed_by_homeowner", False))


def enforce_editability(request, instance: Agreement, data: Dict[str, Any]) -> None:
    """
    Blocks edits to locked agreements for non-staff users.

    Locking uses is_fully_signed() (waiver/policy aware now).
    Waiver toggles remain editable ONLY until the customer signs.
    """
    u = getattr(request, "user", None)
    if u and (getattr(u, "is_staff", False) or getattr(u, "is_superuser", False)):
        return

    if not is_fully_signed(instance):
        return

    changed = changed_fields(instance, data)

    # Allow waiver toggles only until customer signs
    if changed & SIGNATURE_REQUIREMENT_FIELDS:
        if is_customer_signed(instance):
            raise ValidationError(
                {
                    "detail": "Signature requirements are locked after the customer signs.",
                    "blocked_fields": sorted(list(changed & SIGNATURE_REQUIREMENT_FIELDS)),
                    "signed_by_contractor": getattr(instance, "signed_by_contractor", False),
                    "signed_by_homeowner": getattr(instance, "signed_by_homeowner", False),
                }
            )
        # else: allow these fields through, but still block other illegal changes

    # Block other changed fields when locked (except ALWAYS_OK_FIELDS)
    illegal = {f for f in changed if f not in ALWAYS_OK_FIELDS and f not in SIGNATURE_REQUIREMENT_FIELDS}
    if illegal:
        raise ValidationError(
            {
                "detail": "Agreement is fully signed and locked. Create an amendment to change details.",
                "blocked_fields": sorted(illegal),
                "signed_by_contractor": getattr(instance, "signed_by_contractor", False),
                "signed_by_homeowner": getattr(instance, "signed_by_homeowner", False),
            }
        )


def prepare_payload(request) -> Dict[str, Any]:
    """
    Normalizes common payload fields (empty strings -> None) and strips server-owned fields.
    Keeps require_* fields intact so Step 4 waiver toggles persist.
    """
    data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
    data.pop("status", None)

    for k in ("description", "terms_text", "privacy_text", "project_subtype", "standardized_category"):
        if k in data and data[k] == "":
            data[k] = None

    for k in ("start", "end", "total_time_estimate"):
        if k in data and data[k] == "":
            data[k] = None

    if "total_cost" in data and data["total_cost"] == "":
        data["total_cost"] = None

    if "milestone_count" in data and data["milestone_count"] == "":
        data["milestone_count"] = None

    # Normalize require_* booleans if present as strings
    for k in ("require_contractor_signature", "require_customer_signature"):
        if k in data:
            raw = data.get(k)
            if raw in (True, False):
                continue
            if raw in ("true", "True", "1", 1, "yes", "Yes", "on", "ON"):
                data[k] = True
            elif raw in ("false", "False", "0", 0, "no", "No", "off", "OFF"):
                data[k] = False

    return data