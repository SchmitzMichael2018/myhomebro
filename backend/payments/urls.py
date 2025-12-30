# backend/payments/urls.py

from django.urls import path

from .views import (
    OnboardingStart,
    OnboardingStatus,
    OnboardingManage,
    OnboardingLoginLink,
)

from payments.views.escrow_refunds import AgreementEscrowRefundView

# ✅ ADD THIS IMPORT
from payments.webhooks import stripe_webhook

app_name = "payments"

urlpatterns = [
    # ──────────────────────────────────────────────────────────────────
    # Stripe webhook (REQUIRED)
    # ──────────────────────────────────────────────────────────────────
    path("webhooks/stripe/", stripe_webhook, name="stripe-webhook"),

    # ──────────────────────────────────────────────────────────────────
    # Stripe Connect onboarding
    # ──────────────────────────────────────────────────────────────────
    path("onboarding/start/", OnboardingStart.as_view(), name="payments-onboarding-start"),
    path("onboarding/status/", OnboardingStatus.as_view(), name="payments-onboarding-status"),
    path("onboarding/manage/", OnboardingManage.as_view(), name="payments-onboarding-manage"),
    path("onboarding/login-link/", OnboardingLoginLink.as_view(), name="payments-onboarding-login"),

    # ──────────────────────────────────────────────────────────────────
    # Escrow refunds (contractor-owner only)
    # ──────────────────────────────────────────────────────────────────
    path(
        "agreements/<int:agreement_id>/refund_escrow/",
        AgreementEscrowRefundView.as_view(),
        name="agreement-escrow-refund",
    ),
]
