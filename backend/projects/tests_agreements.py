from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    EmployeeCapability,
    EmployeeWorkSchedule,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    Project,
    Skill,
)


def _use_secure_requests(client):
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    for method_name in ("get", "post", "put", "patch", "delete"):
        original = getattr(client, method_name)

        def secure_method(*args, _original=original, **kwargs):
            kwargs.setdefault("secure", True)
            return _original(*args, **kwargs)

        setattr(client, method_name, secure_method)
    return client


class AgreementPlanningAssumptionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="planning-owner@example.com",
            password="test-pass-123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Planning Co",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Casey Customer",
            email="casey-planning@example.com",
        )
        self.client = _use_secure_requests(APIClient())
        self.client.force_authenticate(user=self.user)

    def _planning_payload(self):
        return {
            "planned_start_date": "2026-08-03",
            "planned_finish_date": "2026-08-14",
            "planned_duration_days": 10,
            "planned_crew_size": 3,
            "planned_labor_hours": 240,
            "planning_confidence": 82,
            "planning_notes": "Planning only. Crew assignment happens during activation.",
            "planning_capability_mix": [
                {"capability": "Painting", "count": 2, "available": 3},
                {"capability": "General Labor", "count": 1, "available": 4},
            ],
            "planning_priority": "balanced",
            "include_weekends": False,
        }

    def test_agreement_create_stores_planning_assumptions_without_assignments_or_schedules(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Planning Assumption Draft",
                "title": "Planning Assumption Draft",
                "scope_of_work": "Interior repaint and prep.",
                "agreement_mode": "standard",
                "payment_mode": "escrow",
                "planning_assumptions": self._planning_payload(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        agreement = Agreement.objects.get(pk=response.data["id"])
        self.assertEqual(agreement.planning_assumptions["planned_start_date"], "2026-08-03")
        self.assertEqual(agreement.planning_assumptions["planned_crew_size"], 3)
        self.assertEqual(AgreementAssignment.objects.count(), 0)
        self.assertEqual(MilestoneAssignment.objects.count(), 0)
        self.assertEqual(EmployeeWorkSchedule.objects.count(), 0)

    def test_agreement_detail_returns_planning_assumptions_after_patch(self):
        created = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Planning Detail Draft",
                "title": "Planning Detail Draft",
                "scope_of_work": "Cabinet install planning.",
                "agreement_mode": "standard",
                "payment_mode": "escrow",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        agreement_id = created.data["id"]

        patched = self.client.patch(
            f"/api/projects/agreements/{agreement_id}/",
            {"planning_assumptions": self._planning_payload()},
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.data)

        detail = self.client.get(f"/api/projects/agreements/{agreement_id}/")
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(detail.data["planning_assumptions"]["planned_finish_date"], "2026-08-14")
        self.assertEqual(detail.data["planning_assumptions"]["planning_priority"], "balanced")
        self.assertFalse(detail.data["planning_assumptions"]["include_weekends"])
        self.assertEqual(AgreementAssignment.objects.count(), 0)
        self.assertEqual(MilestoneAssignment.objects.count(), 0)
        self.assertEqual(EmployeeWorkSchedule.objects.count(), 0)


class AgreementActivationPreviewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="activation-preview-owner@example.com",
            password="test-pass-123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Activation Preview Co",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Avery Customer",
            email="avery-preview@example.com",
        )
        self.client = _use_secure_requests(APIClient())
        self.client.force_authenticate(user=self.user)
        self.skill, _ = Skill.objects.get_or_create(slug="painting", defaults={"name": "Painting"})
        employee_user = User.objects.create_user(
            email="activation-employee@example.com",
            password="test-pass-123",
        )
        self.employee = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=employee_user,
            display_name="Pat Painter",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
            is_active=True,
        )
        EmployeeCapability.objects.create(
            subaccount=self.employee,
            skill=self.skill,
            skill_level="skilled",
        )

    def _agreement(self, *, payment_mode="escrow", escrow_funded=False, status="signed"):
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title=f"{payment_mode.title()} Activation Project",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode=payment_mode,
            status=status,
            description="Activation preview scope.",
            total_cost="1200.00",
            incidentals_reserve_amount="150.00" if payment_mode == "escrow" else "0.00",
            escrow_funded_amount="1350.00" if escrow_funded else "0.00",
            escrow_funded=escrow_funded,
            signed_by_contractor=True,
            signed_by_homeowner=True,
            start="2026-08-03",
            end="2026-08-14",
            planning_assumptions={
                "planned_start_date": "2026-08-03",
                "planned_finish_date": "2026-08-14",
                "planned_duration_days": 10,
                "planned_crew_size": 2,
                "planned_labor_hours": 160,
                "planning_confidence": 80,
                "planning_notes": "Saved planning assumptions are ready for activation preview.",
                "planning_capability_mix": [
                    {"capability": "Painting", "count": 1, "available": 1},
                ],
                "planning_priority": "balanced",
                "include_weekends": False,
            },
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Prep and paint",
            description="Prepare surfaces and paint.",
            amount="1200.00",
            start_date="2026-08-03",
            completion_date="2026-08-14",
            recommended_duration_days=10,
            materials_hint="Confirm paint colors and primer availability.",
        )
        return agreement

    def test_activation_preview_creates_no_assignments_or_schedules(self):
        agreement = self._agreement(payment_mode="escrow", escrow_funded=True)

        response = self.client.get(f"/api/projects/agreements/{agreement.id}/activation-preview/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["preview_only"])
        self.assertEqual(response.data["suggested_schedule"]["start_date"], "2026-08-03")
        self.assertEqual(response.data["planning_assumptions"]["planned_crew_size"], 2)
        self.assertEqual(response.data["crew_capability_needs"][0]["capability"], "Painting")
        self.assertEqual(AgreementAssignment.objects.count(), 0)
        self.assertEqual(MilestoneAssignment.objects.count(), 0)
        self.assertEqual(EmployeeWorkSchedule.objects.count(), 0)

    def test_escrow_activation_preview_shows_funding_blocker_when_not_funded(self):
        agreement = self._agreement(payment_mode="escrow", escrow_funded=False)

        response = self.client.get(f"/api/projects/agreements/{agreement.id}/activation-preview/")

        self.assertEqual(response.status_code, 200, response.data)
        blocker_messages = " ".join(row["message"] for row in response.data["blockers"])
        self.assertIn("Escrow funding is required", blocker_messages)
        self.assertFalse(response.data["source_summary"]["funding_ready"])

    def test_direct_pay_activation_preview_available_after_signature(self):
        agreement = self._agreement(payment_mode="direct", escrow_funded=False)

        response = self.client.get(f"/api/projects/agreements/{agreement.id}/activation-preview/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["source_summary"]["signature_ready"])
        self.assertTrue(response.data["source_summary"]["funding_ready"])
        self.assertEqual(response.data["source_summary"]["payment_mode"], "direct")
        self.assertEqual(response.data["blockers"], [])
