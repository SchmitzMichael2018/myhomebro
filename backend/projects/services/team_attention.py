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
    submitted_qs = milestone_qs.filter(
        subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    )

    if user is not None:
        awaiting_review_count = 0
        for milestone in submitted_qs.order_by("agreement_id", "order", "id"):
            if is_effective_reviewer_user(milestone, user):
                awaiting_review_count += 1
    else:
        awaiting_review_count = submitted_qs.count()

    unassigned_assignment_count = milestone_qs.filter(
        completed=False,
        assigned_subcontractor_invitation__isnull=True,
    ).count()
    assigned_work_count = milestone_qs.filter(
        completed=False,
        assigned_subcontractor_invitation__isnull=False,
    ).count()
    overdue_milestone_count = milestone_qs.filter(
        completed=False,
        completion_date__lt=today,
    ).count()
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

    assigned_milestones = milestone_qs.count()
    pending_review_count = milestone_qs.filter(
        subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    ).count()
    overdue_milestone_count = milestone_qs.filter(
        completed=False,
        completion_date__lt=timezone.localdate(),
    ).count()

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
