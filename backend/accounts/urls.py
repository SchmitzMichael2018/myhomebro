# backend/accounts/urls.py

from django.urls import path, include
from .views import ContractorRegistrationView
from .email_verification_views import EmailVerificationView
from .password_reset import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
)
from .account_settings_views import (
    ChangeEmailView,
    ChangePasswordView,
)

app_name = "accounts_api"

urlpatterns = [
    # Registration -------------------------------------------------------------
    path(
        "auth/contractor-register/",
        ContractorRegistrationView.as_view(),
        name="contractor-register",
    ),

    # Email Verification -------------------------------------------------------
    path(
        "auth/verify-email/<uidb64>/<token>/",
        EmailVerificationView.as_view(),
        name="verify_email",
    ),

    # Password Reset -----------------------------------------------------------
    # Step 1: request reset link (ForgotPassword.jsx)
    path(
        "auth/password-reset/request/",
        PasswordResetRequestView.as_view(),
        name="password_reset_request",
    ),
    # Step 2: confirm reset (ResetPassword.jsx)
    path(
        "auth/password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),

    # Auth (JWT login/refresh/etc.) -------------------------------------------
    path("auth/", include("accounts.auth_urls")),

    # Account Settings (Change Email / Password) ------------------------------
    path(
        "change-email/",
        ChangeEmailView.as_view(),
        name="change-email",
    ),
    path(
        "change-password/",
        ChangePasswordView.as_view(),
        name="change-password",
    ),
]
