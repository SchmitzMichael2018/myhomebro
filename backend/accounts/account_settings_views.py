# backend/accounts/account_settings_views.py
from __future__ import annotations

from rest_framework.views import APIView
from rest_framework import permissions, status
from rest_framework.response import Response

# ⬇️ IMPORTANT: import from .serializers (single file), NOT accounts.serializers.account_settings
from .serializers import (
    ChangeEmailSerializer,
    ChangePasswordSerializer,
)


class ChangeEmailView(APIView):
    """
    POST /api/accounts/change-email/
    Body:
      {
        "current_password": "...",
        "new_email": "new@example.com"
      }
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = ChangeEmailSerializer(
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                "detail": "Email updated successfully.",
                "email": user.email,
            },
            status=status.HTTP_200_OK,
        )


class ChangePasswordView(APIView):
    """
    POST /api/accounts/change-password/
    Body:
      {
        "old_password": "...",
        "new_password": "...",
        "new_password_confirm": "..."
      }
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"detail": "Password updated successfully."},
            status=status.HTTP_200_OK,
        )
