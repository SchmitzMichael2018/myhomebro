from __future__ import annotations

from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    AgreementAssignment,
    Contractor,
    Milestone,
    MilestoneAssignment,
    MilestoneComment,
    MilestoneFile,
    Notification,
    SubcontractorCompletionStatus,
)
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.services.milestone_workflow import (
    can_user_review_submitted_work,
    can_user_submit_work,
    get_assigned_worker,
    get_effective_reviewer,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user
from projects.utils.subaccount_scope import get_visible_milestones_for_subaccount


ROLE_CONTRACTOR_OWNER = "contractor_owner"
ROLE_INTERNAL_TEAM_MEMBER = "internal_team_member"
ROLE_SUBCONTRACTOR = "subcontractor"
ROLE_HOMEOWNER = "homeowner"


def _empty_payload(identity_type: str) -> dict:
    return {
        "identity_type": identity_type,
        "today": [],
        "tomorrow": [],
        "this_week": [],
        "recent_activity": [],
    }


def _role_context(identity_type: str) -> dict:
    if identity_type == ROLE_CONTRACTOR_OWNER:
        return {
            "milestone_route": "/app/milestones/{id}",
            "agreement_route": "/app/agreements/{id}",
            "review_route": "/app/reviewer/queue",
            "default_action": ("View Milestone", "/app/milestones/{id}"),
            "empty": {
                "today": "No contractor actions need attention today.",
                "tomorrow": "Nothing is scheduled for tomorrow yet.",
                "this_week": "Nothing else is stacked up for later this week.",
                "recent_activity": "No recent worker activity yet.",
            },
        }
    if identity_type == ROLE_INTERNAL_TEAM_MEMBER:
        return {
            "milestone_route": "/app/employee/milestones",
            "agreement_route": "/app/employee/agreements",
            "review_route": "/app/reviewer/queue",
            "default_action": ("View Work", "/app/employee/milestones"),
            "empty": {
                "today": "Nothing needs your attention today.",
                "tomorrow": "Nothing is scheduled for tomorrow yet.",
                "this_week": "No additional work is stacked up later this week.",
                "recent_activity": "No recent updates on your work yet.",
            },
        }
    if identity_type == ROLE_SUBCONTRACTOR:
        return {
            "milestone_route": "/app/subcontractor/assigned-work",
            "agreement_route": "/app/subcontractor/assigned-work",
            "review_route": "/app/subcontractor/assigned-work",
            "default_action": ("Open Assigned Work", "/app/subcontractor/assigned-work"),
            "empty": {
                "today": "Nothing needs your attention today.",
                "tomorrow": "Nothing is scheduled for tomorrow yet.",
                "this_week": "No additional assigned work is queued for later this week.",
                "recent_activity": "No recent updates on your assigned work yet.",
            },
        }
    return {
        "milestone_route": "/app",
        "agreement_route": "/app",
        "review_route": "/app",
        "default_action": ("Open App", "/app"),
        "empty": {
            "today": "No items need attention right now.",
            "tomorrow": "Nothing is scheduled for tomorrow.",
            "this_week": "Nothing else is queued for later this week.",
            "recent_activity": "No recent activity is available.",
        },
    }


def _route_action(label: str, route: str, action_type: str = "route") -> dict:
    return {"label": label, "type": action_type, "target": route}


def _project_title(milestone: Milestone) -> str:
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None) if agreement is not None else None
    return (
        getattr(project, "title", "")
        or getattr(project, "name", "")
        or getattr(agreement, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or ""
    )


def _agreement_title(milestone: Milestone) -> str:
    agreement = getattr(milestone, "agreement", None)
    return (
        getattr(agreement, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or _project_title(milestone)
    )


def _base_item(milestone: Milestone, item_type: str, title: str, subtitle: str) -> dict:
    assigned_worker = get_assigned_worker(milestone)
    reviewer = get_effective_reviewer(milestone)
    return {
        "item_type": item_type,
        "id": f"{item_type}-{milestone.id}",
        "title": title,
        "subtitle": subtitle,
        "agreement_id": milestone.agreement_id,
        "agreement_title": _agreement_title(milestone),
        "project_title": _project_title(milestone),
        "milestone_id": milestone.id,
        "milestone_title": milestone.title,
        "status": getattr(milestone, "status", "") or "pending",
        "assigned_worker_display": assigned_worker.display_name if assigned_worker else "",
        "reviewer_display": reviewer.display_name if reviewer else "",
        "start_date": milestone.start_date,
        "completion_date": milestone.completion_date,
        "work_submission_status": milestone.subcontractor_completion_status,
        "work_submitted_at": milestone.subcontractor_marked_complete_at,
        "work_submission_note": milestone.subcontractor_completion_note or "",
        "review_response_note": milestone.subcontractor_review_response_note or "",
    }


def _milestone_actions(milestone: Milestone, role_context: dict, *, review_now: bool = False) -> list[dict]:
    actions: list[dict] = []
    if review_now:
        actions.append(_route_action("Review", role_context["review_route"]))

    milestone_route = role_context["milestone_route"].format(id=milestone.id)
    agreement_route = role_context["agreement_route"].format(id=milestone.agreement_id)
    default_label, _ = role_context["default_action"]
    actions.append(_route_action(default_label, milestone_route))
    if milestone.agreement_id:
        actions.append(_route_action("Open Agreement", agreement_route))
    return actions


def _review_item(milestone: Milestone, role_context: dict, title: str, subtitle: str) -> dict:
    item = _base_item(milestone, "review_submission", title, subtitle)
    item["actions"] = _milestone_actions(milestone, role_context, review_now=True)
    return item


def _date_item(milestone: Milestone, role_context: dict, item_type: str, title: str, subtitle: str) -> dict:
    item = _base_item(milestone, item_type, title, subtitle)
    item["actions"] = _milestone_actions(milestone, role_context)
    return item


def _submission_item(milestone: Milestone, role_context: dict, title: str, subtitle: str) -> dict:
    item = _base_item(milestone, "submitted_waiting", title, subtitle)
    item["actions"] = _milestone_actions(milestone, role_context)
    return item


def _activity_item(
    *,
    item_id: str,
    item_type: str,
    title: str,
    subtitle: str,
    occurred_at,
    milestone: Milestone | None,
    role_context: dict,
    note: str = "",
) -> dict:
    agreement_id = getattr(milestone, "agreement_id", None) if milestone is not None else None
    milestone_id = getattr(milestone, "id", None) if milestone is not None else None
    milestone_title = getattr(milestone, "title", "") if milestone is not None else ""
    agreement_title = _agreement_title(milestone) if milestone is not None else ""
    project_title = _project_title(milestone) if milestone is not None else ""
    actions = []
    if milestone is not None:
        actions = _milestone_actions(milestone, role_context)
    return {
        "item_type": item_type,
        "id": item_id,
        "title": title,
        "subtitle": subtitle,
        "agreement_id": agreement_id,
        "agreement_title": agreement_title,
        "project_title": project_title,
        "milestone_id": milestone_id,
        "milestone_title": milestone_title,
        "occurred_at": occurred_at,
        "review_response_note": note,
        "actions": actions,
    }


def _current_identity_type(user) -> str:
    contractor = get_contractor_for_user(user)
    subaccount = get_subaccount_for_user(user)
    if contractor is not None and subaccount is None:
        return ROLE_CONTRACTOR_OWNER
    if subaccount is not None:
        return ROLE_INTERNAL_TEAM_MEMBER
    subcontractor_exists = SubcontractorInvitation.objects.filter(
        accepted_by_user=user,
        status=SubcontractorInvitationStatus.ACCEPTED,
    ).exists()
    if subcontractor_exists:
        return ROLE_SUBCONTRACTOR
    return ROLE_HOMEOWNER


def _contractor_milestones(contractor: Contractor):
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
    ).filter(Q(agreement__project__contractor=contractor) | Q(agreement__contractor=contractor))


def _internal_team_milestones(subaccount):
    visible_qs = (
        get_visible_milestones_for_subaccount(
            subaccount=subaccount,
            MilestoneModel=Milestone,
            AgreementAssignmentModel=AgreementAssignment,
            MilestoneAssignmentModel=MilestoneAssignment,
        )
    )
    review_qs = Milestone.objects.filter(delegated_reviewer_subaccount=subaccount)
    return (
        Milestone.objects.filter(Q(id__in=visible_qs.values("id")) | Q(id__in=review_qs.values("id")))
        .select_related(
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
    )


def _subcontractor_milestones(user):
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
    ).filter(assigned_subcontractor_invitation__accepted_by_user=user)


def _add_dated_items(
    *,
    bucket,
    seen,
    milestone: Milestone,
    item_type: str,
    title: str,
    subtitle: str,
    role_context: dict,
):
    key = (item_type, milestone.id)
    if key in seen:
        return
    seen.add(key)
    bucket.append(_date_item(milestone, role_context, item_type, title, subtitle))


def _build_time_buckets(identity_type: str, user, milestones: list[Milestone], role_context: dict):
    today = timezone.localdate()
    tomorrow = today + timedelta(days=1)
    week_end = today + timedelta(days=7)

    today_items: list[dict] = []
    tomorrow_items: list[dict] = []
    week_items: list[dict] = []
    seen_today: set[tuple[str, int]] = set()
    seen_tomorrow: set[tuple[str, int]] = set()
    seen_week: set[tuple[str, int]] = set()

    for milestone in milestones:
        context_title = _project_title(milestone) or _agreement_title(milestone)
        worker = get_assigned_worker(milestone)
        worker_label = worker.display_name if worker is not None else "Worker"

        if can_user_review_submitted_work(milestone, user) and milestone.subcontractor_completion_status == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
            title = f"{milestone.title} is awaiting your review"
            subtitle = f"{worker_label} submitted work for review in {context_title}."
            key = ("review_submission", milestone.id)
            if key not in seen_today:
                seen_today.add(key)
                today_items.append(_review_item(milestone, role_context, title, subtitle))

        if (
            milestone.subcontractor_completion_status == SubcontractorCompletionStatus.NEEDS_CHANGES
            and (identity_type == ROLE_CONTRACTOR_OWNER or can_user_submit_work(milestone, user))
        ):
            key = ("needs_changes", milestone.id)
            if key not in seen_today:
                seen_today.add(key)
                today_items.append(
                    _date_item(
                        milestone,
                        role_context,
                        "needs_changes",
                        f"{milestone.title} needs changes",
                        (
                            f"Follow up on requested changes in {context_title}."
                            if identity_type == ROLE_CONTRACTOR_OWNER
                            else f"Review feedback is waiting for you on {context_title}."
                        ),
                    )
                )

        if can_user_submit_work(milestone, user):
            if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.NEEDS_CHANGES:
                pass
            elif milestone.subcontractor_completion_status == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
                key = ("submitted_waiting", milestone.id)
                if key not in seen_today:
                    seen_today.add(key)
                    today_items.append(
                        _submission_item(
                            milestone,
                            role_context,
                            f"{milestone.title} is awaiting review",
                            f"Your submission is waiting for review on {context_title}.",
                        )
                    )

        if milestone.completion_date and not milestone.completed:
            if milestone.completion_date < today:
                _add_dated_items(
                    bucket=today_items,
                    seen=seen_today,
                    milestone=milestone,
                    item_type="overdue",
                    title=f"{milestone.title} is overdue",
                    subtitle=context_title,
                    role_context=role_context,
                )
            elif milestone.completion_date == today:
                _add_dated_items(
                    bucket=today_items,
                    seen=seen_today,
                    milestone=milestone,
                    item_type="due_today",
                    title=f"{milestone.title} is due today",
                    subtitle=context_title,
                    role_context=role_context,
                )
            elif milestone.completion_date == tomorrow:
                _add_dated_items(
                    bucket=tomorrow_items,
                    seen=seen_tomorrow,
                    milestone=milestone,
                    item_type="due_tomorrow",
                    title=f"{milestone.title} is due tomorrow",
                    subtitle=context_title,
                    role_context=role_context,
                )
            elif tomorrow < milestone.completion_date <= week_end:
                _add_dated_items(
                    bucket=week_items,
                    seen=seen_week,
                    milestone=milestone,
                    item_type="due_this_week",
                    title=f"{milestone.title} is due later this week",
                    subtitle=context_title,
                    role_context=role_context,
                )

        if milestone.start_date and not milestone.completed:
            if milestone.start_date == today:
                _add_dated_items(
                    bucket=today_items,
                    seen=seen_today,
                    milestone=milestone,
                    item_type="start_today",
                    title=f"{milestone.title} starts today",
                    subtitle=context_title,
                    role_context=role_context,
                )
            elif milestone.start_date == tomorrow:
                _add_dated_items(
                    bucket=tomorrow_items,
                    seen=seen_tomorrow,
                    milestone=milestone,
                    item_type="start_tomorrow",
                    title=f"{milestone.title} starts tomorrow",
                    subtitle=context_title,
                    role_context=role_context,
                )
            elif tomorrow < milestone.start_date <= week_end:
                _add_dated_items(
                    bucket=week_items,
                    seen=seen_week,
                    milestone=milestone,
                    item_type="start_this_week",
                    title=f"{milestone.title} starts later this week",
                    subtitle=context_title,
                    role_context=role_context,
                )

    return today_items, tomorrow_items, week_items


def _contractor_recent_activity(contractor: Contractor, milestones: list[Milestone], role_context: dict):
    activity = []
    notifications = list(
        Notification.objects.select_related("agreement", "agreement__project", "milestone")
        .filter(contractor=contractor)
        .order_by("-created_at", "-id")[:8]
    )
    for notification in notifications:
        milestone = getattr(notification, "milestone", None)
        activity.append(
            _activity_item(
                item_id=f"notification-{notification.id}",
                item_type=notification.event_type,
                title=notification.title,
                subtitle=notification.message,
                occurred_at=notification.created_at,
                milestone=milestone,
                role_context=role_context,
            )
        )

    for milestone in sorted(
        [
            row
            for row in milestones
            if row.subcontractor_reviewed_at
            and row.subcontractor_completion_status
            in {
                SubcontractorCompletionStatus.APPROVED,
                SubcontractorCompletionStatus.NEEDS_CHANGES,
            }
        ],
        key=lambda row: row.subcontractor_reviewed_at,
        reverse=True,
    )[:8]:
        approved = milestone.subcontractor_completion_status == SubcontractorCompletionStatus.APPROVED
        activity.append(
            _activity_item(
                item_id=f"review-outcome-{milestone.id}",
                item_type="work_approved" if approved else "work_sent_back",
                title=f"{milestone.title} was {'approved' if approved else 'sent back'}",
                subtitle=(
                    f"{get_assigned_worker(milestone).display_name if get_assigned_worker(milestone) else 'Worker'} "
                    f"was {'approved' if approved else 'sent back for changes'} in {_project_title(milestone) or _agreement_title(milestone)}."
                ),
                occurred_at=milestone.subcontractor_reviewed_at,
                milestone=milestone,
                role_context=role_context,
                note=milestone.subcontractor_review_response_note or "",
            )
        )

    activity.sort(
        key=lambda item: item.get("occurred_at") or timezone.make_aware(datetime(2000, 1, 1)),
        reverse=True,
    )
    return activity[:10]


def _team_or_subcontractor_recent_activity(milestones: list[Milestone], role_context: dict):
    milestone_ids = [row.id for row in milestones]
    if not milestone_ids:
        return []

    activity = []
    comment_rows = list(
        MilestoneComment.objects.select_related("milestone", "author")
        .filter(milestone_id__in=milestone_ids)
        .order_by("-created_at", "-id")[:6]
    )
    for row in comment_rows:
        author = getattr(row, "author", None)
        author_label = (
            getattr(author, "get_full_name", lambda: "")()
            or getattr(author, "email", "")
            or "User"
        )
        activity.append(
            _activity_item(
                item_id=f"comment-{row.id}",
                item_type="comment_added",
                title=f"Comment added on {getattr(row.milestone, 'title', 'Milestone')}",
                subtitle=f"{author_label} commented on {_project_title(row.milestone) or _agreement_title(row.milestone)}.",
                occurred_at=row.created_at,
                milestone=row.milestone,
                role_context=role_context,
            )
        )

    file_rows = list(
        MilestoneFile.objects.select_related("milestone", "uploaded_by")
        .filter(milestone_id__in=milestone_ids)
        .order_by("-uploaded_at", "-id")[:6]
    )
    for row in file_rows:
        author = getattr(row, "uploaded_by", None)
        author_label = (
            getattr(author, "get_full_name", lambda: "")()
            or getattr(author, "email", "")
            or "User"
        )
        activity.append(
            _activity_item(
                item_id=f"file-{row.id}",
                item_type="file_uploaded",
                title=f"File uploaded for {getattr(row.milestone, 'title', 'Milestone')}",
                subtitle=f"{author_label} uploaded a file on {_project_title(row.milestone) or _agreement_title(row.milestone)}.",
                occurred_at=row.uploaded_at,
                milestone=row.milestone,
                role_context=role_context,
            )
        )

    for milestone in milestones:
        if milestone.subcontractor_marked_complete_at:
            activity.append(
                _activity_item(
                    item_id=f"submission-{milestone.id}",
                    item_type="work_submitted",
                    title=f"{milestone.title} was submitted for review",
                    subtitle=f"Submission activity on {_project_title(milestone) or _agreement_title(milestone)}.",
                    occurred_at=milestone.subcontractor_marked_complete_at,
                    milestone=milestone,
                    role_context=role_context,
                    note=milestone.subcontractor_completion_note or "",
                )
            )
        if milestone.subcontractor_reviewed_at:
            approved = milestone.subcontractor_completion_status == SubcontractorCompletionStatus.APPROVED
            activity.append(
                _activity_item(
                    item_id=f"review-{milestone.id}",
                    item_type="work_approved" if approved else "work_sent_back",
                    title=f"{milestone.title} was {'approved' if approved else 'sent back'}",
                    subtitle=f"Review activity on {_project_title(milestone) or _agreement_title(milestone)}.",
                    occurred_at=milestone.subcontractor_reviewed_at,
                    milestone=milestone,
                    role_context=role_context,
                    note=milestone.subcontractor_review_response_note or "",
                )
            )

    activity.sort(
        key=lambda item: item.get("occurred_at") or timezone.make_aware(datetime(2000, 1, 1)),
        reverse=True,
    )
    deduped = []
    seen = set()
    for item in activity:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        deduped.append(item)
        if len(deduped) >= 10:
            break
    return deduped


class ContractorOperationsDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        identity_type = _current_identity_type(user)
        role_context = _role_context(identity_type)

        if identity_type == ROLE_CONTRACTOR_OWNER:
            contractor = get_contractor_for_user(user)
            if contractor is None:
                return Response(_empty_payload(identity_type))
            milestones = list(
                _contractor_milestones(contractor).order_by("completion_date", "start_date", "order", "id")
            )
            today, tomorrow, this_week = _build_time_buckets(identity_type, user, milestones, role_context)
            recent_activity = _contractor_recent_activity(contractor, milestones, role_context)
            return Response(
                {
                    "identity_type": identity_type,
                    "today": today,
                    "tomorrow": tomorrow,
                    "this_week": this_week,
                    "recent_activity": recent_activity,
                    "empty_states": role_context["empty"],
                }
            )

        if identity_type == ROLE_INTERNAL_TEAM_MEMBER:
            subaccount = get_subaccount_for_user(user)
            milestones = list(
                _internal_team_milestones(subaccount).order_by("completion_date", "start_date", "order", "id")
            )
            today, tomorrow, this_week = _build_time_buckets(identity_type, user, milestones, role_context)
            recent_activity = _team_or_subcontractor_recent_activity(milestones, role_context)
            return Response(
                {
                    "identity_type": identity_type,
                    "today": today,
                    "tomorrow": tomorrow,
                    "this_week": this_week,
                    "recent_activity": recent_activity,
                    "empty_states": role_context["empty"],
                }
            )

        if identity_type == ROLE_SUBCONTRACTOR:
            milestones = list(
                _subcontractor_milestones(user).order_by("completion_date", "start_date", "order", "id")
            )
            today, tomorrow, this_week = _build_time_buckets(identity_type, user, milestones, role_context)
            recent_activity = _team_or_subcontractor_recent_activity(milestones, role_context)
            return Response(
                {
                    "identity_type": identity_type,
                    "today": today,
                    "tomorrow": tomorrow,
                    "this_week": this_week,
                    "recent_activity": recent_activity,
                    "empty_states": role_context["empty"],
                }
            )

        return Response(
            {
                **_empty_payload(identity_type),
                "empty_states": role_context["empty"],
            }
        )
