# backend/projects/api/ai_entitlements_views.py
# v2026-03-03 — AI Entitlements endpoints (Step A) + Scope Credits (Step B)

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
                # NEW fields (safe defaults)
                "scope_unlimited": False,
                "scope_credits_remaining": 0,
                "can_generate_scope": False,
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

            # Recommendations (existing)
            "free_recommendations_remaining": int(ent.free_recommendations_remaining or 0),
            "monthly_recommendations_included": int(ent.monthly_recommendations_included or 0),
            "monthly_recommendations_used": int(ent.monthly_recommendations_used or 0),
            "quota_period_start": ent.quota_period_start.isoformat() if ent.quota_period_start else None,
            "quota_period_end": ent.quota_period_end.isoformat() if ent.quota_period_end else None,
            "allow_ai_summaries": bool(ent.allow_ai_summaries),
            "allow_ai_recommendations": bool(ent.allow_ai_recommendations),

            # Scope assistant flags (existing)
            "allow_scope_assistant": bool(ent.allow_scope_assistant),

            # Other (existing)
            "allow_resolution_agreement": bool(ent.allow_resolution_agreement),
            "allow_business_insights": bool(ent.allow_business_insights),

            # Existing computed
            "can_generate_recommendation": bool(ent.can_generate_recommendation()),

            # ---------------- NEW: Scope credits / quota ----------------
            "scope_unlimited": bool(ent.scope_unlimited),
            "free_scope_credits_remaining": int(ent.free_scope_credits_remaining or 0),
            "monthly_scope_credits_included": int(ent.monthly_scope_credits_included or 0),
            "monthly_scope_credits_used": int(ent.monthly_scope_credits_used or 0),
            "scope_quota_period_start": ent.scope_quota_period_start.isoformat() if ent.scope_quota_period_start else None,
            "scope_quota_period_end": ent.scope_quota_period_end.isoformat() if ent.scope_quota_period_end else None,
            "scope_credits_remaining": int(ent.scope_credits_remaining() if not ent.scope_unlimited else 0),
            "can_generate_scope": bool(ent.can_generate_scope()),
        },
        status=HTTP_200_OK,
    )