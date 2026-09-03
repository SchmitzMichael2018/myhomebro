from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from projects.views.invoice import _send_invoice_email_postmark


class InvoiceEmailDeliveryTests(SimpleTestCase):
    def _invoice(self):
        project = SimpleNamespace(title="Kitchen Remodel")
        agreement = SimpleNamespace(project=project)
        return SimpleNamespace(
            id=17,
            invoice_number="INV-0017",
            amount="650.00",
            agreement=agreement,
            milestone_id_snapshot=1,
            milestone_title_snapshot="Demolition",
        )

    @patch("projects.views.invoice._invoice_notes_and_attachments", return_value=("Complete", []))
    @patch("projects.views.invoice._build_magic_invoice_pdf_url", return_value="https://example.com/pdf")
    @patch("projects.views.invoice._build_magic_invoice_action_url", side_effect=["https://example.com/approve", "https://example.com/dispute"])
    @patch("projects.views.invoice.InvoiceSerializer")
    @patch("projects.views.invoice._get_customer_name", return_value="Home Owner")
    @patch("projects.views.invoice._get_customer_email", return_value="owner@example.com")
    @patch("projects.views.invoice.send_postmark_email")
    def test_uses_shared_postmark_sender(
        self,
        send_postmark_email,
        _customer_email,
        _customer_name,
        serializer,
        _action_url,
        _pdf_url,
        _notes,
    ):
        serializer.return_value.data = {"milestone_order": 1}
        send_postmark_email.return_value = (True, "Postmark email sent.")

        result = _send_invoice_email_postmark(self._invoice())

        self.assertEqual(result["Message"], "Postmark email sent.")
        kwargs = send_postmark_email.call_args.kwargs
        self.assertEqual(kwargs["to_email"], "owner@example.com")
        self.assertIn("INV-0017", kwargs["subject"])
        self.assertIn("https://example.com/pdf", kwargs["text_body"])
        self.assertIn("View Invoice PDF", kwargs["html_body"])

    @patch("projects.views.invoice._invoice_notes_and_attachments", return_value=("", []))
    @patch("projects.views.invoice._build_magic_invoice_pdf_url", return_value="https://example.com/pdf")
    @patch("projects.views.invoice._build_magic_invoice_action_url", side_effect=["https://example.com/approve", "https://example.com/dispute"])
    @patch("projects.views.invoice.InvoiceSerializer")
    @patch("projects.views.invoice._get_customer_name", return_value="Home Owner")
    @patch("projects.views.invoice._get_customer_email", return_value="owner@example.com")
    @patch("projects.views.invoice.send_postmark_email", return_value=(False, "Postmark error 422: rejected"))
    def test_surfaces_provider_failure(self, *_mocks):
        _mocks[3].return_value.data = {"milestone_order": 1}

        with self.assertRaisesRegex(RuntimeError, "Postmark error 422"):
            _send_invoice_email_postmark(self._invoice())
