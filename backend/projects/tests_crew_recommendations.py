from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    EmployeeCapability,
    Homeowner,
    Milestone,
    Project,
    Skill,
)
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.services.contractor_directory import normalize_business_name


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


class CrewRecommendationPreviewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner_user = User.objects.create_user(email="owner@example.com", password="test-pass-123")
        self.contractor = Contractor.objects.create(user=self.owner_user, business_name="Crew Co")
        self.employee_user = User.objects.create_user(email="painter@example.com", password="test-pass-123")
        self.employee = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee_user,
            display_name="Pat Painter",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
            is_active=True,
        )
        self.painting, _ = Skill.objects.get_or_create(slug="painting", defaults={"name": "Painting"})
        self.drywall, _ = Skill.objects.get_or_create(slug="drywall", defaults={"name": "Drywall"})
        EmployeeCapability.objects.create(subaccount=self.employee, skill=self.painting, skill_level="skilled")
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Crew Co",
            normalized_name=normalize_business_name("Crew Co"),
            city="Austin",
            state="TX",
            claimed=True,
            claimed_by_contractor=self.contractor,
            services=["painting contractor"],
        )
        self.opportunity = ContractorOpportunity.objects.create(
            directory_entry=self.entry,
            homeowner_name="Casey Customer",
            homeowner_email="casey@example.com",
            project_title="Interior Painting and Drywall Repair",
            project_type="Painting",
            project_subtype="Drywall Patch",
            project_description="Paint two rooms and patch damaged drywall.",
            status=ContractorOpportunity.STATUS_PENDING,
        )
        self.homeowner = Homeowner.objects.create(full_name="Casey Customer", email="casey@example.com")
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Interior Painting Agreement",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            project_type="Painting",
            project_subtype="Interior Painting",
            description="Paint rooms and repair drywall.",
            start="2026-08-01",
            end="2026-08-05",
        )
        Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Drywall patch and paint prep",
            description="Patch drywall before painting.",
            amount="500.00",
            start_date="2026-08-01",
            completion_date="2026-08-02",
        )
        self.client = APIClient()
        _use_secure_requests(self.client)
        self.client.force_authenticate(user=self.owner_user)

    def test_opportunity_preview_is_read_only_and_returns_gaps(self):
        before_status = self.opportunity.status
        before_assignments = AgreementAssignment.objects.count()

        response = self.client.post(
            "/api/projects/crew-recommendations/preview/",
            {"source_type": "opportunity", "source_id": self.opportunity.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.opportunity.refresh_from_db()
        self.assertEqual(self.opportunity.status, before_status)
        self.assertEqual(AgreementAssignment.objects.count(), before_assignments)
        self.assertEqual(response.data["source_summary"]["source_type"], "opportunity")
        self.assertTrue(any(row["skill_name"] == "Painting" for row in response.data["required_capabilities"]))
        self.assertTrue(any(row["matched_skill_name"] == "Painting" for row in response.data["recommended_members"]))
        self.assertTrue(any(row["skill_name"] == "Drywall" for row in response.data["gaps"]))
        self.assertIn("advisory", response.data["advisory_notice"].lower())

    def test_agreement_preview_is_read_only_and_warns_about_overlap(self):
        other_project = Project.objects.create(contractor=self.contractor, homeowner=self.homeowner, title="Overlap")
        other_agreement = Agreement.objects.create(
            project=other_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            project_type="Painting",
            description="Paint trim.",
            start="2026-08-03",
            end="2026-08-06",
        )
        AgreementAssignment.objects.create(agreement=other_agreement, subaccount=self.employee)
        before_assignments = AgreementAssignment.objects.count()
        before_agreement_status = self.agreement.status
        before_agreement_total = self.agreement.total_cost

        response = self.client.post(
            "/api/projects/crew-recommendations/preview/",
            {"source_type": "agreement", "source_id": self.agreement.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.status, before_agreement_status)
        self.assertEqual(self.agreement.total_cost, before_agreement_total)
        self.assertEqual(AgreementAssignment.objects.count(), before_assignments)
        self.assertTrue(any(row["type"] == "schedule_conflict" for row in response.data["warnings"]))
        self.assertTrue(response.data["recommended_members"])
