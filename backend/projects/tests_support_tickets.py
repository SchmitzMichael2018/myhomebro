from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SUPPORT_EMAIL="support@example.com",
)
class SupportTicketApiTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="owner@example.com",
            password="password123",
            first_name="Ada",
            last_name="Owner",
        )
        self.other_user = user_model.objects.create_user(
            email="other@example.com",
            password="password123",
            first_name="Bea",
            last_name="Other",
        )

    def _submit_ticket(self, client, **overrides):
        payload = {
            "subject": "Need help with an agreement",
            "category": "agreement_help",
            "priority": "normal",
            "message": "Please help me review the latest agreement version.",
            "email": self.user.email,
        }
        payload.update(overrides)
        return client.post("/api/projects/support-tickets/", payload, format="json")

    @staticmethod
    def _rows(payload):
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict) and isinstance(payload.get("results"), list):
            return payload["results"]
        return []

    def test_create_support_ticket_generates_number_and_sends_emails(self):
        self.client.force_authenticate(user=self.user)

        response = self._submit_ticket(
            self.client,
            related_object_type="agreement",
            related_object_id="42",
        )

        self.assertEqual(response.status_code, 201)
        ticket_number = response.data["ticket_number"]
        self.assertRegex(ticket_number, r"^MHB-\d{6}$")
        self.assertEqual(response.data["status"], "open")
        self.assertEqual(response.data["email"], self.user.email)
        self.assertEqual(response.data["related_object"]["type"], "agreement")
        self.assertEqual(response.data["related_object"]["id"], "42")

        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(
            mail.outbox[0].subject,
            f"MyHomeBro Support Request Received – Ticket {ticket_number}",
        )
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertIn("agreement", mail.outbox[1].body.lower())
        self.assertIn(ticket_number, mail.outbox[1].subject)
        self.assertEqual(mail.outbox[1].to, ["support@example.com"])

    def test_list_and_retrieve_scope_to_current_user(self):
        self.client.force_authenticate(user=self.user)
        own_response = self._submit_ticket(self.client)
        self.assertEqual(own_response.status_code, 201)
        own_ticket_number = own_response.data["ticket_number"]

        other_client = APIClient()
        other_client.force_authenticate(user=self.other_user)
        other_response = self._submit_ticket(
            other_client,
            subject="Other user's question",
            email=self.other_user.email,
        )
        self.assertEqual(other_response.status_code, 201)
        other_ticket_number = other_response.data["ticket_number"]

        list_response = self.client.get("/api/projects/support-tickets/")
        self.assertEqual(list_response.status_code, 200)
        rows = self._rows(list_response.data)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ticket_number"], own_ticket_number)

        detail_response = self.client.get(f"/api/projects/support-tickets/{own_ticket_number}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data["ticket_number"], own_ticket_number)

        forbidden_response = self.client.get(f"/api/projects/support-tickets/{other_ticket_number}/")
        self.assertEqual(forbidden_response.status_code, 404)
