from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_customer_portal import PropertyProfile
from projects.models_project_intake import ProjectIntake
from projects.services.recommendations import (
    build_customer_recommendations,
    build_recommendations_for_user,
)
from projects.views.customer_portal import _portal_token


User = get_user_model()


class UnifiedRecommendationServiceTests(TestCase):
    def test_contractor_recommendation_schema_is_typed_and_advisory(self):
        user = User.objects.create_user(email="pro@example.com", password="pass")
        Contractor.objects.create(user=user, business_name="Pro Home Services")

        rows = build_recommendations_for_user(user)

        self.assertTrue(rows)
        row = rows[0]
        for key in [
            "id",
            "key",
            "type",
            "category",
            "title",
            "summary",
            "explanation",
            "source",
            "confidence",
            "severity",
            "audience",
            "action_label",
            "action_target",
            "generated_at",
            "metadata",
        ]:
            self.assertIn(key, row)
        self.assertEqual(row["audience"], "contractor")
        self.assertIn(row["confidence"], {"low", "medium", "high"})
        self.assertIn(row["severity"], {"info", "low", "medium", "high"})

    def test_customer_recommendations_are_scoped_to_customer_property(self):
        own = PropertyProfile.objects.create(
            customer_email="customer@example.com",
            display_name="Main Home",
            address_line1="123 Main St",
            city="Dallas",
            state="TX",
            postal_code="75001",
            year_built=1980,
            is_primary=True,
        )
        other = PropertyProfile.objects.create(
            customer_email="other@example.com",
            display_name="Other Home",
            address_line1="999 Other St",
            city="Austin",
            state="TX",
            postal_code="73301",
            is_primary=True,
        )

        rows = build_customer_recommendations("customer@example.com")

        self.assertTrue(rows)
        object_ids = {row.get("object_id") for row in rows if row.get("object_type") == "property_profile"}
        self.assertIn(own.id, object_ids)
        self.assertNotIn(other.id, object_ids)
        self.assertTrue(all(row.get("audience") == "customer" for row in rows))

    def test_customer_portal_payload_includes_customer_safe_recommendations(self):
        PropertyProfile.objects.create(
            customer_email="portal@example.com",
            display_name="Portal Home",
            address_line1="120 Portal Way",
            year_built=1975,
            is_primary=True,
        )
        token = _portal_token("portal@example.com")

        response = APIClient().get(f"/api/projects/customer-portal/{token}/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("recommendations", response.data)
        self.assertTrue(response.data["recommendations"])
        self.assertTrue(all(row["audience"] == "customer" for row in response.data["recommendations"]))

    def test_contractor_endpoint_returns_only_authenticated_user_recommendations(self):
        user = User.objects.create_user(email="pro2@example.com", password="pass")
        Contractor.objects.create(user=user, business_name="Pro 2")
        client = APIClient()
        client.force_authenticate(user=user)

        response = client.get("/api/projects/recommendations/me/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["recommendations"])
        self.assertTrue(all(row["audience"] == "contractor" for row in response.data["recommendations"]))

    def test_admin_recommendations_staff_only(self):
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            customer_email="homeowner@example.com",
            project_city="Dallas",
            project_state="TX",
            accomplishment_text="Repair exterior trim",
        )
        normal = User.objects.create_user(email="normal@example.com", password="pass")
        staff = User.objects.create_user(email="staff@example.com", password="pass", is_staff=True)
        client = APIClient()
        client.force_authenticate(user=normal)

        denied = client.get("/api/projects/admin/recommendations/")
        self.assertEqual(denied.status_code, 403)

        client.force_authenticate(user=staff)
        response = client.get("/api/projects/admin/recommendations/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["recommendations"])
        self.assertTrue(all(row["audience"] == "admin" for row in response.data["recommendations"]))
