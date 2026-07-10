from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Contractor,
    ContractorAsset,
    ExpenseRequest,
    ExpenseRequestAttachment,
    ProjectAssistantSmartCaptureSession,
)


@override_settings(SECURE_SSL_REDIRECT=False, DEFAULT_FILE_STORAGE="django.core.files.storage.InMemoryStorage")
class ProjectAssistantSmartCaptureApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="smart-capture@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Smart Capture Builders")
        self.other_user = user_model.objects.create_user(email="other-smart-capture@example.com", password="testpass123")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Smart Capture Builders")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def receipt_upload(self, body=None, name="receipt.jpg", content_type="image/jpeg"):
        content = body or (
            b"Merchant: Tile Depot\n"
            b"Date: 2026-07-09\n"
            b"Subtotal: 250.00\n"
            b"Tax: 20.00\n"
            b"Total: 270.00\n"
            b"Category: materials\n"
            b"Item: LVP planks | 10 | 25.00 | 250.00 | LVP-10\n"
        )
        return SimpleUploadedFile(name, content, content_type=content_type)

    def label_upload(self, body=None, name="label.jpg", content_type="image/jpeg"):
        content = body or (
            b"Product: DeWalt Hammer Drill\n"
            b"Manufacturer: DeWalt\n"
            b"Model: DCD996\n"
            b"Serial: SN-PA-12345\n"
            b"SKU: TOOL-99\n"
        )
        return SimpleUploadedFile(name, content, content_type=content_type)

    def create_session(self, capture_type="receipt", file_obj=None):
        response = self.client.post(
            "/api/projects/project-assistant/smart-capture/sessions/",
            {"capture_type": capture_type, "file": file_obj or self.receipt_upload()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response

    def test_receipt_upload_extracts_editable_expense_draft_without_creating_record(self):
        response = self.create_session()
        self.assertEqual(response.data["capture_type"], "receipt")
        self.assertIn(response.data["status"], {"review_ready", "needs_information"})
        self.assertEqual(response.data["structured_payload"]["merchant_name"], "Tile Depot")
        self.assertEqual(response.data["structured_payload"]["total"], "270.00")
        self.assertEqual(response.data["field_confidence"]["total"], "high_confidence")
        self.assertEqual(ExpenseRequest.objects.count(), 0)

    def test_invalid_upload_is_rejected(self):
        response = self.client.post(
            "/api/projects/project-assistant/smart-capture/sessions/",
            {"capture_type": "receipt", "file": SimpleUploadedFile("receipt.txt", b"Total: 10", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ProjectAssistantSmartCaptureSession.objects.count(), 0)

    def test_approve_receipt_creates_draft_expense_and_preserves_source_file(self):
        response = self.create_session()
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/approve/",
            {"structured_payload": {"description": "Tile Depot LVP receipt", "category": "materials"}},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(approve.data["status"], ProjectAssistantSmartCaptureSession.STATUS_COMPLETED)
        self.assertEqual(ExpenseRequest.objects.count(), 1)
        expense = ExpenseRequest.objects.get()
        self.assertEqual(expense.status, ExpenseRequest.Status.DRAFT)
        self.assertEqual(expense.amount, 270)
        self.assertEqual(expense.category, ExpenseRequest.Category.MATERIALS)
        self.assertTrue(expense.receipt)
        self.assertEqual(ExpenseRequestAttachment.objects.count(), 1)
        self.assertEqual(approve.data["created_expense"], expense.id)

    def test_receipt_duplicate_match_is_suggested_without_merging(self):
        first = self.create_session()
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{first.data['id']}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        second = self.create_session()
        match_types = [row["type"] for row in second.data["possible_matches"]]
        self.assertIn("source_file", match_types)
        self.assertEqual(ExpenseRequest.objects.count(), 1)

    def test_label_upload_extracts_asset_draft_without_creating_asset(self):
        response = self.create_session("equipment_label", self.label_upload())
        self.assertEqual(response.data["structured_payload"]["manufacturer"], "DeWalt")
        self.assertEqual(response.data["structured_payload"]["model_number"], "DCD996")
        self.assertEqual(response.data["structured_payload"]["serial_number"], "SN-PA-12345")
        self.assertEqual(ContractorAsset.objects.count(), 0)

    def test_approve_label_creates_contractor_asset_and_preserves_audit_link(self):
        response = self.create_session("equipment_label", self.label_upload())
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/approve/",
            {"structured_payload": {"destination": ContractorAsset.OWNER_CONTRACTOR, "current_location": "Shop trailer"}},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(ContractorAsset.objects.count(), 1)
        asset = ContractorAsset.objects.get()
        self.assertEqual(asset.manufacturer, "DeWalt")
        self.assertEqual(asset.serial_number, "SN-PA-12345")
        self.assertEqual(asset.current_location, "Shop trailer")
        self.assertEqual(asset.source_capture_id, ProjectAssistantSmartCaptureSession.objects.get().id)

    def test_asset_duplicate_match_is_suggested_by_serial_number(self):
        ContractorAsset.objects.create(
            contractor=self.contractor,
            owner_type=ContractorAsset.OWNER_CONTRACTOR,
            name="Existing Drill",
            manufacturer="DeWalt",
            model_number="DCD996",
            serial_number="SN-PA-12345",
            created_by=self.user,
        )
        response = self.create_session("equipment_label", self.label_upload())
        self.assertIn("asset", [row["type"] for row in response.data["possible_matches"]])
        self.assertEqual(ContractorAsset.objects.count(), 1)

    def test_field_corrections_are_preserved_before_approval(self):
        response = self.create_session()
        patch = self.client.patch(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/",
            {"structured_payload": {"merchant_name": "Tile Depot Corrected", "total": "286.41"}},
            format="json",
        )
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertEqual(patch.data["structured_payload"]["merchant_name"], "Tile Depot Corrected")
        self.assertEqual(patch.data["field_confidence"]["merchant_name"], "confirmed")
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(ExpenseRequest.objects.get().amount, Decimal("286.41"))

    def test_other_contractor_cannot_access_session(self):
        response = self.create_session()
        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        detail = other_client.get(f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/")
        self.assertEqual(detail.status_code, 404)
