from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Invoice, Project
from projects.models_sms import SMSConsent
from projects.notifications import notify_invoice_created
from projects.services.sms_automation import evaluate_sms_automation
from projects.services.sms_service import set_sms_opt_in


class InvoiceNotificationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="invoice-notifications@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Invoice Notification Builder",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Invoice Notification Customer",
            email="invoice-customer@example.com",
            phone_number="+12105550144",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Invoice Notification Project",
        )
        self.agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            total_cost=Decimal("1000.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(CELERY_NOTIFICATIONS_ENABLED=False)
    @patch("projects.signals.notify_invoice_created")
    def test_invoice_notification_uses_sync_fallback_when_celery_is_disabled(self, notify):
        with self.captureOnCommitCallbacks(execute=True):
            invoice = Invoice.objects.create(
                agreement=self.agreement,
                amount=Decimal("250.00"),
            )

        notify.assert_called_once()
        self.assertEqual(notify.call_args.args[0].id, invoice.id)

    @override_settings(CELERY_NOTIFICATIONS_ENABLED=True)
    @patch("projects.signals.notify_invoice_created")
    @patch("projects.signals.task_send_invoice_notification.delay", side_effect=ConnectionError("broker unavailable"))
    def test_invoice_notification_falls_back_when_queue_is_unavailable(self, _delay, notify):
        with self.captureOnCommitCallbacks(execute=True):
            invoice = Invoice.objects.create(
                agreement=self.agreement,
                amount=Decimal("250.00"),
            )

        notify.assert_called_once()
        self.assertEqual(notify.call_args.args[0].id, invoice.id)

    @patch("projects.notifications.evaluate_sms_automation")
    @patch("projects.notifications.send_notification")
    def test_invoice_notification_separates_email_from_consent_aware_sms(self, send_email, evaluate_sms):
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("250.00"),
        )

        notify_invoice_created(invoice)

        self.assertFalse(send_email.call_args.kwargs["send_sms"])
        evaluate_sms.assert_called_once_with(
            "invoice_ready",
            homeowner=self.homeowner,
            agreement=self.agreement,
            invoice=invoice,
            metadata={"notification_source": "invoice_created"},
        )

    def test_each_distinct_invoice_can_send_an_invoice_ready_text(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        first = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"))
        second = Invoice.objects.create(agreement=self.agreement, amount=Decimal("300.00"))

        with patch(
            "projects.services.sms_automation.send_compliant_sms",
            return_value={"ok": True, "twilio_sid": "SM-INVOICE", "status": "sent"},
        ) as send_sms:
            first_result = evaluate_sms_automation("invoice_ready", invoice=first)
            second_result = evaluate_sms_automation("invoice_ready", invoice=second)

        self.assertTrue(first_result["sent"])
        self.assertTrue(second_result["sent"])
        self.assertEqual(send_sms.call_count, 2)

    def test_manual_resend_bypasses_recent_invoice_sms_deduplication(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        invoice = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"))
        with patch(
            "projects.services.sms_automation.send_compliant_sms",
            return_value={"ok": True, "twilio_sid": "SM-RESENT", "status": "sent"},
        ) as send_sms:
            evaluate_sms_automation("invoice_ready", invoice=invoice)
            result = evaluate_sms_automation(
                "invoice_ready",
                invoice=invoice,
                metadata={"manual_resend": True},
            )

        self.assertTrue(result["sent"])
        self.assertEqual(send_sms.call_count, 2)

    @patch("projects.views.invoice.evaluate_sms_automation")
    @patch("projects.views.invoice._send_invoice_email_postmark", return_value={"MessageID": "email-1"})
    def test_manual_invoice_submit_sends_email_and_consent_aware_sms(self, _email, evaluate_sms):
        evaluate_sms.return_value = {"sent": True, "reason_code": "sent_immediately"}
        invoice = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"), status="pending")

        response = self.client.post(f"/api/projects/invoices/{invoice.id}/submit/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["sms_delivery"]["sent"])
        evaluate_sms.assert_called_once_with(
            "invoice_ready",
            homeowner=self.homeowner,
            agreement=self.agreement,
            invoice=invoice,
            metadata={"notification_source": "invoice_submit", "manual_resend": True},
        )

    @patch("projects.views.invoice.evaluate_sms_automation")
    @patch("projects.views.invoice._send_invoice_email_postmark", return_value={"MessageID": "email-1"})
    def test_manual_invoice_resend_also_retries_consent_aware_sms(self, _email, evaluate_sms):
        evaluate_sms.return_value = {"sent": True, "reason_code": "sent"}
        invoice = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"), status="pending")

        response = self.client.post(f"/api/projects/invoices/{invoice.id}/resend/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["sms_delivery"]["sent"])
        evaluate_sms.assert_called_once_with(
            "invoice_ready",
            homeowner=self.homeowner,
            agreement=self.agreement,
            invoice=invoice,
            metadata={"notification_source": "invoice_resend", "manual_resend": True},
        )
