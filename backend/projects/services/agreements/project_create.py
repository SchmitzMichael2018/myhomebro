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

    homeowner_id = data.get("homeowner")
    if not homeowner_id:
        raise ValueError("Homeowner is required to create a project.")

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
