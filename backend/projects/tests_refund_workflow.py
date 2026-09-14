from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from payments.models import Payment
from projects.models import (
    Agreement,
    AgreementPaymentMode,
    Contractor,
    CustomerRefundRequest,
    CustomerRefundTransaction,
    DrawRequest,
    DrawRequestStatus,
    ExternalPaymentRecord,
    Homeowner,
    Invoice,
    InvoiceStatus,
    Project,
)
from projects.services.refund_workflow import create_refund_request, refund_source_options


class RefundWorkflowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.contractor_user = User.objects.create_user(email="refund-builder@example.com", password="password123")
        self.contractor = Contractor.objects.create(user=self.contractor_user, business_name="Refund Builder")
        self.homeowner_user = User.objects.create_user(email="refund-owner@example.com", password="password123")
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Refund Owner",
            email=self.homeowner_user.email,
            status="active",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Refund Test Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            total_cost=Decimal("1000.00"),
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.contractor_user)

    @patch("projects.services.refund_workflow.send_postmark_email", return_value=(True, "sent"))
    def test_homeowner_request_is_routed_to_contractor(self, _email):
        Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_escrow_source",
            stripe_charge_id="ch_escrow_source",
            amount_cents=100_000,
            status="succeeded",
        )
        self.assertEqual(refund_source_options(self.agreement)[0]["maximum_refundable_amount"], "1000.00")

        request = create_refund_request(
            agreement=self.agreement,
            actor=self.homeowner_user,
            initiated_by_role=CustomerRefundRequest.InitiatorRole.HOMEOWNER,
            source_type=CustomerRefundRequest.SourceType.ESCROW,
            reason="Unused work was removed.",
            requested_amount=Decimal("125.00"),
        )

        self.assertEqual(request.status, CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED)
        self.assertEqual(request.events.get().event_type, "requested")
        self.assertEqual(refund_source_options(self.agreement), [])

    @patch("projects.services.refund_workflow.notify_homeowner_refund_update", return_value={})
    @patch("projects.services.refund_workflow.stripe.Refund.create")
    def test_contractor_direct_pay_refund_reverses_transfer_and_fee(self, stripe_refund, _notify):
        stripe_refund.return_value = {"id": "re_direct_1"}
        self.agreement.payment_mode = AgreementPaymentMode.DIRECT
        self.agreement.save(update_fields=["payment_mode", "updated_at"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("400.00"),
            status=InvoiceStatus.PAID,
            direct_pay_payment_intent_id="pi_direct_1",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/refund-requests/",
            {
                "source_type": "invoice",
                "invoice_id": invoice.id,
                "requested_amount": "100.00",
                "reason": "Customer credit.",
                "execute_now": True,
                "confirm": "REFUND",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        request = CustomerRefundRequest.objects.get(invoice=invoice)
        self.assertEqual(request.status, CustomerRefundRequest.Status.REFUNDED)
        stripe_refund.assert_called_once()
        kwargs = stripe_refund.call_args.kwargs
        self.assertEqual(kwargs["payment_intent"], "pi_direct_1")
        self.assertEqual(kwargs["amount"], 10_000)
        self.assertTrue(kwargs["reverse_transfer"])
        self.assertTrue(kwargs["refund_application_fee"])

    @patch("projects.services.refund_workflow.notify_homeowner_refund_update", return_value={})
    @patch("projects.services.refund_workflow.stripe.Refund.create")
    def test_contractor_can_refund_a_paid_direct_draw(self, stripe_refund, _notify):
        stripe_refund.return_value = {"id": "re_draw_1"}
        self.agreement.payment_mode = AgreementPaymentMode.DIRECT
        self.agreement.save(update_fields=["payment_mode", "updated_at"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            title="Cabinet progress draw",
            status=DrawRequestStatus.PAID,
            gross_amount=Decimal("250.00"),
            net_amount=Decimal("250.00"),
            current_requested_amount=Decimal("250.00"),
            stripe_payment_intent_id="pi_draw_direct_1",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/refund-requests/",
            {"source_type": "draw", "draw_request_id": draw.id, "requested_amount": "25.00", "reason": "Draw credit", "execute_now": True, "confirm": "REFUND"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        kwargs = stripe_refund.call_args.kwargs
        self.assertEqual(kwargs["payment_intent"], "pi_draw_direct_1")
        self.assertEqual(kwargs["amount"], 2_500)
        self.assertTrue(kwargs["reverse_transfer"])

    @patch("projects.services.refund_workflow.notify_homeowner_refund_update", return_value={})
    def test_external_refund_is_audited_without_stripe(self, _notify):
        external = ExternalPaymentRecord.objects.create(
            agreement=self.agreement,
            payer_name="Refund Owner",
            payee_name="Refund Builder",
            gross_amount=Decimal("75.00"),
            net_amount=Decimal("75.00"),
            payment_method="check",
            payment_date="2026-09-13",
            reference_number="CHECK-100",
            status="verified",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/refund-requests/",
            {
                "source_type": "external",
                "external_payment_id": external.id,
                "requested_amount": "75.00",
                "reason": "Check returned to homeowner.",
                "execute_now": True,
                "confirm": "REFUND",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        external.refresh_from_db()
        self.assertEqual(external.status, "refunded")
        transaction = CustomerRefundTransaction.objects.get()
        self.assertEqual(transaction.action, CustomerRefundTransaction.Action.EXTERNAL_RECORD)
        self.assertEqual(transaction.status, CustomerRefundTransaction.Status.SUCCEEDED)

    @patch("projects.services.refund_workflow.notify_homeowner_refund_update", return_value={})
    @patch("projects.services.refund_workflow.stripe.Refund.create")
    def test_prior_partial_refund_reduces_future_invoice_availability(self, stripe_refund, _notify):
        stripe_refund.return_value = {"id": "re_partial_1"}
        self.agreement.payment_mode = AgreementPaymentMode.DIRECT
        self.agreement.save(update_fields=["payment_mode", "updated_at"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("100.00"),
            status=InvoiceStatus.PAID,
            direct_pay_payment_intent_id="pi_partial_1",
        )
        first = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/refund-requests/",
            {"source_type": "invoice", "invoice_id": invoice.id, "requested_amount": "60.00", "reason": "First credit", "execute_now": True, "confirm": "REFUND"},
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.data)

        second = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/refund-requests/",
            {"source_type": "invoice", "invoice_id": invoice.id, "requested_amount": "50.00", "reason": "Too much", "execute_now": True, "confirm": "REFUND"},
            format="json",
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("available $40.00", second.data["detail"])
