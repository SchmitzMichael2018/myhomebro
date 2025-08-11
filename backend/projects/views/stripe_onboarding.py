# backend/projects/views/stripe_onboarding.py

import stripe
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.conf import settings
from ..models import Contractor

stripe.api_key = settings.STRIPE_SECRET_KEY

class ContractorOnboardingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        contractor = user.contractor_profile

        try:
            if not contractor.stripe_account_id:
                # Create a new Stripe account
                account = stripe.Account.create(
                    type="express",
                    country="US",
                    email=user.email,
                    capabilities={
                        "transfers": {"requested": True},
                    },
                )
                contractor.stripe_account_id = account.id
                contractor.save()

            # Create onboarding link
            account_link = stripe.AccountLink.create(
                account=contractor.stripe_account_id,
                refresh_url="https://www.myhomebro.com/onboarding",
                return_url="https://www.myhomebro.com/dashboard",
                type="account_onboarding",
            )

            return Response({"onboarding_url": account_link.url}, status=200)

        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ContractorOnboardingStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        contractor = user.contractor_profile

        if not contractor.stripe_account_id:
            return Response({"onboarding_status": "not_started"})

        try:
            acct = stripe.Account.retrieve(contractor.stripe_account_id)
            details_submitted = acct.get("details_submitted", False)
            payouts_enabled = acct.get("payouts_enabled", False)

            if payouts_enabled:
                contractor.onboarding_status = "completed"
            elif details_submitted:
                contractor.onboarding_status = "pending"
            else:
                contractor.onboarding_status = "incomplete"
            contractor.save()

            return Response({
                "onboarding_status": contractor.onboarding_status,
                "onboarding_url": None if payouts_enabled else None
            })

        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
