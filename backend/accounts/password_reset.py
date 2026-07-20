# backend/accounts/password_reset.py
from __future__ import annotations

import logging
from datetime import datetime

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode
from django.utils.http import urlsafe_base64_encode

from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from .serializers import (
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
)
from projects.models import ContractorSubAccount
from projects.services.team_account_setup import (
    team_account_setup_expires_at,
    team_account_setup_status,
    team_account_setup_status_label,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def _frontend_url() -> str:
    """
    Base URL for building frontend links.
    Uses settings.FRONTEND_BASE_URL when present, else defaults to production.
    """
    return getattr(
        settings,
        "FRONTEND_BASE_URL",
        "https://www.myhomebro.com",
    ).rstrip("/")


def _build_reset_link(user: User) -> str:
    """
    Produces:
      https://www.myhomebro.com/reset-password/<uid>/<token>/
    """
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{_frontend_url()}/reset-password/{uid}/{token}/"


def _build_plaintext_body(user: User, reset_url: str) -> str:
    first_name = getattr(user, "first_name", "") or "there"
    return (
        f"Hi {first_name},\n\n"
        f"We received a request to reset the password for your MyHomeBro account.\n"
        f"If you made this request, click the link below to choose a new password:\n\n"
        f"{reset_url}\n\n"
        f"If you did not request a password reset, you can safely ignore this email.\n\n"
        f"Thank you,\n"
        f"The MyHomeBro Team\n"
    )


def send_reset_email(user: User) -> None:
    """
    Sends a password reset email (plaintext + HTML).
    HTML is rendered from templates/emails/password_reset.html

    NOTE: While validating email delivery, we do NOT fail silently so problems surface.
    You can make this environment-based later if you want.
    """
    reset_url = _build_reset_link(user)
    subject = "Reset Your MyHomeBro Password"
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")
    to = [user.email]

    text_body = _build_plaintext_body(user, reset_url)

    # Template context matches the uploaded password_reset.html:
    # {{ first_name }}, {{ reset_url }}, {{ year }}
    ctx = {
        "first_name": (getattr(user, "first_name", "") or "").strip(),
        "reset_url": reset_url,
        "year": datetime.utcnow().year,
    }

    try:
        html_body = render_to_string("emails/password_reset.html", ctx)
    except Exception:
        # If template missing/misplaced, log and still send plaintext.
        logger.exception("Password reset HTML template render failed. Sending plaintext only.")
        html_body = None

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=to,
    )

    if html_body:
        msg.attach_alternative(html_body, "text/html")

    # IMPORTANT FOR DEBUGGING: do NOT hide delivery failures
    try:
        msg.send(fail_silently=False)
    except Exception:
        logger.exception("Password reset email failed to send to %s", user.email)
        # We do not raise, because the endpoint should remain enumeration-safe


class PasswordResetRequestView(APIView):
    """
    POST /accounts/auth/password-reset/request/
    Body: { "email": "..." }
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        # Keep enumeration-safe behavior: do not raise validation errors outward
        serializer.is_valid(raise_exception=False)

        email = (serializer.validated_data.get("email") or "").strip().lower()

        if email:
            users = User.objects.filter(email__iexact=email, is_active=True)
            for u in users:
                send_reset_email(u)

        return Response(
            {"detail": "If this email is registered, a reset link has been sent."},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """
    POST /accounts/auth/password-reset/confirm/
    Body: { "uid": "...", "token": "...", "new_password": "..." }
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()

        return Response(
            {"detail": "Password has been reset successfully."},
            status=status.HTTP_200_OK,
        )


def _decode_setup_user(uidb64: str):
    user_id = force_str(urlsafe_base64_decode(uidb64))
    return User.objects.get(pk=user_id)


class TeamAccountSetupValidateView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, uid, token):
        try:
            user = _decode_setup_user(uid)
            subaccount = ContractorSubAccount.objects.select_related("parent_contractor", "user").get(user=user)
        except Exception:
            return Response({"detail": "This setup link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response({"detail": "This setup link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "detail": "Setup link is valid.",
                "email": user.email,
                "display_name": subaccount.display_name,
                "contractor_business_name": getattr(subaccount.parent_contractor, "business_name", "") or "",
                "setup_status": team_account_setup_status(subaccount),
                "setup_status_label": team_account_setup_status_label(subaccount),
                "setup_expires_at": team_account_setup_expires_at(subaccount),
            },
            status=status.HTTP_200_OK,
        )


class TeamAccountSetupConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        uid = request.data.get("uid")
        token = request.data.get("token")
        new_password = request.data.get("new_password")
        if not uid or not token or not new_password:
            return Response(
                {"detail": "Setup link and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = _decode_setup_user(uid)
            subaccount = ContractorSubAccount.objects.select_related("parent_contractor", "user").get(user=user)
        except Exception:
            return Response({"detail": "This setup link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response({"detail": "This setup link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=user)
        except Exception as exc:
            return Response({"new_password": list(getattr(exc, "messages", [str(exc)]))}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.is_active = True
        user.save(update_fields=["password", "is_active"])

        subaccount.is_active = True
        subaccount.setup_completed_at = timezone.now()
        subaccount.save(update_fields=["is_active", "setup_completed_at", "updated_at"])

        return Response(
            {"detail": "Team account setup complete. You can now sign in."},
            status=status.HTTP_200_OK,
        )
