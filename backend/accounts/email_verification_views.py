# accounts/email_verification_views.py
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import get_user_model
from django.views import View
from django.utils import timezone
from accounts.services.verification import verification_token
from urllib.parse import urlencode

User = get_user_model()

class EmailVerificationView(View):
    """
    Handles the email verification process. On success or failure, it redirects
    to a designated frontend page with a status query parameter.
    """
    def get(self, request, uidb64, token):
        # Define frontend URLs for redirection
        success_url = f"{settings.FRONTEND_URL}/verify-account"
        failure_url = f"{settings.FRONTEND_URL}/email-verified?status=failure"

        try:
            uid = urlsafe_base64_decode(uidb64).decode()
            user = User.objects.get(pk=uid)

            if default_token_generator.check_token(user, token):
                user.email_verified_at = user.email_verified_at or timezone.now()
                user.is_verified = True
                if user.verification_state == User.VerificationState.PENDING_EMAIL:
                    user.verification_state = User.VerificationState.PENDING_PHONE
                user.save(update_fields=["email_verified_at", "is_verified", "verification_state"])
                query = urlencode({"status": "email_verified", "verification_session": verification_token(user)})
                return HttpResponseRedirect(f"{success_url}?{query}")
            else:
                return HttpResponseRedirect(failure_url)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return HttpResponseRedirect(failure_url)
