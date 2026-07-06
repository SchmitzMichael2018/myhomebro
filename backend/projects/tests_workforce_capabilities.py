from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor, ContractorSubAccount, EmployeeCapability, EmployeeProfile, Skill


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
