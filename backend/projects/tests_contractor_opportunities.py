from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner
from projects.models_contractor_discovery import (
    ContractorDirectoryDiscovery,
    ContractorDirectoryEntry,
    ContractorOpportunity,
)
from projects.models_project_intake import ProjectIntake
from projects.services.contractor_directory import normalize_business_name


class ContractorOpportunityFlowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.contractor_user = User.objects.create_user(
            email="contractor@example.com",
            password="test-pass",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Austin Concrete Pro",
            phone="512-555-1111",
            city="Austin",
            state="TX",
        )
        self.other_user = User.objects.create_user(
            email="other@example.com",
            password="test-pass",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Contractor",
        )
        self.admin_user = User.objects.create_user(
            email="admin@example.com",
            password="test-pass",
            is_staff=True,
            is_superuser=True,
        )
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Austin Concrete Pro",
            normalized_name=normalize_business_name("Austin Concrete Pro"),
            city="Austin",
            state="TX",
            claimed=True,
            claimed_by_contractor=self.contractor,
            services=["concrete contractor"],
        )
        self.intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            customer_name="Casey Homeowner",
            customer_email="casey@example.com",
            customer_phone="512-555-2222",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Extend my concrete patio.",
            ai_description="Extend the concrete patio with a small slab.",
            ai_project_title="Concrete Patio Extension",
            ai_project_type="Concrete",
            ai_project_subtype="Patio",
            desired_timing_text="Within the next month",
        )
        self.intake.ensure_share_token()
        self.client = APIClient()

    def test_selecting_contractor_creates_pending_opportunity_without_customer_or_agreement(self):
        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {
                "token": self.intake.share_token,
                "selected_contractors": [{"directory_entry_id": self.entry.id, "id": f"directory_entry:{self.entry.id}"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], ContractorOpportunity.STATUS_PENDING)
        opportunity = ContractorOpportunity.objects.get()
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_PENDING)
        self.assertEqual(opportunity.directory_entry, self.entry)
        self.assertEqual(opportunity.intake_request, self.intake)
        self.assertEqual(opportunity.homeowner_email, "casey@example.com")
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_selecting_contractor_generates_project_title_when_missing(self):
        self.intake.ai_project_title = ""
        self.intake.ai_project_type = "Flooring"
        self.intake.ai_project_subtype = ""
        self.intake.accomplishment_text = "Replace old flooring in the living room."
        self.intake.ai_description = "Replace old flooring in the living room with contractor review."
        self.intake.save(
            update_fields=[
                "ai_project_title",
                "ai_project_type",
                "ai_project_subtype",
                "accomplishment_text",
                "ai_description",
                "updated_at",
            ]
        )

        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        opportunity = ContractorOpportunity.objects.get()
        self.assertEqual(opportunity.project_title, "Flooring Replacement Project")
        self.assertNotEqual(opportunity.project_title.lower(), "untitled project")

        self.client.force_authenticate(self.contractor_user)
        accept = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(accept.status_code, 200)
        agreement = Agreement.objects.get()
        self.assertEqual(agreement.project.title, "Flooring Replacement Project")

    def test_selecting_same_contractor_and_intake_twice_does_not_duplicate(self):
        payload = {
            "token": self.intake.share_token,
            "selected_contractors": [{"directory_entry_id": self.entry.id}],
        }
        first = self.client.post("/api/projects/public-intake/select-contractor/", payload, format="json")
        second = self.client.post("/api/projects/public-intake/select-contractor/", payload, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ContractorOpportunity.objects.count(), 1)
        self.assertEqual(first.data["opportunity_id"], second.data["opportunity_id"])

    def test_selected_discovery_record_is_marked_selected(self):
        discovery = ContractorDirectoryDiscovery.objects.create(
            directory_entry=self.entry,
            intake_request=self.intake,
            source_type=ContractorDirectoryDiscovery.SOURCE_PUBLIC_INTAKE,
        )
        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        discovery.refresh_from_db()
        self.assertTrue(discovery.selected_by_homeowner)

    def test_accepting_opportunity_creates_customer_and_draft_agreement_idempotently(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.contractor_user)

        first = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")
        second = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        opportunity.refresh_from_db()
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_CONVERTED)
        self.assertEqual(Homeowner.objects.count(), 1)
        self.assertEqual(Agreement.objects.count(), 1)
        agreement = Agreement.objects.get()
        self.assertEqual(agreement.status, "draft")
        self.assertEqual(agreement.contractor, self.contractor)
        self.assertEqual(agreement.homeowner.email, "casey@example.com")
        self.assertEqual(first.data["agreement_id"], second.data["agreement_id"])
        self.assertIn("/app/agreements/", first.data["next_url"])

    def test_unrelated_contractor_cannot_accept_opportunity(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.other_user)

        response = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_admin_can_list_opportunities(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        self.client.force_authenticate(self.admin_user)

        response = self.client.get("/api/projects/admin/contractor-opportunities/", {"status": "pending"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["contractor_business_name"], "Austin Concrete Pro")
        self.assertEqual(response.data["results"][0]["homeowner_email"], "casey@example.com")

    def test_contractor_only_sees_own_opportunities_and_status_filtering(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        other_entry = ContractorDirectoryEntry.objects.create(
            business_name="Other Claimed Entry",
            normalized_name=normalize_business_name("Other Claimed Entry"),
            claimed=True,
            claimed_by_contractor=self.other_contractor,
        )
        ContractorOpportunity.objects.create(
            directory_entry=other_entry,
            homeowner_name="Other Homeowner",
            homeowner_email="other-homeowner@example.com",
            project_title="Other Project",
            status=ContractorOpportunity.STATUS_PENDING,
        )
        self.client.force_authenticate(self.contractor_user)

        response = self.client.get("/api/projects/contractor-opportunities/", {"status": "pending"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["homeowner_email"], "casey@example.com")
        self.assertEqual(response.data["results"][0]["status"], "pending")

    def test_converted_opportunities_return_agreement_info(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.contractor_user)
        self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        response = self.client.get("/api/projects/contractor-opportunities/", {"status": "converted"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["status"], "converted")
        self.assertIsNotNone(response.data["results"][0]["agreement_id"])
        self.assertIn("/app/agreements/", response.data["results"][0]["next_url"])
