from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import (
    Milestone,
    MilestoneComment,
    MilestoneFile,
    Notification,
    SubcontractorCompletionStatus,
)
from projects.serializers.milestone_comment import MilestoneCommentSerializer
from projects.serializers.milestone_file import MilestoneFileSerializer
from django.utils import timezone
from projects.services.subcontractor_notifications import (
    create_subcontractor_activity_notification,
)


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
        "subcontractor_review_requested": bool(
            getattr(milestone, "subcontractor_review_requested_at", None)
        ),
        "subcontractor_review_requested_at": getattr(
            milestone, "subcontractor_review_requested_at", None
        ),
        "subcontractor_review_note": getattr(
            milestone, "subcontractor_review_note", ""
        )
        or "",
        "subcontractor_review_requested_by_display": (
            getattr(
                getattr(milestone, "subcontractor_review_requested_by", None),
                "get_full_name",
                lambda: "",
            )()
            or getattr(
                getattr(milestone, "subcontractor_review_requested_by", None),
                "email",
                "",
            )
            or display_name
        ),
        "subcontractor_completion_status": getattr(
            milestone,
            "subcontractor_completion_status",
            SubcontractorCompletionStatus.NOT_SUBMITTED,
        ),
        "subcontractor_marked_complete_at": getattr(
            milestone, "subcontractor_marked_complete_at", None
        ),
        "subcontractor_completion_note": getattr(
            milestone, "subcontractor_completion_note", ""
        )
        or "",
        "subcontractor_completion_submitted_by_display": (
            getattr(
                getattr(milestone, "subcontractor_marked_complete_by", None),
                "get_full_name",
                lambda: "",
            )()
            or getattr(
                getattr(milestone, "subcontractor_marked_complete_by", None),
                "email",
                "",
            )
            or display_name
        ),
        "subcontractor_reviewed_at": getattr(milestone, "subcontractor_reviewed_at", None),
        "subcontractor_review_response_note": getattr(
            milestone, "subcontractor_review_response_note", ""
        )
        or "",
        "subcontractor_completion_reviewed_by_display": (
            getattr(
                getattr(milestone, "subcontractor_reviewed_by", None),
                "get_full_name",
                lambda: "",
            )()
            or getattr(
                getattr(milestone, "subcontractor_reviewed_by", None),
                "email",
                "",
            )
            or ""
        ),
    }


def _assigned_milestone_queryset(user):
    return Milestone.objects.select_related(
        "agreement",
        "agreement__project",
        "assigned_subcontractor_invitation",
        "assigned_subcontractor_invitation__accepted_by_user",
        "subcontractor_review_requested_by",
        "subcontractor_marked_complete_by",
        "subcontractor_reviewed_by",
    ).filter(assigned_subcontractor_invitation__accepted_by_user=user)


def _get_assigned_milestone_or_none(user, milestone_id: int):
    return _assigned_milestone_queryset(user).filter(id=milestone_id).first()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_assigned_subcontractor_work(request):
    qs = (
        _assigned_milestone_queryset(request.user)
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def subcontractor_milestone_detail(request, milestone_id: int):
    milestone = _get_assigned_milestone_or_none(request.user, milestone_id)
    if milestone is None:
        return Response({"detail": "Not found."}, status=404)

    comments = (
        MilestoneComment.objects.filter(milestone=milestone)
        .select_related("author")
        .order_by("-created_at")[:100]
    )
    files = (
        MilestoneFile.objects.filter(milestone=milestone)
        .select_related("uploaded_by")
        .order_by("-uploaded_at")[:100]
    )

    return Response(
        {
            "milestone": _milestone_payload(milestone),
            "comments": MilestoneCommentSerializer(
                comments, many=True, context={"request": request}
            ).data,
            "files": MilestoneFileSerializer(
                files, many=True, context={"request": request}
            ).data,
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def subcontractor_milestone_comments(request, milestone_id: int):
    milestone = _get_assigned_milestone_or_none(request.user, milestone_id)
    if milestone is None:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "GET":
        qs = (
            MilestoneComment.objects.filter(milestone=milestone)
            .select_related("author")
            .order_by("-created_at")
        )
        return Response(
            MilestoneCommentSerializer(qs, many=True, context={"request": request}).data
        )

    content = ((request.data or {}).get("content") or "").strip()
    if not content:
        return Response({"detail": "content is required."}, status=400)

    obj = MilestoneComment.objects.create(
        milestone=milestone,
        author=request.user,
        content=content,
    )
    create_subcontractor_activity_notification(
        milestone=milestone,
        actor_user=request.user,
        event_type=Notification.EVENT_SUBCONTRACTOR_COMMENT,
    )
    return Response(
        MilestoneCommentSerializer(obj, context={"request": request}).data,
        status=201,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def subcontractor_milestone_files(request, milestone_id: int):
    milestone = _get_assigned_milestone_or_none(request.user, milestone_id)
    if milestone is None:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "GET":
        qs = (
            MilestoneFile.objects.filter(milestone=milestone)
            .select_related("uploaded_by")
            .order_by("-uploaded_at")
        )
        return Response(
            MilestoneFileSerializer(qs, many=True, context={"request": request}).data
        )

    uploaded = request.FILES.get("file")
    if not uploaded:
        return Response({"detail": "file is required."}, status=400)

    obj = MilestoneFile.objects.create(
        milestone=milestone,
        uploaded_by=request.user,
        file=uploaded,
    )
    create_subcontractor_activity_notification(
        milestone=milestone,
        actor_user=request.user,
        event_type=Notification.EVENT_SUBCONTRACTOR_FILE,
    )
    return Response(
        MilestoneFileSerializer(obj, context={"request": request}).data,
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def subcontractor_request_review(request, milestone_id: int):
    milestone = _get_assigned_milestone_or_none(request.user, milestone_id)
    if milestone is None:
        return Response({"detail": "Not found."}, status=404)

    note = ((request.data or {}).get("note") or "").strip()
    milestone.subcontractor_review_requested_at = timezone.now()
    milestone.subcontractor_review_requested_by = request.user
    milestone.subcontractor_review_note = note
    milestone.save(
        update_fields=[
            "subcontractor_review_requested_at",
            "subcontractor_review_requested_by",
            "subcontractor_review_note",
        ]
    )
    milestone.refresh_from_db()
    create_subcontractor_activity_notification(
        milestone=milestone,
        actor_user=request.user,
        event_type=Notification.EVENT_SUBCONTRACTOR_REVIEW,
    )

    return Response({"milestone": _milestone_payload(milestone)}, status=200)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def subcontractor_submit_completion(request, milestone_id: int):
    milestone = _get_assigned_milestone_or_none(request.user, milestone_id)
    if milestone is None:
        return Response({"detail": "Not found."}, status=404)

    if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.APPROVED:
        return Response(
            {"detail": "This subcontractor completion submission has already been approved."},
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
    return Response({"milestone": _milestone_payload(milestone)}, status=200)
