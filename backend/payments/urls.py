# backend/payments/urls.py
from django.urls import path
from .views import (
    OnboardingStart,
    OnboardingStatus,
    OnboardingManage,
    OnboardingLoginLink,  # optional
)

# NOTE: The Stripe webhook is mounted in core/urls.py at /stripe/webhook/

app_name = "payments"

urlpatterns = [
    # Onboarding
    path("onboarding/start/", OnboardingStart.as_view(), name="payments-onboarding-start"),
    path("onboarding/status/", OnboardingStatus.as_view(), name="payments-onboarding-status"),

    # NEW: Manage existing Stripe account settings (bank account, tax info, docs)
    path("onboarding/manage/", OnboardingManage.as_view(), name="payments-onboarding-manage"),

    # NEW (optional): One-click login to Stripe Express Dashboard
    path("onboarding/login-link/", OnboardingLoginLink.as_view(), name="payments-onboarding-login"),
]
