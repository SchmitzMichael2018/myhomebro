from __future__ import annotations

import io

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

from projects.models import Agreement, Contractor, Homeowner, Milestone, Project
from projects.models import InspectionStatus
from projects.models_project_intake import ProjectIntake
from projects.services.legal_clauses import build_legal_notices
from projects.services.intake_conversion import convert_intake_to_agreement
from projects.services.intake_analysis import analyze_project_intake
from projects.services.milestone_roles import annotate_milestone_roles
from projects.services.pdf import build_agreement_pdf_bytes
from projects.serializers.agreement import AgreementSerializer


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
