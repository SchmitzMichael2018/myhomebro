# accounts/email_verification_views.py
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import get_user_model
from django.views import View

User = get_user_model()

class EmailVerificationView(View):
    """
    Handles the email verification process. On success or failure, it redirects
    to a designated frontend page with a status query parameter.
    """
    def get(self, request, uidb64, token):
        # Define frontend URLs for redirection
        success_url = f"{settings.FRONTEND_URL}/email-verified?status=success"
        failure_url = f"{settings.FRONTEND_URL}/email-verified?status=failure"

        try:
            uid = urlsafe_base64_decode(uidb64).decode()
            user = User.objects.get(pk=uid)

            if default_token_generator.check_token(user, token):
                # Mark the user as active and verified.
                # You might only want to set is_active=True here if users are inactive until verified.
                user.is_active = True
                user.is_verified = True
                user.save()
                return HttpResponseRedirect(success_url)
            else:
                return HttpResponseRedirect(failure_url)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return HttpResponseRedirect(failure_url)