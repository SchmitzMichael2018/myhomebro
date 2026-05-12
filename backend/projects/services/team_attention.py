from __future__ import annotations

from datetime import datetime

from django.db.models import Q
from django.utils import timezone

from projects.models import (
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    Milestone,
    MilestoneAssignment,
    SubcontractorCompletionStatus,
)
from projects.models_subcontractor import SubcontractorInvitation, SubcontractorInvitationStatus
from projects.services.milestone_workflow import is_effective_reviewer_user
from projects.services.milestone_lifecycle import milestone_is_overdue, milestone_lifecycle_state


def _max_dt(*values):
    chosen = None
    for value in values:
        if not value:
            continue
        if isinstance(value, datetime) and timezone.is_naive(value):
            value = timezone.make_aware(value, timezone.get_current_timezone())
        if chosen is None or value > chosen:
            chosen = value
    return chosen


def build_contractor_attention_counts(contractor: Contractor | None, *, user=None) -> dict:
    if contractor is None:
        return {
            "awaiting_review_count": 0,
            "submitted_for_review_count": 0,
            "unassigned_assignment_count": 0,
            "assigned_work_count": 0,
            "assigned_action_count": 0,
            "overdue_milestone_count": 0,
            "pending_invites_count": 0,
            "active_subcontractor_count": 0,
            "total_attention_count": 0,
        }

    milestone_qs = Milestone.objects.select_related(
        "agreement",
        "agreement__project",
        "assigned_subcontractor_invitation",
        "delegated_reviewer_subaccount",
    ).filter(
        Q(agreement__project__contractor=contractor) | Q(agreement__contractor=contractor)
    )
    today = timezone.localdate()
    active_milestones = [milestone for milestone in milestone_qs if milestone_is_overdue(milestone) or milestone_lifecycle_state(milestone) != "planned"]
    submitted_milestones = [
        milestone
        for milestone in active_milestones
        if getattr(milestone, "subcontractor_completion_status", None)
        == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    ]

    if user is not None:
        awaiting_review_count = 0
        for milestone in sorted(submitted_milestones, key=lambda m: (getattr(m, "agreement_id", 0), getattr(m, "order", 0), getattr(m, "id", 0))):
            if is_effective_reviewer_user(milestone, user):
                awaiting_review_count += 1
    else:
        awaiting_review_count = len(submitted_milestones)

    unassigned_assignment_count = sum(
        1
        for milestone in active_milestones
        if not getattr(milestone, "completed", False)
        and getattr(milestone, "assigned_subcontractor_invitation_id", None) is None
    )
    assigned_work_count = sum(
        1
        for milestone in active_milestones
        if not getattr(milestone, "completed", False)
        and getattr(milestone, "assigned_subcontractor_invitation_id", None) is not None
    )
    overdue_milestone_count = sum(1 for milestone in active_milestones if milestone_is_overdue(milestone))

    active_assigned_count = sum(
        1
        for milestone in active_milestones
        if not getattr(milestone, "completed", False)
        and getattr(milestone, "assigned_subcontractor_invitation_id", None) is not None
        and getattr(milestone, "subcontractor_completion_status", None)
        != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        and not milestone_is_overdue(milestone)
    )
    overdue_assigned_count = sum(
        1
        for milestone in active_milestones
        if not getattr(milestone, "completed", False)
        and getattr(milestone, "assigned_subcontractor_invitation_id", None) is not None
        and getattr(milestone, "subcontractor_completion_status", None)
        != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        and milestone_is_overdue(milestone)
    )
    assigned_action_count = active_assigned_count + awaiting_review_count + overdue_assigned_count
    pending_invites_count = SubcontractorInvitation.objects.filter(
        contractor=contractor,
        status=SubcontractorInvitationStatus.PENDING,
    ).count()
    active_subcontractor_count = ContractorSubAccount.objects.filter(
        parent_contractor=contractor,
        is_active=True,
    ).count()

    total_attention_count = (
        awaiting_review_count
        + unassigned_assignment_count
        + overdue_milestone_count
        + pending_invites_count
    )

    return {
        "awaiting_review_count": awaiting_review_count,
        "submitted_for_review_count": awaiting_review_count,
        "unassigned_assignment_count": unassigned_assignment_count,
        "assigned_work_count": assigned_work_count,
        "assigned_action_count": assigned_action_count,
        "overdue_milestone_count": overdue_milestone_count,
        "pending_invites_count": pending_invites_count,
        "active_subcontractor_count": active_subcontractor_count,
        "total_attention_count": total_attention_count,
    }


def build_subaccount_work_summary(subaccount: ContractorSubAccount) -> dict:
    user = getattr(subaccount, "user", None)
    milestone_qs = Milestone.objects.select_related(
        "agreement",
        "agreement__project",
        "assigned_subcontractor_invitation",
        "delegated_reviewer_subaccount",
    ).filter(
        Q(subaccount_assignment__subaccount=subaccount)
        | Q(delegated_reviewer_subaccount=subaccount)
        | Q(assigned_subcontractor_invitation__accepted_by_user=user)
    )

    active_milestones = [milestone for milestone in milestone_qs if milestone_lifecycle_state(milestone) != "planned"]

    assigned_milestones = len(active_milestones)
    pending_review_count = sum(
        1
        for milestone in active_milestones
        if getattr(milestone, "subcontractor_completion_status", None)
        == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    )
    overdue_milestone_count = sum(1 for milestone in active_milestones if milestone_is_overdue(milestone))

    agreement_assignment_count = AgreementAssignment.objects.filter(subaccount=subaccount).count()
    milestone_assignment_count = MilestoneAssignment.objects.filter(subaccount=subaccount).count()

    last_activity_at = _max_dt(
        getattr(user, "last_login", None),
        getattr(subaccount, "updated_at", None),
        getattr(subaccount, "created_at", None),
        milestone_qs.order_by("-subcontractor_marked_complete_at").first().subcontractor_marked_complete_at
        if milestone_qs.filter(subcontractor_marked_complete_at__isnull=False).exists()
        else None,
        milestone_qs.order_by("-subcontractor_reviewed_at").first().subcontractor_reviewed_at
        if milestone_qs.filter(subcontractor_reviewed_at__isnull=False).exists()
        else None,
        milestone_qs.order_by("-subcontractor_review_requested_at").first().subcontractor_review_requested_at
        if milestone_qs.filter(subcontractor_review_requested_at__isnull=False).exists()
        else None,
    )

    return {
        "assignment_count": agreement_assignment_count + milestone_assignment_count,
        "active_assignment_count": assigned_milestones,
        "pending_review_count": pending_review_count,
        "overdue_milestone_count": overdue_milestone_count,
        "last_activity_at": last_activity_at,
        "last_login": getattr(user, "last_login", None),
    }
