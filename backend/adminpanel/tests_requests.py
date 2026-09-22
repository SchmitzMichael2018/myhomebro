from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_attribution import AccountAcquisition
from projects.models_project_intake import ProjectIntake, ProjectIntakeClassificationEvent


User = get_user_model()


class AdminRequestManagementTests(TestCase):
    url = "/api/projects/admin/requests/"

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(email="request-admin@example.com", password="AdminPass123!")
        self.client.force_authenticate(self.admin)
        now = timezone.now()
        self.rows = []
        for index in range(60):
            row = ProjectIntake.objects.create(
                customer_name=f"Customer {index:02d}", customer_email=f"customer{index}@example.com",
                customer_phone=f"210555{index:04d}", project_city="San Antonio" if index % 2 else "Austin",
                project_state="TX", project_postal_code=f"782{index:02d}", ai_project_title=f"Roof request {index:02d}",
                ai_project_type="Roofing" if index % 2 else "Plumbing", status="submitted" if index % 3 else "analyzed",
                post_submit_flow="multi_contractor", submitted_at=now - timedelta(hours=index),
            )
            self.rows.append(row)
        self.linked_user = User.objects.create_user(
            email=self.rows[1].customer_email, verification_state=User.VerificationState.VERIFIED,
            trust_classification=User.TrustClassification.NORMAL, email_verified_at=now, phone_verified_at=now,
        )
        AccountAcquisition.objects.create(user=self.linked_user, first_touch={"source": "google", "medium": "organic"})

    def get(self, **params):
        return self.client.get(self.url, params)

    def test_default_is_active_newest_first_and_paginated_to_25(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 25)
        self.assertEqual(response.data["pagination"]["total"], 60)
        submitted = [row["submitted_at"] for row in response.data["results"]]
        self.assertEqual(submitted, sorted(submitted, reverse=True))

    def test_page_sizes_next_previous_and_alternate_sort(self):
        for size in (25, 50, 100):
            response = self.get(page_size=size)
            self.assertEqual(response.data["pagination"]["page_size"], size)
        second = self.get(page=2, page_size=25)
        self.assertTrue(second.data["pagination"]["has_previous"])
        self.assertTrue(second.data["pagination"]["has_next"])
        ascending = self.get(sort="customer_asc", page_size=100)
        names = [row["customer"]["name"] for row in ascending.data["results"]]
        self.assertEqual(names, sorted(names))

    def test_search_and_composable_filters(self):
        result = self.get(q="Roof request 11", service="Roofing", city="San Antonio", state="TX", status="submitted")
        self.assertEqual(result.data["pagination"]["total"], 1)
        self.assertEqual(result.data["results"][0]["id"], self.rows[11].id)
        date_result = self.get(date_from=timezone.localdate().isoformat(), page_size=100)
        self.assertGreater(date_result.data["pagination"]["total"], 0)

    def test_acquisition_and_verification_filters_and_labels(self):
        response = self.get(source="google", verification="verified")
        self.assertEqual(response.data["pagination"]["total"], 1)
        self.assertEqual(response.data["results"][0]["source"]["label"], "Google Organic")
        unknown = self.get(q=str(self.rows[2].pk))
        self.assertEqual(unknown.data["results"][0]["source"]["label"], "Legacy / Unknown")

    def test_classification_filter_and_default_exclusions(self):
        self.rows[0].traffic_classification = "test"; self.rows[0].save(update_fields=["traffic_classification"])
        self.rows[1].traffic_classification = "spam_fraud"; self.rows[1].save(update_fields=["traffic_classification"])
        self.rows[2].traffic_classification = "archived"; self.rows[2].save(update_fields=["traffic_classification"])
        self.assertEqual(self.get().data["pagination"]["total"], 57)
        self.assertEqual(self.get(view="test_spam").data["pagination"]["total"], 2)
        self.assertEqual(self.get(view="archived").data["pagination"]["total"], 1)

    def test_all_bulk_classifications_archive_restore_and_audit(self):
        endpoints = {
            "mark_test": "test", "mark_suspicious": "suspicious", "mark_spam_fraud": "spam_fraud", "mark_real": "real",
        }
        row = self.rows[0]
        for action, expected in endpoints.items():
            response = self.client.post(f"{self.url}bulk-action/", {"action": action, "ids": [row.pk], "confirmed": action == "mark_spam_fraud"}, format="json")
            self.assertEqual(response.status_code, 200)
            row.refresh_from_db(); self.assertEqual(row.traffic_classification, expected)
        self.client.post(f"{self.url}bulk-action/", {"action": "mark_test", "ids": [row.pk]}, format="json")
        archived = self.client.post(f"{self.url}bulk-action/", {"action": "archive", "ids": [row.pk], "confirmed": True}, format="json")
        self.assertEqual(archived.status_code, 200)
        restored = self.client.post(f"{self.url}bulk-action/", {"action": "restore", "ids": [row.pk]}, format="json")
        self.assertEqual(restored.status_code, 200)
        row.refresh_from_db(); self.assertEqual(row.traffic_classification, "test")
        self.assertGreaterEqual(ProjectIntakeClassificationEvent.objects.filter(project_intake=row).count(), 6)

    def test_high_impact_confirmation_and_current_page_limit(self):
        response = self.client.post(f"{self.url}bulk-action/", {"action": "archive", "ids": [self.rows[0].pk]}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(f"{self.url}bulk-action/", {"action": "mark_test", "ids": list(range(1, 102))}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_request_classification_does_not_change_account_trust_or_attribution(self):
        acquisition = self.linked_user.acquisition
        response = self.client.post(f"{self.url}bulk-action/", {"action": "mark_test", "ids": [self.rows[1].pk]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.linked_user.refresh_from_db(); acquisition.refresh_from_db()
        self.assertEqual(self.linked_user.trust_classification, User.TrustClassification.NORMAL)
        self.assertEqual(acquisition.first_touch["source"], "google")

    def test_permissions_and_no_delete_endpoint(self):
        ordinary = User.objects.create_user(email="ordinary@example.com", password="Pass123!!")
        self.client.force_authenticate(ordinary)
        self.assertEqual(self.get().status_code, 403)
        self.client.force_authenticate(User.objects.create_user(email="staff@example.com", is_staff=True))
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(self.client.post(f"{self.url}bulk-action/", {"action": "mark_test", "ids": [self.rows[0].pk]}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"{self.url}{self.rows[0].pk}/").status_code, 405)

    def test_detail_and_summary_counts(self):
        detail = self.client.get(f"{self.url}{self.rows[0].pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["reference"], f"REQ-{self.rows[0].pk}")
        summary = self.get().data["summary"]
        self.assertEqual(summary["active"], 60)
        self.assertEqual(summary["ready_to_route"], 60)

    def test_paginated_query_count_is_bounded(self):
        with self.assertNumQueries(8):
            response = self.get(page_size=25)
        self.assertEqual(len(response.data["results"]), 25)
