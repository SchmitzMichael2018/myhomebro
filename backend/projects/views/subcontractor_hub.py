from __future__ import annotations

from collections import defaultdict

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Milestone, Notification, SubcontractorCompletionStatus
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.serializers.milestone import MilestoneSerializer
from projects.serializers.subcontractor_invitations import (
    SubcontractorInvitationCreateSerializer,
)
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.milestone_payouts import sync_milestone_payout
from projects.services.milestone_workflow import can_user_review_submitted_work
from projects.services.subcontractor_invitations import (
    normalize_email,
    send_subcontractor_invitation_email,
    serialize_invitation_summary,
)
from projects.services.subcontractor_notifications import (
    create_subcontractor_activity_notification,
)
from projects.views.subcontractor_invitations import _get_owned_agreement


def _require_contractor(user):
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionError("Only contractors can manage subcontractors.")
    return contractor


def _contractor_invitation_queryset(contractor):
    return SubcontractorInvitation.objects.filter(contractor=contractor).select_related(
        "agreement",
        "agreement__project",
        "accepted_by_user",
    )


def _contractor_milestone_queryset(contractor):
    return Milestone.objects.select_related(
        "agreement",
        "agreement__project",
        "assigned_subcontractor_invitation",
        "assigned_subcontractor_invitation__accepted_by_user",
        "subcontractor_marked_complete_by",
        "subcontractor_reviewed_by",
    ).filter(agreement__project__contractor=contractor)


