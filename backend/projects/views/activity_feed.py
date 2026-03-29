from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.activity_feed import build_dashboard_activity_payload


def _contractor_for_user(user):
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


class ContractorActivityFeedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"results": [], "next_best_action": {}}, status=200)
        try:
            limit = int(request.query_params.get("limit") or 12)
        except Exception:
            limit = 12
        return Response(build_dashboard_activity_payload(contractor, limit=limit), status=200)
