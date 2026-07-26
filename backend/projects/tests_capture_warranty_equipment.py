import json
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Agreement, AgreementWarranty, Capture, Contractor, ContractorAsset,
    Dispute, EquipmentCaptureAttachment, Homeowner, Project,
    WarrantyCaptureChange, WarrantyCaptureDocument, WarrantyRequest,
    WarrantyRequestEvidence,
)
from projects.services.capture_processing import (
    build_warranty_equipment_draft, validate_structured_draft,
)
from projects.views.customer_portal import _project_dashboard_payload


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
    CAPTURE_EQUIPMENT_ENABLED=True,
    CAPTURE_WARRANTY_ENABLED=True,
)
class WarrantyEquipmentCaptureTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="d2@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.user, business_name="D2 Builders")
        self.customer = Homeowner.objects.create(
            created_by=self.contractor, full_name="Jamie Homeowner", email="jamie@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor, homeowner=self.customer, title="HVAC replacement",
        )
        self.agreement = Agreement.objects.create(
            project=self.project, contractor=self.contractor, homeowner=self.customer,
            total_cost=Decimal("8000.00"), status="signed",
        )
        self.warranty = AgreementWarranty.objects.create(
            agreement=self.agreement, contractor=self.contractor,
            title="Workmanship warranty",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def file(self, name="label.jpg", content_type="image/jpeg"):
        content = b"%PDF-1.7 test" if content_type == "application/pdf" else b"\xff\xd8\xff\xe0photo"
        return SimpleUploadedFile(name, content, content_type=content_type)

    def create(self, capture_type, metadata, *, text="", file=None):
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": capture_type,
                "capture_method": "file_upload",
                "project_id": self.project.id,
                "raw_text_payload": json.dumps({
                    "title": "Field capture", "text": text, "input_metadata": metadata,
                }),
                "files": [file or self.file()],
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return Capture.objects.get(id=response.data["id"])

    def approve(self, capture):
        process = self.client.post(
            f"/api/projects/captures/{capture.id}/process/",
            {"expected_version": capture.version}, format="json",
        )
        self.assertEqual(process.status_code, 200, process.data)
        capture.refresh_from_db()
        if capture.duplicate_candidates:
            review = self.client.patch(
                f"/api/projects/captures/{capture.id}/review/",
                {
                    "expected_version": capture.version,
                    "structured_draft": capture.structured_draft,
                    "duplicate_decision": {
                        "decision": "create_separate", "candidate_id": None,
                    },
                },
                format="json",
            )
            self.assertEqual(review.status_code, 200, review.data)
            capture.refresh_from_db()
        approve = self.client.post(
            f"/api/projects/captures/{capture.id}/approve/",
            {"expected_version": capture.version}, format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        capture.refresh_from_db()
        return capture

    def apply(self, capture):
        destinations = capture.approved_snapshot["structured_draft"]["proposed_destinations"]
        key = str(uuid4())
        self.last_idempotency_key = key
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            {
                "expected_version": capture.version,
                "idempotency_key": key,
                "destinations": destinations,
                "adapter_versions": {name: "1" for name in destinations},
                "application_options": {"include_follow_up": False},
                "confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_equipment_manual_processing_apply_artifact_receipt_and_idempotency(self):
        capture = self.create(Capture.TYPE_EQUIPMENT, {
            "category": "hvac", "manufacturer": "Carrier", "model": "XR500",
            "serial_number": "SERIAL-1234", "installation_date": "2026-07-26",
            "customer_visible": False, "uncertainties": ["serial_number: character 3"],
        })
        capture = self.approve(capture)
        response = self.apply(capture)
        asset = ContractorAsset.objects.get(origin_capture=capture)
        self.assertEqual(asset.project, self.project)
        self.assertFalse(asset.customer_visible)
        self.assertEqual(EquipmentCaptureAttachment.objects.filter(equipment=asset).count(), 1)
        self.assertIn("equipment", [row["type"] for row in response.data["receipt"]["created_records"]])
        replay = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            {
                "expected_version": Capture.objects.get(id=capture.id).version,
                "idempotency_key": self.last_idempotency_key,
                "destinations": capture.approved_snapshot["structured_draft"]["proposed_destinations"],
                "adapter_versions": {"equipment_record": "1", "equipment_attachment": "1"},
                "application_options": {"include_follow_up": False}, "confirmed": True,
            }, format="json",
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(ContractorAsset.objects.filter(origin_capture=capture).count(), 1)

    def test_equipment_duplicate_requires_decision_and_does_not_overwrite(self):
        existing = ContractorAsset.objects.create(
            contractor=self.contractor, project=self.project,
            owner_type=ContractorAsset.OWNER_CUSTOMER_PROPERTY,
            name="Existing HVAC", asset_type="hvac", manufacturer="Carrier",
            model_number="XR500", serial_number="SERIAL-1234",
        )
        capture = self.create(Capture.TYPE_EQUIPMENT, {
            "category": "hvac", "manufacturer": "Carrier", "model": "XR500",
            "serial_number": "SERIAL-1234",
        })
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/process/",
            {"expected_version": capture.version}, format="json",
        )
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_POSSIBLE_DUPLICATE)
        self.assertEqual(response.data["review"]["duplicate_candidates"][0]["candidate_id"], existing.id)
        existing.refresh_from_db()
        self.assertEqual(existing.name, "Existing HVAC")

    def test_warranty_document_preserves_pdf_and_change_history(self):
        capture = self.create(
            Capture.TYPE_WARRANTY_DOCUMENT,
            {
                "manufacturer": "Carrier", "product_name": "Heat pump",
                "model": "XR500", "serial_number": "SERIAL-1234",
                "start_date": "2026-07-26", "expiration_date": "2031-07-26",
                "parts_coverage": "Parts per manufacturer document.",
            },
            file=self.file("warranty.pdf", "application/pdf"),
        )
        capture = self.approve(capture)
        self.apply(capture)
        warranty = AgreementWarranty.objects.get(origin_capture=capture)
        document = WarrantyCaptureDocument.objects.get(warranty=warranty)
        self.assertEqual(document.artifact.file_sha256, capture.artifacts.get().file_sha256)
        self.assertEqual(WarrantyCaptureChange.objects.filter(warranty=warranty).count(), 1)
        self.assertNotIn("covered", warranty.coverage_details.lower())

    def test_warranty_dates_and_mime_spoofing_are_rejected(self):
        draft_capture = Capture(
            capture_type=Capture.TYPE_WARRANTY_DOCUMENT, project=self.project,
            contractor=self.contractor,
            raw_text_payload={"input_metadata": {
                "start_date": "2027-01-01", "expiration_date": "2026-01-01",
            }},
        )
        with self.assertRaises(Exception):
            validate_structured_draft(
                Capture.TYPE_WARRANTY_DOCUMENT,
                build_warranty_equipment_draft(draft_capture),
            )
        bad = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": Capture.TYPE_WARRANTY_DOCUMENT,
                "project_id": self.project.id,
                "raw_text_payload": json.dumps({"input_metadata": {}}),
                "files": [SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf")],
            },
            format="multipart",
        )
        self.assertEqual(bad.status_code, 400)

    def test_warranty_concern_creates_neutral_intake_evidence_no_dispute(self):
        capture = self.create(
            Capture.TYPE_WARRANTY_CONCERN,
            {"urgency": "high", "date_first_noticed": "2026-07-25"},
            text="Water heater is leaking near the drain valve.",
        )
        capture = self.approve(capture)
        self.apply(capture)
        request = WarrantyRequest.objects.get(origin_capture=capture)
        self.assertEqual(request.status, WarrantyRequest.STATUS_SUBMITTED)
        self.assertEqual(request.coverage_decision, "")
        self.assertTrue(request.source_context["coverage_not_determined"])
        self.assertEqual(WarrantyRequestEvidence.objects.filter(warranty_request=request).count(), 1)
        self.assertEqual(Dispute.objects.count(), 0)

    def test_customer_portal_only_returns_explicitly_visible_equipment_and_masks_serial(self):
        ContractorAsset.objects.create(
            contractor=self.contractor, customer=self.customer, project=self.project,
            owner_type=ContractorAsset.OWNER_CUSTOMER_PROPERTY, name="Visible HVAC",
            asset_type="hvac", serial_number="SECRET-1234", customer_visible=True,
        )
        ContractorAsset.objects.create(
            contractor=self.contractor, customer=self.customer, project=self.project,
            owner_type=ContractorAsset.OWNER_CUSTOMER_PROPERTY, name="Internal HVAC",
            asset_type="hvac", serial_number="SECRET-9999", customer_visible=False,
        )
        payload = _project_dashboard_payload(self.project, self.agreement)
        self.assertEqual([row["name"] for row in payload["equipment"]], ["Visible HVAC"])
        self.assertEqual(payload["equipment"][0]["serial_number"], "••••1234")

    @override_settings(CAPTURE_EQUIPMENT_ENABLED=False, CAPTURE_WARRANTY_ENABLED=False)
    def test_feature_flags_reject_new_capture_types(self):
        for capture_type in (
            Capture.TYPE_EQUIPMENT, Capture.TYPE_WARRANTY_DOCUMENT,
            Capture.TYPE_WARRANTY_CONCERN,
        ):
            response = self.client.post(
                "/api/projects/captures/",
                {
                    "capture_type": capture_type, "project_id": self.project.id,
                    "raw_text_payload": {"input_metadata": {}},
                },
                format="json",
            )
            self.assertEqual(response.status_code, 404)
