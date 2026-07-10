from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Contractor,
    CustomerCommunicationLog,
    Homeowner,
    ProjectAssistantCaptureSession,
)
from projects.models_contractor_discovery import ContractorOpportunity


@override_settings(SECURE_SSL_REDIRECT=False)
class ProjectAssistantQuickCaptureApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="quick-capture@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Quick Capture Builders")
        self.other_user = user_model.objects.create_user(email="other-quick-capture@example.com", password="testpass123")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Capture Builders")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_session(self, text=None):
        response = self.client.post(
            "/api/projects/project-assistant/quick-capture/sessions/",
            {
                "text": text
                or "I just spoke with Sarah Johnson. Her email is sarah@example.com and her number is 214-555-0182. She wants a full bathroom remodel at 123 Oak Street.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response

    def test_intent_extraction_prepares_customer_opportunity_draft(self):
        response = self.create_session()
        prepared = response.data["prepared_payload"]

        self.assertEqual(prepared["intent"], "create_customer_and_opportunity")
        self.assertEqual(prepared["customer_draft"]["display_name"], "Sarah Johnson")
        self.assertEqual(prepared["customer_draft"]["email"], "sarah@example.com")
        self.assertIn("214", prepared["customer_draft"]["phone"])
        self.assertEqual(prepared["opportunity_draft"]["project_category"], "Bathroom Remodel")
        self.assertEqual(prepared["opportunity_draft"]["property_address"], "123 Oak Street")
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(ContractorOpportunity.objects.count(), 0)

    def test_missing_field_handling_requires_email_before_customer_creation(self):
        response = self.client.post(
            "/api/projects/project-assistant/quick-capture/sessions/",
            {"text": "Create a customer named Sarah Johnson. Her phone is 214-555-0182."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        missing_labels = [row["label"] for row in response.data["prepared_payload"]["missing_fields"]]
        self.assertIn("Customer email is required before creating a customer record", missing_labels)

        approve = self.client.post(
            f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/approve/",
            {"action": "create_customer"},
            format="json",
        )
        self.assertEqual(approve.status_code, 400)
        self.assertEqual(Homeowner.objects.count(), 0)

    def test_duplicate_customer_matching_is_scoped_to_contractor(self):
        Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Sarah Johnson",
            email="sarah@example.com",
            phone_number="2145550182",
            street_address="123 Oak Street",
        )
        Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Sarah Johnson",
            email="sarah.other@example.com",
            phone_number="2145550182",
            street_address="123 Oak Street",
        )

        response = self.create_session()
        matches = response.data["prepared_payload"]["possible_duplicates"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["email"], "sarah@example.com")

    def test_approved_customer_and_opportunity_creation(self):
        response = self.create_session()
        approve = self.client.post(
            f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/approve/",
            {"action": "create_customer_and_opportunity"},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(approve.data["status"], ProjectAssistantCaptureSession.STATUS_APPROVED)
        self.assertEqual(Homeowner.objects.count(), 1)
        self.assertEqual(ContractorOpportunity.objects.count(), 1)
        opportunity = ContractorOpportunity.objects.get()
        self.assertEqual(opportunity.converted_customer.email, "sarah@example.com")
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_PENDING)
        self.assertIsNone(opportunity.converted_agreement_id)

    def test_existing_customer_opportunity_creation(self):
        existing = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Sarah Johnson",
            email="sarah@example.com",
            phone_number="2145550182",
        )
        response = self.create_session()
        approve = self.client.post(
            f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/approve/",
            {"action": "create_opportunity_for_existing_customer", "selected_customer_id": existing.id},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(Homeowner.objects.count(), 1)
        self.assertEqual(ContractorOpportunity.objects.count(), 1)
        self.assertEqual(ContractorOpportunity.objects.get().converted_customer_id, existing.id)

    def test_basic_reminder_draft_and_creation(self):
        customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Sarah Johnson",
            email="sarah@example.com",
        )
        response = self.client.post(
            "/api/projects/project-assistant/quick-capture/sessions/",
            {"text": "Remind me tomorrow morning to call Sarah Johnson about the bathroom estimate."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["prepared_payload"]["intent"], "create_reminder")
        approve = self.client.post(
            f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/approve/",
            {"action": "create_reminder", "selected_customer_id": customer.id},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(CustomerCommunicationLog.objects.count(), 1)
        self.assertIsNotNone(CustomerCommunicationLog.objects.get().follow_up_at)

    def test_other_contractor_cannot_access_session(self):
        response = self.create_session()
        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        detail = other_client.get(f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/")
        self.assertEqual(detail.status_code, 404)

    def test_cancel_preserves_original_note_without_mutation(self):
        response = self.create_session()
        cancel = self.client.post(
            f"/api/projects/project-assistant/quick-capture/sessions/{response.data['id']}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancel.status_code, 200, cancel.data)
        self.assertEqual(cancel.data["status"], ProjectAssistantCaptureSession.STATUS_CANCELLED)
        self.assertIn("Sarah Johnson", cancel.data["source_text"])
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(ContractorOpportunity.objects.count(), 0)
