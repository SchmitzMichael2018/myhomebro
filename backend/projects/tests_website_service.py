import io
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from pypdf import PdfWriter
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_website_service import WebsiteServiceEvent, WebsiteServiceMaterial, WebsiteServiceProject
from projects.services.website_service import proposal_fingerprint, queue_website_notification, send_website_notification, sync_checkout_completed, sync_checkout_unavailable


@override_settings(SECURE_SSL_REDIRECT=False)
class WebsiteServiceTests(TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.storage_settings = override_settings(WEBSITE_MATERIAL_ROOT=self.root.name)
        self.storage_settings.enable()
        self.addCleanup(self.storage_settings.disable)
        # FileField storage is initialized with the model; swap its location for this test only.
        self.field = WebsiteServiceMaterial._meta.get_field("file")
        self.old_storage = self.field.storage
        from projects.models_website_service import website_material_storage
        self.field.storage = website_material_storage()
        self.addCleanup(setattr, self.field, "storage", self.old_storage)
        self.owner = get_user_model().objects.create_user(email="website-owner@example.test", password="test-only-password")
        self.other = get_user_model().objects.create_user(email="website-other@example.test", password="test-only-password")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.base = "/api/projects/website-service-projects/"

    def create(self, **extra):
        payload = {"business_name": "Example Kitchen", "business_type": "restaurant", "template_id": "restaurant-food"}
        payload.update(extra)
        response = self.client.post(self.base, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def prepare_checkout(self, project, session_id="cs_test_expected", price_cents=150000):
        project.proposal_deliverables = "Five-page responsive website and content setup"
        project.service_terms = "One build, two revision rounds, customer owns the delivered files."
        project.refund_terms = "Refundable before work begins; completed work is non-refundable."
        project.quoted_price_cents = price_cents
        project.proposal_sent_at = timezone.now()
        project.payment_status = "checkout"
        project.stripe_checkout_session_id = session_id
        project.save()
        project.checkout_proposal_fingerprint = proposal_fingerprint(project)
        project.save(update_fields=["checkout_proposal_fingerprint"])
        return {
            "id": session_id,
            "payment_status": "paid",
            "payment_intent": "pi_test_paid",
            "amount_total": price_cents,
            "currency": "usd",
            "metadata": {
                "kind": "website_service",
                "website_service_project_id": str(project.pk),
                "proposal_fingerprint": project.checkout_proposal_fingerprint,
            },
        }

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.base).status_code, [401, 403])
        self.assertIn(self.client.post(self.base, {"business_name": "No"}, format="json").status_code, [401, 403])

    def test_project_persists_for_current_user_and_ignores_staff_fields(self):
        project = self.create(owner=self.other.pk, status="launched", preview_url="https://example.test/")
        row = WebsiteServiceProject.objects.get(pk=project["id"])
        self.assertEqual(row.owner, self.owner)
        self.assertEqual(row.status, "brief")
        self.assertEqual(row.preview_url, "")
        response = self.client.patch(f'{self.base}{row.pk}/', {"description": "Menu and catering", "status": "launched"}, format="json")
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.description, "Menu and catering")
        self.assertEqual(row.status, "brief")

    def test_other_account_cannot_list_edit_submit_upload_or_request(self):
        project = self.create()
        self.client.force_authenticate(self.other)
        response = self.client.get(self.base)
        rows = response.data if isinstance(response.data, list) else response.data["results"]
        self.assertEqual(rows, [])
        url = f'{self.base}{project["id"]}/'
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"business_name": "Stolen"}, format="json").status_code, 404)
        for action in ["submit", "materials", "requests"]:
            self.assertEqual(self.client.post(url + action + "/", {}, format="json").status_code, 404)

    def test_submit_requires_complete_brief_and_is_repeatable(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        self.assertEqual(self.client.post(url + "submit/").status_code, 400)
        self.client.patch(url, {"description": "Show our menu", "contact_details": "Example phone and hours"}, format="json")
        self.assertEqual(self.client.post(url + "submit/").data["status"], "review")
        self.assertEqual(self.client.post(url + "submit/").data["status"], "review")
        self.assertEqual(WebsiteServiceProject.objects.count(), 1)

    def test_private_material_download_and_file_validation(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "green").save(buffer, format="PNG")
        content = buffer.getvalue()
        upload = SimpleUploadedFile("logo.png", content, content_type="image/png")
        response = self.client.post(url + "materials/", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("file", response.data)
        file_url = url + f'materials/{response.data["id"]}/download/'
        response = self.client.get(file_url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), content)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(file_url).status_code, 404)
        self.client.force_authenticate(self.owner)
        for name, data in [("bad.png", b"not an image"), ("bad.html", b"<script>"), ("bad.pdf", b"not a pdf"), ("big.pdf", b"%PDF-" + b"x" * (5 * 1024 * 1024))]:
            response = self.client.post(url + "materials/", {"file": SimpleUploadedFile(name, data)}, format="multipart")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(WebsiteServiceMaterial.objects.count(), 1)

    def test_structurally_valid_pdf_is_accepted_and_fake_pdf_is_rejected(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/materials/'
        pdf = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(pdf)
        response = self.client.post(url, {"file": SimpleUploadedFile("brief.pdf", pdf.getvalue(), content_type="application/pdf")}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post(url, {"file": SimpleUploadedFile("fake.pdf", b"%PDF-not-a-document", content_type="application/pdf")}, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_request_and_staff_response_are_visible_to_owner(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        response = self.client.post(url + "requests/", {"message": "Please add a catering page", "status": "done", "response": "forged"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "open")
        self.assertEqual(response.data["response"], "")
        row = WebsiteServiceProject.objects.get(pk=project["id"]).requests.get()
        row.response = "Added to the next preview"
        row.status = "done"
        row.save()
        self.assertEqual(self.client.get(url).data["requests"][0]["response"], row.response)

    def test_invalid_template_rejected(self):
        response = self.client.post(self.base, {"business_name": "Example", "template_id": "../../etc/passwd"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_customer_cannot_forge_proposal_or_payment_fields(self):
        project = self.create(
            quoted_price_cents=1,
            proposal_deliverables="Forged",
            refund_terms="Forged",
            payment_status="paid",
        )
        row = WebsiteServiceProject.objects.get(pk=project["id"])
        self.assertIsNone(row.quoted_price_cents)
        self.assertEqual(row.proposal_deliverables, "")
        self.assertEqual(row.payment_status, "not_ready")

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.create")
    def test_checkout_requires_complete_terms_and_is_separate_from_project_payments(self, create_session):
        project_data = self.create()
        project = WebsiteServiceProject.objects.get(pk=project_data["id"])
        project.proposal_deliverables = "Five-page responsive website and content setup"
        project.service_terms = "One build, two revision rounds, customer owns the delivered files."
        project.refund_terms = "Refundable before work begins; completed work is non-refundable."
        project.quoted_price_cents = 150000
        project.proposal_sent_at = timezone.now()
        project.payment_status = "checkout"
        project.save()
        url = f"{self.base}{project.pk}/checkout/"
        self.assertEqual(self.client.post(url, {"accept_terms": False}, format="json").status_code, 400)
        create_session.return_value = SimpleNamespace(id="cs_test_website", url="https://checkout.stripe.test/session")
        response = self.client.post(url, {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["checkout_url"], create_session.return_value.url)
        kwargs = create_session.call_args.kwargs
        self.assertEqual(kwargs["metadata"]["kind"], "website_service")
        self.assertEqual(kwargs["line_items"][0]["price_data"]["unit_amount"], 150000)
        self.assertEqual(kwargs["line_items"][0]["price_data"]["currency"], "usd")
        self.assertEqual(kwargs["metadata"]["proposal_fingerprint"], kwargs["payment_intent_data"]["metadata"]["proposal_fingerprint"])
        project.refresh_from_db()
        self.assertEqual(project.stripe_checkout_session_id, "cs_test_website")
        self.assertEqual(project.checkout_proposal_fingerprint, kwargs["metadata"]["proposal_fingerprint"])
        self.assertIsNotNone(project.terms_accepted_at)

    @override_settings(POSTMARK_SERVER_TOKEN="", SUPPORT_EMAIL="support@example.test")
    def test_checkout_webhook_is_idempotent_and_final_approval_never_publishes(self):
        project_data = self.create()
        project = WebsiteServiceProject.objects.get(pk=project_data["id"])
        project.status = "preview"
        project.preview_url = "https://preview.example.test"
        project.save(update_fields=["status", "preview_url"])
        session = self.prepare_checkout(project, session_id="cs_test_paid")
        with self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(sync_checkout_completed(session))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(sync_checkout_completed(session))
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "paid")
        self.assertEqual(WebsiteServiceEvent.objects.filter(project=project, event_type="payment_confirmed").count(), 1)
        response = self.client.post(f"{self.base}{project.pk}/final-approval/")
        self.assertEqual(response.status_code, 200, response.data)
        project.refresh_from_db()
        self.assertIsNotNone(project.final_approved_at)
        self.assertEqual(project.live_url, "")
        self.assertEqual(project.status, "preview")

    def test_checkout_webhook_rejects_session_id_mismatch(self):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        session = self.prepare_checkout(project)
        session["id"] = "cs_test_attacker"
        self.assertFalse(sync_checkout_completed(session))
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "checkout")

    def test_checkout_webhook_rejects_amount_and_currency_mismatches(self):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        session = self.prepare_checkout(project)
        wrong_amount = {**session, "amount_total": session["amount_total"] - 1}
        self.assertFalse(sync_checkout_completed(wrong_amount))
        wrong_currency = {**session, "currency": "cad"}
        self.assertFalse(sync_checkout_completed(wrong_currency))
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "checkout")

    def test_checkout_webhook_requires_session_and_metadata_to_identify_same_project(self):
        first = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        second = WebsiteServiceProject.objects.create(owner=self.other, business_name="Other website")
        session = self.prepare_checkout(first)
        session["metadata"] = {**session["metadata"], "website_service_project_id": str(second.pk)}
        self.assertFalse(sync_checkout_completed(session))
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.payment_status, "checkout")
        self.assertEqual(second.payment_status, "not_ready")

    def test_duplicate_or_mismatched_events_cannot_pay_another_project(self):
        first = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        second = WebsiteServiceProject.objects.create(owner=self.other, business_name="Other website")
        valid = self.prepare_checkout(first)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(sync_checkout_completed(valid))
        mismatched = {**valid, "metadata": {**valid["metadata"], "website_service_project_id": str(second.pk)}}
        self.assertFalse(sync_checkout_completed(mismatched))
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.payment_status, "paid")
        self.assertEqual(second.payment_status, "not_ready")
        self.assertEqual(WebsiteServiceEvent.objects.filter(project=first, event_type="payment_confirmed").count(), 1)

    def test_checkout_webhook_rejects_session_for_modified_proposal(self):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        old_session = self.prepare_checkout(project)
        project.proposal_deliverables = "Changed scope with an additional page"
        project.proposal_sent_at = timezone.now()
        project.save(update_fields=["proposal_deliverables", "proposal_sent_at", "updated_at"])
        self.assertFalse(sync_checkout_completed(old_session))
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "checkout")

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.retrieve")
    @patch("stripe.checkout.Session.create")
    def test_modified_proposal_creates_new_checkout_instead_of_reusing_old_session(self, create_session, retrieve_session):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        self.prepare_checkout(project, session_id="cs_test_old")
        project.proposal_deliverables = "Changed and re-approved scope"
        project.proposal_sent_at = timezone.now()
        project.save(update_fields=["proposal_deliverables", "proposal_sent_at", "updated_at"])
        create_session.return_value = SimpleNamespace(id="cs_test_new", url="https://checkout.stripe.test/new")
        response = self.client.post(f"{self.base}{project.pk}/checkout/", {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        retrieve_session.assert_not_called()
        create_session.assert_called_once()
        project.refresh_from_db()
        self.assertEqual(project.stripe_checkout_session_id, "cs_test_new")
        self.assertEqual(project.checkout_proposal_fingerprint, proposal_fingerprint(project))

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.expire")
    @patch("stripe.checkout.Session.create")
    def test_proposal_change_during_checkout_does_not_store_or_return_stale_session(self, create_session, expire_session):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        self.prepare_checkout(project, session_id="cs_test_old")
        project.stripe_checkout_session_id = None
        project.checkout_proposal_fingerprint = ""
        project.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint"])

        def change_proposal(**kwargs):
            WebsiteServiceProject.objects.filter(pk=project.pk).update(
                proposal_deliverables="Scope changed during checkout",
                proposal_sent_at=timezone.now(),
            )
            return SimpleNamespace(id="cs_test_stale", url="https://checkout.stripe.test/stale")

        create_session.side_effect = change_proposal
        response = self.client.post(f"{self.base}{project.pk}/checkout/", {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        project.refresh_from_db()
        self.assertIsNone(project.stripe_checkout_session_id)
        self.assertEqual(project.checkout_proposal_fingerprint, "")
        expire_session.assert_called_once_with("cs_test_stale")

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.create")
    def test_concurrent_checkout_does_not_create_second_session(self, create_session):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        self.prepare_checkout(project, session_id="cs_old")
        project.stripe_checkout_session_id = None
        project.checkout_proposal_fingerprint = ""
        project.checkout_attempt_token = "active-attempt"
        project.checkout_attempt_started_at = timezone.now()
        project.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint", "checkout_attempt_token", "checkout_attempt_started_at"])
        response = self.client.post(f"{self.base}{project.pk}/checkout/", {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 400)
        create_session.assert_not_called()

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.expire")
    @patch("stripe.checkout.Session.create")
    def test_superseded_attempt_expires_orphaned_session(self, create_session, expire_session):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        self.prepare_checkout(project, session_id="cs_old")
        project.stripe_checkout_session_id = None
        project.checkout_proposal_fingerprint = ""
        project.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint"])

        def supersede(**kwargs):
            WebsiteServiceProject.objects.filter(pk=project.pk).update(checkout_attempt_token="newer-attempt", checkout_attempt_started_at=timezone.now())
            return SimpleNamespace(id="cs_orphan", url="https://checkout.stripe.test/orphan")

        create_session.side_effect = supersede
        response = self.client.post(f"{self.base}{project.pk}/checkout/", {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 400)
        expire_session.assert_called_once_with("cs_orphan")
        project.refresh_from_db()
        self.assertIsNone(project.stripe_checkout_session_id)

    @override_settings(STRIPE_SECRET_KEY="sk_test_website", FRONTEND_URL="https://app.example.test")
    @patch("stripe.checkout.Session.retrieve")
    @patch("stripe.checkout.Session.create")
    def test_open_checkout_session_is_reused(self, create_session, retrieve_session):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        self.prepare_checkout(project, session_id="cs_open")
        retrieve_session.return_value = SimpleNamespace(id="cs_open", url="https://checkout.stripe.test/open", status="open", payment_status="unpaid")
        response = self.client.post(f"{self.base}{project.pk}/checkout/", {"accept_terms": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["checkout_url"], "https://checkout.stripe.test/open")
        create_session.assert_not_called()

    def test_expired_checkout_cannot_later_mark_project_paid(self):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        session = self.prepare_checkout(project, session_id="cs_expired")
        self.assertTrue(sync_checkout_unavailable(session, reason="expired"))
        self.assertFalse(sync_checkout_unavailable(session, reason="expired"))
        self.assertFalse(sync_checkout_completed(session))
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "failed")
        self.assertIsNone(project.stripe_checkout_session_id)

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_test", POSTMARK_SERVER_TOKEN="", SUPPORT_EMAIL="support@example.test")
    @patch("stripe.Webhook.construct_event")
    def test_signed_webhook_updates_exact_project_once(self, construct_event):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        session = self.prepare_checkout(project, session_id="cs_signed")
        construct_event.return_value = {"type": "checkout.session.completed", "data": {"object": session}}
        with self.captureOnCommitCallbacks(execute=True):
            first = self.client.post("/api/payments/webhooks/stripe/", b"{}", content_type="application/json", HTTP_STRIPE_SIGNATURE="test-signature")
        with self.captureOnCommitCallbacks(execute=True):
            duplicate = self.client.post("/api/payments/webhooks/stripe/", b"{}", content_type="application/json", HTTP_STRIPE_SIGNATURE="test-signature")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(duplicate.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.payment_status, "paid")
        self.assertEqual(WebsiteServiceEvent.objects.filter(project=project, event_type="payment_confirmed").count(), 1)

    @override_settings(POSTMARK_SERVER_TOKEN="test-token", SUPPORT_EMAIL="support@example.test")
    @patch("projects.services.website_service.send_postmark_email", side_effect=RuntimeError("provider unavailable"))
    def test_notification_failure_after_commit_does_not_roll_back_submission(self, send_email):
        project = self.create(description="Show our work", contact_details="Public business phone")
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f'{self.base}{project["id"]}/submit/')
        self.assertEqual(response.status_code, 200, response.data)
        row = WebsiteServiceProject.objects.get(pk=project["id"])
        self.assertEqual(row.status, "review")
        self.assertEqual(send_email.call_count, 2)
        self.assertEqual(WebsiteServiceEvent.objects.filter(project=row, delivered=False).count(), 2)

    @patch("projects.services.website_service.send_website_notification")
    def test_rolled_back_transaction_does_not_deliver_notification(self, deliver):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    queue_website_notification(project, "test", "Test", "Test")
                    raise RuntimeError("roll back")
            except RuntimeError:
                pass
        deliver.assert_not_called()

    @override_settings(SUPPORT_EMAIL="approved-staff@example.test")
    @patch("projects.services.website_service.send_postmark_email", return_value=(True, "accepted"))
    def test_notifications_select_only_project_owner_or_configured_staff(self, send_email):
        project = WebsiteServiceProject.objects.get(pk=self.create()["id"])
        send_website_notification(project, "customer_test", "Customer", "Message", "customer")
        send_website_notification(project, "staff_test", "Staff", "Message", "staff")
        recipients = [call.kwargs["to_email"] for call in send_email.call_args_list]
        self.assertEqual(recipients, [self.owner.email, "approved-staff@example.test"])
        self.assertNotIn(self.other.email, recipients)

    def test_other_account_cannot_start_checkout_or_approve(self):
        project = self.create()
        self.client.force_authenticate(self.other)
        for action in ["checkout", "final-approval"]:
            self.assertEqual(self.client.post(f'{self.base}{project["id"]}/{action}/', {"accept_terms": True}, format="json").status_code, 404)
