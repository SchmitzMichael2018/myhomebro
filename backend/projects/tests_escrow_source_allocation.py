from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from payments.models import Payment
from projects.models import Agreement, Contractor, Homeowner, Invoice, InvoiceStatus, Project
from projects.views.magic_invoice import (
    _reconcile_escrow_source_payment_for_invoice,
    _select_escrow_source_payment_for_invoice,
)


class EscrowSourceAllocationTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            email="escrow-allocation@example.com",
            password="testpass123",
        )
        contractor = Contractor.objects.create(user=user, business_name="Escrow Builder")
        homeowner = Homeowner.objects.create(
            created_by=contractor,
            full_name="Escrow Customer",
            email="escrow-customer@example.com",
        )
        project = Project.objects.create(
            contractor=contractor,
            homeowner=homeowner,
            title="Escrow Allocation Project",
        )
        self.agreement = Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=homeowner,
            payment_mode="escrow",
            escrow_funded=True,
            escrow_funded_amount=Decimal("6200.00"),
            total_cost=Decimal("5700.00"),
        )
        self.original_funding = Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_original",
            stripe_charge_id="ch_original",
            amount_cents=550000,
            status="succeeded",
        )
        self.amendment_funding = Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_amendment",
            stripe_charge_id=None,
            amount_cents=70000,
            status="succeeded",
        )
        for index, payout_cents in enumerate((62950, 67800, 62950, 159950, 159950), start=1):
            Invoice.objects.create(
                agreement=self.agreement,
                amount=Decimal(payout_cents) / Decimal("100"),
                payout_cents=payout_cents,
                status=InvoiceStatus.PAID,
                escrow_released=True,
                stripe_transfer_id=f"tr_released_{index}",
            )
        self.pending_invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("400.00"),
            status=InvoiceStatus.PENDING,
        )

    def test_depleted_original_charge_is_not_reused(self):
        source = _select_escrow_source_payment_for_invoice(self.pending_invoice, 38700)

        self.assertIsNone(source)

    def test_missing_amendment_charge_is_reconciled_and_selected(self):
        stripe_intent = SimpleNamespace(
            status="succeeded",
            amount_received=70000,
            amount=70000,
            currency="usd",
            latest_charge=SimpleNamespace(id="ch_amendment"),
            metadata={"agreement_id": str(self.agreement.id)},
        )
        stripe_api = SimpleNamespace(
            PaymentIntent=SimpleNamespace(retrieve=lambda *_args, **_kwargs: stripe_intent)
        )

        source = _reconcile_escrow_source_payment_for_invoice(
            self.pending_invoice,
            38700,
            stripe_api,
        )

        self.assertEqual(source.id, self.amendment_funding.id)
        self.amendment_funding.refresh_from_db()
        self.assertEqual(self.amendment_funding.stripe_charge_id, "ch_amendment")

