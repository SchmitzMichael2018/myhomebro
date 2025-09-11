# backend/backend/projects/views/stripe_onboarding.py
from typing import Optional
import stripe
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.conf import settings

stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", "")

def _get_contractor(user) -> Optional[object]:
    return getattr(user, "contractor_profile", None)

class ContractorOnboardingStatusView(APIView):
    """
    GET /api/projects/contractor-onboarding-status/

    Public-safe endpoint for the LandingPage:
    - Anonymous users: 200 with {"onboarding_status":"anonymous", ...}
    - Authenticated without contractor_profile: 200 with "no_contractor_profile"
    - Authenticated with profile: returns Stripe/account status.
    """
    permission_classes: list = []  # allow anonymous GET

    def get(self, request):
        # Anonymous visitor → return stable payload (avoid 401 on LandingPage)
        if not request.user.is_authenticated:
            return Response(
                {
                    "onboarding_status": "anonymous",
                    "connected": False,
                    "stripe_account_id": "",
                    "detail": "User not authenticated.",
                },
                status=status.HTTP_200_OK,
            )

        contractor = _get_contractor(request.user)
        if contractor is None:
            return Response(
                {
                    "onboarding_status": "no_contractor_profile",
                    "connected": False,
                    "stripe_account_id": "",
                    "detail": "No contractor profile linked to this account.",
                },
                status=status.HTTP_200_OK,
            )

        acct_id = getattr(contractor, "stripe_account_id", "") or ""
        if not acct_id:
            return Response(
                {
                    "onboarding_status": "not_started",
                    "connected": False,
                    "stripe_account_id": "",
                    "onboarding_url": None,
                },
                status=status.HTTP_200_OK,
            )

        # Look up the Stripe account
        try:
            acct = stripe.Account.retrieve(acct_id)
            details_submitted = bool(acct.get("details_submitted", False))
            payouts_enabled = bool(acct.get("payouts_enabled", False))

            if payouts_enabled:
                status_label = "completed"
            elif details_submitted:
                status_label = "pending"
            else:
                status_label = "incomplete"

            # Persist a simple status flag if your model has one
            if hasattr(contractor, "onboarding_status"):
                contractor.onboarding_status = status_label
                contractor.save(update_fields=["onboarding_status"])

            return Response(
                {
                    "onboarding_status": status_label,
                    "connected": payouts_enabled,
                    "stripe_account_id": acct_id,
                    "onboarding_url": None,  # not created here
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            return Response(
                {"detail": f"Stripe error: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ContractorOnboardingView(APIView):
    """
    POST /api/projects/contractor-onboarding/

    Auth-only endpoint that:
    - creates an Express account if missing
    - returns a fresh AccountLink URL to continue onboarding
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        contractor = _get_contractor(request.user)
        if contractor is None:
            return Response({"detail": "No contractor profile."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            acct_id = getattr(contractor, "stripe_account_id", "") or ""
            if not acct_id:
                # Create Express account
                acct = stripe.Account.create(
                    type="express",
                    country="US",
                    email=getattr(request.user, "email", "") or None,
                    capabilities={"transfers": {"requested": True}},
                )
                contractor.stripe_account_id = acct.id
                contractor.save(update_fields=["stripe_account_id"])
                acct_id = acct.id

            # Create an onboarding link
            refresh_url = getattr(settings, "STRIPE_ONBOARDING_REFRESH_URL", "https://www.myhomebro.com/onboarding")
            return_url = getattr(settings, "STRIPE_ONBOARDING_RETURN_URL", "https://www.myhomebro.com/dashboard")
            link = stripe.AccountLink.create(
                account=acct_id,
                refresh_url=refresh_url,
                return_url=return_url,
                type="account_onboarding",
            )
            return Response({"onboarding_url": link.url}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
