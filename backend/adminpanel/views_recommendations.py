from __future__ import annotations

from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.recommendations import build_admin_recommendations, recommendation_audit_summary


class AdminRecommendationsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        try:
            limit = int(request.query_params.get("limit") or 10)
        except (TypeError, ValueError):
            limit = 10
        limit = max(1, min(limit, 25))
        return Response(
            {
                "recommendations": build_admin_recommendations(params=request.query_params, limit=limit),
                "audit_sources": recommendation_audit_summary(),
            }
        )
