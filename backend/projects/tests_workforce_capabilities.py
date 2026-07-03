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
