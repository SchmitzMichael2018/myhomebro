from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, ExpenseRequest, Homeowner, Invoice, InvoiceStatus, Project
from projects.models_dispute import Dispute
from projects.services.escrow_reimbursements import escrow_ledger
from projects.views.customer_portal import _portal_token


class EscrowReimbursementRequestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            email="contractor@example.com",
            password="password123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Escrow Builder",
            stripe_account_id="acct_test_reimburse",
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
            title="Kitchen Flooring",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode="escrow",
            signed_by_contractor=True,
            signed_by_homeowner=True,
            escrow_funded=True,
            escrow_funded_amount=Decimal("1000.00"),
            total_cost=Decimal("1000.00"),
        )
        self.client.force_authenticate(self.user)

    def _receipt(self, name="receipt.pdf"):
        return SimpleUploadedFile(name, b"proof", content_type="application/pdf")

    def _create_reimbursement(self, amount="125.00", receipt=None):
        return self.client.post(
            "/api/projects/expense-requests/",
            {
                "agreement": self.agreement.id,
                "description": "Material reimbursement",
                "amount": amount,
                "request_kind": ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
                "category": ExpenseRequest.Category.MATERIALS,
                "receipt": receipt or self._receipt(),
            },
            format="multipart",
        )

    def test_contractor_can_submit_escrow_reimbursement_with_receipt(self):
        response = self._create_reimbursement()

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["request_kind"], ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT)
        self.assertEqual(response.data["status"], ExpenseRequest.Status.SUBMITTED)
        self.assertIsNotNone(response.data["submitted_at"])
        self.assertEqual(response.data["escrow_ledger"]["available"], "1000.00")

    def test_reimbursement_requires_receipt_or_proof(self):
        response = self.client.post(
            "/api/projects/expense-requests/",
            {
                "agreement": self.agreement.id,
                "description": "Missing proof",
                "amount": "50.00",
                "request_kind": ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
                "category": ExpenseRequest.Category.MATERIALS,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Receipt or proof", response.data["detail"])

    def test_reimbursement_requires_signed_funded_escrow(self):
        self.agreement.escrow_funded = False
        self.agreement.escrow_funded_amount = Decimal("0.00")
        self.agreement.save(update_fields=["escrow_funded", "escrow_funded_amount"])

        response = self._create_reimbursement()

        self.assertEqual(response.status_code, 400)
        self.assertIn("Escrow must be funded", response.data["detail"])

    def test_reimbursement_cannot_exceed_available_escrow(self):
        Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("850.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
        )

        response = self._create_reimbursement(amount="200.00")

        self.assertEqual(response.status_code, 400)
        self.assertIn("exceeds available escrow", response.data["detail"])

    def test_reimbursement_is_blocked_when_dispute_freezes_escrow(self):
        Dispute.objects.create(
            agreement=self.agreement,
            initiator="homeowner",
            reason="Work issue",
            status="open",
            escrow_frozen=True,
        )

        response = self._create_reimbursement()

        self.assertEqual(response.status_code, 400)
        self.assertIn("Escrow is on hold", response.data["detail"])

    def test_unrelated_contractor_cannot_submit_reimbursement_against_agreement(self):
        User = get_user_model()
        other_user = User.objects.create_user(
            email="other@example.com",
            password="password123",
        )
        Contractor.objects.create(user=other_user, business_name="Other Builder")
        self.client.force_authenticate(other_user)

        response = self._create_reimbursement()

        self.assertEqual(response.status_code, 403)

    def test_customer_portal_approval_moves_reimbursement_to_pending_release_and_reserves_escrow(self):
        response = self._create_reimbursement(amount="200.00")
        self.assertEqual(response.status_code, 201, response.data)
        reimbursement_id = response.data["id"]
        token = _portal_token(self.homeowner.email)

        approve = self.client.post(
            f"/api/projects/customer-portal/{token}/reimbursements/{reimbursement_id}/approve/",
            {},
            format="json",
        )

        self.assertEqual(approve.status_code, 200, approve.data)
        expense = ExpenseRequest.objects.get(pk=reimbursement_id)
        self.assertEqual(expense.status, ExpenseRequest.Status.PENDING_RELEASE)
        self.assertEqual(expense.available_escrow_at_approval, Decimal("1000.00"))
        ledger = escrow_ledger(self.agreement)
        self.assertEqual(ledger["reimbursement_pending"], Decimal("200.00"))
        self.assertEqual(ledger["available"], Decimal("800.00"))

    def test_customer_portal_denial_records_reason(self):
        response = self._create_reimbursement(amount="75.00")
        self.assertEqual(response.status_code, 201, response.data)
        reimbursement_id = response.data["id"]
        token = _portal_token(self.homeowner.email)

        deny = self.client.post(
            f"/api/projects/customer-portal/{token}/reimbursements/{reimbursement_id}/deny/",
            {"denial_reason": "Receipt does not match materials."},
            format="json",
        )

        self.assertEqual(deny.status_code, 200, deny.data)
        expense = ExpenseRequest.objects.get(pk=reimbursement_id)
        self.assertEqual(expense.status, ExpenseRequest.Status.DENIED)
        self.assertEqual(expense.denial_reason, "Receipt does not match materials.")

    def test_release_action_is_idempotent_and_does_not_overdraw_escrow(self):
        response = self._create_reimbursement(amount="125.00")
        reimbursement_id = response.data["id"]
        token = _portal_token(self.homeowner.email)
        approve = self.client.post(
            f"/api/projects/customer-portal/{token}/reimbursements/{reimbursement_id}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)

        first_release = self.client.post(
            f"/api/projects/expense-requests/{reimbursement_id}/mark_paid/",
            {"stripe_transfer_id": "tr_reimbursement_123"},
            format="json",
        )
        second_release = self.client.post(
            f"/api/projects/expense-requests/{reimbursement_id}/mark_paid/",
            {"stripe_transfer_id": "tr_reimbursement_456"},
            format="json",
        )

        self.assertEqual(first_release.status_code, 200, first_release.data)
        self.assertEqual(second_release.status_code, 200, second_release.data)
        expense = ExpenseRequest.objects.get(pk=reimbursement_id)
        self.assertEqual(expense.status, ExpenseRequest.Status.RELEASED)
        self.assertEqual(expense.stripe_transfer_id, "tr_reimbursement_123")
        ledger = escrow_ledger(self.agreement)
        self.assertEqual(ledger["reimbursement_released"], Decimal("125.00"))
        self.assertEqual(ledger["available"], Decimal("875.00"))


class AdminEscrowReimbursementTests(EscrowReimbursementRequestTests):
    def setUp(self):
        super().setUp()
        User = get_user_model()
        self.admin = User.objects.create_user(
            email="admin@example.com",
            password="password123",
            is_staff=True,
        )

    def _approved_reimbursement(self, amount="125.00"):
        response = self._create_reimbursement(amount=amount)
        self.assertEqual(response.status_code, 201, response.data)
        reimbursement_id = response.data["id"]
        token = _portal_token(self.homeowner.email)
        approve = self.client.post(
            f"/api/projects/customer-portal/{token}/reimbursements/{reimbursement_id}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        return ExpenseRequest.objects.get(pk=reimbursement_id)

    def test_non_admin_cannot_list_or_release_admin_reimbursements(self):
        expense = self._approved_reimbursement()

        list_response = self.client.get("/api/projects/admin/reimbursements/")
        release_response = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-123"},
            format="json",
        )

        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(release_response.status_code, 403)

    def test_admin_can_list_reimbursements_and_view_ledger_detail(self):
        expense = self._approved_reimbursement(amount="200.00")
        self.client.force_authenticate(self.admin)

        list_response = self.client.get("/api/projects/admin/reimbursements/?status=pending_release")
        detail_response = self.client.get(f"/api/projects/admin/reimbursements/{expense.id}/")

        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(list_response.data["results"][0]["id"], expense.id)
        self.assertEqual(list_response.data["results"][0]["current_ledger"]["available"], "800.00")
        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        self.assertEqual(detail_response.data["ledger_breakdown"]["funded"], "1000.00")
        self.assertEqual(detail_response.data["receipt_url"].endswith(".pdf"), True)

    def test_admin_can_record_manual_release_with_transfer_reference(self):
        expense = self._approved_reimbursement(amount="125.00")
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        expense.refresh_from_db()
        self.assertEqual(expense.status, ExpenseRequest.Status.RELEASED)
        self.assertEqual(expense.stripe_transfer_id, "manual-transfer-123")
        self.assertIsNotNone(expense.released_at)

    def test_admin_record_release_rejects_already_released_reimbursement(self):
        expense = self._approved_reimbursement(amount="125.00")
        self.client.force_authenticate(self.admin)
        first = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )
        second = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-456"},
            format="json",
        )

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 400, second.data)
        self.assertIn("already been released", second.data["detail"])

    def test_admin_release_blocks_insufficient_current_escrow(self):
        expense = self._approved_reimbursement(amount="300.00")
        Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("800.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("insufficient", response.data["detail"].lower())
        expense.refresh_from_db()
        self.assertIn("insufficient", expense.release_error.lower())

    def test_admin_release_blocks_active_dispute_hold(self):
        expense = self._approved_reimbursement(amount="125.00")
        Dispute.objects.create(
            agreement=self.agreement,
            initiator="homeowner",
            reason="Work issue",
            status="open",
            escrow_frozen=True,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("dispute", response.data["detail"].lower())

    def test_admin_can_place_and_clear_hold_and_held_reimbursement_cannot_release(self):
        expense = self._approved_reimbursement(amount="125.00")
        self.client.force_authenticate(self.admin)

        hold = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/hold/",
            {"reason": "Need to review receipt."},
            format="json",
        )
        release_while_held = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )
        clear = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/clear-hold/",
            {},
            format="json",
        )
        release_after_clear = self.client.post(
            f"/api/projects/admin/reimbursements/{expense.id}/record-release/",
            {"stripe_transfer_id": "manual-transfer-123"},
            format="json",
        )

        self.assertEqual(hold.status_code, 200, hold.data)
        self.assertEqual(release_while_held.status_code, 400, release_while_held.data)
        self.assertIn("hold", release_while_held.data["detail"].lower())
        self.assertEqual(clear.status_code, 200, clear.data)
        self.assertEqual(release_after_clear.status_code, 200, release_after_clear.data)

    def test_admin_retry_clears_failed_release_error_without_creating_transfer(self):
        expense = self._approved_reimbursement(amount="125.00")
        expense.release_error = "temporary manual review failure"
        expense.save(update_fields=["release_error"])
        self.client.force_authenticate(self.admin)

        response = self.client.post(f"/api/projects/admin/reimbursements/{expense.id}/retry-release/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        expense.refresh_from_db()
        self.assertEqual(expense.release_error, "")
        self.assertEqual(expense.status, ExpenseRequest.Status.PENDING_RELEASE)
