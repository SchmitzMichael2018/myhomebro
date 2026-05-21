from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner


class AgreementListPaginationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="agreement-pagination@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Agreement Pagination Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Agreement Pagination Customer",
            email="agreement-pagination-customer@example.com",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _create_agreement(self, title, **overrides):
        payload = {
            "is_draft": True,
            "wizard_step": 1,
            "homeowner": self.homeowner.id,
            "project_title": title,
            "title": title,
            "description": f"{title} scope.",
            "payment_mode": "escrow",
            "project_class": "residential",
            "project_mode": "full_service",
        }
        payload.update(overrides)
        response = self.client.post("/api/projects/agreements/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Agreement.objects.get(pk=response.data["id"])

    def test_agreement_list_returns_page_number_pagination(self):
        for index in range(3):
            self._create_agreement(f"Paginated Agreement {index + 1}")

        response = self.client.get("/api/projects/agreements/?page=1&page_size=2")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])
        self.assertIsNone(response.data["previous"])

    def test_agreement_list_filters_search_and_project_class_with_pagination(self):
        self._create_agreement("Residential Kitchen Remodel", project_class="residential")
        self._create_agreement("Commercial Lobby Buildout", project_class="commercial")

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=10&search=lobby&project_class=commercial"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["project_title"], "Commercial Lobby Buildout")

    def test_needs_attention_signature_filter_applies_before_pagination(self):
        target = self._create_agreement("Unsigned Older Agreement")
        for index in range(5):
            agreement = self._create_agreement(f"Signed Newer Agreement {index + 1}")
            agreement.signed_by_contractor = True
            agreement.signed_by_homeowner = True
            agreement.status = "signed"
            agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner", "status", "updated_at"])

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=2&focus=needs_attention&filter=awaiting_signature"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], target.id)

    def test_schedule_filter_applies_before_pagination(self):
        target = self._create_agreement("Due Today Agreement")
        target.start = timezone.localdate()
        target.save(update_fields=["start", "updated_at"])
        for index in range(5):
            future = self._create_agreement(f"Future Agreement {index + 1}")
            future.start = timezone.localdate() + timedelta(days=20 + index)
            future.save(update_fields=["start", "updated_at"])

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=2&focus=schedule&range=today"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], target.id)
