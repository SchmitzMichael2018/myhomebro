# backend/projects/views/subaccounts.py
# v2025-11-16 — ContractorSubAccountViewSet + debug-safe WhoAmI endpoint

from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated  # only used for subaccounts
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ContractorSubAccount
from projects.serializers.subaccounts import (
    ContractorSubAccountSerializer,
    ContractorSubAccountCreateSerializer,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user
from projects.permissions_subaccounts import IsContractorOrSubAccount


class ContractorSubAccountViewSet(viewsets.ModelViewSet):
    """
    Contractor-side management of employee sub-accounts.

    - List + retrieve: view all your employees.
    - Create: invite/create a new employee with email/password.
    - Update/partial_update: change display name, role, is_active, notes.
    """

    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return ContractorSubAccount.objects.none()
        return (
            ContractorSubAccount.objects.filter(parent_contractor=contractor)
            .select_related("user", "parent_contractor")
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return ContractorSubAccountCreateSerializer
        return ContractorSubAccountSerializer

    def perform_create(self, serializer):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            raise PermissionError("You must be a contractor to create sub-accounts.")
        serializer.save(parent_contractor=contractor)


class WhoAmIView(APIView):
    """
    DEBUG-SAFE identity endpoint:

    GET /api/projects/whoami/

    Always returns 200 with JSON, no auth required (for now):

    {
      "user_id": <int or null>,
      "username": <str or null>,
      "email": <str or null>,
      "type": "contractor" | "subaccount" | "none",
      "role": "contractor_owner" | "employee_readonly" | "employee_milestones" | null,
      "contractor_id": <int or null>,
      "subaccount_id": <int or null>
    }
    """

    # IMPORTANT: no permission_classes here while debugging
    permission_classes: list = []

    def get(self, request, *args, **kwargs):
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            # Even if anonymous, respond with type = none (still HTTP 200)
            return Response(
                {
                    "user_id": None,
                    "username": None,
                    "email": None,
                    "type": "none",
                    "role": None,
                    "contractor_id": None,
                    "subaccount_id": None,
                },
                status=status.HTTP_200_OK,
            )

        contractor = get_contractor_for_user(user)
        subaccount = get_subaccount_for_user(user)

        base = {
            "user_id": getattr(user, "id", None),
            "username": getattr(user, "username", None),
            "email": getattr(user, "email", None),
        }

        if contractor is None:
            # Authenticated but not wired to Contractor/SubAccount
            return Response(
                {
                    **base,
                    "type": "none",
                    "role": None,
                    "contractor_id": None,
                    "subaccount_id": None,
                },
                status=status.HTTP_200_OK,
            )

        if subaccount is None:
            # Primary contractor
            return Response(
                {
                    **base,
                    "type": "contractor",
                    "role": "contractor_owner",
                    "contractor_id": contractor.id,
                    "subaccount_id": None,
                },
                status=status.HTTP_200_OK,
            )

        # Employee sub-account
        return Response(
            {
                **base,
                "type": "subaccount",
                "role": subaccount.role,
                "contractor_id": contractor.id,
                "subaccount_id": subaccount.id,
            },
            status=status.HTTP_200_OK,
        )
