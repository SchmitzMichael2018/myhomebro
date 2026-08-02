from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor, Skill
from projects.services.contractor_skills import normalize_custom_services


class ContractorCustomServiceTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="custom-owner", password="pass12345")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Custom Co")
        self.roofing = Skill.objects.create(name="Roofing", slug="roofing")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_normalizes_and_persists_custom_services_separately(self):
        response = self.client.patch(
            "/api/projects/contractors/me/",
            {"custom_services": ["  Epoxy   Flooring "]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.custom_services, ["Epoxy Flooring"])
        self.assertFalse(Skill.objects.filter(name__iexact="Epoxy Flooring").exists())
        self.assertEqual(self.client.get("/api/projects/contractors/me/").json()["custom_services"], ["Epoxy Flooring"])

    def test_rejects_canonical_duplicate_and_unsafe_values(self):
        self.contractor.skills.add(self.roofing)
        for value, message in [
            ([" roofing "], "This service already exists."),
            (["<script>alert(1)</script>"], "Enter a service, not contact information."),
            (["call 512-555-0199"], "Enter a service, not contact information."),
        ]:
            response = self.client.patch("/api/projects/contractors/me/", {"custom_services": value}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertIn(message, response.json()["custom_services"])

    def test_normalizer_rejects_case_insensitive_duplicate_and_length(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            normalize_custom_services(["Epoxy Flooring", "epoxy flooring"])
        with self.assertRaisesRegex(ValueError, "2–80"):
            normalize_custom_services(["x" * 81])

    def test_another_contractor_cannot_modify_owner_through_me_endpoint(self):
        self.contractor.custom_services = ["Epoxy Flooring"]
        self.contractor.save(update_fields=["custom_services"])
        other = get_user_model().objects.create_user(username="other-owner", password="pass12345")
        other_contractor = Contractor.objects.create(user=other, business_name="Other Co")
        self.client.force_authenticate(other)
        response = self.client.patch("/api/projects/contractors/me/", {"custom_services": ["Cabinet Refinishing"]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.contractor.refresh_from_db()
        other_contractor.refresh_from_db()
        self.assertEqual(self.contractor.custom_services, ["Epoxy Flooring"])
        self.assertEqual(other_contractor.custom_services, ["Cabinet Refinishing"])
