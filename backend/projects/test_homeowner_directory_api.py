from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from projects.models import Contractor, Homeowner


@override_settings(SECURE_SSL_REDIRECT=False)
class HomeownerDirectoryApiTests(APITestCase):
    endpoint = "/api/projects/homeowners/"

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="owner@example.com",
            password="test-password",
        )
        self.contractor = Contractor.objects.create(user=self.user, business_name="Directory Builder")
        self.other_user = user_model.objects.create_user(
            email="other@example.com",
            password="test-password",
        )
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Builder")
        self.client.force_authenticate(self.user)

    def customer(self, **overrides):
        values = {
            "created_by": self.contractor,
            "full_name": "Sample Customer",
            "email": "sample@example.com",
        }
        values.update(overrides)
        return Homeowner.objects.create(**values)

    def test_directory_order_uses_company_then_name_case_insensitively_and_id_tie_break(self):
        beta_first = self.customer(full_name="same name", email="first@example.com")
        beta_second = self.customer(full_name="Same Name", email="second@example.com")
        alpha = self.customer(full_name="Zed Contact", company_name="alpha Works", email="alpha@example.com")
        zebra = self.customer(full_name="Aaron Contact", company_name="Zebra Works", email="zebra@example.com")

        response = self.client.get(self.endpoint, {"ordering": "directory_name", "page_size": 10})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [row["id"] for row in response.data["results"]],
            [alpha.id, beta_first.id, beta_second.id, zebra.id],
        )

    def test_search_covers_company_contact_and_property_fields(self):
        match = self.customer(
            full_name="Morgan Client",
            company_name="Acme Renovation",
            email="morgan@example.com",
            phone_number="512-555-0199",
            street_address="42 Juniper Way",
            city="Round Rock",
            zip_code="78664",
        )
        self.customer(full_name="Unrelated Customer", email="unrelated@example.com")

        for query in ["acme", "morgan", "555-0199", "juniper", "round rock", "78664"]:
            with self.subTest(query=query):
                response = self.client.get(
                    self.endpoint,
                    {"ordering": "directory_name", "q": query, "page_size": 8},
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual([row["id"] for row in response.data["results"]], [match.id])

    def test_pagination_metadata_cap_ownership_and_invalid_page(self):
        Homeowner.objects.bulk_create(
            [
                Homeowner(created_by=self.contractor, full_name=f"Customer {index:03d}", email=f"c{index}@example.com")
                for index in range(105)
            ]
        )
        hidden = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Private Other Customer",
            email="private-other@example.com",
        )

        response = self.client.get(
            self.endpoint,
            {"ordering": "directory_name", "page": 1, "page_size": 500},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 105)
        self.assertEqual(response.data["directory_total"], 105)
        self.assertEqual(len(response.data["results"]), 100)
        self.assertNotIn(hidden.id, [row["id"] for row in response.data["results"]])

        invalid = self.client.get(
            self.endpoint,
            {"ordering": "directory_name", "page": "not-a-page", "page_size": 8},
        )
        self.assertEqual(invalid.status_code, 404)

    def test_alphabet_filter_returns_only_requested_initial_and_available_letters(self):
        alpha = self.customer(full_name="Contact A", company_name="Acme", email="a@example.com")
        self.customer(full_name="Beta Customer", email="b@example.com")

        response = self.client.get(
            self.endpoint,
            {"ordering": "directory_name", "starts_with": "A", "page_size": 8},
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.data["results"]], [alpha.id])
        self.assertEqual(response.data["directory_letters"], ["A", "B"])
