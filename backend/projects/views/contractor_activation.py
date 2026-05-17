from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.contractor_activation_summary import (
    build_contractor_activation_summary,
    dismiss_contractor_activation_section,
)


class ContractorActivationSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor is None:
            return Response({"detail": "Only contractors can view activation guidance."}, status=status.HTTP_403_FORBIDDEN)
        return Response(build_contractor_activation_summary(contractor), status=status.HTTP_200_OK)


class ContractorActivationSummaryDismissView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor is None:
            return Response({"detail": "Only contractors can update activation guidance."}, status=status.HTTP_403_FORBIDDEN)
        section = str(request.data.get("section") or "").strip()
        try:
            payload = dismiss_contractor_activation_section(contractor, section)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(payload, status=status.HTTP_200_OK)
