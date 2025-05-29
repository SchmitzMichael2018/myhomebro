"""
accounts/email_verification_views.py

Handles secure email verification using unique tokens.
"""
from django.shortcuts import redirect
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import get_user_model
from django.views import View
from django.http import HttpResponse

User = get_user_model()

class EmailVerificationView(View):
    """
    Secure Email Verification Endpoint.
    """
    def get(self, request, uidb64, token):
        try:
            uid = urlsafe_base64_decode(uidb64).decode()
            user = User.objects.get(pk=uid)

            if default_token_generator.check_token(user, token):
                user.is_verified = True
                user.save()
                return HttpResponse("✅ Email verified successfully.")
            else:
                return HttpResponse("❌ Invalid or expired verification link.")
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return HttpResponse("❌ Invalid verification link.")
