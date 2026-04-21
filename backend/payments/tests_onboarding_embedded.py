from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from payments.models import ConnectedAccount
from projects.models import Contractor


class EmbeddedStripeOnboardingTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="embedded-stripe-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Embedded Stripe Contractor",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    @patch("payments.views.onboarding.stripe.AccountSession.create")
    @patch("payments.views.onboarding.stripe.Account.create")
    def test_account_session_creates_custom_account_and_syncs_contractor(
        self,
        mock_account_create,
        mock_account_session_create,
    ):
        mock_account_create.return_value = {
            "id": "acct_custom_123",
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
        }
        mock_account_session_create.return_value = {
            "client_secret": "seti_client_secret_123",
        }

        response = self.client.post("/api/payments/onboarding/account-session/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["account_id"], "acct_custom_123")
        self.assertEqual(payload["client_secret"], "seti_client_secret_123")
        self.assertEqual(payload["resume_url"], "/app/onboarding/stripe")
        self.assertIn("onboarding", payload)
        self.assertEqual(payload["onboarding"]["business_name"], "Embedded Stripe Contractor")

        mock_account_create.assert_called_once()
        account_kwargs = mock_account_create.call_args.kwargs
        self.assertEqual(account_kwargs["type"], "custom")
        self.assertEqual(account_kwargs["country"], "US")
        self.assertEqual(
            account_kwargs["capabilities"],
            {"card_payments": {"requested": True}, "transfers": {"requested": True}},
        )

        mock_account_session_create.assert_called_once_with(
            account="acct_custom_123",
            components={"account_onboarding": {"enabled": True}},
        )

        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.stripe_account_id, "acct_custom_123")

        connected = ConnectedAccount.objects.get(user=self.user)
        self.assertEqual(connected.stripe_account_id, "acct_custom_123")

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    @patch("payments.views.onboarding.stripe.AccountSession.create")
    @patch("payments.views.onboarding.stripe.Account.create")
    def test_account_session_reuses_existing_account(
        self,
        mock_account_create,
        mock_account_session_create,
    ):
        connected = ConnectedAccount.objects.create(
            user=self.user,
            stripe_account_id="acct_existing_456",
        )
        self.contractor.stripe_account_id = "acct_existing_456"
        self.contractor.save(update_fields=["stripe_account_id"])

        mock_account_session_create.return_value = {
            "client_secret": "seti_client_secret_existing",
        }

        response = self.client.post("/api/payments/onboarding/account-session/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["account_id"], "acct_existing_456")
        self.assertEqual(payload["client_secret"], "seti_client_secret_existing")
        self.assertEqual(payload["resume_url"], "/app/onboarding/stripe")

        mock_account_create.assert_not_called()
        mock_account_session_create.assert_called_once_with(
            account="acct_existing_456",
            components={"account_onboarding": {"enabled": True}},
        )
        connected.refresh_from_db()
        self.assertEqual(connected.stripe_account_id, "acct_existing_456")

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    def test_status_uses_embedded_resume_url_when_not_started(self):
        response = self.client.get("/api/payments/onboarding/status/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["onboarding_status"], "not_started")
        self.assertEqual(payload["resume_url"], "/app/onboarding/stripe")
        self.assertFalse(payload["connected"])
        self.assertEqual(payload["onboarding"]["stripe_onboarding_status"], "not_started")

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    @patch("payments.views.onboarding.stripe.Account.retrieve")
    def test_status_reports_in_progress_for_incomplete_account(self, mock_account_retrieve):
        ConnectedAccount.objects.create(user=self.user, stripe_account_id="acct_incomplete_123")
        self.contractor.stripe_account_id = "acct_incomplete_123"
        self.contractor.save(update_fields=["stripe_account_id"])

        mock_account_retrieve.return_value = {
            "id": "acct_incomplete_123",
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "requirements": {
                "currently_due": ["business_profile.mcc"],
                "eventually_due": ["external_account"],
                "past_due": [],
                "disabled_reason": None,
            },
        }

        response = self.client.get("/api/payments/onboarding/status/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["onboarding_status"], "in_progress")
        self.assertFalse(payload["connected"])
        self.assertEqual(payload["resume_url"], "/app/onboarding/stripe")
        self.assertEqual(payload["onboarding"]["stripe_onboarding_status"], "in_progress")
        self.assertFalse(payload["onboarding"]["stripe_ready"])

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    @patch("payments.views.onboarding.stripe.Account.retrieve")
    def test_status_reports_complete_for_fully_connected_account(self, mock_account_retrieve):
        ConnectedAccount.objects.create(user=self.user, stripe_account_id="acct_complete_123")
        self.contractor.stripe_account_id = "acct_complete_123"
        self.contractor.save(update_fields=["stripe_account_id"])

        mock_account_retrieve.return_value = {
            "id": "acct_complete_123",
            "charges_enabled": True,
            "payouts_enabled": True,
            "details_submitted": True,
            "requirements": {
                "currently_due": [],
                "eventually_due": [],
                "past_due": [],
                "disabled_reason": None,
            },
        }

        response = self.client.get("/api/payments/onboarding/status/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["onboarding_status"], "completed")
        self.assertTrue(payload["connected"])
        self.assertEqual(payload["onboarding"]["stripe_onboarding_status"], "complete")
        self.assertTrue(payload["onboarding"]["stripe_ready"])

    @override_settings(STRIPE_ENABLED=True, STRIPE_API_KEY="sk_test_embedded")
    @patch("payments.views.onboarding.stripe.Account.retrieve")
    def test_status_reports_restricted_when_contractor_is_deauthorized(self, mock_account_retrieve):
        ConnectedAccount.objects.create(user=self.user, stripe_account_id="acct_restricted_123")
        self.contractor.stripe_account_id = "acct_restricted_123"
        self.contractor.stripe_deauthorized_at = timezone.now()
        self.contractor.save(update_fields=["stripe_account_id", "stripe_deauthorized_at"])

        mock_account_retrieve.return_value = {
            "id": "acct_restricted_123",
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "requirements": {
                "currently_due": ["external_account"],
                "eventually_due": [],
                "past_due": [],
                "disabled_reason": "rejected.listed",
            },
        }

        response = self.client.get("/api/payments/onboarding/status/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["onboarding"]["stripe_onboarding_status"], "restricted")
        self.assertEqual(payload["onboarding"]["status"], "in_progress")
        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.stripe_onboarding_status, "restricted")
