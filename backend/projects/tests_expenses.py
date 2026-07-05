from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, ExpenseRequest, Homeowner, Project
from projects.services.escrow_reimbursements import incidentals_reserve_summary


@override_settings(SECURE_SSL_REDIRECT=False)
class IncidentalsReserveExpenseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(email="incidentals@example.com", password="password123")
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Incidentals Builder",
            stripe_account_id="acct_incidentals",
            payouts_enabled=True,
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Pat Customer",
            email="pat@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Kitchen Incidentals",
        )
        self.escrow_agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode="escrow",
            signed_by_contractor=True,
            signed_by_homeowner=True,
            escrow_funded=True,
            escrow_funded_amount=Decimal("1000.00"),
            total_cost=Decimal("1000.00"),
            incidentals_reserve_amount=Decimal("100.00"),
        )
        self.direct_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Direct Pay Deck",
        )
        self.direct_agreement = Agreement.objects.create(
            project=self.direct_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode="direct",
            signed_by_contractor=True,
            signed_by_homeowner=True,
            total_cost=Decimal("500.00"),
        )
        self.client.force_authenticate(self.user)

    def _receipt(self, name="receipt.pdf"):
        return SimpleUploadedFile(name, b"proof", content_type="application/pdf")

    def _create_incidentals(self, amount="25.00", agreement=None):
        return self.client.post(
            "/api/projects/expense-requests/",
            {
                "agreement": (agreement or self.escrow_agreement).id,
                "description": "Home Depot",
                "amount": amount,
                "request_kind": ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
                "funding_source": ExpenseRequest.FundingSource.INCIDENTALS_RESERVE,
                "category": ExpenseRequest.Category.MATERIALS,
                "receipt": self._receipt(),
            },
            format="multipart",
        )

    def test_reserve_can_be_configured_and_remaining_is_computed(self):
        summary = incidentals_reserve_summary(self.escrow_agreement)

        self.assertEqual(summary["original"], Decimal("100.00"))
        self.assertEqual(summary["pending"], Decimal("0.00"))
        self.assertEqual(summary["spent"], Decimal("0.00"))
        self.assertEqual(summary["remaining"], Decimal("100.00"))

    def test_pending_incidentals_do_not_reduce_spent_or_remaining(self):
        response = self._create_incidentals(amount="25.00")

        self.assertEqual(response.status_code, 201, response.data)
        summary = incidentals_reserve_summary(self.escrow_agreement)
        self.assertEqual(summary["pending"], Decimal("25.00"))
        self.assertEqual(summary["spent"], Decimal("0.00"))
        self.assertEqual(summary["remaining"], Decimal("100.00"))
        self.assertEqual(response.data["incidentals_reserve"]["pending"], "0.00")
        self.assertEqual(response.data["reserve_impact"]["pending_delta"], "25.00")

    def test_approved_incidentals_reduce_remaining_reserve(self):
        response = self._create_incidentals(amount="40.00")
        self.assertEqual(response.status_code, 201, response.data)

        approve = self.client.post(f"/api/projects/expense-requests/{response.data['id']}/homeowner_accept/", {})

        self.assertEqual(approve.status_code, 200, approve.data)
        summary = incidentals_reserve_summary(self.escrow_agreement)
        self.assertEqual(summary["pending"], Decimal("0.00"))
        self.assertEqual(summary["spent"], Decimal("40.00"))
        self.assertEqual(summary["remaining"], Decimal("60.00"))

    def test_rejected_incidentals_do_not_reduce_remaining_reserve(self):
        response = self._create_incidentals(amount="40.00")
        self.assertEqual(response.status_code, 201, response.data)

        reject = self.client.post(f"/api/projects/expense-requests/{response.data['id']}/homeowner_reject/", {})

        self.assertEqual(reject.status_code, 200, reject.data)
        summary = incidentals_reserve_summary(self.escrow_agreement)
        self.assertEqual(summary["pending"], Decimal("0.00"))
        self.assertEqual(summary["spent"], Decimal("0.00"))
        self.assertEqual(summary["remaining"], Decimal("100.00"))

    def test_incidentals_cannot_exceed_remaining_reserve(self):
        response = self._create_incidentals(amount="125.00")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Incidentals Reserve", str(response.data))

    def test_incidentals_require_configured_reserve(self):
        self.escrow_agreement.incidentals_reserve_amount = Decimal("0.00")
        self.escrow_agreement.save(update_fields=["incidentals_reserve_amount"])

        response = self._create_incidentals(amount="25.00")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Incidentals Reserve", str(response.data))

    def test_incidentals_cannot_be_used_on_direct_pay_agreement(self):
        response = self._create_incidentals(amount="25.00", agreement=self.direct_agreement)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Incidentals Reserve", str(response.data))

    def test_reimbursement_flow_still_allows_direct_pay_expense(self):
        response = self.client.post(
            "/api/projects/expense-requests/",
            {
                "agreement": self.direct_agreement.id,
                "description": "Permit fee",
                "amount": "30.00",
                "request_kind": ExpenseRequest.RequestKind.DIRECT_EXPENSE,
                "funding_source": ExpenseRequest.FundingSource.REIMBURSEMENT,
                "category": ExpenseRequest.Category.PERMIT,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["funding_source"], ExpenseRequest.FundingSource.REIMBURSEMENT)
        self.assertEqual(response.data["request_kind"], ExpenseRequest.RequestKind.DIRECT_EXPENSE)

    def test_zero_and_negative_amounts_are_rejected(self):
        zero = self._create_incidentals(amount="0.00")
        negative = self._create_incidentals(amount="-1.00")

        self.assertEqual(zero.status_code, 400)
        self.assertEqual(negative.status_code, 400)
