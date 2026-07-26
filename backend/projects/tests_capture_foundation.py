from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    CaptureApplication,
    CaptureEvent,
    Contractor,
    ContractorSubAccount,
)
from projects.services.capture_lifecycle import (
    CaptureLifecycleError,
    CaptureVersionConflict,
    archive_capture,
    retry_capture,
    transition_capture,
)
from projects.services.capture_permissions import (
    can_apply_capture,
    can_archive_capture,
    can_create_capture,
    can_review_capture,
    can_view_company_capture,
)


@override_settings(SECURE_SSL_REDIRECT=False, CAPTURE_FOUNDATION_ENABLED=True)
class CaptureFoundationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(email="capture-owner@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Capture Builders")
        self.other_owner = user_model.objects.create_user(email="capture-other@example.com", password="test")
        self.other_contractor = Contractor.objects.create(
            user=self.other_owner, business_name="Other Builders"
        )
        self.employee = user_model.objects.create_user(email="capture-employee@example.com", password="test")
        self.employee_account = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee,
            display_name="Capture Employee",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.supervisor = user_model.objects.create_user(
            email="capture-supervisor@example.com", password="test"
        )
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.supervisor,
            display_name="Capture Supervisor",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.capture = Capture.objects.create(
            contractor=self.contractor,
            captured_by=self.employee,
            capture_type=Capture.TYPE_QUICK_LEAD,
            status=Capture.STATUS_SAVED,
            raw_text_payload={"text": "Raw lead"},
        )
        self.client = APIClient()

    def test_lifecycle_records_append_only_events_and_versions(self):
        changed = transition_capture(
            self.capture,
            to_status=Capture.STATUS_PROCESSING,
            actor=self.employee,
            expected_version=1,
        )
        self.assertEqual(changed.version, 2)
        event = changed.events.get()
        self.assertEqual((event.from_status, event.to_status), ("saved", "processing"))
        event.reason = "changed"
        with self.assertRaises(ValidationError):
            event.save()
        with self.assertRaises(ValidationError):
            event.delete()

    def test_invalid_transition_is_rejected_without_event(self):
        with self.assertRaises(CaptureLifecycleError):
            transition_capture(
                self.capture,
                to_status=Capture.STATUS_APPLIED,
                actor=self.owner,
                expected_version=1,
            )
        self.capture.refresh_from_db()
        self.assertEqual(self.capture.status, Capture.STATUS_SAVED)
        self.assertFalse(self.capture.events.exists())

    def test_stale_version_is_rejected(self):
        with self.assertRaises(CaptureVersionConflict):
            transition_capture(
                self.capture,
                to_status=Capture.STATUS_PROCESSING,
                actor=self.owner,
                expected_version=8,
            )

    def test_retry_only_accepts_recoverable_states(self):
        with self.assertRaises(CaptureLifecycleError):
            retry_capture(self.capture, actor=self.employee, expected_version=1)
        self.capture.status = Capture.STATUS_FAILED
        self.capture.save(update_fields=["status"])
        retried = retry_capture(self.capture, actor=self.employee, expected_version=1)
        self.assertEqual(retried.status, Capture.STATUS_PROCESSING)
        self.assertEqual(retried.retry_count, 1)

    def test_archive_sets_timestamp_and_prevents_further_transition(self):
        archived = archive_capture(
            self.capture,
            actor=self.employee,
            expected_version=1,
            reason="No longer needed",
        )
        self.assertEqual(archived.status, Capture.STATUS_ARCHIVED)
        self.assertIsNotNone(archived.archived_at)
        with self.assertRaises(CaptureLifecycleError):
            transition_capture(
                archived,
                to_status=Capture.STATUS_SAVED,
                actor=self.owner,
                expected_version=2,
            )

    def test_permission_policy_is_contractor_and_role_scoped(self):
        self.assertTrue(can_create_capture(self.employee))
        self.assertTrue(can_view_company_capture(self.employee, self.capture))
        self.assertTrue(can_review_capture(self.employee, self.capture))
        self.assertFalse(can_apply_capture(self.employee, self.capture))
        self.assertTrue(can_review_capture(self.supervisor, self.capture))
        self.assertTrue(can_apply_capture(self.owner, self.capture))
        self.assertTrue(can_archive_capture(self.employee, self.capture))
        self.assertFalse(can_view_company_capture(self.other_owner, self.capture))

    def test_completed_receipt_is_standardized_and_immutable(self):
        application = CaptureApplication.objects.create(
            capture=self.capture,
            adapter="customer",
            idempotency_key="receipt-1",
            status=CaptureApplication.STATUS_COMPLETED,
            actor=self.owner,
            capture_version=self.capture.version,
            created_records=[{"type": "customer", "id": 91}],
            executed_at=timezone.now(),
        )
        receipt = application.finalize_receipt()
        self.assertEqual(receipt["adapter"], "customer")
        self.assertEqual(receipt["created_records"], [{"type": "customer", "id": 91}])
        application.created_records = [{"type": "customer", "id": 92}]
        with self.assertRaises(ValidationError):
            application.save()
        with self.assertRaises(ValidationError):
            application.delete()

    def test_api_isolates_other_contractors_and_private_employee_captures(self):
        other_capture = Capture.objects.create(
            contractor=self.other_contractor,
            captured_by=self.other_owner,
            capture_type=Capture.TYPE_QUICK_NOTE,
        )
        colleague = get_user_model().objects.create_user(
            email="capture-colleague@example.com", password="test"
        )
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=colleague,
            display_name="Colleague",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        private_capture = Capture.objects.create(
            contractor=self.contractor,
            captured_by=colleague,
            capture_type=Capture.TYPE_QUICK_NOTE,
        )
        self.client.force_authenticate(self.employee)
        response = self.client.get("/api/projects/captures/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["results"]], [str(self.capture.id)])
        self.assertEqual(
            self.client.get(f"/api/projects/captures/{other_capture.id}/").status_code,
            404,
        )
        self.assertEqual(
            self.client.get(f"/api/projects/captures/{private_capture.id}/").status_code,
            404,
        )

    def test_api_patch_returns_version_conflict_and_archive_uses_expected_version(self):
        self.client.force_authenticate(self.employee)
        stale = self.client.patch(
            f"/api/projects/captures/{self.capture.id}/",
            {"expected_version": 7, "raw_text_payload": {"text": "Changed"}},
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        archived = self.client.post(
            f"/api/projects/captures/{self.capture.id}/archive/",
            {"expected_version": 1, "reason": "Done"},
            format="json",
        )
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.data["status"], Capture.STATUS_ARCHIVED)

    def test_quick_lead_save_creates_only_saved_capture(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "quick_lead",
                "capture_method": "typed",
                "raw_text_payload": {
                    "name": "John",
                    "phone": "281-555-0100",
                    "text": "Needs a deck",
                    "notes": "",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = Capture.objects.get(pk=response.data["id"])
        self.assertEqual(created.status, Capture.STATUS_SAVED)
        self.assertEqual(created.raw_text_payload["name"], "John")
        self.assertEqual(created.processing_engine, "")
        self.assertEqual(created.applications.count(), 0)
        self.assertEqual(created.events.get().to_status, Capture.STATUS_SAVED)

    def test_quick_note_voice_save_preserves_transcript_and_language(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "quick_note",
                "capture_method": "voice_transcript",
                "raw_text_payload": {
                    "title": "Deck",
                    "text": "Remember the cedar sample",
                    "transcript": "Remember the cedar sample",
                    "language": "en-US",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], Capture.STATUS_SAVED)
        self.assertEqual(response.data["raw_text_payload"]["language"], "en-US")

    def test_photo_save_atomically_creates_artifact(self):
        self.client.force_authenticate(self.owner)
        photo = SimpleUploadedFile("job-site.jpg", b"fake-image-bytes", content_type="image/jpeg")
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "photo",
                "capture_method": "camera",
                "file": photo,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = Capture.objects.get(pk=response.data["id"])
        artifact = created.artifacts.get()
        self.assertEqual(created.status, Capture.STATUS_SAVED)
        self.assertEqual(artifact.original_filename, "job-site.jpg")
        self.assertEqual(artifact.mime_type, "image/jpeg")
        self.assertTrue(artifact.file_sha256)

    def test_photo_rejects_non_image_without_creating_capture(self):
        self.client.force_authenticate(self.owner)
        before = Capture.objects.count()
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "photo",
                "capture_method": "file_upload",
                "file": SimpleUploadedFile("notes.txt", b"no", content_type="text/plain"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Capture.objects.count(), before)

    def test_summary_counts_only_visible_company_captures(self):
        Capture.objects.create(
            contractor=self.contractor,
            captured_by=self.owner,
            capture_type=Capture.TYPE_QUICK_NOTE,
            status=Capture.STATUS_READY_FOR_REVIEW,
        )
        Capture.objects.create(
            contractor=self.contractor,
            captured_by=self.owner,
            capture_type=Capture.TYPE_QUICK_NOTE,
            status=Capture.STATUS_FAILED,
        )
        Capture.objects.create(
            contractor=self.other_contractor,
            captured_by=self.other_owner,
            capture_type=Capture.TYPE_QUICK_NOTE,
            status=Capture.STATUS_APPLIED,
        )
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/projects/captures/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending"], 1)
        self.assertEqual(response.data["needs_review"], 1)
        self.assertEqual(response.data["failed"], 1)
        self.assertEqual(response.data["applied"], 0)

    def test_feature_flag_is_disabled_by_default(self):
        self.client.force_authenticate(self.owner)
        with override_settings(CAPTURE_FOUNDATION_ENABLED=False):
            response = self.client.get("/api/projects/captures/")
        self.assertEqual(response.status_code, 404)
