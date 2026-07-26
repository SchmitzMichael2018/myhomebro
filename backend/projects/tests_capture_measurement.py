import json
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    Contractor,
    Homeowner,
    MeasurementCalculatedResult,
    MeasurementEntry,
    MeasurementSession,
    Project,
    ProposalMeasurement,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
    CAPTURE_MEASUREMENT_ENABLED=True,
)
class MeasurementCaptureTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="measure@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Measure Builders")
        self.customer = Homeowner.objects.create(created_by=self.contractor, full_name="Home Owner", email="home@example.com")
        self.project = Project.objects.create(contractor=self.contractor, homeowner=self.customer, title="Living room floor")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def payload(self):
        return {
            "capture_type": "measurement", "capture_method": "typed", "project_id": self.project.id,
            "raw_text_payload": {
                "input_metadata": {
                    "room_name": "Living Room", "purpose": "flooring", "guided_profile": "rectangular_room",
                    "entries": [
                        {"client_key": "length", "label": "Length", "dimension_type": "length", "raw_value": "12 ft 4 3/8 in", "display_unit": "feet_inches", "source_method": "tape_measure", "verification_status": "verified"},
                        {"client_key": "width", "label": "Width", "dimension_type": "width", "raw_value": "14 ft 7 in", "display_unit": "feet_inches", "source_method": "tape_measure", "verification_status": "verified"},
                    ],
                    "adjustments": [], "annotations": [],
                }
            },
        }

    def test_full_lifecycle_creates_session_results_receipt_and_no_estimate_rows(self):
        create = self.client.post("/api/projects/captures/", self.payload(), format="json")
        self.assertEqual(create.status_code, 201, create.data)
        process = self.client.post(f"/api/projects/captures/{create.data['id']}/process/", {"expected_version": create.data["version"]}, format="json")
        self.assertEqual(process.status_code, 200, process.data)
        draft = process.data["review"]["structured_draft"]
        self.assertEqual(draft["schema_version"], "measurement.v1")
        self.assertEqual(len(draft["calculations"]), 4)
        review = self.client.patch(
            f"/api/projects/captures/{create.data['id']}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": draft},
            format="json",
        )
        self.assertEqual(review.status_code, 200, review.data)
        approve = self.client.post(
            f"/api/projects/captures/{create.data['id']}/approve/",
            {"expected_version": review.data["capture"]["version"]}, format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        capture = Capture.objects.get(pk=create.data["id"])
        destinations = capture.approved_snapshot["structured_draft"]["proposed_destinations"]
        application = {
            "expected_version": capture.version, "idempotency_key": str(uuid4()),
            "destinations": destinations, "adapter_versions": {name: "1" for name in destinations},
            "application_options": {}, "confirmed": True,
        }
        applied = self.client.post(f"/api/projects/captures/{capture.id}/apply/", application, format="json")
        self.assertEqual(applied.status_code, 200, applied.data)
        session = MeasurementSession.objects.get(source_capture=capture)
        self.assertEqual(MeasurementEntry.objects.filter(session=session).count(), 2)
        self.assertEqual(MeasurementCalculatedResult.objects.filter(session=session).count(), 4)
        self.assertEqual(ProposalMeasurement.objects.count(), 0)
        detail = self.client.get(f"/api/projects/measurements/{session.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["room_name"], "Living Room")
        self.assertEqual(len(detail.data["events"]), 4)

    def test_server_rejects_unknown_fields_provider_calculation_and_photo_verification(self):
        create = self.client.post("/api/projects/captures/", self.payload(), format="json")
        capture = Capture.objects.get(pk=create.data["id"])
        from projects.services.capture_processing import build_measurement_draft, validate_structured_draft, CaptureSchemaError
        draft = build_measurement_draft(capture)
        draft["unknown"] = True
        with self.assertRaises(CaptureSchemaError):
            validate_structured_draft("measurement", draft)
        draft = build_measurement_draft(capture)
        draft["calculations"] = [{"formula_key": "provider.magic"}]
        with self.assertRaises(CaptureSchemaError):
            validate_structured_draft("measurement", draft)
        draft = build_measurement_draft(capture)
        draft["entries"][0]["source_method"] = "photo_reference"
        with self.assertRaises(CaptureSchemaError):
            validate_structured_draft("measurement", draft)

    @override_settings(CAPTURE_MEASUREMENT_ENABLED=False)
    def test_feature_disabled_fails_closed(self):
        response = self.client.post("/api/projects/captures/", self.payload(), format="json")
        self.assertEqual(response.status_code, 404)
