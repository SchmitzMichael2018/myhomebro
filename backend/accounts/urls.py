# backend/accounts/urls.py

from django.urls import path, include
from .views import ContractorRegistrationView, CustomerRegistrationView, PublicRegistrationQrView
from .email_verification_views import EmailVerificationView
from .verification_views import (
    ConfirmPhoneVerificationView,
    RequestPhoneVerificationView,
    ResendVerificationEmailView,
    VerificationStatusView,
    VerifyAccountEmailView,
)
from .password_reset import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    TeamAccountSetupConfirmView,
    TeamAccountSetupValidateView,
)
from .account_settings_views import (
    ChangeEmailView,
    ChangePasswordView,
    ChangePhoneView,
)

app_name = "accounts_api"

urlpatterns = [
    path(
        "public/registration-qr/",
        PublicRegistrationQrView.as_view(),
        name="public-registration-qr",
    ),
    # Registration -------------------------------------------------------------
    path(
        "auth/contractor-register/",
        ContractorRegistrationView.as_view(),
        name="contractor-register",
    ),
    path(
        "auth/customer-register/",
        CustomerRegistrationView.as_view(),
        name="customer-register",
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
    path("auth/verify-account-email/<str:token>/", VerifyAccountEmailView.as_view(), name="verify-account-email"),
    path("auth/verification/status/", VerificationStatusView.as_view(), name="verification-status"),
    path("auth/verification/resend-email/", ResendVerificationEmailView.as_view(), name="verification-resend-email"),
    path("auth/verification/request-phone/", RequestPhoneVerificationView.as_view(), name="verification-request-phone"),
    path("auth/verification/confirm-phone/", ConfirmPhoneVerificationView.as_view(), name="verification-confirm-phone"),
    path(
        "auth/team-account-setup/<uid>/<token>/",
        TeamAccountSetupValidateView.as_view(),
        name="team_account_setup_validate",
    ),
    path(
        "auth/team-account-setup/confirm/",
        TeamAccountSetupConfirmView.as_view(),
        name="team_account_setup_confirm",
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
    path("change-phone/", ChangePhoneView.as_view(), name="change-phone"),
]
