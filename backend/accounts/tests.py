from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Homeowner
from projects.services.public_intake_customers import get_or_create_customer_for_public_intake


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    ACCOUNTS_REQUIRE_EMAIL_VERIFICATION=True,
    SITE_URL="https://www.myhomebro.com",
)
class CustomerAccountRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = "/api/accounts/auth/customer-register/"

    def _payload(self, **overrides):
        data = {
            "full_name": "Pat Homeowner",
            "email": "Pat.Customer@Example.com",
            "phone_number": "(555) 111-2222",
            "password": "StrongPass123!",
        }
        data.update(overrides)
        return data

    def test_customer_can_create_account_without_project(self):
        response = self.client.post(self.url, self._payload(), format="json", secure=True)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["next_step"], "verify_email")
        self.assertNotIn("password", response.data)
        user = get_user_model().objects.get(email__iexact="pat.customer@example.com")
        self.assertFalse(user.is_active)
        self.assertFalse(user.is_verified)
        homeowner = Homeowner.objects.get(email__iexact="pat.customer@example.com")
        self.assertEqual(homeowner.full_name, "Pat Homeowner")
        self.assertEqual(homeowner.phone_number, "(555) 111-2222")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/api/accounts/auth/verify-email/", mail.outbox[0].body)

    def test_customer_registration_reuses_existing_homeowner_identity(self):
        existing = Homeowner.objects.create(
            full_name="Existing Customer",
            email="existing@example.com",
            phone_number="555-222-3333",
            status="active",
        )

        response = self.client.post(
            self.url,
            self._payload(email="EXISTING@example.com", phone_number="555-999-0000"),
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Homeowner.objects.filter(email__iexact="existing@example.com").count(), 1)
        self.assertEqual(response.data["customer"]["id"], existing.id)

    def test_repeat_customer_account_signup_does_not_create_duplicate_user_or_customer(self):
        first = self.client.post(self.url, self._payload(), format="json", secure=True)
        second = self.client.post(self.url, self._payload(), format="json", secure=True)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(get_user_model().objects.filter(email__iexact="pat.customer@example.com").count(), 1)
        self.assertEqual(Homeowner.objects.filter(email__iexact="pat.customer@example.com").count(), 1)

    def test_verified_customer_account_can_load_portal_shell_without_project(self):
        user = get_user_model().objects.create_user(
            email="empty-customer@example.com",
            password="StrongPass123!",
            first_name="Empty",
            last_name="Customer",
            is_active=True,
            is_verified=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.get("/api/projects/customer-portal/account/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["customer"]["email"], "empty-customer@example.com")
        self.assertEqual(response.data["account"]["email"], "empty-customer@example.com")
        self.assertEqual(len(response.data["property_profiles"]), 1)
        self.assertEqual(response.data["property_profiles"][0]["display_name"], "Primary Property")
        self.assertTrue(Homeowner.objects.filter(email__iexact="empty-customer@example.com").exists())

    def test_later_public_intake_links_existing_customer_account_by_email(self):
        created = self.client.post(
            self.url,
            self._payload(email="future-intake@example.com", full_name="Future Intake"),
            format="json",
            secure=True,
        )
        self.assertEqual(created.status_code, 201)
        homeowner_id = created.data["customer"]["id"]

        result = get_or_create_customer_for_public_intake(
            name="Future Intake",
            email="future-intake@example.com",
            phone="555-111-2222",
            source="landing_page",
        )

        self.assertFalse(result.created)
        self.assertEqual(result.homeowner.id, homeowner_id)
        self.assertEqual(Homeowner.objects.filter(email__iexact="future-intake@example.com").count(), 1)
