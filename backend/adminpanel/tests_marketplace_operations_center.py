from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from adminpanel.marketplace_operations_center import build_marketplace_operations_center


def _secure_client() -> APIClient:
    client = APIClient()
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    return client


class MarketplaceOperationsCenterTests(TestCase):
    def test_operations_center_builds_attention_queue_and_advisor_guardrails(self):
        payload = build_marketplace_operations_center(
            generated_at="2026-07-09T12:00:00Z",
            summary={"open_disputes": 1},
            money={"escrow_in_flight_total": "4850.00"},
            operations={
                "marketplace": {
                    "kpis": {"verification_queue": 2, "saved_request_backlog": 5},
                    "health": {"requests_with_zero_bids": 1},
                },
                "payments": {
                    "kpis": {
                        "pending_reimbursement_releases": 2,
                        "held_reimbursements": 1,
                        "failed_releases": 1,
                    },
                    "pending_releases": [{"id": 1, "project": "Kitchen Remodel"}],
                    "held": [],
                    "failed": [{"id": 2, "project": "Roof Repair"}],
                },
                "disputes": {
                    "kpis": {"open_disputes": 1, "escalated_disputes": 1, "awaiting_review": 1},
                    "open": [{"id": 3, "project": "Kitchen Remodel", "age_days": 4}],
                    "awaiting_admin_review": [{"id": 3, "project": "Kitchen Remodel", "age_days": 4}],
                },
                "reviews": {"kpis": {"pending_reviews": 1}},
                "users": {"kpis": {"contractors_pending_verification": 2}},
                "maintenance": {"kpis": {"overdue_work_orders": 1}},
                "recommendations": [
                    {
                        "title": "Requests have zero bids",
                        "source": "marketplace_analytics",
                        "action_target": "/app/admin/marketplace/analytics",
                    }
                ],
            },
            warranty={"kpis": {"open_requests": 2, "overdue_requests": 1, "escalated_requests": 1}},
            support={"kpis": {"open_tickets": 2, "urgent_tickets": 1}},
        )

        self.assertEqual(payload["label"], "Marketplace Operations Center")
        self.assertTrue(payload["attention_queue"])
        self.assertTrue(any(item["category"] == "Financial Operations" for item in payload["attention_queue"]))
        self.assertEqual(payload["financial_operations"]["kpis"]["failed_releases"], 1)
        self.assertEqual(payload["resolution_oversight"]["kpis"]["payment_impact_cases"], 1)
        self.assertEqual(payload["warranty_oversight"]["kpis"]["escalated_requests"], 1)
        self.assertIn("Payments / Stripe", [row["label"] for row in payload["platform_health"]["categories"]])
        self.assertEqual(payload["audit_activity"]["status"], "foundation")
        self.assertEqual(payload["advisor"]["role"], "Marketplace Operations Advisor")
        self.assertIn("Route marketplace requests", payload["advisor"]["human_only_actions"])

    def test_admin_overview_requires_admin_and_returns_operations_center(self):
        User = get_user_model()
        admin = User.objects.create_user(
            email="admin-ops@example.com",
            password="test-pass",
            is_staff=True,
        )
        regular = User.objects.create_user(
            email="regular-ops@example.com",
            password="test-pass",
        )

        client = _secure_client()
        client.force_authenticate(user=regular)
        denied = client.get("/api/projects/admin/overview/")
        self.assertEqual(denied.status_code, 403)

        client.force_authenticate(user=admin)
        response = client.get("/api/projects/admin/overview/")
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertIn("operations_center", payload)
        self.assertEqual(payload["operations_center"]["label"], "Marketplace Operations Center")
        self.assertIn("financial_operations", payload["operations_center"])
        self.assertIn("resolution_oversight", payload["operations_center"])
        self.assertIn("warranty_oversight", payload["operations_center"])
        self.assertIn("platform_health", payload["operations_center"])
        self.assertIn("advisor", payload["operations_center"])
