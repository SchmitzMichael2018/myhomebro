from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from projects.models import Contractor, Homeowner, Project


@override_settings(SECURE_SSL_REDIRECT=False)
class AdminEntityDetailTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user("admin-details@example.com", is_staff=True)
        contractor_user = User.objects.create_user(
            "owner-details@example.com",
            first_name="Avery",
            last_name="Builder",
            is_verified=True,
        )
        self.contractor = Contractor.objects.create(
            user=contractor_user,
            business_name="Summit Renovations",
            city="Austin",
            state="TX",
            stripe_account_id="acct_safe_identifier",
            charges_enabled=True,
        )
        self.customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Casey Prospect",
            email="casey@example.com",
        )
        self.other_customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Morgan Owner",
            email="morgan@example.com",
        )
        Project.objects.create(contractor=self.contractor, homeowner=self.customer, title="Kitchen Remodel")
        Project.objects.create(contractor=self.contractor, homeowner=self.other_customer, title="Other Customer Project")
        self.client.force_authenticate(self.admin)

    def test_contractor_detail_uses_profile_id_and_safe_account_summary(self):
        response = self.client.get(f"/api/projects/admin/contractors/{self.contractor.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], self.contractor.id)
        self.assertEqual(response.data["user_id"], self.contractor.user_id)
        self.assertIsNone(response.data["company_id"])
        self.assertEqual(response.data["counts"]["projects"], 2)
        self.assertEqual(response.data["financial"]["stripe_account_id"], "acct_safe_identifier")
        self.assertNotIn("password", response.data)

    def test_customer_project_count_is_direct_and_cross_customer_isolated(self):
        response = self.client.get(f"/api/projects/admin/homeowners/{self.customer.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], self.customer.id)
        self.assertEqual(response.data["relationship_id"], self.customer.id)
        self.assertIsNone(response.data["user_id"])
        self.assertEqual(response.data["counts"]["projects"], 1)
        self.assertEqual([row["title"] for row in response.data["projects"]], ["Kitchen Remodel"])

    def test_missing_records_return_clear_not_found(self):
        contractor = self.client.get("/api/projects/admin/contractors/999999/")
        customer = self.client.get("/api/projects/admin/homeowners/999999/")
        self.assertEqual(contractor.status_code, 404)
        self.assertEqual(contractor.data["detail"], "Contractor not found.")
        self.assertEqual(customer.status_code, 404)
        self.assertEqual(customer.data["detail"], "Customer not found.")
