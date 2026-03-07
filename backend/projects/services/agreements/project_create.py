# backend/projects/services/agreements/project_create.py
from __future__ import annotations

from typing import Dict, Any, Optional, Tuple

from django.shortcuts import get_object_or_404

from projects.models import Project, Homeowner, Contractor


def resolve_contractor_for_user(user) -> Optional[Contractor]:
    contractor = getattr(user, "contractor", None)
    if contractor is None:
        contractor = getattr(user, "contractor_profile", None)
    if contractor is None:
        contractor = Contractor.objects.filter(user=user).first()
    return contractor


def _coalesce_owner_id(data: Dict[str, Any]) -> Optional[int]:
    """
    Backward-compatible resolver for the project "owner" concept.

    Historically the API used: homeowner
    UI now uses: customer/client

    Supported keys (first match wins):
      - homeowner, homeowner_id
      - customer, customer_id
      - client, client_id

    Values supported:
      - int / numeric string
      - dict with {"id": ...} (defensive)
    """
    keys = ("homeowner", "homeowner_id", "customer", "customer_id", "client", "client_id")
    for key in keys:
        val = data.get(key)
        if val is None or val == "":
            continue

        # If FE accidentally sends an object, allow {id: 123}
        if isinstance(val, dict):
            val = val.get("id")

        if val is None or val == "":
            continue

        try:
            return int(val)
        except Exception:
            continue

    return None


def ensure_project_for_agreement_payload(
    *,
    payload: Dict[str, Any],
    contractor: Optional[Contractor],
) -> Tuple[Dict[str, Any], Optional[Project]]:
    """Ensure payload contains a project id; create Project if missing.

    Returns (payload, created_project_or_none).
    """
    data = payload.copy()

    if data.get("description") is None:
        data["description"] = ""
    if data.get("description", "") is None:
        data["description"] = ""

    project_id = data.get("project")
    if project_id:
        data.pop("project_title", None)
        return data, None

    # ✅ Accept homeowner/customer/client without changing existing model logic
    homeowner_id = _coalesce_owner_id(data)
    if not homeowner_id:
        # Keep user-facing language aligned with UI (Customer), but functionally identical
        raise ValueError("Customer is required to create a project.")

    homeowner = get_object_or_404(Homeowner, pk=homeowner_id)

    project_title = data.get("project_title") or data.get("title") or "Untitled Project"
    project_description = data.get("description") or ""

    project = Project.objects.create(
        title=project_title,
        contractor=contractor if contractor is not None else None,
        homeowner=homeowner,
        description=project_description,
    )

    data["project"] = project.pk
    data.pop("project_title", None)

    return data, project
