from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from projects.models import Agreement, Contractor, ContractorActivityEvent, ContractorPublicProfile, Homeowner, Project


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

    def test_admin_can_inactivate_contractor_with_required_audit_reason(self):
        profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Summit Renovations",
            is_public=True,
            allow_public_intake=True,
        )
        agreement = Agreement.objects.create(
            contractor=self.contractor,
            homeowner=self.customer,
            project=Project.objects.filter(contractor=self.contractor, homeowner=self.customer).first(),
            total_cost="2500.00",
        )

        response = self.client.post(
            f"/api/projects/admin/contractors/{self.contractor.id}/inactivate/",
            {"reason": "Fictional pre-launch contractor account."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.contractor.refresh_from_db()
        self.contractor.user.refresh_from_db()
        profile.refresh_from_db()
        self.assertFalse(self.contractor.user.is_active)
        self.assertEqual(self.contractor.marketplace_verification_status, Contractor.MARKETPLACE_SUSPENDED)
        self.assertFalse(self.contractor.marketplace_preferred)
        self.assertFalse(profile.is_public)
        self.assertFalse(profile.allow_public_intake)
        self.assertTrue(Agreement.objects.filter(pk=agreement.id).exists())
        event = ContractorActivityEvent.objects.get(
            contractor=self.contractor,
            event_type="admin_contractor_inactivated",
        )
        self.assertEqual(event.actor_user, self.admin)
        self.assertEqual(event.summary, "Fictional pre-launch contractor account.")
        self.assertTrue(event.metadata["prior_state"]["user_is_active"])

        listing = self.client.get("/api/projects/admin/contractors/")
        row = next(item for item in listing.data["results"] if item["id"] == self.contractor.id)
        self.assertEqual(row["account_status"], "inactive")
        self.assertFalse(row["is_active"])

    def test_contractor_inactivation_requires_reason(self):
        response = self.client.post(
            f"/api/projects/admin/contractors/{self.contractor.id}/inactivate/",
            {"reason": "   "},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.contractor.user.refresh_from_db()
        self.assertTrue(self.contractor.user.is_active)

    def test_non_admin_cannot_inactivate_contractor(self):
        regular_user = get_user_model().objects.create_user("regular@example.com")
        self.client.force_authenticate(regular_user)

        response = self.client.post(
            f"/api/projects/admin/contractors/{self.contractor.id}/inactivate/",
            {"reason": "Unauthorized attempt."},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.contractor.user.refresh_from_db()
        self.assertTrue(self.contractor.user.is_active)
