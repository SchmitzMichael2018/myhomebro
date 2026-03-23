# backend/projects/api/ai_entitlements_views.py
# Compatibility endpoint: AI is included by default and no entitlement record
# is required or consulted at runtime.

from __future__ import annotations

from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK

def _get_contractor_for_user(user):
    """
    Your Contractor model is OneToOne with AUTH_USER.
    This returns contractor_profile if present.
    """
    return getattr(user, "contractor_profile", None)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_ai_entitlements(request):
    user = request.user
    contractor = _get_contractor_for_user(user)

    # If a non-contractor user hits this, return a minimal payload
    if not contractor:
        return JsonResponse(
            {
                "detail": "OK",
                "is_contractor": False,
                "ai_access": "included",
                "ai_enabled": True,
                "ai_unlimited": True,
            },
            status=HTTP_200_OK,
        )

    return JsonResponse(
        {
            "detail": "OK",
            "is_contractor": True,
            "contractor_id": contractor.id,
            "ai_access": "included",
            "ai_enabled": True,
            "ai_unlimited": True,
        },
        status=HTTP_200_OK,
    )
