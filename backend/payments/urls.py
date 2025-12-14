from django.urls import path

from .views import (
    OnboardingStart,
    OnboardingStatus,
    OnboardingManage,
    OnboardingLoginLink,
)

# NEW: escrow refunds
from payments.views.escrow_refunds import AgreementEscrowRefundView

app_name = "payments"

urlpatterns = [
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
