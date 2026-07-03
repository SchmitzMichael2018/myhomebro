from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement, ContractorSubAccount
from projects.services.assignment_conflicts import evaluate_assignment_conflicts
from projects.utils.accounts import get_contractor_for_user


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def check_assignment_conflicts(request):
    """
    POST /api/projects/assignments/check-conflicts/

    Body:
      {
        "subaccount_id": 123,
        "agreement_id": 456
      }

    Response includes:
      - overlap conflicts (blocking for non-supervisors)
      - schedule warnings (weekly schedule + exceptions)
    """
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied("Contractor owner required.")

    subaccount_id = request.data.get("subaccount_id")
    agreement_id = request.data.get("agreement_id")
    if not subaccount_id or not agreement_id:
        return Response({"detail": "subaccount_id and agreement_id required"}, status=400)

    try:
        subaccount = ContractorSubAccount.objects.select_related("user").get(
            id=subaccount_id,
            parent_contractor=contractor,
            is_active=True,
        )
    except ContractorSubAccount.DoesNotExist:
        return Response({"detail": "Employee not found."}, status=404)

    try:
        agreement = Agreement.objects.select_related("project").get(id=agreement_id, contractor=contractor)
    except Agreement.DoesNotExist:
        return Response({"detail": "Agreement not found."}, status=404)

    return Response(evaluate_assignment_conflicts(contractor=contractor, subaccount=subaccount, agreement=agreement))
