from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Project
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.services.contractor_directory import normalize_business_name


class ContractorActivationSummaryTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(email="activation@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Activation Concrete",
            phone="512-555-1000",
            city="Austin",
            state="TX",
        )
        self.other_user = User.objects.create_user(email="other-activation@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Activation")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _entry(self, contractor=None, name="Activation Concrete"):
        contractor = contractor or self.contractor
        return ContractorDirectoryEntry.objects.create(
            business_name=name,
            normalized_name=normalize_business_name(name),
            city="Austin",
            state="TX",
            claimed=True,
            claimed_by_contractor=contractor,
        )

    def test_traditional_signup_gets_traditional_onboarding_only(self):
        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["activation_type"], Contractor.ACTIVATION_TRADITIONAL_SIGNUP)
        self.assertFalse(response.data["has_pending_opportunities"])
        self.assertTrue(response.data["guide_sections"]["traditional_onboarding"]["visible"])
        self.assertFalse(response.data["guide_sections"]["public_leads"]["visible"])
        self.assertFalse(response.data["guide_sections"]["prefilled_profile"]["visible"])

    def test_prefilled_contractor_gets_prefilled_profile_section(self):
        self._entry()

        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["activation_type"], Contractor.ACTIVATION_PREFILLED_DIRECTORY)
        self.assertTrue(response.data["has_prefilled_profile"])
        self.assertTrue(response.data["guide_sections"]["prefilled_profile"]["visible"])
        self.assertIn("public business information", response.data["guide_sections"]["prefilled_profile"]["description"])

    def test_pending_opportunity_gets_public_leads_guidance(self):
        entry = self._entry()
        ContractorOpportunity.objects.create(
            directory_entry=entry,
            homeowner_name="Casey Homeowner",
            homeowner_email="casey@example.com",
            project_title="Patio Extension",
            status=ContractorOpportunity.STATUS_PENDING,
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending_opportunity_count"], 1)
        self.assertTrue(response.data["has_pending_opportunities"])
        self.assertTrue(response.data["guide_sections"]["public_leads"]["visible"])
        self.assertIn("Nothing has been sent", response.data["guide_sections"]["public_leads"]["description"])
        self.contractor.refresh_from_db()
        self.assertIsNotNone(self.contractor.first_opportunity_seen_at)

    def test_converted_opportunity_gets_draft_agreement_guidance(self):
        entry = self._entry()
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Casey Homeowner",
            email="casey@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            title="Patio Extension",
            description="Draft from opportunity",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            description="Draft from opportunity",
            status="draft",
            collaboration_summary_snapshot={"source": "contractor_opportunity"},
        )
        ContractorOpportunity.objects.create(
            directory_entry=entry,
            homeowner_name="Casey Homeowner",
            homeowner_email="casey@example.com",
            project_title="Patio Extension",
            status=ContractorOpportunity.STATUS_CONVERTED,
            accepted_by_contractor=self.contractor,
            converted_customer=homeowner,
            converted_agreement=agreement,
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["has_converted_opportunity"])
        self.assertEqual(response.data["latest_agreement_id"], agreement.id)
        self.assertIn(f"/app/agreements/{agreement.id}/wizard", response.data["latest_agreement_url"])
        self.assertTrue(response.data["guide_sections"]["draft_agreement"]["visible"])
        self.assertIn("Draft agreements are starting points", response.data["guide_sections"]["draft_agreement"]["description"])
        self.contractor.refresh_from_db()
        self.assertIsNotNone(self.contractor.first_draft_agreement_seen_at)

    def test_dismiss_endpoint_updates_section_flags(self):
        entry = self._entry()
        ContractorOpportunity.objects.create(
            directory_entry=entry,
            homeowner_name="Casey Homeowner",
            homeowner_email="casey@example.com",
            status=ContractorOpportunity.STATUS_PENDING,
        )

        response = self.client.post(
            "/api/projects/contractor-activation-summary/dismiss/",
            {"section": "public_leads"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.contractor.refresh_from_db()
        self.assertTrue(self.contractor.has_seen_public_leads_intro)
        self.assertTrue(response.data["guide_sections"]["public_leads"]["dismissed"])

    def test_other_contractors_opportunities_do_not_affect_summary(self):
        other_entry = self._entry(contractor=self.other_contractor, name="Other Activation")
        ContractorOpportunity.objects.create(
            directory_entry=other_entry,
            homeowner_name="Hidden Homeowner",
            homeowner_email="hidden@example.com",
            project_title="Hidden Project",
            status=ContractorOpportunity.STATUS_PENDING,
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending_opportunity_count"], 0)
        self.assertFalse(response.data["has_pending_opportunities"])
        self.assertFalse(response.data["guide_sections"]["public_leads"]["visible"])
