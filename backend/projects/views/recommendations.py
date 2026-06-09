from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.recommendations import build_recommendations_for_user, recommendation_audit_summary


class RecommendationMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = int(request.query_params.get("limit") or 5)
        except (TypeError, ValueError):
            limit = 5
        limit = max(1, min(limit, 10))
        return Response(
            {
                "recommendations": build_recommendations_for_user(request.user, limit=limit),
                "audit_sources": recommendation_audit_summary(),
            }
        )
