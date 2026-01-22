# backend/projects/api/disputes_ai_urls.py
# v2026-01-22 — Dispute AI urls + entitlement endpoint (Step A)

from django.urls import path

from projects.api.ai_entitlements_views import my_ai_entitlements
from projects.api.disputes_ai_views import (
    dispute_ai_recommendation,
    dispute_ai_artifacts,
)

urlpatterns = [
    # GET: my entitlements (Step A)
    path("ai/entitlements/me/", my_ai_entitlements, name="ai-entitlements-me"),

    # POST: generate recommendation (gated by entitlements)
    path(
        "disputes/<int:dispute_id>/ai/recommendation/",
        dispute_ai_recommendation,
        name="dispute-ai-recommendation",
    ),

    # GET: list/fetch stored artifacts (no AI call)
    path(
        "disputes/<int:dispute_id>/ai/artifacts/",
        dispute_ai_artifacts,
        name="dispute-ai-artifacts",
    ),
]
