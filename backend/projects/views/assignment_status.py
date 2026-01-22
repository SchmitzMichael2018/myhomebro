# backend/projects/views/assignment_status.py
# v2026-01-03 — read-only assignment status endpoints (current assignees)

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
from projects.utils.accounts import get_contractor_for_user


def _require_contractor_owner(request):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied("Contractor owner required.")
    return contractor


def _subaccount_payload(sub: ContractorSubAccount):
    u = getattr(sub, "user", None)
    return {
        "id": sub.id,
        "display_name": sub.display_name,
        "email": getattr(u, "email", None),
        "role": sub.role,
        "is_active": sub.is_active,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_assignment_status(request, agreement_id: int):
    """
    GET /api/projects/assignments/agreements/<agreement_id>/status/

    Returns agreement-level subaccount assignments (can be 0..N).
    """
    contractor = _require_contractor_owner(request)

    try:
        agreement = Agreement.objects.get(id=agreement_id, contractor=contractor)
    except Agreement.DoesNotExist:
        return Response({"detail": "Agreement not found."}, status=404)

    assigned_sub_ids = list(
        AgreementAssignment.objects.filter(agreement=agreement).values_list("subaccount_id", flat=True)
    )
    subs = (
        ContractorSubAccount.objects.filter(id__in=assigned_sub_ids, parent_contractor=contractor)
        .select_related("user")
        .order_by("display_name", "id")
    )

    return Response(
        {
            "agreement_id": agreement.id,
            "assigned_subaccounts": [_subaccount_payload(s) for s in subs],
            "count": subs.count(),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def milestone_assignment_status(request, milestone_id: int):
    """
    GET /api/projects/assignments/milestones/<milestone_id>/status/

    Returns:
      - milestone override assignment (0 or 1 subaccount)
      - agreement-level assignments (0..N), for context
    """
    contractor = _require_contractor_owner(request)

    try:
        milestone = (
            Milestone.objects.select_related("agreement")
            .get(id=milestone_id, agreement__contractor=contractor)
        )
    except Milestone.DoesNotExist:
        return Response({"detail": "Milestone not found."}, status=404)

    # Override (OneToOne)
    override = None
    try:
        ma = MilestoneAssignment.objects.select_related("subaccount", "subaccount__user").get(milestone=milestone)
        override = _subaccount_payload(ma.subaccount)
    except MilestoneAssignment.DoesNotExist:
        override = None

    # Agreement-level assignments
    agreement_assigned_sub_ids = list(
        AgreementAssignment.objects.filter(agreement_id=milestone.agreement_id).values_list("subaccount_id", flat=True)
    )
    subs = (
        ContractorSubAccount.objects.filter(id__in=agreement_assigned_sub_ids, parent_contractor=contractor)
        .select_related("user")
        .order_by("display_name", "id")
    )

    return Response(
        {
            "milestone_id": milestone.id,
            "agreement_id": milestone.agreement_id,
            "override_subaccount": override,
            "agreement_assigned_subaccounts": [_subaccount_payload(s) for s in subs],
            "agreement_count": subs.count(),
        }
    )
