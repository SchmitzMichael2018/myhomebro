from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    ContractorAsset,
    ExpenseRequest,
    Homeowner,
    ProjectAssistantSmartCaptureSession,
    PropertyIntelligenceRecord,
    PropertyProfile,
)
from projects.views.customer_portal import _portal_token


@override_settings(
    SECURE_SSL_REDIRECT=False,
    DEFAULT_FILE_STORAGE="django.core.files.storage.InMemoryStorage",
    SMART_CAPTURE_PROVIDER="deterministic",
)
class CustomerPropertyIntelligenceSmartCaptureTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="customer-smart@example.com", password="testpass123")
        self.homeowner = Homeowner.objects.create(full_name="Customer Smart", email="customer-smart@example.com")
        self.property = PropertyProfile.objects.create(
            homeowner=self.homeowner,
            customer_email="customer-smart@example.com",
            display_name="Oak Lane",
            address_line1="123 Oak Lane",
            is_primary=True,
        )
        self.other_user = user_model.objects.create_user(email="other-smart@example.com", password="testpass123")
        self.other_homeowner = Homeowner.objects.create(full_name="Other Smart", email="other-smart@example.com")
        self.other_property = PropertyProfile.objects.create(
            homeowner=self.other_homeowner,
            customer_email="other-smart@example.com",
            display_name="Other Home",
            address_line1="9 Other Street",
        )
        self.client = APIClient()
        self.token = _portal_token("customer-smart@example.com")
        self.other_token = _portal_token("other-smart@example.com")

    def upload(self, name="label.jpg", text=None):
        body = text or "Product: Rheem Water Heater\nManufacturer: Rheem\nModel: RH-50\nSerial: WH-123\nVoltage: 240V"
        return SimpleUploadedFile(name, body.encode("utf-8"), content_type="image/jpeg")

    def create_session(self, capture_type="home_system_label", property_id=None, file_obj=None):
        return self.client.post(
            f"/api/projects/customer-portal/{self.token}/smart-capture/sessions/",
            {
                "capture_type": capture_type,
                "property_id": property_id or self.property.id,
                "file": file_obj or self.upload(),
            },
            format="multipart",
        )

    def test_customer_capture_requires_owned_property_and_prevents_cross_customer_access(self):
        response = self.client.post(
            f"/api/projects/customer-portal/{self.token}/smart-capture/sessions/",
            {
                "capture_type": "home_system_label",
                "property_id": self.other_property.id,
                "file": self.upload(),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)

        created = self.create_session()
        self.assertEqual(created.status_code, 201, created.data)
        blocked = self.client.get(
            f"/api/projects/customer-portal/{self.other_token}/smart-capture/sessions/{created.data['id']}/"
        )
        self.assertEqual(blocked.status_code, 404)

    def test_one_property_customer_can_start_without_explicit_property(self):
        response = self.client.post(
            f"/api/projects/customer-portal/{self.token}/smart-capture/sessions/",
            {
                "capture_type": "appliance_label",
                "file": self.upload(text="Product: Dishwasher\nManufacturer: Bosch\nModel: B-100\nSerial: DW-9"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["structured_payload"]["property_id"], self.property.id)

    def test_multi_property_customer_must_choose_property(self):
        PropertyProfile.objects.create(
            homeowner=self.homeowner,
            customer_email="customer-smart@example.com",
            display_name="Second Home",
            address_line1="456 Pine",
        )
        response = self.client.post(
            f"/api/projects/customer-portal/{self.token}/smart-capture/sessions/",
            {
                "capture_type": "home_system_label",
                "file": self.upload(),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Choose a property", response.data["detail"])

    def test_customer_approval_creates_property_record_and_no_contractor_mutations(self):
        response = self.create_session("property_receipt", file_obj=self.upload("receipt.jpg", "Merchant: Lowe's\nDate: 2026-07-12\nTotal: 42.50"))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(PropertyIntelligenceRecord.objects.count(), 0)
        self.assertEqual(ExpenseRequest.objects.count(), 0)
        approve = self.client.post(
            f"/api/projects/customer-portal/{self.token}/smart-capture/sessions/{response.data['id']}/approve/",
            {"structured_payload": {**response.data["structured_payload"], "property_id": self.property.id}},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        record = PropertyIntelligenceRecord.objects.get()
        self.assertEqual(record.property_profile, self.property)
        self.assertEqual(record.record_type, PropertyIntelligenceRecord.RECORD_RECEIPT)
        self.assertTrue(record.source_capture_id)
        self.assertTrue(record.source_document_id)
        self.assertEqual(ExpenseRequest.objects.count(), 0)
        self.assertEqual(ContractorAsset.objects.count(), 0)
        session = ProjectAssistantSmartCaptureSession.objects.get(pk=response.data["id"])
        self.assertEqual(session.created_property_intelligence_record, record)
        self.assertIsNone(session.created_expense_id)
        self.assertIsNone(session.created_asset_id)

    def test_duplicate_property_record_match_uses_property_scope(self):
        PropertyIntelligenceRecord.objects.create(
            property_profile=self.property,
            customer_email="customer-smart@example.com",
            record_type=PropertyIntelligenceRecord.RECORD_HOME_SYSTEM,
            name="Existing Water Heater",
            manufacturer="Rheem",
            model_number="RH-50",
            serial_number="WH-123",
        )
        response = self.create_session("home_system_label")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["possible_matches"])
        self.assertEqual(response.data["possible_matches"][0]["type"], "property_intelligence_record")
