from __future__ import annotations

import io
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

try:  # pragma: no cover - optional test dependency
    from PyPDF2 import PdfReader  # type: ignore
except Exception:  # pragma: no cover
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:  # pragma: no cover
        PdfReader = None  # type: ignore

from projects.models import Agreement, Contractor, ContractorPublicProfile, Homeowner, Milestone, Project, PublicContractorLead
from projects.models import InspectionStatus
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite
from projects.models_project_intake import ProjectIntake
from projects.services.legal_clauses import build_legal_notices
from projects.services.intake_conversion import convert_intake_to_agreement
from projects.services.intake_analysis import analyze_project_intake
from projects.services.milestone_roles import annotate_milestone_roles
from projects.services.payment_protection import build_payment_protection_summary
from projects.services.contractor_matching import score_contractor_project_match
from projects.services.pdf import build_agreement_pdf_bytes
from projects.serializers.agreement import AgreementSerializer
from projects.serializers.public_presence import ContractorPublicLeadSerializer, PublicContractorProfileSerializer


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

    def test_assisted_diy_milestone_roles_are_annotated(self):
        rows = annotate_milestone_roles(
            [
                {"title": "Homeowner Prep", "description": "Prep the room and clear materials."},
                {"title": "Electrical Panel Tie-In", "description": "Licensed electrical panel and service work."},
                {"title": "Final Walkthrough", "description": "Review completed work together."},
            ],
            project_mode="assisted_diy",
        )
        roles = [row.get("milestone_role") for row in rows]

        self.assertEqual(roles[0], "homeowner_task")
        self.assertEqual(roles[1], "contractor_task")
        self.assertEqual(roles[2], "inspection_checkpoint")
        self.assertIn("Licensed Trade Work", rows[1].get("milestone_safety_labels", []))
        self.assertIn("Contractor Required", rows[1].get("milestone_safety_labels", []))

    def test_restricted_assisted_diy_tasks_do_not_become_homeowner_tasks(self):
        rows = annotate_milestone_roles(
            [
                {"title": "Electrical Panel Tie-In", "description": "Electrical panel upgrade and service work."},
                {"title": "Gas Line Work", "description": "Gas line replacement and pressure test."},
                {"title": "Roof Inspection", "description": "Final inspection and walkthrough."},
            ],
            project_mode="assisted_diy",
        )
        roles = [row.get("milestone_role") for row in rows]

        self.assertEqual(roles[0], "contractor_task")
        self.assertEqual(roles[1], "contractor_task")
        self.assertEqual(roles[2], "inspection_checkpoint")
        self.assertNotIn("homeowner_task", roles[:2])
        self.assertIn("Licensed Trade Work", rows[0].get("milestone_safety_labels", []))
        self.assertIn("Licensed Trade Work", rows[1].get("milestone_safety_labels", []))

    def test_intake_analysis_returns_safety_warnings_without_blocking_permits(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Two",
            email="customer2@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            customer_name="Customer Two",
            customer_email="customer2@example.com",
            project_class="residential",
            project_mode="assisted_diy",
            accomplishment_text="Replace electrical panel and handle permit coordination.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            homeowner_participation_notes="Homeowner will help with cleanup only.",
        )

        result = analyze_project_intake(intake=intake)

        self.assertIn("safety_warnings", result)
        self.assertGreaterEqual(len(result["safety_warnings"]), 1)
        self.assertIn("licensed professionals", result["safety_warnings"][0].lower())
        self.assertEqual(result["project_mode"], "assisted_diy")

    def test_intake_payment_preference_persists_and_guides_analysis(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Two B",
            email="customer2b@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            customer_name="Customer Two B",
            customer_email="customer2b@example.com",
            project_class="residential",
            project_mode="consultation",
            accomplishment_text="Need guidance and payment flexibility for a kitchen update.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            payment_preference="discuss",
        )

        result = analyze_project_intake(intake=intake)

        self.assertEqual(result["payment_preference"], "discuss")
        self.assertEqual(result["payment_protection"]["label"], "Escrow Recommended")
        self.assertEqual(result["payment_protection"]["level"], "recommended")

    def test_intake_analysis_returns_contractor_match_snapshot(self):
        self.contractor.accepts_diy_assistance = True
        self.contractor.accepts_consultation_only = True
        self.contractor.accepts_hourly_help = True
        self.contractor.accepts_inspection_only = True
        self.contractor.accepts_homeowner_participation = True
        self.contractor.save(update_fields=[
            "accepts_diy_assistance",
            "accepts_consultation_only",
            "accepts_hourly_help",
            "accepts_inspection_only",
            "accepts_homeowner_participation",
        ])
        self.contractor.skills.create(name="Flooring", slug="flooring")
        profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="DIY Pro",
            tagline="Guided DIY assistance and finish work",
            bio="We help finish started projects, support homeowner participation, and keep escrow milestone payments clear.",
            city="Austin",
            state="TX",
            service_area_text="Austin metro",
            specialties=["Flooring", "Finish Work"],
            work_types=["Guided DIY", "Repair"],
            allow_public_intake=True,
            is_public=True,
        )
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Two D",
            email="customer2d@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=profile,
            homeowner=homeowner,
            customer_name="Customer Two D",
            customer_email="customer2d@example.com",
            project_class="residential",
            project_mode="assisted_diy",
            accomplishment_text="Need help finishing a started flooring project.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            homeowner_participation_notes="Homeowner will prep and cleanup.",
            homeowner_started_work=True,
            homeowner_task_summary="Prep and cleanup",
            homeowner_assistance_summary="Need supervision and finish assistance.",
            payment_preference="escrow",
        )

        result = analyze_project_intake(intake=intake)

        self.assertIn("contractor_match", result)
        self.assertEqual(result["contractor_match"]["tier"], "Strong Match")
        self.assertIn("DIY Assistance Available", result["contractor_match"]["badges"])
        self.assertTrue(result["contractor_match"]["project_requirements"]["rescue_project"])
        self.assertIn("Offers Assisted DIY support.", result["contractor_match"]["reasons"])
        self.assertIn("Supports rescue or finish-my-project work.", result["contractor_match"]["reasons"])

    def test_public_profile_serializer_exposes_compatibility_badges(self):
        self.contractor.accepts_diy_assistance = True
        self.contractor.accepts_consultation_only = True
        self.contractor.accepts_inspection_only = True
        self.contractor.accepts_homeowner_participation = True
        self.contractor.save(update_fields=[
            "accepts_diy_assistance",
            "accepts_consultation_only",
            "accepts_inspection_only",
            "accepts_homeowner_participation",
        ])
        self.contractor.skills.create(name="Electrical", slug="electrical")
        profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="DIY Pro Profile",
            tagline="Homeowner participation welcome",
            bio="Good fit for collaborative projects and phased milestone work.",
            city="Austin",
            state="TX",
            service_area_text="Austin metro",
            specialties=["Electrical", "Consultation"],
            work_types=["Assisted DIY", "Inspection"],
            allow_public_intake=True,
            is_public=True,
        )

        payload = PublicContractorProfileSerializer(profile).data

        self.assertIn("DIY Assistance Available", payload["compatibility_badges"])
        self.assertIn("Consultation Available", payload["compatibility_badges"])
        self.assertIn("Inspection Services", payload["compatibility_badges"])
        self.assertTrue(payload["compatibility_profile"]["summary"])
        self.assertTrue(payload["ways_i_work"])
        self.assertIn("Good fit", payload["compatibility_summary"])

    def test_public_lead_serializer_exposes_matching_snapshot(self):
        self.contractor.accepts_diy_assistance = True
        self.contractor.accepts_homeowner_participation = True
        self.contractor.accepts_inspection_only = True
        self.contractor.save(update_fields=[
            "accepts_diy_assistance",
            "accepts_homeowner_participation",
            "accepts_inspection_only",
        ])
        self.contractor.skills.create(name="Flooring", slug="flooring-compatibility")
        profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Lead Match Profile",
            tagline="Collaborative project support",
            bio="We support rescue projects, homeowner participation, and inspection checkpoints.",
            city="Austin",
            state="TX",
            service_area_text="Austin metro",
            specialties=["Flooring", "Finish Work"],
            work_types=["Assisted DIY", "Inspection"],
            allow_public_intake=True,
            is_public=True,
        )
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Match Prospect",
            email="match@example.com",
            phone="555-123-4567",
            project_address="123 Main St",
            city="Austin",
            state="TX",
            zip_code="78701",
            project_type="Flooring",
            project_description="Need help finishing a started flooring project.",
            preferred_timeline="Soon",
            budget_text="$8,000",
            status=PublicContractorLead.STATUS_READY_FOR_REVIEW,
        )
        lead.ai_analysis = {
            "project_mode": "assisted_diy",
            "payment_preference": "escrow",
            "project_scope_summary": "Need help finishing a started flooring project.",
            "homeowner_started_work": True,
            "homeowner_participation_notes": "Homeowner will prep and cleanup.",
            "homeowner_task_summary": "Prep and cleanup",
            "homeowner_assistance_summary": "Need supervision and finish assistance.",
        }
        lead.save(update_fields=["ai_analysis", "updated_at"])

        payload = ContractorPublicLeadSerializer(lead).data

        self.assertIn("matching", payload)
        self.assertEqual(payload["matching"]["tier"], "Strong Match")
        self.assertIn("Offers Assisted DIY support.", payload["matching"]["reasons"])
        self.assertTrue(payload["matching"]["project_requirements"]["rescue_project"])
        self.assertIn("DIY Assistance Available", payload["matching"]["badges"])

    def test_payment_protection_requires_escrow_for_inspection_only_work(self):
        summary = build_payment_protection_summary(
            project_mode="inspection_only",
            payment_preference="direct",
            milestones=[],
        )

        self.assertEqual(summary["label"], "Escrow Required")
        self.assertTrue(summary["requires_escrow"])
        self.assertEqual(summary["recommended_payment_mode"], "escrow")

    def test_convert_intake_to_agreement_maps_direct_payment_preference(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Two C",
            email="customer2c@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            customer_name="Customer Two C",
            customer_email="customer2c@example.com",
            project_class="residential",
            project_mode="full_service",
            accomplishment_text="Need a standard remodel with direct payment preference.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            payment_preference="direct",
        )

        agreement = convert_intake_to_agreement(intake=intake, use_recommended_template=False)

        self.assertEqual(agreement.payment_mode, "direct")
        self.assertEqual(agreement.project_mode, "full_service")

    def test_legal_clauses_include_assisted_diy_collaboration_language(self):
        clauses = build_legal_notices(project_state="TX", payment_mode="escrow", project_mode="assisted_diy")
        titles = [title for title, _ in clauses]

        self.assertIn("Assisted DIY / Collaboration", titles)
        self.assertNotIn(
            "Assisted DIY / Collaboration",
            [title for title, _ in build_legal_notices(project_state="TX", payment_mode="escrow", project_mode="full_service")],
        )

    def test_convert_intake_to_agreement_persists_ai_milestone_roles(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Three",
            email="customer3@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            customer_name="Customer Three",
            customer_email="customer3@example.com",
            project_class="residential",
            project_mode="assisted_diy",
            accomplishment_text="Need help finishing a bathroom project.",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            ai_milestones=[
                {"title": "Homeowner Prep", "description": "Prep the bathroom and clear materials."},
                {"title": "Install and finish", "description": "Contractor handles technical install work."},
                {"title": "Final walkthrough", "description": "Review completed work together."},
            ],
        )

        agreement = convert_intake_to_agreement(intake=intake, use_recommended_template=False)
        roles = list(agreement.milestones.order_by("order").values_list("milestone_role", flat=True))

        self.assertEqual(agreement.project_mode, "assisted_diy")
        self.assertIn("homeowner_task", roles)
        self.assertIn("contractor_task", roles)
        self.assertIn("inspection_checkpoint", roles)

    def test_assisted_diy_serializer_exposes_collaboration_snapshot(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Four",
            email="customer4@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            title="Assisted DIY Project",
            description="Need help finishing a started project.",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            project_mode="assisted_diy",
            project_class="residential",
            payment_mode="escrow",
            status="draft",
            description="Need help finishing a started project.",
            homeowner_participation_notes="Homeowner will handle prep and cleanup.",
            homeowner_responsibilities="Prep and cleanup",
            contractor_responsibilities="Electrical and inspection work",
            excluded_work="Electrical panel service",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Homeowner Prep",
            description="Prep the area and clear materials.",
            amount=0,
            milestone_role="homeowner_task",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Electrical Panel Tie-In",
            description="Licensed electrical panel and service work.",
            amount=0,
            milestone_role="contractor_task",
            inspection_status=InspectionStatus.REQUESTED,
            inspection_notes="Inspection requested before electrical tie-in.",
        )

        payload = AgreementSerializer(agreement).data

        self.assertIn("responsibility_matrix", payload)
        self.assertIn("homeowner_acknowledgements", payload)
        self.assertIn("inspection_summary", payload)
        self.assertIn("rescue_project_summary", payload)
        self.assertTrue(payload["collaboration_summary"])
        self.assertGreaterEqual(payload["responsibility_matrix"]["homeowner_responsibilities"]["count"], 1)

    def test_inspection_workflow_status_transitions(self):
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Five",
            email="customer5@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            title="Inspection Project",
            description="Inspection workflow test",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            project_mode="inspection_only",
            project_class="residential",
            payment_mode="escrow",
            status="draft",
            description="Inspection workflow test",
        )
        milestone = Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Inspection Checkpoint",
            description="Final inspection checkpoint.",
            amount=0,
        )

        request_inspection = self.client.post(
            f"/api/projects/milestones/{milestone.id}/request-inspection/",
            {"inspection_notes": "Please inspect the work."},
            format="json",
        )
        self.assertEqual(request_inspection.status_code, 200)
        milestone.refresh_from_db()
        self.assertEqual(milestone.inspection_status, InspectionStatus.REQUESTED)
        self.assertEqual(milestone.inspection_notes, "Please inspect the work.")

        passed = self.client.post(
            f"/api/projects/milestones/{milestone.id}/inspection-passed/",
            {"inspection_notes": "Passed inspection."},
            format="json",
        )
        self.assertEqual(passed.status_code, 200)
        milestone.refresh_from_db()
        self.assertEqual(milestone.inspection_status, InspectionStatus.PASSED)
        self.assertEqual(milestone.inspection_notes, "Passed inspection.")

        revision = self.client.post(
            f"/api/projects/milestones/{milestone.id}/inspection-revision-required/",
            {"inspection_notes": "Punch list required."},
            format="json",
        )
        self.assertEqual(revision.status_code, 200)
        milestone.refresh_from_db()
        self.assertEqual(milestone.inspection_status, InspectionStatus.REVISION_REQUIRED)
        self.assertEqual(milestone.inspection_notes, "Punch list required.")

    def test_assisted_diy_pdf_includes_collaboration_sections(self):
        if PdfReader is None:
            self.skipTest("PDF parser dependency not available in this environment.")

        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Customer Six",
            email="customer6@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            title="PDF Collaboration Project",
            description="Need help finishing a started project.",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            project_mode="assisted_diy",
            project_class="residential",
            payment_mode="escrow",
            status="draft",
            description="Need help finishing a started project.",
            homeowner_participation_notes="Homeowner will help with prep and cleanup.",
            homeowner_responsibilities="Prep and cleanup",
            contractor_responsibilities="Electrical and inspection work",
            excluded_work="Electrical panel service",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Homeowner Prep",
            description="Prep the area and clear materials.",
            amount=0,
            milestone_role="homeowner_task",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Electrical Panel Tie-In",
            description="Licensed electrical panel and service work.",
            amount=0,
            milestone_role="contractor_task",
            inspection_status=InspectionStatus.REQUESTED,
            inspection_notes="Inspection requested before electrical tie-in.",
        )

        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        extracted = "\n".join(page.extract_text() or "" for page in reader.pages)

        self.assertIn("Responsibility Matrix", extracted)
        self.assertIn("Homeowner Acknowledgements", extracted)
        self.assertIn("Inspection Checkpoints", extracted)
        self.assertIn("Rescue / Partial Completion Notes", extracted)
        self.assertIn("Payment Protection", extracted)

    def test_contractor_search_prioritizes_claimed_contractor_before_cached_listing(self):
        ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="DIY Pro",
            is_public=True,
            allow_public_intake=True,
            show_phone_public=False,
            show_email_public=False,
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            customer_name="Customer Seven",
            customer_email="customer7@example.com",
            project_class="residential",
            project_mode="assisted_diy",
            accomplishment_text="Need help with a bathroom remodel.",
            project_city="Austin",
            project_state="TX",
        )
        intake.ensure_share_token()
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_CACHED_DIRECTORY,
            business_name="Cached Plumbing Co",
            city="Austin",
            state="TX",
            phone_number="(555) 111-2222",
            primary_trade="plumbing",
            trade_categories=["plumbing"],
        )

        response = self.client.get(
            "/api/projects/public-intake/contractor-search/",
            {"token": intake.share_token, "query": "bathroom remodel"},
        )

        self.assertEqual(response.status_code, 200)
        results = response.data["results"]
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["source"], ContractorDirectoryListing.SOURCE_MYHOMEBRO)
        self.assertTrue(results[0]["claimed"])

    @patch("projects.services.contractor_discovery.send_twilio_sms", return_value=(True, "sent"))
    @patch("projects.services.contractor_discovery.send_postmark_email", return_value=(True, "sent"))
    def test_send_contractor_invites_creates_discovery_invite_for_listing(self, _mock_email, _mock_sms):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            customer_name="Customer Eight",
            customer_email="customer8@example.com",
            project_class="residential",
            project_mode="consultation",
            accomplishment_text="Need a consultation for a roof repair.",
            project_city="Austin",
            project_state="TX",
        )
        intake.ensure_share_token()
        listing = ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_CACHED_DIRECTORY,
            business_name="Roof Consult Co",
            city="Austin",
            state="TX",
            phone_number="(555) 222-3333",
            primary_trade="roofing",
            trade_categories=["roofing"],
        )

        response = self.client.post(
            "/api/projects/public-intake/send-contractor-invites/",
            {
                "token": intake.share_token,
                "selected_contractors": [
                    {"id": f"listing:{listing.id}", "source": listing.source, "channel": "sms"},
                ],
                "preferred_channel": "sms",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["invite_count"], 1)
        invite = ContractorDiscoveryInvite.objects.get(directory_listing=listing)
        self.assertEqual(invite.status, ContractorDiscoveryInvite.STATUS_SENT)
        self.assertEqual(invite.channel, ContractorDiscoveryInvite.CHANNEL_SMS)

    def test_contractor_claim_flow_claims_listing_and_links_contract(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            customer_name="Customer Nine",
            customer_email="customer9@example.com",
            project_class="residential",
            project_mode="inspection_only",
            accomplishment_text="Need an inspection for a plumbing repair.",
            project_city="Austin",
            project_state="TX",
        )
        intake.ensure_share_token()
        listing = ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
            business_name="Claimable Plumbing LLC",
            city="Austin",
            state="TX",
            phone_number="(555) 333-4444",
            primary_trade="plumbing",
            trade_categories=["plumbing"],
        )
        invite = ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            directory_listing=listing,
            channel=ContractorDiscoveryInvite.CHANNEL_SMS,
            destination_phone=listing.phone_number,
        )

        get_response = self.client.get(f"/api/projects/contractors/claim/{invite.invite_token}/")
        self.assertEqual(get_response.status_code, 200)
        self.assertTrue(get_response.data["claim_url"].endswith(str(invite.invite_token)))

        post_response = self.client.post(f"/api/projects/contractors/claim/{invite.invite_token}/", {}, format="json")
        self.assertEqual(post_response.status_code, 200)
        listing.refresh_from_db()
        invite.refresh_from_db()
        self.assertTrue(listing.claimed_profile)
        self.assertEqual(listing.claimed_contractor_id, self.contractor.id)
        self.assertEqual(invite.status, ContractorDiscoveryInvite.STATUS_CLAIMED)
