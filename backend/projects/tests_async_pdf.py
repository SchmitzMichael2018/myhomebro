import tempfile
from decimal import Decimal
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from projects.models import Agreement, Contractor, Homeowner, Invoice, Project
from projects.services.pdf_dispatch import enqueue_agreement_pdf
from projects.tasks import task_generate_full_agreement_pdf


class AsyncPDFTestBase(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(email="pdf@example.com", password="test")
        contractor = Contractor.objects.create(user=user, business_name="PDF Builder")
        homeowner = Homeowner.objects.create(
            created_by=contractor,
            full_name="PDF Customer",
            email="customer@example.com",
        )
        project = Project.objects.create(
            contractor=contractor,
            homeowner=homeowner,
            title="PDF Project",
        )
        self.agreement = Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=homeowner,
            total_cost=Decimal("1000.00"),
        )


class PDFDispatchTests(AsyncPDFTestBase):
    def test_authenticated_invoice_download_generates_pdf_on_demand(self):
        invoice = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"))
        self.client.force_login(self.agreement.contractor.user)

        response = self.client.get(f"/api/projects/invoices/{invoice.id}/pdf/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

    @override_settings(PDF_ASYNC_ENABLED=True, PDF_QUEUE_NAME="pdf")
    @patch("projects.tasks.task_generate_full_agreement_pdf.apply_async")
    def test_successful_enqueue_stores_task_id_after_acceptance(self, apply_async):
        apply_async.return_value = Mock(id="task-123")
        result = enqueue_agreement_pdf(self.agreement.id)
        self.agreement.refresh_from_db()
        self.assertTrue(result.accepted)
        self.assertEqual(self.agreement.pdf_generation_status, "queued")
        self.assertEqual(self.agreement.pdf_task_id, "task-123")

    @override_settings(PDF_ASYNC_ENABLED=True, PDF_QUEUE_NAME="pdf")
    @patch("projects.tasks.task_generate_full_agreement_pdf.apply_async")
    def test_enqueue_failure_leaves_retryable_without_task_id(self, apply_async):
        apply_async.side_effect = ConnectionError("broker unavailable")
        result = enqueue_agreement_pdf(self.agreement.id)
        self.agreement.refresh_from_db()
        self.assertFalse(result.accepted)
        self.assertEqual(self.agreement.pdf_generation_status, "failed_retryable")
        self.assertEqual(self.agreement.pdf_task_id, "")

    @override_settings(PDF_ASYNC_ENABLED=False, PDF_SYNC_FALLBACK_ENABLED=False)
    def test_disabled_async_does_not_run_unbounded_sync_fallback(self):
        result = enqueue_agreement_pdf(self.agreement.id)
        self.agreement.refresh_from_db()
        self.assertFalse(result.accepted)
        self.assertEqual(result.status, "disabled")
        self.assertEqual(self.agreement.pdf_generation_status, "disabled")
        self.assertEqual(self.agreement.pdf_generation_error_code, "")

    @override_settings(
        PDF_ASYNC_ENABLED=False,
        CELERY_BROKER_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_agreement_pdf_generates_synchronously_without_redis(self):
        from projects.services.pdf import generate_full_agreement_pdf

        with tempfile.TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            path = generate_full_agreement_pdf(self.agreement, merge_attachments=False)
            self.agreement.refresh_from_db()
            with open(path, "rb") as generated:
                self.assertEqual(generated.read(4), b"%PDF")
        self.assertEqual(self.agreement.pdf_generation_status, "completed")

    @override_settings(
        PDF_ASYNC_ENABLED=False,
        CELERY_NOTIFICATIONS_ENABLED=False,
        CELERY_BROKER_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_invoice_and_receipt_pdfs_generate_without_redis(self):
        from projects.services.invoice_pdf import generate_invoice_pdf_bytes
        from receipts.models import Receipt

        with tempfile.TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            invoice = Invoice.objects.create(agreement=self.agreement, amount=Decimal("250.00"))
            invoice_pdf = generate_invoice_pdf_bytes(invoice)
            self.assertTrue(invoice_pdf.startswith(b"%PDF"))

            receipt = Receipt.objects.create(
                invoice=invoice,
                agreement=self.agreement,
                receipt_number="RECEIPT-NO-REDIS",
                stripe_payment_intent_id="pi_test_no_redis",
                amount_paid_cents=25000,
            )
            receipt.refresh_from_db()
            self.assertTrue(receipt.pdf_file.name)
            with receipt.pdf_file.open("rb") as generated:
                self.assertEqual(generated.read(4), b"%PDF")


class PDFTaskTests(AsyncPDFTestBase):
    @patch("projects.services.pdf.generate_full_agreement_pdf")
    def test_success_marks_completed(self, generate):
        result = task_generate_full_agreement_pdf.apply(
            args=[self.agreement.id],
            task_id="pdf-success",
            throw=True,
        ).result
        self.agreement.refresh_from_db()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(self.agreement.pdf_generation_status, "completed")

    @patch("projects.services.pdf.generate_full_agreement_pdf")
    def test_permanent_failure_does_not_mark_completed(self, generate):
        generate.side_effect = ValueError("invalid agreement data")
        with self.assertRaises(ValueError):
            task_generate_full_agreement_pdf.apply(
                args=[self.agreement.id],
                task_id="pdf-failure",
                throw=True,
            )
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.pdf_generation_status, "failed_permanent")
        self.assertEqual(self.agreement.pdf_generation_error_code, "valueerror")

    @patch("projects.services.pdf.generate_full_agreement_pdf")
    def test_existing_pdf_reference_is_preserved_on_failure(self, generate):
        self.agreement.pdf_file.name = "agreements/pdf/existing.pdf"
        self.agreement.save(update_fields=["pdf_file"])
        generate.side_effect = ValueError("invalid agreement data")
        with self.assertRaises(ValueError):
            task_generate_full_agreement_pdf.apply(
                args=[self.agreement.id],
                task_id="pdf-preserve",
                throw=True,
            )
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.pdf_file.name, "agreements/pdf/existing.pdf")

    @patch("projects.services.pdf.generate_full_agreement_pdf")
    def test_completed_duplicate_is_idempotent(self, generate):
        Agreement.objects.filter(pk=self.agreement.id).update(pdf_generation_status="completed")
        result = task_generate_full_agreement_pdf.apply(
            args=[self.agreement.id],
            task_id="pdf-duplicate",
            throw=True,
        ).result
        self.assertTrue(result["duplicate"])
        generate.assert_not_called()
