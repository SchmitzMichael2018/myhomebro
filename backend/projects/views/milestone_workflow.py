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
)
from projects.services.subcontractor_notifications import (
    create_subcontractor_activity_notification,
)


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
