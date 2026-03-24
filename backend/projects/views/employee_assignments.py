# backend/projects/views/employee_assignments.py
# v2026-01-02 — Owner endpoints for assigning work to ContractorSubAccounts

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from projects.models import (
    Agreement,
    Milestone,
    ContractorSubAccount,
    AgreementAssignment,
    MilestoneAssignment,
)
from projects.services.milestone_payouts import sync_milestone_payout
from projects.utils.accounts import get_contractor_for_user


def _require_contractor_owner(request):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied("Contractor owner required.")
    return contractor


def _get_subaccount_or_404(contractor, subaccount_id):
    try:
        return ContractorSubAccount.objects.get(
            id=subaccount_id,
            parent_contractor=contractor,
        )
    except ContractorSubAccount.DoesNotExist:
        return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assign_agreement(request, agreement_id: int):
    """
    POST /api/projects/assignments/agreements/<agreement_id>/assign/
    { "subaccount_id": <int> }

    Assigns entire agreement to subaccount (idempotent).
    """
    contractor = _require_contractor_owner(request)

    subaccount_id = request.data.get("subaccount_id")
    if not subaccount_id:
        return Response({"detail": "subaccount_id required"}, status=400)

    sub = _get_subaccount_or_404(contractor, subaccount_id)
    if not sub:
        return Response({"detail": "Subaccount not found."}, status=404)

    try:
        agreement = Agreement.objects.get(id=agreement_id, contractor=contractor)
    except Agreement.DoesNotExist:
        return Response({"detail": "Agreement not found."}, status=404)

    obj, created = AgreementAssignment.objects.get_or_create(
        agreement=agreement,
        subaccount=sub,
    )
    return Response({"assigned": True, "created": created, "id": obj.id})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unassign_agreement(request, agreement_id: int):
    """
    POST /api/projects/assignments/agreements/<agreement_id>/unassign/
    { "subaccount_id": <int> }

    Unassigns entire agreement from subaccount (idempotent).
    """
    contractor = _require_contractor_owner(request)

    subaccount_id = request.data.get("subaccount_id")
    if not subaccount_id:
        return Response({"detail": "subaccount_id required"}, status=400)

    deleted, _ = AgreementAssignment.objects.filter(
        agreement_id=agreement_id,
        subaccount_id=subaccount_id,
        agreement__contractor=contractor,
    ).delete()

    return Response({"unassigned": True, "deleted": deleted})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assign_milestone(request, milestone_id: int):
    """
    POST /api/projects/assignments/milestones/<milestone_id>/assign/
    { "subaccount_id": <int> }

    Explicitly assigns a milestone to a subaccount (override rule).
    One milestone can be assigned to only one subaccount at a time (OneToOne).
    """
    contractor = _require_contractor_owner(request)

    subaccount_id = request.data.get("subaccount_id")
    if not subaccount_id:
        return Response({"detail": "subaccount_id required"}, status=400)

    sub = _get_subaccount_or_404(contractor, subaccount_id)
    if not sub:
        return Response({"detail": "Subaccount not found."}, status=404)

    try:
        milestone = Milestone.objects.select_related("agreement").get(
            id=milestone_id,
            agreement__contractor=contractor,
        )
    except Milestone.DoesNotExist:
        return Response({"detail": "Milestone not found."}, status=404)

    obj, created = MilestoneAssignment.objects.update_or_create(
        milestone=milestone,
        defaults={"subaccount": sub},
    )
    sync_milestone_payout(milestone.id)
    return Response({"assigned": True, "created": created, "id": obj.id})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unassign_milestone(request, milestone_id: int):
    """
    POST /api/projects/assignments/milestones/<milestone_id>/unassign/

    Removes explicit milestone assignment (idempotent).
    """
    contractor = _require_contractor_owner(request)

    deleted, _ = MilestoneAssignment.objects.filter(
        milestone_id=milestone_id,
        milestone__agreement__contractor=contractor,
    ).delete()
    sync_milestone_payout(milestone_id)

    return Response({"unassigned": True, "deleted": deleted})
