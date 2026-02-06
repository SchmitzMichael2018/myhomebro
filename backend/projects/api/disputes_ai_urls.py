# backend/projects/api/disputes_ai_urls.py
# v2026-01-22 — AI urls (entitlements + disputes + checkout + agreements)

from django.urls import path

from projects.api.ai_entitlements_views import my_ai_entitlements
from projects.api.ai_checkout_views import create_ai_recommendation_checkout, ai_checkout_status
from projects.api.disputes_ai_views import dispute_ai_recommendation, dispute_ai_artifacts
from projects.api.ai_agreement_views import ai_agreement_description

urlpatterns = [
    # Step A: entitlements
    path("ai/entitlements/me/", my_ai_entitlements, name="ai-entitlements-me"),

    # Step B: checkout + status (no webhook required)
    path("ai/checkout/recommendation/", create_ai_recommendation_checkout, name="ai-checkout-recommendation"),
    path("ai/checkout/status/", ai_checkout_status, name="ai-checkout-status"),

    # AI Dispute endpoints
    path("disputes/<int:dispute_id>/ai/recommendation/", dispute_ai_recommendation, name="dispute-ai-recommendation"),
    path("disputes/<int:dispute_id>/ai/artifacts/", dispute_ai_artifacts, name="dispute-ai-artifacts"),

    # ✅ Agreement AI (Step 1 only here)
    path("agreements/ai/description/", ai_agreement_description, name="ai-agreement-description"),
]
