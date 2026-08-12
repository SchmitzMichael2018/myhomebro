from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Project
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.models_proposals import Proposal, ProposalLineItem, ProposalReviewVersion
from projects.models_templates import ProjectTemplate
from projects.services.contractor_directory import normalize_business_name


@override_settings(SECURE_SSL_REDIRECT=False)
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

    def _template(self, *, status=ProjectTemplate.LifecycleStatus.ACTIVE, contractor=None, is_system=False):
        return ProjectTemplate.objects.create(
            contractor=None if is_system else (contractor or self.contractor),
            name=f"{'System' if is_system else 'Contractor'} {status} Template",
            lifecycle_status=status,
            is_active=True,
            is_system=is_system,
            is_system_template=is_system,
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

    def test_priority_summary_recommends_active_contractor_template_first(self):
        self._template(is_system=True)
        self._template(status=ProjectTemplate.LifecycleStatus.DRAFT)

        response = self.client.get("/api/projects/contractor-activation-summary/")

        summary = response.data["priority_summary"]
        self.assertEqual(summary["active_contractor_template_count"], 0)
        self.assertEqual(summary["launch_action"]["key"], "launch:first-template")
        self.assertEqual(summary["launch_action"]["destination"], "/app/templates")
        self.assertTrue(summary["launch_action"]["optional"])

    def test_priority_summary_advances_from_template_to_customer_to_estimate(self):
        self._template()
        response = self.client.get("/api/projects/contractor-activation-summary/")
        self.assertEqual(response.data["priority_summary"]["launch_action"]["key"], "launch:first-customer")

        Homeowner.objects.create(created_by=self.contractor, full_name="First Customer")
        response = self.client.get("/api/projects/contractor-activation-summary/")
        self.assertEqual(response.data["priority_summary"]["launch_action"]["key"], "launch:first-estimate")
        self.assertEqual(
            response.data["priority_summary"]["launch_action"]["destination"],
            "/app/estimates?create=estimate",
        )

    def test_priority_summary_routes_incomplete_and_ready_estimates_to_exact_steps(self):
        self._template()
        Homeowner.objects.create(created_by=self.contractor, full_name="Estimate Customer")
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=901,
            project_title="Bathroom Remodel",
            status=Proposal.STATUS_IN_PROGRESS,
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")
        action = response.data["priority_summary"]["launch_action"]
        self.assertEqual(action["key"], f"sales:estimate-pricing:{proposal.id}")
        self.assertEqual(action["destination"], f"/app/proposals/{proposal.id}?section=estimate")

        ProposalLineItem.objects.create(
            proposal=proposal,
            description="Installation labor",
            quantity=1,
            unit_price=1000,
        )
        proposal.status = Proposal.STATUS_READY
        proposal.save(update_fields=["status", "updated_at"])
        response = self.client.get("/api/projects/contractor-activation-summary/")
        action = response.data["priority_summary"]["launch_action"]
        self.assertEqual(action["key"], f"sales:agreement-ready:{proposal.id}")
        self.assertEqual(action["destination"], f"/app/proposals/{proposal.id}?section=ready")

    def test_accepted_estimate_without_agreement_remains_actionable(self):
        self._template()
        Homeowner.objects.create(created_by=self.contractor, full_name="Estimate Customer")
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=910,
            project_title="Accepted Bathroom", status=Proposal.STATUS_ACCEPTED,
        )
        ProposalLineItem.objects.create(proposal=proposal, description="Work", quantity=1, unit_price=1000)
        ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email="customer@example.com",
            snapshot={}, decision=ProposalReviewVersion.DECISION_ACCEPTED, decided_at=timezone.now(),
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")

        action = response.data["priority_summary"]["launch_action"]
        self.assertEqual(action["key"], f"sales:agreement-ready:{proposal.id}")
        self.assertEqual(action["source_proposal_id"], proposal.id)
        self.assertEqual(action["action_family"], "proposal_create_agreement")

    def test_converted_proposal_never_generates_create_agreement_priority(self):
        self._template()
        homeowner = Homeowner.objects.create(created_by=self.contractor, full_name="Estimate Customer")
        project = Project.objects.create(contractor=self.contractor, homeowner=homeowner, title="Bathroom")
        agreement = Agreement.objects.create(project=project, contractor=self.contractor, homeowner=homeowner, status="draft")
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=911,
            project_title="Bathroom", status=Proposal.STATUS_ACCEPTED,
            converted_agreement=agreement, converted_at=timezone.now(),
        )
        ProposalLineItem.objects.create(proposal=proposal, description="Work", quantity=1, unit_price=1000)

        response = self.client.get("/api/projects/contractor-activation-summary/")

        summary = response.data["priority_summary"]
        self.assertEqual(summary["active_estimate_count"], 0)
        self.assertIsNone(summary["launch_action"])

    def test_legacy_opportunity_agreement_link_suppresses_proposal_priority(self):
        self._template()
        homeowner = Homeowner.objects.create(created_by=self.contractor, full_name="Legacy Customer")
        project = Project.objects.create(contractor=self.contractor, homeowner=homeowner, title="Legacy Bathroom")
        agreement = Agreement.objects.create(project=project, contractor=self.contractor, homeowner=homeowner, status="draft")
        entry = self._entry()
        opportunity = ContractorOpportunity.objects.create(
            directory_entry=entry, accepted_by_contractor=self.contractor,
            homeowner_name="Legacy Customer", project_title="Legacy Bathroom",
            status=ContractorOpportunity.STATUS_CONVERTED, converted_agreement=agreement,
        )
        proposal = Proposal.objects.create(
            contractor=self.contractor, contractor_opportunity=opportunity,
            source_type=Proposal.SOURCE_OPPORTUNITY, source_id=opportunity.id,
            project_title="Legacy Bathroom", status=Proposal.STATUS_READY,
        )
        ProposalLineItem.objects.create(proposal=proposal, description="Work", quantity=1, unit_price=1000)

        response = self.client.get("/api/projects/contractor-activation-summary/")

        self.assertEqual(response.data["priority_summary"]["active_estimate_count"], 0)
        self.assertIsNone(response.data["priority_summary"]["launch_action"])

    def test_other_contractor_records_do_not_complete_launch_sequence(self):
        self._template(contractor=self.other_contractor)
        Homeowner.objects.create(created_by=self.other_contractor, full_name="Other Customer")
        Proposal.objects.create(
            contractor=self.other_contractor,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=902,
            project_title="Hidden Estimate",
        )

        response = self.client.get("/api/projects/contractor-activation-summary/")
        summary = response.data["priority_summary"]
        self.assertEqual(summary["active_contractor_template_count"], 0)
        self.assertEqual(summary["customer_count"], 0)
        self.assertEqual(summary["active_estimate_count"], 0)
