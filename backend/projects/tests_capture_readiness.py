from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Capture, CaptureArtifact, CaptureEvent, Contractor


@override_settings(SECURE_SSL_REDIRECT=False, CAPTURE_FOUNDATION_ENABLED=True)
class CaptureReadinessTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="capture-ready@example.com",
            password="test",
            first_name="Pat",
            last_name="Builder",
        )
        self.contractor = Contractor.objects.create(
            user=self.owner, business_name="Ready Builders"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def create_capture(self, **overrides):
        defaults = {
            "contractor": self.contractor,
            "captured_by": self.owner,
            "capture_type": Capture.TYPE_QUICK_LEAD,
            "status": Capture.STATUS_SAVED,
            "raw_text_payload": {
                "name": "Jordan Homeowner",
                "phone": "281-555-0119",
                "email": "jordan@example.com",
                "text": "Kitchen estimate",
                "transcript": "Call about cabinets",
            },
        }
        defaults.update(overrides)
        return Capture.objects.create(**defaults)

    def test_server_search_covers_payload_status_type_and_creator(self):
        capture = self.create_capture()
        for term in (
            "Jordan",
            "281-555-0119",
            "jordan@example.com",
            "cabinets",
            "saved",
            "quick_lead",
            "Pat",
        ):
            response = self.client.get("/api/projects/captures/", {"search": term})
            self.assertEqual(response.status_code, 200)
            self.assertEqual([row["id"] for row in response.data["results"]], [str(capture.id)])

    def test_group_filters_dates_duplicates_follow_up_and_creator(self):
        capture = self.create_capture(
            status=Capture.STATUS_POSSIBLE_DUPLICATE,
            duplicate_candidates=[{"candidate_id": 7, "match_strength": "strong"}],
            structured_draft={"follow_up": {"suggested": True}},
        )
        query_sets = (
            {"status": "needs_review"},
            {"type": "quick_lead"},
            {"creator": self.owner.id},
            {"date_from": timezone.localdate().isoformat()},
            {"date_to": timezone.localdate().isoformat()},
            {"has_duplicates": "true"},
            {"has_follow_up": "true"},
        )
        for params in query_sets:
            response = self.client.get("/api/projects/captures/", params)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["results"][0]["id"], str(capture.id))

    def test_cursor_pagination_and_sorting(self):
        now = timezone.now()
        for index in range(23):
            self.create_capture(
                raw_text_payload={"title": f"Capture {index:02d}", "text": "Scope"},
                original_captured_at=now - timedelta(minutes=index),
            )
        newest = self.client.get("/api/projects/captures/", {"page_size": 10})
        self.assertEqual(newest.status_code, 200)
        self.assertEqual(newest.data["count"], 23)
        self.assertIsNotNone(newest.data["next"])
        self.assertNotIn("page=", newest.data["next"])
        next_page = self.client.get(newest.data["next"])
        self.assertEqual(next_page.status_code, 200)
        oldest = self.client.get("/api/projects/captures/", {"sort": "oldest"})
        self.assertEqual(oldest.status_code, 200)
        self.assertEqual(oldest.data["results"][0]["raw_text_payload"]["title"], "Capture 22")
        alphabetical = self.client.get("/api/projects/captures/", {"sort": "alphabetical"})
        self.assertEqual(alphabetical.status_code, 200)

    def test_summary_exposes_navigable_card_counts(self):
        self.create_capture(status=Capture.STATUS_APPROVED)
        applied = self.create_capture(status=Capture.STATUS_APPLIED)
        Capture.objects.filter(pk=applied.pk).update(updated_at=timezone.now())
        response = self.client.get("/api/projects/captures/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["approved"], 1)
        self.assertEqual(response.data["applied_today"], 1)
        self.assertEqual(
            response.data["creators"],
            [{"id": self.owner.id, "name": "Pat Builder"}],
        )

    def test_timeline_and_artifacts_are_separate_scoped_resources(self):
        capture = self.create_capture()
        CaptureEvent.objects.create(
            capture=capture,
            event_type="created",
            to_status=Capture.STATUS_SAVED,
            actor=self.owner,
        )
        CaptureArtifact.objects.create(
            capture=capture,
            artifact_type=CaptureArtifact.TYPE_PHOTO,
            file=SimpleUploadedFile("job.png", b"image", content_type="image/png"),
            original_filename="job.png",
            mime_type="image/png",
            file_size=5,
            uploaded_by=self.owner,
            sanitization_metadata={"ocr_text": "Permit 123"},
        )
        detail = self.client.get(f"/api/projects/captures/{capture.id}/")
        self.assertEqual(detail.data["events"], [])
        self.assertEqual(detail.data["artifacts"], [])
        timeline = self.client.get(f"/api/projects/captures/{capture.id}/timeline/")
        self.assertEqual(timeline.data["results"][0]["actor_name"], "Pat Builder")
        artifacts = self.client.get(f"/api/projects/captures/{capture.id}/artifacts/")
        self.assertEqual(artifacts.data["results"][0]["original_filename"], "job.png")
        self.assertTrue(artifacts.data["results"][0]["download_url"])
