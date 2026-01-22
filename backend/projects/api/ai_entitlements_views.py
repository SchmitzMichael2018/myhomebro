# backend/projects/api/ai_entitlements_views.py
# v2026-01-22 — AI Entitlements endpoints (Step A)

from __future__ import annotations

from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK

from projects.models_ai_entitlements import ContractorAIEntitlement


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
                "tier": "free",
                "can_generate_recommendation": False,
                "free_recommendations_remaining": 0,
            },
            status=HTTP_200_OK,
        )

    ent, _ = ContractorAIEntitlement.objects.get_or_create(contractor_id=contractor.id)

    return JsonResponse(
        {
            "detail": "OK",
            "is_contractor": True,
            "contractor_id": contractor.id,
            "tier": ent.tier,
            "subscription_active": bool(ent.subscription_active),
            "free_recommendations_remaining": int(ent.free_recommendations_remaining or 0),
            "monthly_recommendations_included": int(ent.monthly_recommendations_included or 0),
            "monthly_recommendations_used": int(ent.monthly_recommendations_used or 0),
            "quota_period_start": ent.quota_period_start.isoformat() if ent.quota_period_start else None,
            "quota_period_end": ent.quota_period_end.isoformat() if ent.quota_period_end else None,
            "allow_ai_summaries": bool(ent.allow_ai_summaries),
            "allow_ai_recommendations": bool(ent.allow_ai_recommendations),
            "allow_scope_assistant": bool(ent.allow_scope_assistant),
            "allow_resolution_agreement": bool(ent.allow_resolution_agreement),
            "allow_business_insights": bool(ent.allow_business_insights),
            "can_generate_recommendation": bool(ent.can_generate_recommendation()),
        },
        status=HTTP_200_OK,
    )
