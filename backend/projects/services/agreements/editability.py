# backend/projects/services/agreements/editability.py
from __future__ import annotations

from typing import Set, Dict, Any

from django.utils.timezone import now
from rest_framework.exceptions import ValidationError

from projects.models import Agreement

RETENTION_YEARS = 3  # keep consistent with legacy usage

ALWAYS_OK_FIELDS: Set[str] = {
    "reviewed",
    "reviewed_at",
    "reviewed_by",
    "pdf_archived",
    "is_archived",
}

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


def is_fully_signed(ag: Agreement) -> bool:
    return bool(
        getattr(ag, "signed_by_contractor", False)
        and getattr(ag, "signed_by_homeowner", False)
    )


def fully_signed_at(ag: Agreement):
    ch = getattr(ag, "signed_at_contractor", None)
    hh = getattr(ag, "signed_at_homeowner", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return ch or hh


def enforce_editability(request, instance: Agreement, data: Dict[str, Any]) -> None:
    """Blocks edits to fully-signed agreements for non-staff users."""
    u = getattr(request, "user", None)
    if u and (getattr(u, "is_staff", False) or getattr(u, "is_superuser", False)):
        return
    if not is_fully_signed(instance):
        return

    changed = changed_fields(instance, data)
    illegal = {f for f in changed if f not in ALWAYS_OK_FIELDS and f in (DRAFT_ONLY_FIELDS | changed)}
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
    """Normalizes common payload fields (empty strings -> None) and strips server-owned fields."""
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

    return data
