from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from django.test import override_settings
from django.utils import timezone
from datetime import timedelta
import re
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    AgreementWarranty,
    Contractor,
    ContractorSubAccount,
    EmployeeCapability,
    EmployeeProfile,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    Project,
    Skill,
)
from projects.models_warranty import WarrantyRequest, WarrantyWorkOrder
from projects.services.workforce_assignments import capacity_state_for_counts


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


class WorkforceCapabilityApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner_user = User.objects.create_user(email="owner@example.com", password="test-pass-123")
        self.contractor = Contractor.objects.create(user=self.owner_user, business_name="Crew Co")
        self.employee_user = User.objects.create_user(email="employee@example.com", password="test-pass-123")
        self.subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee_user,
            display_name="Taylor Crew",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        EmployeeProfile.objects.create(subaccount=self.subaccount, first_name="Taylor")
        self.painting, _ = Skill.objects.get_or_create(slug="painting", defaults={"name": "Painting"})
        self.drywall, _ = Skill.objects.get_or_create(slug="drywall", defaults={"name": "Drywall"})
        self.client = APIClient()
        _use_secure_requests(self.client)

    def test_workforce_catalog_returns_skills_and_levels(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/projects/workforce/catalog/")

        self.assertEqual(response.status_code, 200)
        names = {row["name"] for row in response.data["skills"]}
        levels = {row["value"] for row in response.data["skill_levels"]}
        self.assertIn("Painting", names)
        self.assertIn("skilled", levels)

    def test_employee_profile_patch_replaces_capabilities(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.patch(
            "/api/projects/employee/profile/",
            {
                "capabilities": [
                    {"skill_id": self.painting.id, "skill_level": "skilled"},
                    {"skill_id": self.drywall.id, "skill_level": "expert"},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 2)
        self.assertTrue(
            EmployeeCapability.objects.filter(
                subaccount=self.subaccount,
                skill=self.painting,
                skill_level="skilled",
            ).exists()
        )
        payload = response.data["profile"]["capabilities"]
        self.assertEqual({row["skill_name"] for row in payload}, {"Painting", "Drywall"})

        response = self.client.patch(
            "/api/projects/employee/profile/",
            {"capabilities": [{"skill_id": self.painting.id, "skill_level": "lead"}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 1)
        self.assertEqual(EmployeeCapability.objects.get(subaccount=self.subaccount).skill_level, "lead")

    def test_employee_profile_rejects_duplicate_capabilities(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.patch(
            "/api/projects/employee/profile/",
            {
                "capabilities": [
                    {"skill_id": self.painting.id, "skill_level": "skilled"},
                    {"skill_id": self.painting.id, "skill_level": "expert"},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Duplicate capabilities", str(response.data))

    def test_subaccount_list_exposes_capabilities_without_changing_roles(self):
        EmployeeCapability.objects.create(
            subaccount=self.subaccount,
            skill=self.painting,
            skill_level="lead",
        )
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.get("/api/projects/subaccounts/")

        self.assertEqual(response.status_code, 200)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        self.assertEqual(rows[0]["role"], ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES)
        self.assertEqual(rows[0]["capabilities"][0]["skill_name"], "Painting")
        self.assertEqual(rows[0]["capabilities"][0]["skill_level"], "lead")

    def test_owner_can_view_and_edit_employee_labor_cost_profile(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/",
            {
                "cost_basis": "hourly",
                "hourly_cost": "42.50",
                "standard_hours_per_week": "40.00",
                "overtime_multiplier": "1.50",
                "labor_cost_notes": "Loaded labor estimate only.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["cost_basis"], "hourly")
        self.assertEqual(response.data["hourly_cost"], "42.50")
        self.assertEqual(response.data["calculated_effective_hourly_cost"], "42.50")
        self.subaccount.refresh_from_db()
        self.assertEqual(str(self.subaccount.hourly_cost), "42.50")

    def test_salary_labor_cost_calculates_effective_hourly_cost(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/",
            {
                "cost_basis": "salary",
                "annual_salary": "104000.00",
                "standard_hours_per_week": "40.00",
                "overtime_multiplier": "1.25",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["calculated_effective_hourly_cost"], "50.00")

    def test_labor_cost_profile_rejects_non_positive_values(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/",
            {"cost_basis": "hourly", "hourly_cost": "0"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("positive", str(response.data))

    def test_employee_cannot_view_or_edit_other_employee_labor_cost(self):
        self.subaccount.cost_basis = "salary"
        self.subaccount.annual_salary = "104000.00"
        self.subaccount.standard_hours_per_week = "40.00"
        self.subaccount.save(update_fields=["cost_basis", "annual_salary", "standard_hours_per_week", "updated_at"])
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.get(f"/api/projects/subaccounts/{self.subaccount.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("annual_salary", response.data)
        self.assertNotIn("calculated_effective_hourly_cost", response.data)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/",
            {"hourly_cost": "99.00"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_contractor_owner_can_replace_employee_capabilities(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/capabilities/",
            {
                "capabilities": [
                    {"skill_id": self.painting.id, "skill_level": "working"},
                    {"skill_id": self.drywall.id, "skill_level": "expert"},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], self.subaccount.id)
        self.assertEqual({row["skill_name"] for row in response.data["capabilities"]}, {"Painting", "Drywall"})
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 2)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/capabilities/",
            {"capabilities": [{"skill_id": self.painting.id, "skill_level": "lead"}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 1)
        self.assertEqual(EmployeeCapability.objects.get(subaccount=self.subaccount).skill_level, "lead")
        self.subaccount.refresh_from_db()
        self.assertEqual(self.subaccount.role, ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES)

    def test_contractor_capability_endpoint_rejects_duplicates(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/capabilities/",
            {
                "capabilities": [
                    {"skill_id": self.painting.id, "skill_level": "working"},
                    {"skill_id": self.painting.id, "skill_level": "expert"},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Duplicate capabilities", str(response.data))
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 0)

    def test_employee_cannot_use_contractor_capability_endpoint(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.patch(
            f"/api/projects/subaccounts/{self.subaccount.id}/capabilities/",
            {"capabilities": [{"skill_id": self.painting.id, "skill_level": "lead"}]},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(EmployeeCapability.objects.filter(subaccount=self.subaccount).count(), 0)

    def _create_agreement(self, *, contractor=None, title="Kitchen Refresh", homeowner_email="customer@example.com"):
        contractor = contractor or self.contractor
        homeowner = Homeowner.objects.create(
            created_by=contractor,
            full_name="Jordan Customer",
            email=homeowner_email,
        )
        project = Project.objects.create(
            contractor=contractor,
            homeowner=homeowner,
            title=title,
            project_street_address="1200 QA Lane",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78704",
        )
        return Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=homeowner,
            project_type="Flooring",
            description="Replace flooring and repair subfloor.",
            total_cost="2500.00",
            start=timezone.localdate(),
            end=timezone.localdate() + timedelta(days=5),
        )

    def test_workforce_assignments_endpoint_normalizes_agreement_and_milestone_work(self):
        EmployeeCapability.objects.create(
            subaccount=self.subaccount,
            skill=self.painting,
            skill_level="lead",
        )
        agreement = self._create_agreement()
        AgreementAssignment.objects.create(agreement=agreement, subaccount=self.subaccount)
        milestone = Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Demo and prep",
            amount="500.00",
            completion_date=timezone.localdate(),
            normalized_milestone_type="Floor prep",
        )
        MilestoneAssignment.objects.create(milestone=milestone, subaccount=self.subaccount)
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Unassigned install",
            amount="1000.00",
            completion_date=timezone.localdate() + timedelta(days=2),
            normalized_milestone_type="LVP install",
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/projects/workforce/assignments/")

        self.assertEqual(response.status_code, 200)
        rows = response.data["results"]
        self.assertTrue(any(row["source_type"] == "agreement_assignment" for row in rows))
        self.assertTrue(any(row["source_type"] == "milestone_assignment" and row["member_name"] == "Taylor Crew" for row in rows))
        self.assertTrue(any(row["source_type"] == "unassigned_milestone" and row["member_name"] == "Unassigned" for row in rows))
        self.assertGreaterEqual(response.data["summary"]["unassigned_count"], 1)
        self.assertTrue(any(row["skill"] == "Painting" for row in response.data["skills_matrix"]))
        self.assertTrue(any(row["member_name"] == "Taylor Crew" for row in response.data["capacity"]))

    def test_workforce_assignments_include_warranty_work_orders(self):
        agreement = self._create_agreement()
        warranty = AgreementWarranty.objects.create(
            agreement=agreement,
            contractor=self.contractor,
            title="12-month workmanship warranty",
            start_date=timezone.localdate(),
            end_date=timezone.localdate() + timedelta(days=365),
        )
        warranty_request = WarrantyRequest.objects.create(
            warranty=warranty,
            agreement=agreement,
            contractor=self.contractor,
            homeowner=agreement.homeowner,
            title="Floor plank lifting",
            description="A plank lifted near the hallway.",
            severity=WarrantyRequest.SEVERITY_HIGH,
        )
        WarrantyWorkOrder.objects.create(
            warranty_request=warranty_request,
            warranty=warranty,
            agreement=agreement,
            contractor=self.contractor,
            title="Repair raised plank",
            scope="Inspect and reset raised plank.",
            assigned_user=self.employee_user,
            scheduled_for=timezone.now() + timedelta(hours=2),
            status=WarrantyWorkOrder.STATUS_SCHEDULED,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/projects/team/workload/")

        self.assertEqual(response.status_code, 200)
        warranty_rows = [row for row in response.data["results"] if row["source_type"] == "warranty_work_order"]
        self.assertEqual(len(warranty_rows), 1)
        self.assertEqual(warranty_rows[0]["member_name"], "Taylor Crew")
        self.assertTrue(warranty_rows[0]["is_warranty_work"])
        self.assertEqual(response.data["summary"]["warranty_count"], 1)

    def test_workforce_assignments_are_scoped_to_current_contractor(self):
        other_user = get_user_model().objects.create_user(email="other@example.com", password="test-pass-123")
        other_contractor = Contractor.objects.create(user=other_user, business_name="Other Co")
        other_agreement = self._create_agreement(
            contractor=other_contractor,
            title="Other contractor project",
            homeowner_email="other-customer@example.com",
        )
        Milestone.objects.create(
            agreement=other_agreement,
            order=1,
            title="Other private milestone",
            amount="100.00",
            completion_date=timezone.localdate(),
        )
        own_agreement = self._create_agreement()
        Milestone.objects.create(
            agreement=own_agreement,
            order=1,
            title="Own milestone",
            amount="100.00",
            completion_date=timezone.localdate(),
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/projects/workforce/assignments/")

        self.assertEqual(response.status_code, 200)
        labels = {row["milestone_label"] for row in response.data["results"]}
        self.assertIn("Own milestone", labels)
        self.assertNotIn("Other private milestone", labels)

    def test_workforce_capacity_state_calculation(self):
        self.assertEqual(capacity_state_for_counts(0, 1)[0], "available")
        self.assertEqual(capacity_state_for_counts(1, 4)[0], "normal")
        self.assertEqual(capacity_state_for_counts(3, 9)[0], "near_capacity")
        self.assertEqual(capacity_state_for_counts(4, 12)[0], "overbooked")


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="qa@myhomebro.local",
    FRONTEND_BASE_URL="https://app.myhomebro.test",
    TEAM_ACCOUNT_SETUP_COOLDOWN_SECONDS=60,
)
class TeamAccountSetupLinkTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner_user = User.objects.create_user(email="owner-setup@example.com", password="test-pass-123")
        self.contractor = Contractor.objects.create(user=self.owner_user, business_name="Setup Crew Co")
        self.client = APIClient()
        _use_secure_requests(self.client)

    def _extract_setup_parts(self):
        body = mail.outbox[-1].body
        match = re.search(r"https://app\.myhomebro\.test/team-account-setup/([^/]+)/([^/]+)/", body)
        self.assertIsNotNone(match, body)
        return match.group(1), match.group(2)

    def test_owner_can_create_employee_and_send_setup_link_without_password(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/projects/subaccounts/",
            {
                "display_name": "Jordan Setup",
                "email": "jordan.setup@example.com",
                "role": ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
                "send_setup_link": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["setup_status"], "setup_pending")
        self.assertNotIn("token", response.data)
        self.assertNotIn("password", response.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Set up your MyHomeBro team account")
        self.assertIn("Setup Crew Co", mail.outbox[0].body)
        self.assertNotIn("temporary password", mail.outbox[0].body.lower())

        subaccount = ContractorSubAccount.objects.get(id=response.data["id"])
        self.assertFalse(subaccount.user.is_active)
        self.assertFalse(subaccount.user.has_usable_password())
        self.assertIsNotNone(subaccount.setup_sent_at)

    def test_setup_link_completion_activates_account_and_is_single_use(self):
        self.client.force_authenticate(user=self.owner_user)
        self.client.post(
            "/api/projects/subaccounts/",
            {
                "display_name": "Alex Setup",
                "email": "alex.setup@example.com",
                "role": ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
                "send_setup_link": True,
            },
            format="json",
        )
        uid, token = self._extract_setup_parts()
        self.client.force_authenticate(user=None)

        response = self.client.post(
            "/api/accounts/auth/team-account-setup/confirm/",
            {"uid": uid, "token": token, "new_password": "MyHomeBroSetup!2026"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        subaccount = ContractorSubAccount.objects.select_related("user").get(user__email="alex.setup@example.com")
        self.assertTrue(subaccount.user.is_active)
        self.assertTrue(subaccount.user.has_usable_password())
        self.assertTrue(subaccount.user.check_password("MyHomeBroSetup!2026"))
        self.assertTrue(subaccount.is_active)
        self.assertIsNotNone(subaccount.setup_completed_at)

        response = self.client.post(
            "/api/accounts/auth/team-account-setup/confirm/",
            {"uid": uid, "token": token, "new_password": "AnotherPass!2026"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_resending_setup_link_invalidates_previous_pending_token(self):
        self.client.force_authenticate(user=self.owner_user)
        create_response = self.client.post(
            "/api/projects/subaccounts/",
            {
                "display_name": "Riley Resend",
                "email": "riley.resend@example.com",
                "role": ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
                "send_setup_link": True,
            },
            format="json",
        )
        first_uid, first_token = self._extract_setup_parts()
        subaccount = ContractorSubAccount.objects.get(id=create_response.data["id"])
        subaccount.setup_sent_at = timezone.now() - timedelta(seconds=61)
        subaccount.save(update_fields=["setup_sent_at", "updated_at"])

        response = self.client.post(f"/api/projects/subaccounts/{subaccount.id}/send-setup-link/")
        self.assertEqual(response.status_code, 200)
        second_uid, second_token = self._extract_setup_parts()

        self.client.force_authenticate(user=None)
        response = self.client.post(
            "/api/accounts/auth/team-account-setup/confirm/",
            {"uid": first_uid, "token": first_token, "new_password": "OldTokenPass!2026"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.post(
            "/api/accounts/auth/team-account-setup/confirm/",
            {"uid": second_uid, "token": second_token, "new_password": "NewTokenPass!2026"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_setup_link_resend_has_cooldown(self):
        self.client.force_authenticate(user=self.owner_user)
        create_response = self.client.post(
            "/api/projects/subaccounts/",
            {
                "display_name": "Casey Cooldown",
                "email": "casey.cooldown@example.com",
                "role": ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
                "send_setup_link": True,
            },
            format="json",
        )

        response = self.client.post(f"/api/projects/subaccounts/{create_response.data['id']}/send-setup-link/")

        self.assertEqual(response.status_code, 429)
        self.assertIn("retry_after_seconds", response.data)
        self.assertEqual(len(mail.outbox), 1)

    def test_employee_cannot_send_setup_link_for_team_member(self):
        employee_user = get_user_model().objects.create_user(email="employee-owner-test@example.com", password="test-pass-123")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=employee_user,
            display_name="Employee Manager",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        pending_user = get_user_model().objects.create_user(email="pending-target@example.com", password=None, is_active=False)
        pending_sub = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=pending_user,
            display_name="Pending Target",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )
        self.client.force_authenticate(user=employee_user)

        response = self.client.post(f"/api/projects/subaccounts/{pending_sub.id}/send-setup-link/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)
