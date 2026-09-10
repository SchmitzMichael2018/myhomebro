from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from payments.models import Payment, Refund
from payments.services.contingency_refunds import (
    AUTO_REFUND_REASON,
    auto_refund_unused_contingency,
    contingency_refund_eligibility,
)
from projects.models import Agreement, Contractor, ExpenseRequest, Homeowner, Invoice, Milestone, Project


@override_settings(STRIPE_SECRET_KEY="sk_test_123", CONTINGENCY_AUTO_REFUND_GRACE_DAYS=5)
class ContingencyAutoRefundTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(email="reserve@example.com", password="password123")
        contractor = Contractor.objects.create(user=user, business_name="Reserve Builder")
        homeowner = Homeowner.objects.create(created_by=contractor, full_name="QA Homeowner", email="qa@example.com")
        project = Project.objects.create(contractor=contractor, homeowner=homeowner, title="Reserve Closeout")
        self.agreement = Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=homeowner,
            payment_mode="escrow",
            status="completed",
            incidentals_reserve_amount=Decimal("100.00"),
            escrow_funded=True,
            escrow_funded_amount=Decimal("1100.00"),
            total_cost=Decimal("1000.00"),
        )
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1000.00"),
            status="paid",
            escrow_released=True,
            escrow_released_at=timezone.now() - timedelta(days=6),
        )
        Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Final walkthrough",
            amount=Decimal("1000.00"),
            completed=True,
            is_invoiced=True,
            invoice=invoice,
        )
        self.payment = Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_reserve",
            amount_cents=110000,
            currency="usd",
            status="succeeded",
        )

    def test_waits_for_grace_period_after_final_milestone_release(self):
        invoice = self.agreement.milestones.get().invoice
        invoice.escrow_released_at = timezone.now() - timedelta(days=4)
        invoice.save(update_fields=["escrow_released_at"])

        result = contingency_refund_eligibility(self.agreement)

        self.assertFalse(result["eligible"])
        self.assertIn("grace_period", result["blockers"])

    def test_zero_dollar_service_after_final_payment_does_not_block_return(self):
        Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Warranty service follow-up",
            amount=Decimal("0.00"),
            completed=True,
            is_invoiced=False,
            normalized_milestone_type="warranty_service",
        )

        result = contingency_refund_eligibility(self.agreement)

        self.assertTrue(result["eligible"])
        self.assertEqual(result["refundable_cents"], 10000)

    def test_pending_contingency_request_blocks_refund(self):
        ExpenseRequest.objects.create(
            agreement=self.agreement,
            description="Pending materials",
            amount=Decimal("25.00"),
            request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
            funding_source=ExpenseRequest.FundingSource.INCIDENTALS_RESERVE,
            status=ExpenseRequest.Status.SUBMITTED,
        )

        result = contingency_refund_eligibility(self.agreement)

        self.assertFalse(result["eligible"])
        self.assertIn("pending_contingency_request", result["blockers"])

    @patch("payments.services.contingency_refunds.stripe.Refund.create")
    def test_refunds_unused_reserve_once(self, create_refund):
        create_refund.return_value = SimpleNamespace(id="re_unused", status="succeeded")

        first = auto_refund_unused_contingency(self.agreement)
        second = auto_refund_unused_contingency(self.agreement)

        self.assertEqual(first["status"], "requested")
        self.assertEqual(first["refunded_cents"], 10000)
        self.assertEqual(second["status"], "skipped")
        self.assertEqual(create_refund.call_count, 1)
        row = Refund.objects.get(reason=AUTO_REFUND_REASON)
        self.assertEqual(row.amount_cents, 10000)
        self.assertEqual(row.status, "succeeded")
