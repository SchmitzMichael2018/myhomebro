from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Milestone, Project
from projects.views.funding import send_funding_link_for_agreement


@override_settings(SECURE_SSL_REDIRECT=False, STRIPE_SECRET_KEY="sk_test_123")
class IncidentalsReserveEscrowFundingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(email="funding@example.com", password="password123")
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Funding Builder",
            stripe_account_id="acct_funding",
            charges_enabled=True,
            payouts_enabled=True,
            details_submitted=True,
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Pat Customer",
            email="pat@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Escrow Kitchen",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode="escrow",
            signed_by_contractor=True,
            signed_by_homeowner=True,
            total_cost=Decimal("1000.00"),
            incidentals_reserve_amount=Decimal("150.00"),
        )
        Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Build",
            description="Build milestone",
            amount=Decimal("1000.00"),
        )
        self.client.force_authenticate(self.user)

    def test_funding_link_includes_incidentals_reserve_without_changing_milestone_total(self):
        with patch("projects.views.funding.email_escrow_funding_request"):
            payload = send_funding_link_for_agreement(self.agreement)

        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.total_cost, Decimal("1000.00"))
        self.assertEqual(payload["milestone_escrow_total"], "1000.00")
        self.assertEqual(payload["incidentals_reserve"], "150.00")
        self.assertEqual(payload["total_required"], "1150.00")
        self.assertEqual(payload["amount"], "1150.00")

    def test_funding_preview_returns_escrow_breakdown(self):
        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/funding_preview/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["milestone_escrow_total"], "1000.00")
        self.assertEqual(response.data["incidentals_reserve"], "150.00")
        self.assertEqual(response.data["total_required"], "1150.00")
        self.assertEqual(response.data["remaining_to_fund"], "1150.00")

    def test_funded_flag_requires_milestones_plus_incidentals(self):
        self.agreement.escrow_funded_amount = Decimal("1000.00")
        self.agreement.save(update_fields=["escrow_funded_amount"])
        self.agreement.refresh_from_db()
        self.assertFalse(self.agreement.escrow_funded)

        self.agreement.escrow_funded_amount = Decimal("1150.00")
        self.agreement.save(update_fields=["escrow_funded_amount"])
        self.agreement.refresh_from_db()
        self.assertTrue(self.agreement.escrow_funded)

    def test_public_funding_info_shows_breakdown(self):
        with patch("projects.views.funding.email_escrow_funding_request"):
            payload = send_funding_link_for_agreement(self.agreement)

        response = self.client.get(
            "/api/projects/funding/public_fund/",
            {"token": payload["public_fund_url"].rsplit("/", 1)[-1]},
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["milestone_escrow_total"], "1000.00")
        self.assertEqual(response.data["incidentals_reserve"], "150.00")
        self.assertEqual(response.data["total_required"], "1150.00")

    def test_payment_intent_uses_funding_link_amount_with_reserve(self):
        with patch("projects.views.funding.email_escrow_funding_request"):
            payload = send_funding_link_for_agreement(self.agreement)
        token = payload["public_fund_url"].rsplit("/", 1)[-1]

        class FakeIntent:
            id = "pi_incidentals"
            client_secret = "pi_incidentals_secret"

        with patch("projects.views.funding.stripe.PaymentIntent.create", return_value=FakeIntent()) as create:
            response = self.client.post("/api/projects/funding/create_payment_intent/", {"token": token}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["amount"], "1150.00")
        self.assertEqual(create.call_args.kwargs["amount"], 115000)
