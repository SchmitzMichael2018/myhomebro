# backend/backend/projects/views/contractor_me.py
from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status


class ContractorMeView(APIView):
    """
    Auth'd "who am I" endpoint used by the frontend to establish session state.
    Returns user + contractor summary so the app doesn't bounce back to landing.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        # Base user info
        payload = {
            "user_id": getattr(user, "id", None),
            "email": getattr(user, "email", None),
            "first_name": getattr(user, "first_name", None),
            "last_name": getattr(user, "last_name", None),
            "is_staff": getattr(user, "is_staff", False),
            "is_superuser": getattr(user, "is_superuser", False),
            "is_verified": getattr(user, "is_verified", False),
        }

        # Contractor profile (optional)
        contractor = getattr(user, "contractor", None)
        if contractor:
            payload.update({
                "contractor_id": getattr(contractor, "id", None),
                "business_name": getattr(contractor, "business_name", None) or getattr(contractor, "name", None),
                "phone": getattr(contractor, "phone", None),
                "onboarding_status": getattr(contractor, "onboarding_status", None),
                "license_number": getattr(contractor, "license_number", None),
                "license_expires": getattr(contractor, "license_expires", None),
            })
        else:
            payload.update({
                "contractor_id": None,
            })

        return Response(payload, status=status.HTTP_200_OK)
