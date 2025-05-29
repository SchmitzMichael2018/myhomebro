# accounts/urls.py

"""
This file manages registration, email verification, and password reset endpoints
for the accounts app.
"""

from django.urls import path
from .views import ContractorRegistrationView
from .email_verification_views import EmailVerificationView
from .password_reset_views import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetCompleteView,
)

app_name = "accounts_api"

urlpatterns = [
    # Single-step Contractor Registration (with instant login tokens)
    path(
        'auth/contractor-register/',
        ContractorRegistrationView.as_view(),
        name='contractor-register'
    ),

    # (Optional: generic user registration endpoint, if you add a HomeownerRegistrationView, etc.)
    # path('auth/homeowner-register/', HomeownerRegistrationView.as_view(), name='homeowner-register'),

    # Email Verification
    path(
        'auth/verify-email/<uidb64>/<token>/',
        EmailVerificationView.as_view(),
        name='verify_email'
    ),

    # Password Reset
    path(
        'auth/password-reset/request/',
        PasswordResetRequestView.as_view(),
        name='password_reset_request'
    ),
    path(
        'auth/password-reset/confirm/<uidb64>/<token>/',
        PasswordResetConfirmView.as_view(),
        name='password_reset_confirm'
    ),
    path(
        'auth/password-reset/complete/',
        PasswordResetCompleteView.as_view(),
        name='password_reset_complete'
    ),
]



