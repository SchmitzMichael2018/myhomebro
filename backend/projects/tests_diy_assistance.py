from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor, Homeowner
from projects.models_project_intake import ProjectIntake
from projects.services.intake_conversion import convert_intake_to_agreement


class DIYAssistanceTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="diy@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.user, business_name="DIY Pro")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_contractor_me_patch_persists_diy_flags(self):
        response = self.client.patch(
            "/api/projects/contractors/me/",
            {
                "accepts_diy_assistance": True,
                "accepts_consultation_only": True,
                "accepts_hourly_help": True,
                "accepts_inspection_only": False,
                "accepts_homeowner_participation": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.contractor.refresh_from_db()
        self.assertTrue(self.contractor.accepts_diy_assistance)
        self.assertTrue(self.contractor.accepts_consultation_only)
        self.assertTrue(self.contractor.accepts_hourly_help)
        self.assertTrue(self.contractor.accepts_homeowner_participation)

        me_response = self.client.get("/api/projects/contractors/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertTrue(me_response.data["accepts_diy_assistance"])
        self.assertTrue(me_response.data["accepts_consultation_only"])
        self.assertTrue(me_response.data["accepts_hourly_help"])
        self.assertTrue(me_response.data["accepts_homeowner_participation"])

    def test_intake_conversion_carries_project_mode_and_participation_notes(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer One",
            email="customer@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            customer_name="Customer One",
            customer_email="customer@example.com",
            project_class="residential",
            project_mode="assisted_diy",
            accomplishment_text="Need help finishing a bathroom remodel with homeowner labor.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            homeowner_participation_notes="Homeowner will demo and paint.",
            homeowner_started_work=True,
            homeowner_task_summary="Demo, cleanup, paint.",
            homeowner_assistance_summary="Provide framing guidance and finish inspection.",
        )

        agreement = convert_intake_to_agreement(intake=intake, use_recommended_template=False)

        self.assertEqual(agreement.project_mode, "assisted_diy")
        self.assertEqual(agreement.homeowner_participation_notes, "Homeowner will demo and paint.")
        self.assertIn("Demo", agreement.homeowner_responsibilities)
        self.assertIn("inspection", agreement.contractor_responsibilities.lower())
