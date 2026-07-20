from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementWarranty,
    Contractor,
    Homeowner,
    Invoice,
    InvoiceStatus,
    Milestone,
    Project,
)
from projects.models_dispute import Dispute
from projects.models_proposals import Proposal
from projects.models_warranty import WarrantyRequest


def _use_secure_requests(client):
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    for method_name in ("get", "post", "put", "patch", "delete"):
        original = getattr(client, method_name)

        def secure_method(*args, _original=original, **kwargs):
            kwargs.setdefault("secure", True)
            return _original(*args, **kwargs)

        setattr(client, method_name, secure_method)


class InsightsCommandCenterApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(email="owner@example.com", password="test-pass-123")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Insights Co")
        self.customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Jordan Customer",
            email="jordan@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.customer,
            title="Kitchen Refresh",
            project_street_address="1200 QA Lane",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78704",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.customer,
            project_type="Remodel",
            description="Kitchen refresh project.",
            total_cost="5000.00",
            signed_by_contractor=True,
            signed_by_homeowner=False,
            start=timezone.localdate(),
            end=timezone.localdate() + timedelta(days=7),
        )
        Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Overdue demo",
            amount="1200.00",
            completion_date=timezone.localdate() - timedelta(days=1),
            completed=False,
        )
        Invoice.objects.create(
            agreement=self.agreement,
            amount="1200.00",
            status=InvoiceStatus.PENDING,
            escrow_released=False,
            platform_fee_cents=60_00,
            payout_cents=1140_00,
        )
        paid_invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount="2200.00",
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=timezone.now(),
            platform_fee_cents=110_00,
            payout_cents=2090_00,
        )
        paid_invoice.save()
        warranty = AgreementWarranty.objects.create(
            agreement=self.agreement,
            contractor=self.contractor,
            title="12-month workmanship warranty",
            start_date=timezone.localdate(),
            end_date=timezone.localdate() + timedelta(days=365),
        )
        WarrantyRequest.objects.create(
            warranty=warranty,
            agreement=self.agreement,
            contractor=self.contractor,
            homeowner=self.customer,
            title="Cabinet hinge concern",
            description="Cabinet hinge is loose.",
            status=WarrantyRequest.STATUS_SUBMITTED,
        )
        Dispute.objects.create(
            agreement=self.agreement,
            project=self.project,
            initiator="homeowner",
            reason="Customer requested review",
            description="Open resolution case.",
            status="open",
        )
        Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=999,
            status=Proposal.STATUS_IN_PROGRESS,
            project_title="Backsplash estimate",
            customer_name="Jordan Customer",
            service_location="1200 QA Lane",
        )
        self.client = APIClient()
        _use_secure_requests(self.client)

    def test_summary_includes_command_center_payload(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/projects/business/contractor/summary/")

        self.assertEqual(response.status_code, 200)
        command_center = response.data["command_center"]
        self.assertIn(command_center["business_health"]["overall"], {"Needs Attention", "At Risk"})
        self.assertEqual(
            command_center["metrics"]["pending_release"]["label"],
            "Money Waiting On Customer Approval",
        )
        self.assertEqual(
            command_center["metrics"]["outstanding_receivables"]["label"],
            "Money Customers Still Owe",
        )
        attention_titles = {item["title"] for item in command_center["needs_attention"]}
        self.assertIn("Overdue milestones", attention_titles)
        self.assertIn("Warranty requests", attention_titles)
        self.assertIn("Resolution cases", attention_titles)
        self.assertIn("morning_brief", command_center)
        self.assertEqual(command_center["operations_analyst"]["role"], "Operations Analyst")
        self.assertEqual(command_center["opportunity_forecast"]["source_note"], "Deterministic workflow state from opportunities, estimates, agreements, and collected payments.")

    def test_contractor_can_manage_insights_goals(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            "/api/projects/business/contractor/insights-goals/",
            {
                "metric_type": "monthly_revenue",
                "name": "Monthly Revenue",
                "target_value": "50000",
                "deadline": "2026-07-31",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["metric_type"], "monthly_revenue")
        self.assertEqual(response.data["target_value"], "50000.00")

        goal_id = response.data["id"]
        response = self.client.patch(
            f"/api/projects/business/contractor/insights-goals/{goal_id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_active"])

        response = self.client.get("/api/projects/business/contractor/insights-goals/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)

    def test_insights_preferences_are_user_scoped_and_persist_layout(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.get("/api/projects/business/contractor/insights-preferences/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("business_snapshot", response.data["visible_widget_ids"])

        response = self.client.patch(
            "/api/projects/business/contractor/insights-preferences/",
            {
                "visible_widget_ids": ["goal_progress", "business_snapshot"],
                "default_reporting_period": "90",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["visible_widget_ids"], ["goal_progress", "business_snapshot"])
        self.assertEqual(response.data["default_reporting_period"], "90")

        response = self.client.get("/api/projects/business/contractor/insights-preferences/")
        self.assertEqual(response.data["visible_widget_ids"], ["goal_progress", "business_snapshot"])
