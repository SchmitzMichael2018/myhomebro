# backend/accounts/urls.py

from django.urls import path, include
from .views import ContractorRegistrationView
from .email_verification_views import EmailVerificationView
from .password_reset_views import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetCompleteView,
)

app_name = "accounts_api"

urlpatterns = [
    # Registration
    path(
        "auth/contractor-register/",
        ContractorRegistrationView.as_view(),
        name="contractor-register",
    ),

    # Email Verification
    path(
        "auth/verify-email/<uidb64>/<token>/",
        EmailVerificationView.as_view(),
        name="verify_email",
    ),

    # Password Reset
    path(
        "auth/password-reset/request/",
        PasswordResetRequestView.as_view(),
        name="password_reset_request",
    ),
    path(
        "auth/password-reset/confirm/<uidb64>/<token>/",
        PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),
    path(
        "auth/password-reset/complete/",
        PasswordResetCompleteView.as_view(),
        name="password_reset_complete",
    ),

    # Mount the auth login/refresh and email-available utilities here as well.
    path("auth/", include("accounts.auth_urls")),
]
