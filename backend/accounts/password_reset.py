# backend/accounts/password_reset.py
from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from .serializers import (
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
)

User = get_user_model()


def _frontend_url() -> str:
    return getattr(
        settings,
        "FRONTEND_BASE_URL",
        "https://www.myhomebro.com",
    ).rstrip("/")


def _build_reset_link(user: User) -> str:
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


def _build_html_body(user: User, reset_url: str) -> str:
    first_name = (getattr(user, "first_name", "") or "").strip()
    year = datetime.utcnow().year

    html = f"""\
<!DOCTYPE html>
<html lang="en" style="margin:0; padding:0;">
  <head>
    <meta charset="UTF-8" />
    <title>Reset Your MyHomeBro Password</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(15,23,42,0.12);">
            <tr>
              <td style="padding:24px 24px 16px 24px; background:linear-gradient(135deg,#0f172a,#1d4ed8); color:#e5e7eb;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="font-size:18px; font-weight:700;">
                      MyHomeBro
                    </td>
                    <td align="right" style="font-size:12px; opacity:0.8;">
                      Password Reset
                    </td>
                  </tr>
                </table>
                <h1 style="margin:16px 0 0; font-size:20px; font-weight:800; color:#f9fafb;">
                  Reset your password
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px; font-size:15px; color:#111827;">
                  Hi {first_name or "there"},
                </p>
                <p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.5;">
                  We received a request to reset the password for your MyHomeBro account.
                  If you made this request, tap the button below to choose a new password.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
                  <tr>
                    <td>
                      <a href="{reset_url}" style="
                        display:inline-block;
                        padding:12px 24px;
                        background-color:#2563eb;
                        border-radius:9999px;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:14px;
                        font-weight:600;
                        letter-spacing:0.02em;
                      ">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 12px; font-size:12px; color:#6b7280; line-height:1.5;">
                  If the button doesn't work, you can copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 16px; font-size:12px; color:#2563eb; word-break:break-all;">
                  {reset_url}
                </p>
                <p style="margin:0 0 8px; font-size:12px; color:#6b7280; line-height:1.5;">
                  If you did not request a password reset, you can safely ignore this email and your password will remain the same.
                </p>
                <p style="margin:16px 0 0; font-size:12px; color:#6b7280;">
                  Thank you,<br />
                  <span style="font-weight:600; color:#111827;">The MyHomeBro Team</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0; font-size:11px; color:#9ca3af;">
                  You’re receiving this email because a password reset was requested for your MyHomeBro account.
                  If this wasn’t you, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:12px 0 0; font-size:11px; color:#9ca3af;">
            &copy; {year} MyHomeBro. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    return html


def send_reset_email(user: User) -> None:
    reset_url = _build_reset_link(user)
    subject = "Reset Your MyHomeBro Password"
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")
    to = [user.email]

    text_body = _build_plaintext_body(user, reset_url)
    html_body = _build_html_body(user, reset_url)

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=to,
    )
    msg.attach_alternative(html_body, "text/html")
    try:
        msg.send(fail_silently=True)
    except Exception:
        # Optional: log email failures
        pass


class PasswordResetRequestView(APIView):
    """
    POST /accounts/auth/password-reset/request/
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
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
