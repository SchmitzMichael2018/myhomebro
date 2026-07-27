import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from pypdf import PdfWriter
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    Contractor,
    Homeowner,
    MeasurementCalculatedResult,
    MeasurementSession,
    PlanMeasurementAnnotation,
    PlanMeasurementCalibration,
    Project,
    ProposalMeasurement,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_MEASUREMENT_ENABLED=True,
    MEASUREMENT_PDF_ENABLED=True,
)
class PlanMeasurementApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="plan@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Plan Builders")
        customer = Homeowner.objects.create(created_by=self.contractor, full_name="Plan Customer", email="customer@example.com")
        self.project = Project.objects.create(contractor=self.contractor, homeowner=customer, title="Plan Project")
        self.capture = Capture.objects.create(
            contractor=self.contractor, captured_by=self.user, capture_type="measurement",
            capture_method="typed", raw_text_payload={}, status=Capture.STATUS_APPLIED,
        )
        self.session = MeasurementSession.objects.create(
            contractor=self.contractor, project=self.project, room_name="Kitchen",
            captured_by=self.user, source_capture=self.capture,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def pdf(self):
        stream = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.write(stream)
        return SimpleUploadedFile("plan.pdf", stream.getvalue(), content_type="application/pdf")

    def create_document(self):
        response = self.client.post(
            "/api/projects/measurement-plan-documents/",
            {"measurement_session": self.session.id, "file": self.pdf()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def create_calibration(self, document):
        response = self.client.post(
            f"/api/projects/measurement-plan-documents/{document['id']}/calibrations/",
            {
                "page_number": 1,
                "calibration_type": "page",
                "reference_geometry": {"points": [{"x": "0.1", "y": "0.2"}, {"x": "0.6", "y": "0.2"}]},
                "known_length": "10",
                "unit": "feet",
                "page_rotation": 0,
                "page_box": {"x": "0", "y": "0", "width": "612", "height": "792"},
                "source_dimension_label": "Kitchen width",
                "expected_document_version": document["version"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_upload_calibrate_annotate_and_propose_without_estimate_mutation(self):
        document = self.create_document()
        self.assertEqual(document["page_count"], 1)
        calibration = self.create_calibration(document)
        self.assertEqual(PlanMeasurementCalibration.objects.count(), 1)
        annotation = self.client.post(
            f"/api/projects/measurement-plan-documents/{document['id']}/annotations/",
            {
                "page_number": 1,
                "calibration_id": calibration["id"],
                "annotation_type": "polygon",
                "geometry": {"points": [
                    {"x": "0.1", "y": "0.2"}, {"x": "0.6", "y": "0.2"},
                    {"x": "0.6", "y": "0.4"}, {"x": "0.1", "y": "0.4"},
                ]},
                "label": "Kitchen floor",
                "category": "flooring",
                "expected_document_version": 2,
            },
            format="json",
        )
        self.assertEqual(annotation.status_code, 201, annotation.data)
        self.assertEqual(annotation.data["confidence"], "high_estimate")
        proposal = self.client.post(
            f"/api/projects/measurement-plan-annotations/{annotation.data['id']}/create-proposal/",
            {},
            format="json",
        )
        self.assertEqual(proposal.status_code, 200, proposal.data)
        result = MeasurementCalculatedResult.objects.get(pk=proposal.data["measurement_result_id"])
        self.assertEqual(result.verification_status, "needs_verification")
        self.assertEqual(result.lineage["provider"], "pdf_plan")
        self.assertEqual(ProposalMeasurement.objects.count(), 0)

    def test_server_rejects_out_of_bounds_self_intersection_and_stale_version(self):
        document = self.create_document()
        calibration = self.create_calibration(document)
        stale = self.client.post(
            f"/api/projects/measurement-plan-documents/{document['id']}/annotations/",
            {
                "page_number": 1, "calibration_id": calibration["id"], "annotation_type": "line",
                "geometry": {"points": [{"x": "0.1", "y": "0.1"}, {"x": "0.2", "y": "0.2"}]},
                "label": "Wall", "expected_document_version": 1,
            },
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        invalid = self.client.post(
            f"/api/projects/measurement-plan-documents/{document['id']}/annotations/",
            {
                "page_number": 1, "calibration_id": calibration["id"], "annotation_type": "polygon",
                "geometry": {"points": [
                    {"x": "0.1", "y": "0.1"}, {"x": "0.9", "y": "0.9"},
                    {"x": "0.9", "y": "0.1"}, {"x": "0.1", "y": "0.9"},
                ]},
                "label": "Invalid", "expected_document_version": 2,
            },
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)

    def test_cross_contractor_document_access_is_non_enumerating(self):
        document = self.create_document()
        other_user = get_user_model().objects.create_user(email="other-plan@example.com", password="test")
        Contractor.objects.create(user=other_user, business_name="Other Builder")
        self.client.force_authenticate(other_user)
        self.assertEqual(self.client.get(f"/api/projects/measurement-plan-documents/{document['id']}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/projects/measurement-plan-documents/{document['id']}/file/").status_code, 404)

    @override_settings(MEASUREMENT_PDF_ENABLED=False)
    def test_feature_disabled_fails_closed(self):
        response = self.client.get(
            "/api/projects/measurement-plan-documents/",
            {"measurement_session": self.session.id},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "feature_disabled")

    def test_confirmed_proposal_annotation_cannot_be_archived_or_calibration_invalidated(self):
        document = self.create_document()
        calibration = self.create_calibration(document)
        annotation = self.client.post(
            f"/api/projects/measurement-plan-documents/{document['id']}/annotations/",
            {
                "page_number": 1, "calibration_id": calibration["id"], "annotation_type": "line",
                "geometry": {"points": [{"x": "0.1", "y": "0.2"}, {"x": "0.6", "y": "0.2"}]},
                "label": "Wall", "expected_document_version": 2,
            },
            format="json",
        ).data
        self.client.post(f"/api/projects/measurement-plan-annotations/{annotation['id']}/create-proposal/", {}, format="json")
        self.assertEqual(self.client.post(f"/api/projects/measurement-plan-annotations/{annotation['id']}/archive/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/projects/measurement-plan-calibrations/{calibration['id']}/invalidate/", {}, format="json").status_code, 400)
        self.assertTrue(PlanMeasurementAnnotation.objects.get(pk=annotation["id"]).measurement_entry_id)
