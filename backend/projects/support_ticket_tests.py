from __future__ import annotations

from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_support import SupportMessage, SupportTicket
from projects.services.support_gmail_sync import InboundSupportEmail


def _use_secure_requests(client):
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    for method_name in ("get", "post", "put", "patch", "delete"):
        original = getattr(client, method_name)

        def secure_method(*args, _original=original, **kwargs):
            kwargs.setdefault("secure", True)
            return _original(*args, **kwargs)

        setattr(client, method_name, secure_method)
    return client


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SUPPORT_EMAIL="support@example.com",
    SUPPORT_INBOUND_SYNC_ENABLED=True,
    SUPPORT_GMAIL_SYNC_LOOKBACK_DAYS=14,
    SUPPORT_GMAIL_USERNAME="mailbox@example.com",
    SUPPORT_GMAIL_PASSWORD="secret",
)
class SupportTicketTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.client = _use_secure_requests(APIClient())
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="owner@example.com",
            password="password123",
            first_name="Ada",
            last_name="Owner",
        )

    def _submit_ticket(self):
        self.client.force_authenticate(user=self.user)
        payload = {
            "subject": "Contract cancellation",
            "category": "agreement_help",
            "priority": "normal",
            "message": "Please help me review the latest agreement version.",
            "email": self.user.email,
        }
        return self.client.post("/api/projects/support-tickets/", payload, format="json")

    def test_ticket_reply_creates_message_and_sends_email(self):
        create_response = self._submit_ticket()
        self.assertEqual(create_response.status_code, 201)
        ticket_number = create_response.data["ticket_number"]
        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 1)

        reply_response = self.client.post(
            f"/api/projects/support-tickets/{ticket_number}/reply/",
            {"message": "Here is the follow-up details."},
            format="json",
        )

        self.assertEqual(reply_response.status_code, 201, reply_response.data)
        self.assertEqual(SupportTicket.objects.filter(ticket_number=ticket_number).count(), 1)
        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 2)
        self.assertEqual(reply_response.data["messages"][1]["message"], "Here is the follow-up details.")
        self.assertEqual(len(mail.outbox), 3)
        self.assertEqual(mail.outbox[-1].to, ["support@example.com"])
        self.assertIn(
            f"Re: MyHomeBro Support Ticket {ticket_number} \u2013 Contract cancellation",
            mail.outbox[-1].subject,
        )

    def test_gmail_sync_imports_reply_with_ticket_number(self):
        create_response = self._submit_ticket()
        ticket_number = create_response.data["ticket_number"]
        payload = InboundSupportEmail(
            gmail_message_id="gmail-msg-1",
            gmail_thread_id="gmail-thread-1",
            subject=f"Re: MyHomeBro Support Ticket {ticket_number} \u2013 Contract cancellation",
            body="Here is the follow-up details.",
            sender_email="customer@example.com",
            sent_at=timezone.now(),
        )

        with patch("projects.services.support_gmail_sync.iter_inbound_support_emails_from_imap", return_value=[payload]):
            stdout = StringIO()
            call_command("sync_support_gmail", stdout=stdout)

        self.assertEqual(SupportTicket.objects.filter(ticket_number=ticket_number).count(), 1)
        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 2)
        self.assertEqual(
            SupportMessage.objects.filter(ticket__ticket_number=ticket_number, gmail_message_id="gmail-msg-1").count(),
            1,
        )

    def test_duplicate_gmail_message_is_ignored(self):
        create_response = self._submit_ticket()
        ticket_number = create_response.data["ticket_number"]
        payload = InboundSupportEmail(
            gmail_message_id="gmail-msg-dup",
            gmail_thread_id="gmail-thread-dup",
            subject=f"Re: MyHomeBro Support Ticket {ticket_number} \u2013 Contract cancellation",
            body="First reply.",
            sender_email="customer@example.com",
            sent_at=timezone.now(),
        )
        with patch("projects.services.support_gmail_sync.iter_inbound_support_emails_from_imap", return_value=[payload]):
            call_command("sync_support_gmail", stdout=StringIO())
        with patch("projects.services.support_gmail_sync.iter_inbound_support_emails_from_imap", return_value=[payload]):
            call_command("sync_support_gmail", stdout=StringIO())

        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 2)
        self.assertEqual(SupportMessage.objects.filter(gmail_message_id="gmail-msg-dup").count(), 1)

    def test_unknown_ticket_number_is_skipped(self):
        create_response = self._submit_ticket()
        ticket_number = create_response.data["ticket_number"]
        payload = InboundSupportEmail(
            gmail_message_id="gmail-msg-unknown",
            gmail_thread_id="gmail-thread-unknown",
            subject="Re: MyHomeBro Support Ticket MHB-999999 \u2013 Contract cancellation",
            body="This should not import.",
            sender_email="customer@example.com",
            sent_at=timezone.now(),
        )

        with patch("projects.services.support_gmail_sync.iter_inbound_support_emails_from_imap", return_value=[payload]):
            with patch("projects.services.support_gmail_sync.logger.warning") as warning_mock:
                call_command("sync_support_gmail", stdout=StringIO())

        self.assertEqual(SupportTicket.objects.filter(ticket_number=ticket_number).count(), 1)
        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 1)
        warning_mock.assert_called()

    def test_follow_up_does_not_create_new_ticket(self):
        create_response = self._submit_ticket()
        ticket_number = create_response.data["ticket_number"]
        payload = InboundSupportEmail(
            gmail_message_id="gmail-msg-no-new-ticket",
            gmail_thread_id="gmail-thread-no-new-ticket",
            subject=f"Re: MyHomeBro Support Ticket {ticket_number} \u2013 Contract cancellation",
            body="Follow-up on the same ticket.",
            sender_email="customer@example.com",
            sent_at=timezone.now(),
        )

        with patch("projects.services.support_gmail_sync.iter_inbound_support_emails_from_imap", return_value=[payload]):
            call_command("sync_support_gmail", stdout=StringIO())

        self.assertEqual(SupportTicket.objects.count(), 1)
        self.assertEqual(SupportMessage.objects.filter(ticket__ticket_number=ticket_number).count(), 2)
