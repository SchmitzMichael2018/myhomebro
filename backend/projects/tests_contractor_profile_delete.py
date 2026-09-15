from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor, Homeowner, Project


class ContractorProfileDeleteTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="qa-contractor@example.com",
            password="pass12345",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Disposable QA Contractor",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_hard_delete_removes_only_contractor_role(self):
        customer_owner = get_user_model().objects.create_user(
            email="customer-record-owner@example.com",
            password="pass12345",
        )
        other_contractor = Contractor.objects.create(
            user=customer_owner,
            business_name="Other Contractor",
        )
        shared_email_customer = Homeowner.objects.create(
            created_by=other_contractor,
            full_name="QA Customer Workspace",
            email=self.user.email,
        )

        response = self.client.delete("/api/projects/contractors/me/?hard=1")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Contractor.objects.filter(pk=self.contractor.pk).exists())
        self.assertTrue(get_user_model().objects.filter(pk=self.user.pk, is_active=True).exists())
        self.assertTrue(Homeowner.objects.filter(pk=shared_email_customer.pk).exists())

    def test_delete_requires_explicit_hard_delete_confirmation(self):
        response = self.client.delete("/api/projects/contractors/me/")

        self.assertEqual(response.status_code, 400)
        self.assertTrue(Contractor.objects.filter(pk=self.contractor.pk).exists())

    def test_delete_is_blocked_when_related_business_records_exist(self):
        customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Related Customer",
            email="customer@example.com",
        )
        Project.objects.create(
            contractor=self.contractor,
            homeowner=customer,
            title="Related Project",
        )

        response = self.client.delete("/api/projects/contractors/me/?hard=1")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["related_counts"]["customers"], 1)
        self.assertEqual(response.json()["related_counts"]["projects"], 1)
        self.assertTrue(response.json()["deactivation_available"])
        self.assertTrue(Contractor.objects.filter(pk=self.contractor.pk).exists())

    def test_deactivate_preserves_records_login_and_routes_to_customer_workspace(self):
        customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Retained Customer",
            email="retained@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=customer,
            title="Retained Project",
        )

        response = self.client.post("/api/projects/contractors/me/deactivate/")

        self.assertEqual(response.status_code, 200)
        self.contractor.refresh_from_db()
        self.user.refresh_from_db()
        self.assertFalse(self.contractor.is_active)
        self.assertIsNotNone(self.contractor.deactivated_at)
        self.assertTrue(self.user.is_active)
        self.assertTrue(Homeowner.objects.filter(pk=customer.pk).exists())
        self.assertTrue(Project.objects.filter(pk=project.pk).exists())

        identity = self.client.get("/api/projects/whoami/")
        self.assertEqual(identity.status_code, 200)
        self.assertEqual(identity.json()["type"], "homeowner")
        self.assertEqual(identity.json()["available_workspaces"], ["customer"])

        portal = self.client.get("/api/projects/customer-portal/account/")
        self.assertEqual(portal.status_code, 200)
        self.assertFalse(portal.json()["account"]["can_access_contractor_workspace"])

    def test_deactivate_is_idempotent(self):
        first = self.client.post("/api/projects/contractors/me/deactivate/")
        second = self.client.post("/api/projects/contractors/me/deactivate/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(Contractor.objects.get(pk=self.contractor.pk).is_active)

    def test_delete_returns_not_found_without_contractor_role(self):
        self.contractor.delete()

        response = self.client.delete("/api/projects/contractors/me/?hard=1")

        self.assertEqual(response.status_code, 404)
