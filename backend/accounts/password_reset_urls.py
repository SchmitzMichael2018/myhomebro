# accounts/password_reset_urls.py
from django.urls import path
from .password_reset_views import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetCompleteView
)

urlpatterns = [
    path('request/', PasswordResetRequestView.as_view(), name='password_reset_request_json'),
    path('confirm/<uidb64>/<token>/', PasswordResetConfirmView.as_view(), name='password_reset_confirm_secure'),
    path('complete/', PasswordResetCompleteView.as_view(), name='password_reset_complete'),
]


