from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Milestone


def _milestone_status(milestone: Milestone) -> str:
    raw = str(getattr(milestone, "status", "") or "").strip()
    if raw:
        return raw
    if getattr(milestone, "is_invoiced", False):
        return "invoiced"
    if getattr(milestone, "completed", False):
        return "completed"
    return "pending"


def _milestone_payload(milestone: Milestone) -> dict:
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None) if agreement is not None else None
    assigned = getattr(milestone, "assigned_subcontractor_invitation", None)
    user = getattr(assigned, "accepted_by_user", None) if assigned is not None else None
    display_name = ""
    if user is not None:
        display_name = getattr(user, "get_full_name", lambda: "")() or ""
    display_name = display_name or getattr(assigned, "invite_name", "") or getattr(assigned, "invite_email", "") or ""

    return {
        "id": milestone.id,
        "title": getattr(milestone, "title", "") or "",
        "description": getattr(milestone, "description", "") or "",
        "status": _milestone_status(milestone),
        "start_date": getattr(milestone, "start_date", None),
        "completion_date": getattr(milestone, "completion_date", None),
        "completed": bool(getattr(milestone, "completed", False)),
        "completed_at": getattr(milestone, "completed_at", None),
        "is_invoiced": bool(getattr(milestone, "is_invoiced", False)),
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}".strip(),
        "project_title": getattr(project, "title", "") or "",
        "assigned_subcontractor": {
            "invitation_id": getattr(assigned, "id", None),
            "display_name": display_name,
            "email": getattr(assigned, "invite_email", "") or "",
        },
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_assigned_subcontractor_work(request):
    qs = (
        Milestone.objects.select_related(
            "agreement",
            "agreement__project",
            "assigned_subcontractor_invitation",
            "assigned_subcontractor_invitation__accepted_by_user",
        )
        .filter(assigned_subcontractor_invitation__accepted_by_user=request.user)
        .order_by("agreement_id", "order", "id")
    )

    grouped = []
    groups_by_agreement = {}
    for milestone in qs:
        agreement_id = milestone.agreement_id
        if agreement_id not in groups_by_agreement:
            agreement = getattr(milestone, "agreement", None)
            project = getattr(agreement, "project", None) if agreement is not None else None
            group = {
                "agreement_id": agreement_id,
                "agreement_title": getattr(project, "title", "") or f"Agreement #{agreement_id}",
                "project_title": getattr(project, "title", "") or "",
                "milestones": [],
            }
            groups_by_agreement[agreement_id] = group
            grouped.append(group)
        groups_by_agreement[agreement_id]["milestones"].append(_milestone_payload(milestone))

    return Response(
        {
            "groups": grouped,
            "milestones": [_milestone_payload(milestone) for milestone in qs],
            "count": qs.count(),
        }
    )
