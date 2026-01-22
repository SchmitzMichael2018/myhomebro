# backend/projects/views/feature_flags.py
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


class FeatureFlagsView(APIView):
    """
    Read-only feature flags for frontend capability gating.
    Django settings are the single source of truth.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "ai_enabled": bool(getattr(settings, "AI_ENABLED", False)),
                "ai_disputes_enabled": bool(getattr(settings, "AI_DISPUTES_ENABLED", False)),
                "ai_insights_enabled": bool(getattr(settings, "AI_INSIGHTS_ENABLED", False)),
                "ai_scope_assist_enabled": bool(getattr(settings, "AI_SCOPE_ASSIST_ENABLED", False)),
            }
        )
