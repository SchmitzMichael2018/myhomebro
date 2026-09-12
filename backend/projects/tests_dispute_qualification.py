from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from unittest.mock import patch

from projects.models import Agreement, AgreementPaymentMode, Contractor, Homeowner, Milestone, Project
from projects.models_dispute import Dispute, DisputeEscrowAllocation, DisputePaymentHold, DisputeWorkPauseRequest
from projects.services.dispute_workflow import (
    assess_dispute_qualification,
    begin_hold_expiration,
    extend_qualification_deadline,
    initialize_dispute_workflow,
    release_expired_hold,
)


@override_settings(DISPUTE_QUALIFICATION_BUSINESS_DAYS=3, DISPUTE_QUALIFICATION_GRACE_HOURS=24)
class DisputeQualificationWorkflowTests(TestCase):
    def setUp(self):
        self.contractor_user = get_user_model().objects.create_user(email="qualification-contractor@example.com", password="testpass123")
        self.homeowner_user = get_user_model().objects.create_user(email="qualification-homeowner@example.com", password="testpass123")
        self.admin_user = get_user_model().objects.create_superuser(email="qualification-admin@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.contractor_user, business_name="Qualification Contractor", city="Austin", state="TX")
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Qualification Homeowner",
            email="qualification-homeowner@example.com",
        )
        self.project = Project.objects.create(contractor=self.contractor, homeowner=self.homeowner, title="Door project")
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Door project agreement",
        )
        self.milestone_one = Milestone.objects.create(
            agreement=self.agreement, order=1, title="Door installation", amount=Decimal("400.00")
        )
        self.milestone_two = Milestone.objects.create(
            agreement=self.agreement, order=2, title="Final paint", amount=Decimal("200.00")
        )
        self.contractor_client = APIClient()
        self.contractor_client.force_authenticate(self.contractor_user)
        self.homeowner_client = APIClient()
        self.homeowner_client.force_authenticate(self.homeowner_user)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(self.admin_user)

    def _create_dispute(self, milestone=None, **overrides):
        values = {
            "agreement": self.agreement,
            "milestone": milestone or self.milestone_one,
            "source_type": Dispute.SOURCE_MILESTONE,
            "source_object_id": (milestone or self.milestone_one).id,
            "initiator": "homeowner",
            "reason": "Door does not close",
            "description": "The installed door is visibly misaligned and does not close or latch.",
            "expected_result": "The signed milestone requires a door that closes and latches.",
            "requested_resolution": "Inspect and adjust the door so it closes and latches.",
            "evidence_unavailable_reason": "A detailed written description is presently sufficient; photos can follow.",
            "contractor_notified": True,
        }
        values.update(overrides)
        return Dispute.objects.create(**values)

    def test_complete_escrow_claim_qualifies_and_holds_only_selected_milestone(self):
        dispute = initialize_dispute_workflow(self._create_dispute())
        self.assertEqual(dispute.qualification_status, Dispute.QUALIFICATION_QUALIFIED)
        self.assertEqual(dispute.workflow_stage, Dispute.STAGE_CONTRACTOR_RESPONSE)
        self.assertTrue(dispute.escrow_frozen)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_CONTINUED)
        self.assertEqual(dispute.payment_hold.amount_cents, 40000)
        self.assertEqual(dispute.payment_hold.milestone_id, self.milestone_one.id)
        self.assertFalse(
            DisputePaymentHold.objects.filter(milestone=self.milestone_two).exclude(status=DisputePaymentHold.STATUS_RELEASED).exists()
        )

    def test_incomplete_claim_receives_specific_questions_and_temporary_hold(self):
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        self.assertEqual(dispute.qualification_status, Dispute.QUALIFICATION_INFORMATION_NEEDED)
        self.assertGreaterEqual(len(dispute.missing_information), 4)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_TEMPORARY)

    def test_direct_pay_case_is_documented_without_platform_hold(self):
        self.agreement.payment_mode = AgreementPaymentMode.DIRECT
        self.agreement.save(update_fields=["payment_mode"])
        dispute = initialize_dispute_workflow(self._create_dispute())
        self.assertFalse(dispute.escrow_frozen)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_NO_HOLD)

    def test_general_project_concern_can_be_documented_without_a_payment_source(self):
        dispute = self._create_dispute()
        dispute.milestone = None
        dispute.source_type = Dispute.SOURCE_GENERAL_PROJECT_ISSUE
        dispute.source_object_id = None
        dispute.save(update_fields=["milestone", "source_type", "source_object_id"])
        dispute = initialize_dispute_workflow(dispute)
        self.assertEqual(dispute.qualification_status, Dispute.QUALIFICATION_QUALIFIED)
        self.assertFalse(dispute.escrow_frozen)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_NO_HOLD)

    def test_paid_source_is_documented_without_reopening_a_payment_hold(self):
        from projects.models import Invoice, InvoiceStatus

        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("400.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            milestone_id_snapshot=self.milestone_one.id,
        )
        dispute = self._create_dispute(
            source_type=Dispute.SOURCE_PAYMENT_REQUEST,
            source_object_id=invoice.id,
            payment_request=invoice,
        )
        dispute = initialize_dispute_workflow(dispute)
        self.assertFalse(dispute.escrow_frozen)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_NO_HOLD)
        self.assertTrue(any("outside the platform review window" in row for row in dispute.missing_information))

    def test_urgent_case_never_enters_automatic_expiration(self):
        due = timezone.now() - timedelta(hours=1)
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="There is an active leak causing immediate property damage.")
        )
        dispute.qualification_due_at = due
        dispute.save(update_fields=["qualification_due_at"])
        self.assertEqual(dispute.qualification_status, Dispute.QUALIFICATION_URGENT_REVIEW)
        self.assertFalse(begin_hold_expiration(dispute, now=timezone.now()))

    def test_expiration_is_two_step_idempotent_and_does_not_move_money(self):
        now = timezone.now()
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        dispute.qualification_due_at = now - timedelta(minutes=1)
        dispute.save(update_fields=["qualification_due_at"])
        self.assertTrue(begin_hold_expiration(dispute, now=now))
        self.assertFalse(begin_hold_expiration(dispute, now=now))
        dispute.payment_hold.refresh_from_db()
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_EXPIRATION_PENDING)
        self.assertTrue(release_expired_hold(dispute, now=now + timedelta(hours=25)))
        self.assertFalse(release_expired_hold(dispute, now=now + timedelta(hours=25)))
        dispute.refresh_from_db()
        self.assertFalse(dispute.escrow_frozen)
        self.assertEqual(dispute.qualification_status, Dispute.QUALIFICATION_NOT_QUALIFIED)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_RELEASED)

    def test_reasoned_extension_reopens_expiration_pending_hold(self):
        now = timezone.now()
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        dispute.qualification_due_at = now - timedelta(minutes=1)
        dispute.save(update_fields=["qualification_due_at"])
        self.assertTrue(begin_hold_expiration(dispute, now=now))
        prior_due = dispute.qualification_due_at
        dispute = extend_qualification_deadline(dispute, reason="Customer is hospitalized.", business_days=2, now=now)
        self.assertGreater(dispute.qualification_due_at, prior_due)
        self.assertEqual(dispute.qualification_extension_count, 1)
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_TEMPORARY)

    def test_late_information_does_not_silently_reactivate_released_hold(self):
        now = timezone.now()
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        dispute.qualification_due_at = now - timedelta(hours=26)
        dispute.save(update_fields=["qualification_due_at"])
        self.assertTrue(begin_hold_expiration(dispute, now=now - timedelta(hours=25)))
        self.assertTrue(release_expired_hold(dispute, now=now))
        dispute.expected_result = "A closing and latching door."
        dispute.requested_resolution = "Adjust it."
        dispute.contractor_notified = True
        dispute.evidence_unavailable_reason = "No photo is needed to document a door that will not latch."
        dispute.save()
        dispute = assess_dispute_qualification(dispute, now=now + timedelta(minutes=1))
        dispute.payment_hold.refresh_from_db()
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_RELEASED)
        self.assertFalse(dispute.escrow_frozen)

    def test_work_pause_is_separate_and_requires_other_party_acceptance(self):
        dispute = initialize_dispute_workflow(self._create_dispute())
        created = self.contractor_client.post(
            f"/api/projects/disputes/{dispute.id}/work-pauses/",
            {"reason_type": "safety", "explanation": "Conditions at the site are hostile.", "scope": "On-site work"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        pause_id = created.data["id"]
        same_party = self.contractor_client.post(
            f"/api/projects/disputes/{dispute.id}/work-pauses/{pause_id}/respond/",
            {"decision": "accept", "reason": "Self approval"},
            format="json",
        )
        self.assertEqual(same_party.status_code, 403)
        accepted = self.homeowner_client.post(
            f"/api/projects/disputes/{dispute.id}/work-pauses/{pause_id}/respond/",
            {"decision": "accept", "reason": "Agreed while conditions are reviewed."},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(accepted.data["status"], DisputeWorkPauseRequest.STATUS_ACCEPTED)
        dispute.refresh_from_db()
        self.assertTrue(dispute.escrow_frozen)

    def test_public_customer_link_cannot_self_approve_customer_work_pause(self):
        dispute = initialize_dispute_workflow(self._create_dispute())
        pause = DisputeWorkPauseRequest.objects.create(
            dispute=dispute,
            requested_by=self.homeowner_user,
            reason_type=DisputeWorkPauseRequest.REASON_VOLUNTARY,
            explanation="Customer requested that on-site work pause.",
            scope="On-site work",
        )

        response = self.homeowner_client.post(
            f"/api/projects/disputes/public/{dispute.id}/work-pauses/{pause.id}/respond/?token={dispute.public_token}",
            {"decision": "accept", "reason": "Self approval"},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        pause.refresh_from_db()
        self.assertEqual(pause.status, DisputeWorkPauseRequest.STATUS_REQUESTED)

    def test_allocation_must_balance_and_requires_both_parties_plus_staff_confirmation(self):
        dispute = initialize_dispute_workflow(self._create_dispute())
        invalid = self.contractor_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/",
            {"contractor_amount_cents": 20000, "homeowner_amount_cents": 10000, "explanation": "Proposed split."},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)
        created = self.contractor_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/",
            {"contractor_amount_cents": 25000, "homeowner_amount_cents": 15000, "explanation": "Mutually discussed split."},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        allocation_id = created.data["id"]
        contractor_auth = self.contractor_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation_id}/authorize/",
            {"authorization": "authorize", "attestation": True},
            format="json",
        )
        self.assertEqual(contractor_auth.status_code, 200, contractor_auth.data)
        premature = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation_id}/confirm/", {}, format="json"
        )
        self.assertEqual(premature.status_code, 400)
        homeowner_auth = self.homeowner_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation_id}/authorize/",
            {"authorization": "authorize", "attestation": True},
            format="json",
        )
        self.assertEqual(homeowner_auth.status_code, 200, homeowner_auth.data)
        confirmed = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation_id}/confirm/", {}, format="json"
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        allocation = DisputeEscrowAllocation.objects.get(pk=allocation_id)
        self.assertEqual(allocation.status, DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION)
        self.assertIsNone(allocation.executed_at)
        self.assertEqual(allocation.execution_reference, "")

    @override_settings(DISPUTE_ESCROW_ALLOCATION_EXECUTION_ENABLED=True, STRIPE_SECRET_KEY="sk_test_dispute")
    @patch("payments.fees.calculate_platform_fee_cents_for_invoice", return_value=1000)
    @patch("stripe.Transfer.create")
    @patch("stripe.Refund.create")
    def test_exact_allocation_execution_refunds_before_transfer_and_is_idempotent(
        self, refund_create, transfer_create, _fee_mock
    ):
        from payments.models import Payment
        from projects.models import Invoice, InvoiceStatus

        self.contractor.stripe_account_id = "acct_test_contractor"
        self.contractor.save(update_fields=["stripe_account_id"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("400.00"),
            status=InvoiceStatus.DISPUTED,
            disputed=True,
            milestone_id_snapshot=self.milestone_one.id,
        )
        self.milestone_one.invoice = invoice
        self.milestone_one.is_invoiced = True
        self.milestone_one.completed = True
        self.milestone_one.completed_at = timezone.now()
        self.milestone_one.save(update_fields=["invoice", "is_invoiced", "completed", "completed_at"])
        Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_dispute_allocation",
            stripe_charge_id="ch_dispute_allocation",
            amount_cents=60000,
            status="succeeded",
        )
        dispute = initialize_dispute_workflow(self._create_dispute())
        allocation = DisputeEscrowAllocation.objects.create(
            dispute=dispute,
            payment_hold=dispute.payment_hold,
            source_amount_cents=40000,
            contractor_amount_cents=25000,
            homeowner_amount_cents=15000,
            explanation="Authorized split.",
            status=DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION,
            homeowner_authorized_at=timezone.now(),
            contractor_authorized_at=timezone.now(),
            staff_confirmed_at=timezone.now(),
            staff_confirmed_by=self.admin_user,
        )
        order = []
        refund_create.side_effect = lambda **kwargs: order.append("refund") or {"id": "re_split_1"}
        transfer_create.side_effect = lambda **kwargs: order.append("transfer") or {"id": "tr_split_1"}
        executed = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation.id}/execute/", {}, format="json"
        )
        self.assertEqual(executed.status_code, 200, executed.data)
        self.assertEqual(order, ["refund", "transfer"])
        self.assertEqual(executed.data["status"], DisputeEscrowAllocation.STATUS_EXECUTED)
        invoice.refresh_from_db()
        dispute.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.SETTLED)
        self.assertEqual(invoice.payout_cents, 24000)
        self.assertEqual(dispute.status, "resolved_partial")
        repeated = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/escrow-allocations/{allocation.id}/execute/", {}, format="json"
        )
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(refund_create.call_count, 1)
        self.assertEqual(transfer_create.call_count, 1)

    def test_human_override_requires_reason_and_explicit_hold_reactivation(self):
        now = timezone.now()
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        dispute.qualification_due_at = now - timedelta(hours=26)
        dispute.save(update_fields=["qualification_due_at"])
        self.assertTrue(begin_hold_expiration(dispute, now=now - timedelta(hours=25)))
        self.assertTrue(release_expired_hold(dispute, now=now))
        missing_reason = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/qualification-override/",
            {"qualification_status": "qualified", "reason": "", "reactivate_source_hold": True},
            format="json",
        )
        self.assertEqual(missing_reason.status_code, 400)
        without_reactivation = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/qualification-override/",
            {"qualification_status": "qualified", "reason": "Late documentation is sufficient."},
            format="json",
        )
        self.assertEqual(without_reactivation.status_code, 200, without_reactivation.data)
        dispute.payment_hold.refresh_from_db()
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_RELEASED)
        reactivated = self.admin_client.post(
            f"/api/projects/disputes/{dispute.id}/qualification-override/",
            {
                "qualification_status": "qualified",
                "reason": "Both parties were notified and the source remains platform controlled.",
                "reactivate_source_hold": True,
            },
            format="json",
        )
        self.assertEqual(reactivated.status_code, 200, reactivated.data)
        dispute.payment_hold.refresh_from_db()
        self.assertEqual(dispute.payment_hold.status, DisputePaymentHold.STATUS_CONTINUED)
        self.assertTrue(reactivated.data["escrow_frozen"])

    @patch("projects.management.commands.send_dispute_reminders.notify_homeowner_qualification")
    def test_qualification_reminder_job_is_deduplicated(self, notify_mock):
        now = timezone.now()
        dispute = initialize_dispute_workflow(
            self._create_dispute(description="Door issue", expected_result="", requested_resolution="", contractor_notified=None, evidence_unavailable_reason="")
        )
        dispute.qualification_due_at = now + timedelta(hours=20)
        dispute.save(update_fields=["qualification_due_at"])
        call_command("send_dispute_reminders")
        call_command("send_dispute_reminders")
        self.assertEqual(notify_mock.call_count, 1)
        self.assertEqual(dispute.reminder_logs.filter(kind="qualification_24h").count(), 1)