def _agreement_title(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    return (
        getattr(project, "title", "")
        or getattr(project, "name", "")
        or getattr(agreement, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or f"Agreement #{getattr(agreement, 'id', '')}"
    )


def _display_name(invitation: SubcontractorInvitation) -> str:
    user = getattr(invitation, "accepted_by_user", None)
    if user is not None:
        full_name = getattr(user, "get_full_name", lambda: "")() or ""
        if full_name:
            return full_name
        if getattr(user, "email", ""):
            return user.email
    return invitation.invite_name or invitation.invite_email or "Subcontractor"


def _assignment_status(assigned_count: int, submitted_count: int, needs_changes_count: int, approved_count: int, completed_count: int) -> str:
    if assigned_count <= 0:
        return "assigned"
    if submitted_count > 0:
        return "submitted"
    if needs_changes_count > 0:
        return "rejected"
    if completed_count == assigned_count and assigned_count > 0:
        return "completed"
    if approved_count == assigned_count and assigned_count > 0:
        return "approved"
    return "in_progress"


def _serialize_assignment_row(invitation: SubcontractorInvitation, milestones: list[Milestone]) -> dict:
    assigned_count = len(milestones)
    submitted_count = sum(
        1
        for milestone in milestones
        if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    )
    needs_changes_count = sum(
        1
        for milestone in milestones
        if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.NEEDS_CHANGES
    )
    approved_count = sum(
        1
        for milestone in milestones
        if milestone.subcontractor_completion_status == SubcontractorCompletionStatus.APPROVED
    )
    completed_count = sum(1 for milestone in milestones if bool(getattr(milestone, "completed", False)))
    # Keep this contractor-only work-value summary lightweight so future
    # assignment -> approved work -> payment visibility can build on it
    # without exposing payout data in subcontractor-facing payloads.
    total_assigned_amount = sum(
        float(milestone.amount or 0)
        for milestone in milestones
    )
    earliest_due = min(
        (milestone.completion_date for milestone in milestones if milestone.completion_date),
        default=None,
    )

    return {
        "id": invitation.id,
        "invitation_id": invitation.id,
        "agreement_id": invitation.agreement_id,
        "agreement_title": _agreement_title(invitation.agreement),
        "subcontractor_user_id": getattr(invitation.accepted_by_user, "id", None),
        "subcontractor_display_name": _display_name(invitation),
        "subcontractor_email": invitation.invite_email,
        "status": _assignment_status(
            assigned_count,
            submitted_count,
            needs_changes_count,
            approved_count,
            completed_count,
        ),
        "assigned_milestones_count": assigned_count,
        "submitted_for_review_count": submitted_count,
        "needs_changes_count": needs_changes_count,
        "approved_count": approved_count,
        "completed_count": completed_count,
        "total_assigned_amount": f"{total_assigned_amount:.2f}",
        "earliest_due_date": earliest_due,
        "notes": invitation.invited_message or "",
        "milestones": [
            {
                "id": milestone.id,
                "title": milestone.title,
                "completion_date": milestone.completion_date,
                "status": getattr(milestone, "status", "") or "pending",
                "work_submission_status": milestone.subcontractor_completion_status,
                "assigned_amount": milestone.amount,
            }
            for milestone in milestones
        ],
    }


def _directory_rows(contractor) -> list[dict]:
    invitations = list(
        _contractor_invitation_queryset(contractor)
        .filter(status=SubcontractorInvitationStatus.ACCEPTED)
        .order_by("-accepted_at", "-id")
    )
    milestone_rows = list(
        _contractor_milestone_queryset(contractor)
        .filter(assigned_subcontractor_invitation__status=SubcontractorInvitationStatus.ACCEPTED)
        .order_by("agreement_id", "order", "id")
    )
    milestones_by_invitation: dict[int, list[Milestone]] = defaultdict(list)
    for milestone in milestone_rows:
        if milestone.assigned_subcontractor_invitation_id:
            milestones_by_invitation[milestone.assigned_subcontractor_invitation_id].append(milestone)

    grouped: dict[str, dict] = {}
    order: list[str] = []
    for invitation in invitations:
        key = str(getattr(invitation.accepted_by_user, "id", None) or normalize_email(invitation.invite_email))
        if key not in grouped:
            grouped[key] = {
                "key": key,
                "subcontractor_user_id": getattr(invitation.accepted_by_user, "id", None),
                "display_name": _display_name(invitation),
                "email": invitation.invite_email,
                "status": "active",
                "agreements": [],
                "agreements_count": 0,
                "assigned_work_count": 0,
                "submitted_for_review_count": 0,
                "latest_invited_at": invitation.invited_at,
                "latest_accepted_at": invitation.accepted_at,
            }
            order.append(key)
        row = grouped[key]
        row["agreements"].append(
            {
                "agreement_id": invitation.agreement_id,
                "agreement_title": _agreement_title(invitation.agreement),
            }
        )
        invitation_milestones = milestones_by_invitation.get(invitation.id, [])
        row["assigned_work_count"] += len(invitation_milestones)
        row["submitted_for_review_count"] += sum(
            1
            for milestone in invitation_milestones
            if milestone.subcontractor_completion_status
            == SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        )
        if invitation.invited_at and (row["latest_invited_at"] is None or invitation.invited_at > row["latest_invited_at"]):
            row["latest_invited_at"] = invitation.invited_at
        if invitation.accepted_at and (row["latest_accepted_at"] is None or invitation.accepted_at > row["latest_accepted_at"]):
            row["latest_accepted_at"] = invitation.accepted_at

    rows = []
    for key in order:
        row = grouped[key]
        deduped_agreements = []
        seen_agreements = set()
        for agreement in row["agreements"]:
            if agreement["agreement_id"] in seen_agreements:
                continue
            seen_agreements.add(agreement["agreement_id"])
            deduped_agreements.append(agreement)
        row["agreements"] = deduped_agreements
        row["agreements_count"] = len(deduped_agreements)
        rows.append(row)
    return rows


def _assignment_rows(contractor, agreement_id: int | None = None) -> list[dict]:
    invitations_qs = _contractor_invitation_queryset(contractor).filter(
        status=SubcontractorInvitationStatus.ACCEPTED
    )
    milestones_qs = _contractor_milestone_queryset(contractor)
    if agreement_id is not None:
        invitations_qs = invitations_qs.filter(agreement_id=agreement_id)
        milestones_qs = milestones_qs.filter(agreement_id=agreement_id)

    invitations = list(invitations_qs.order_by("-accepted_at", "-id"))
    milestones = list(
        milestones_qs.filter(
            assigned_subcontractor_invitation__status=SubcontractorInvitationStatus.ACCEPTED
        ).order_by("agreement_id", "order", "id")
    )
    milestones_by_invitation: dict[int, list[Milestone]] = defaultdict(list)
    for milestone in milestones:
        if milestone.assigned_subcontractor_invitation_id:
            milestones_by_invitation[milestone.assigned_subcontractor_invitation_id].append(milestone)

    return [
        _serialize_assignment_row(invitation, milestones_by_invitation.get(invitation.id, []))
        for invitation in invitations
    ]


def _submission_rows(contractor) -> list[dict]:
    milestones = list(
        _contractor_milestone_queryset(contractor)
        .filter(
            assigned_subcontractor_invitation__status=SubcontractorInvitationStatus.ACCEPTED,
            subcontractor_completion_status__in=[
                SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
                SubcontractorCompletionStatus.NEEDS_CHANGES,
                SubcontractorCompletionStatus.APPROVED,
            ],
        )
        .order_by("-subcontractor_marked_complete_at", "-subcontractor_reviewed_at", "-id")
    )
    rows = []
    for milestone in milestones:
        invitation = milestone.assigned_subcontractor_invitation
        rows.append(
            {
                "id": milestone.id,
                "milestone_id": milestone.id,
                "agreement_id": milestone.agreement_id,
                "agreement_title": _agreement_title(milestone.agreement),
                "milestone_title": milestone.title,
                "subcontractor_display_name": _display_name(invitation) if invitation else "",
                "subcontractor_email": getattr(invitation, "invite_email", "") or "",
                "review_status": milestone.subcontractor_completion_status,
                "submitted_at": milestone.subcontractor_marked_complete_at,
                "reviewed_at": milestone.subcontractor_reviewed_at,
                "reviewed_by_display": (
                    getattr(getattr(milestone, "subcontractor_reviewed_by", None), "get_full_name", lambda: "")()
                    or getattr(getattr(milestone, "subcontractor_reviewed_by", None), "email", "")
                    or ""
                ),
                "notes": milestone.subcontractor_completion_note or "",
                "review_response_note": milestone.subcontractor_review_response_note or "",
            }
        )
    return rows


class ContractorSubcontractorDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contractor = _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"results": _directory_rows(contractor)})


class ContractorSubcontractorInviteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        agreement_id = request.data.get("agreement_id")
        if not agreement_id:
            return Response({"agreement_id": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            agreement, contractor = _get_owned_agreement(
                user=request.user,
                agreement_id=int(agreement_id),
            )
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)

        serializer = SubcontractorInvitationCreateSerializer(
            data=request.data,
            context={"agreement": agreement, "contractor": contractor},
        )
        serializer.is_valid(raise_exception=True)
        invitation = SubcontractorInvitation.objects.create(
            agreement=agreement,
            contractor=contractor,
            **serializer.validated_data,
        )
        delivery = send_subcontractor_invitation_email(request=request, invitation=invitation)
        payload = serialize_invitation_summary(invitation, request=request)
        payload["agreement_title"] = _agreement_title(agreement)
        payload["delivery"] = delivery
        return Response(payload, status=status.HTTP_201_CREATED)


class ContractorSubcontractorInvitationsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contractor = _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitations = list(
            _contractor_invitation_queryset(contractor).order_by("-invited_at", "-id")
        )
        results = []
        for invitation in invitations:
            invitation.refresh_expired_status()
            payload = serialize_invitation_summary(invitation, request=request)
            payload["agreement_title"] = _agreement_title(invitation.agreement)
            results.append(payload)
        return Response({"results": results})


class ContractorSubcontractorInvitationRevokeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, invitation_id: int):
        try:
            contractor = _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = get_object_or_404(
            _contractor_invitation_queryset(contractor),
            pk=invitation_id,
        )
        invitation.refresh_expired_status()
        if invitation.status != SubcontractorInvitationStatus.PENDING:
            return Response(
                {"detail": "Only pending invitations can be revoked."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invitation.mark_revoked()
        payload = serialize_invitation_summary(invitation, request=request)
        payload["agreement_title"] = _agreement_title(invitation.agreement)
        return Response(payload, status=status.HTTP_200_OK)


class ContractorSubcontractorAssignmentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contractor = _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"results": _assignment_rows(contractor)})


class AgreementSubcontractorAssignmentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        try:
            agreement, contractor = _get_owned_agreement(user=request.user, agreement_id=agreement_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"agreement_id": agreement.id, "results": _assignment_rows(contractor, agreement.id)})

    def post(self, request, agreement_id: int):
        try:
            agreement, contractor = _get_owned_agreement(user=request.user, agreement_id=agreement_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation_id = request.data.get("invitation_id")
        milestone_ids = request.data.get("milestone_ids") or []
        if not invitation_id:
            return Response({"invitation_id": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(milestone_ids, list) or not milestone_ids:
            return Response({"milestone_ids": ["Select at least one milestone."]}, status=status.HTTP_400_BAD_REQUEST)

        invitation = get_object_or_404(
            _contractor_invitation_queryset(contractor).filter(
                agreement=agreement,
                status=SubcontractorInvitationStatus.ACCEPTED,
            ),
            pk=invitation_id,
        )
        milestones = list(
            _contractor_milestone_queryset(contractor).filter(
                agreement=agreement,
                id__in=milestone_ids,
            )
        )
        if len(milestones) != len(set(int(x) for x in milestone_ids)):
            return Response(
                {"milestone_ids": ["One or more milestones could not be assigned."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        errors = {}
        updated = []
        with transaction.atomic():
            for milestone in milestones:
                serializer = MilestoneSerializer(
                    milestone,
                    data={"assigned_subcontractor_invitation": invitation.id},
                    partial=True,
                    context={"request": request},
                )
                if not serializer.is_valid():
                    errors[str(milestone.id)] = serializer.errors
                    continue
                updated.append(serializer.save())

        if errors:
            return Response({"detail": "Some milestones could not be assigned.", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        row = next(
            (item for item in _assignment_rows(contractor, agreement.id) if item["invitation_id"] == invitation.id),
            None,
        )
        return Response(
            {
                "agreement_id": agreement.id,
                "assignment": row,
                "updated_milestone_ids": [milestone.id for milestone in updated],
            },
            status=status.HTTP_200_OK,
        )


class ContractorSubcontractorWorkSubmissionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contractor = _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"results": _submission_rows(contractor)})


class ContractorSubcontractorWorkReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, submission_id: int):
        milestone = get_object_or_404(
            Milestone.objects.select_related(
                "agreement",
                "agreement__project",
                "assigned_subcontractor_invitation",
                "assigned_subcontractor_invitation__accepted_by_user",
                "subcontractor_reviewed_by",
            ),
            pk=submission_id,
        )
        try:
            _require_contractor(request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        if not can_user_review_submitted_work(milestone, request.user):
            return Response({"detail": "You are not allowed to review this submission."}, status=status.HTTP_403_FORBIDDEN)
        if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
            return Response({"detail": "No work submission is pending review."}, status=status.HTTP_400_BAD_REQUEST)

        action = str((request.data or {}).get("action") or "").strip().lower()
        response_note = str((request.data or {}).get("response_note") or "").strip()
        if action not in {"approve", "needs_changes"}:
            return Response({"action": ["Use 'approve' or 'needs_changes'."]}, status=status.HTTP_400_BAD_REQUEST)

        milestone.subcontractor_completion_status = (
            SubcontractorCompletionStatus.APPROVED
            if action == "approve"
            else SubcontractorCompletionStatus.NEEDS_CHANGES
        )
        milestone.subcontractor_reviewed_by = request.user
        milestone.subcontractor_review_response_note = response_note
        from django.utils import timezone

        milestone.subcontractor_reviewed_at = timezone.now()
        milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_reviewed_by",
                "subcontractor_review_response_note",
                "subcontractor_reviewed_at",
            ]
        )
        sync_milestone_payout(milestone.id)
        create_subcontractor_activity_notification(
            milestone=milestone,
            actor_user=request.user,
            event_type=Notification.EVENT_SUBCONTRACTOR_REVIEW,
        )
        payload = MilestoneSerializer(milestone, context={"request": request}).data
        return Response({"milestone": payload}, status=status.HTTP_200_OK)
