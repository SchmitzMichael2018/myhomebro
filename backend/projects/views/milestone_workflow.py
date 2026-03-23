from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Milestone, Notification, SubcontractorCompletionStatus
from projects.serializers.milestone import MilestoneSerializer
from projects.services.milestone_workflow import (
    can_user_review_submitted_work,
    can_user_submit_work,
    get_assigned_worker,
    get_effective_reviewer,
    is_effective_reviewer_user,
)
from projects.services.subcontractor_notifications import (
    create_subcontractor_activity_notification,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


def _workflow_queryset():
    return Milestone.objects.select_related(
        "agreement",
        "agreement__project",
        "assigned_subcontractor_invitation",
        "assigned_subcontractor_invitation__accepted_by_user",
        "subaccount_assignment",
        "subaccount_assignment__subaccount",
        "subaccount_assignment__subaccount__user",
        "delegated_reviewer_subaccount",
        "delegated_reviewer_subaccount__user",
        "subcontractor_marked_complete_by",
        "subcontractor_reviewed_by",
    )


def _serialize_queue_item(milestone: Milestone) -> dict:
    assigned_worker = get_assigned_worker(milestone)
    reviewer = get_effective_reviewer(milestone)
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None) if agreement is not None else None

    return {
        "id": milestone.id,
        "title": milestone.title,
        "description": milestone.description,
        "status": getattr(milestone, "status", "") or "pending",
        "start_date": getattr(milestone, "start_date", None),
        "completion_date": getattr(milestone, "completion_date", None),
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": (
            getattr(agreement, "title", "")
            or getattr(agreement, "project_title_snapshot", "")
            or ""
        ),
        "project_title": (
            getattr(project, "title", "")
            or getattr(project, "name", "")
            or getattr(agreement, "project_title_snapshot", "")
            or ""
        ),
        "assigned_worker": (
            {
                "kind": assigned_worker.kind,
                "user_id": getattr(assigned_worker.user, "id", None),
                "display_name": assigned_worker.display_name,
                "email": assigned_worker.email,
                "subaccount_id": getattr(assigned_worker.subaccount, "id", None),
                "invitation_id": getattr(assigned_worker.invitation, "id", None),
            }
            if assigned_worker is not None
            else None
        ),
        "assigned_worker_display": (
            assigned_worker.display_name if assigned_worker is not None else ""
        ),
        "reviewer": {
            "kind": reviewer.kind,
            "user_id": getattr(reviewer.user, "id", None),
            "display_name": reviewer.display_name,
            "email": reviewer.email,
            "subaccount_id": getattr(reviewer.subaccount, "id", None),
            "is_delegated": reviewer.kind == "internal_team_member",
        },
        "reviewer_display": reviewer.display_name,
        "work_submission_status": milestone.subcontractor_completion_status,
        "work_submitted_at": milestone.subcontractor_marked_complete_at,
        "work_submission_note": milestone.subcontractor_completion_note or "",
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reviewer_queue(request):
    contractor = get_contractor_for_user(request.user)
    subaccount = get_subaccount_for_user(request.user)

    rows = _workflow_queryset().filter(
        subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    )

    if subaccount is not None:
        rows = rows.filter(delegated_reviewer_subaccount__user=request.user)
    elif contractor is not None:
        rows = rows.filter(agreement__project__contractor=contractor)
    else:
        return Response({"groups": [], "milestones": [], "count": 0})

    milestones = [
        milestone
        for milestone in rows.order_by("agreement_id", "order", "id")
        if is_effective_reviewer_user(milestone, request.user)
    ]

    serialized = [_serialize_queue_item(milestone) for milestone in milestones]
    grouped: dict[int, dict] = {}
    for item in serialized:
        agreement_id = item.get("agreement_id")
        group = grouped.setdefault(
            agreement_id,
            {
                "agreement_id": agreement_id,
                "agreement_title": item.get("agreement_title") or "",
                "project_title": item.get("project_title") or "",
                "milestones": [],
            },
        )
        group["milestones"].append(item)

    return Response(
        {
            "groups": list(grouped.values()),
            "milestones": serialized,
            "count": len(serialized),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def submit_work_for_review(request, milestone_id: int):
    milestone = get_object_or_404(_workflow_queryset(), pk=milestone_id)
    if not can_user_submit_work(milestone, request.user):
        return Response({"detail": "Not found."}, status=404)

    if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.APPROVED:
        return Response(
            {"detail": "This work submission has already been approved."},
            status=400,
        )

    note = ((request.data or {}).get("note") or "").strip()
    milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    milestone.subcontractor_marked_complete_at = timezone.now()
    milestone.subcontractor_marked_complete_by = request.user
    milestone.subcontractor_completion_note = note
    milestone.subcontractor_reviewed_at = None
    milestone.subcontractor_reviewed_by = None
    milestone.subcontractor_review_response_note = ""
    milestone.save(
        update_fields=[
            "subcontractor_completion_status",
            "subcontractor_marked_complete_at",
            "subcontractor_marked_complete_by",
            "subcontractor_completion_note",
            "subcontractor_reviewed_at",
            "subcontractor_reviewed_by",
            "subcontractor_review_response_note",
        ]
    )
    milestone.refresh_from_db()
    create_subcontractor_activity_notification(
        milestone=milestone,
        actor_user=request.user,
        event_type=Notification.EVENT_SUBCONTRACTOR_REVIEW,
    )
    return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def approve_work_submission(request, milestone_id: int):
    milestone = get_object_or_404(_workflow_queryset(), pk=milestone_id)
    if not can_user_review_submitted_work(milestone, request.user):
        return Response({"detail": "You are not allowed to review this work submission."}, status=403)
    if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
        return Response({"detail": "No work submission is pending review."}, status=400)

    response_note = ((request.data or {}).get("response_note") or "").strip()
    milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
    milestone.subcontractor_reviewed_at = timezone.now()
    milestone.subcontractor_reviewed_by = request.user
    milestone.subcontractor_review_response_note = response_note
    milestone.save(
        update_fields=[
            "subcontractor_completion_status",
            "subcontractor_reviewed_at",
            "subcontractor_reviewed_by",
            "subcontractor_review_response_note",
        ]
    )
    milestone.refresh_from_db()
    return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def send_back_work_submission(request, milestone_id: int):
    milestone = get_object_or_404(_workflow_queryset(), pk=milestone_id)
    if not can_user_review_submitted_work(milestone, request.user):
        return Response({"detail": "You are not allowed to review this work submission."}, status=403)
    if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
        return Response({"detail": "No work submission is pending review."}, status=400)

    response_note = ((request.data or {}).get("response_note") or "").strip()
    milestone.subcontractor_completion_status = SubcontractorCompletionStatus.NEEDS_CHANGES
    milestone.subcontractor_reviewed_at = timezone.now()
    milestone.subcontractor_reviewed_by = request.user
    milestone.subcontractor_review_response_note = response_note
    milestone.save(
        update_fields=[
            "subcontractor_completion_status",
            "subcontractor_reviewed_at",
            "subcontractor_reviewed_by",
            "subcontractor_review_response_note",
        ]
    )
    milestone.refresh_from_db()
    return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=200)
