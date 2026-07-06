from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    EmployeeWorkSchedule,
    Homeowner,
    MilestoneAssignment,
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
