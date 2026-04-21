from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import resolve
from rest_framework.test import APIClient

from projects.models import Contractor, ContractorOnboardingSetup, ContractorWorkspaceContext
from projects.views.contractor_onboarding_setup import ContractorOnboardingSetupView


class ContractorOnboardingSetupApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Test Contractor",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.path = "/api/projects/contractors/onboarding/setup/"

    def test_route_maps_to_setup_view(self):
        match = resolve(self.path)
        self.assertIs(getattr(match.func, "cls", None), ContractorOnboardingSetupView)

    def test_get_returns_safe_default_setup(self):
        response = self.client.get(self.path)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["work_description"], "")
        self.assertEqual(response.data["project_family"], {"key": "", "label": ""})
        self.assertIn("project_style", response.data)
        self.assertIn("pricing_baseline", response.data)
        self.assertIn("agreement_defaults", response.data)

    def test_patch_persists_intelligent_setup_and_workspace_family(self):
        response = self.client.patch(
            self.path,
            {
                "work_description": "Roofing and repairs",
                "clarification_answers": {
                    "materials_supply": "Homeowner",
                    "inspection_before_pricing": "Yes",
                },
                "completed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["work_description"], "Roofing and repairs")
        self.assertEqual(response.data["project_family"]["key"], "roofing")
        self.assertIn("pricing_baseline", response.data)
        self.assertIn("milestone_tendencies", response.data)
        self.assertTrue(response.data["completed_at"])

        setup = ContractorOnboardingSetup.objects.get(contractor=self.contractor)
        self.assertEqual(setup.work_description, "Roofing and repairs")
        self.assertEqual(setup.preferred_project_family_keys, ["roofing"])
        self.assertEqual(setup.preferred_project_family_label, "Roofing")
        self.assertTrue(setup.completed_at)
        self.assertIn("project_style", setup.generated_setup)

        workspace = ContractorWorkspaceContext.objects.get(contractor=self.contractor)
        self.assertEqual(workspace.default_project_family_key, "roofing")
        self.assertEqual(workspace.default_project_family_label, "Roofing")
