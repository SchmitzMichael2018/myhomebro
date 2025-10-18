# backend/projects/views/contractor_me.py
# COMPLETE FILE — provides ContractorMeView (and alias ContractorMe)

from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as drf_status


def _contractor_for_user(user):
    """
    Resolve the current user's Contractor profile.
    Supports either related_name='contractor_profile' or default 'contractor'.
    """
    return getattr(user, "contractor_profile", None) or getattr(user, "contractor", None)


class ContractorMeView(APIView):
    """
    GET /api/projects/contractors/me/
    Returns the Contractor profile for the authenticated user,
    including Stripe status flags & computed helpers (if present on the model).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=drf_status.HTTP_404_NOT_FOUND)

        payload = {
            "id": getattr(contractor, "id", None),
            "business_name": getattr(contractor, "business_name", None),
            "phone": getattr(contractor, "phone", None),
            "address": getattr(contractor, "address", None),
            "license_number": getattr(contractor, "license_number", None),
            "license_expiration": getattr(contractor, "license_expiration", None),
            "logo": getattr(contractor, "logo", None) and getattr(contractor.logo, "url", None),
            "license_file": getattr(contractor, "license_file", None) and getattr(contractor.license_file, "url", None),

            # Stripe / Connect fields (safe if fields don’t exist yet)
            "stripe_account_id": getattr(contractor, "stripe_account_id", "") or "",
            "onboarding_status": getattr(contractor, "onboarding_status", "") or "",
            "charges_enabled": bool(getattr(contractor, "charges_enabled", False)),
            "payouts_enabled": bool(getattr(contractor, "payouts_enabled", False)),
            "details_submitted": bool(getattr(contractor, "details_submitted", False)),
            "requirements_due_count": int(getattr(contractor, "requirements_due_count", 0) or 0),
            "stripe_status_updated_at": getattr(contractor, "stripe_status_updated_at", None),
            "stripe_deauthorized_at": getattr(contractor, "stripe_deauthorized_at", None),

            # Computed helpers if present on the model
            "stripe_connected": bool(
                getattr(contractor, "stripe_connected", False)
                or getattr(contractor, "charges_enabled", False)
                or getattr(contractor, "payouts_enabled", False)
            ),
            "stripe_action_required": bool(
                getattr(contractor, "stripe_action_required", False)
                or (int(getattr(contractor, "requirements_due_count", 0) or 0) > 0)
            ),
        }

        user = getattr(contractor, "user", None)
        if user is not None:
            payload.update({
                "user_id": getattr(user, "id", None),
                "email": getattr(user, "email", None),
                "first_name": getattr(user, "first_name", None),
                "last_name": getattr(user, "last_name", None),
            })

        return Response(payload, status=drf_status.HTTP_200_OK)


# Optional alias for backward compatibility (if some code imports ContractorMe)
ContractorMe = ContractorMeView
