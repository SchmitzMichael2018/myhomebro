from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from payments.models import Payment, Refund
from projects.models import Agreement, Contractor, Invoice, Project
from projects.models_referrals import ContractorReferral, FoundingContractorAward, ReferralEarning, ReferralPayout
from projects.services.referral_payouts import execute_contractor_referral_payout
from projects.services.referrals import (
    PROMOTION_LAUNCH_AT,
    attribute_contractor_registration,
    participant_for_user,
    record_qualifying_receipt,
    release_eligible_earnings,
    reserve_founding_slot,
)
from projects.views.customer_portal import _portal_token
from receipts.models import Receipt


User = get_user_model()


class ReferralProgramTests(TestCase):
    def make_contractor(self, email, *, qualified=False):
        user = User.objects.create_user(email=email, password="test-pass")
        values = {}
        if qualified:
            values = {
                "business_name": "Qualified Builders",
                "phone": "5551234567",
                "address": "1 Main St",
                "city": "Austin",
                "state": "TX",
                "zip": "78701",
                "marketplace_verification_status": Contractor.MARKETPLACE_VERIFIED,
                "stripe_account_id": "acct_test",
                "details_submitted": True,
                "payouts_enabled": True,
            }
        contractor = Contractor.objects.create(user=user, **values)
        reserve_founding_slot(contractor)
        return contractor

    def make_receipt(self, contractor, *, fee_cents=1000, created_at=None):
        project = Project.objects.create(contractor=contractor, title="Referral project")
        agreement = Agreement.objects.create(project=project, contractor=contractor)
        invoice = Invoice.objects.create(agreement=agreement, amount="100.00")
        return Receipt.objects.create(
            invoice=invoice,
            agreement=agreement,
            receipt_number=f"R-{invoice.pk}",
            stripe_payment_intent_id=f"pi_{invoice.pk}",
            amount_paid_cents=10000,
            platform_fee_cents=fee_cents,
            created_at=created_at or timezone.now(),
        )

    def test_first_valid_attribution_is_immutable_and_self_referral_is_rejected(self):
        referrer = self.make_contractor("referrer@example.com")
        other = self.make_contractor("other@example.com")
        referred = self.make_contractor("referred@example.com")
        first = participant_for_user(referrer.user)
        second = participant_for_user(other.user)

        attribution = attribute_contractor_registration(contractor=referred, referral_code=first.code)
        repeated = attribute_contractor_registration(contractor=referred, referral_code=second.code)

        self.assertEqual(repeated.pk, attribution.pk)
        self.assertEqual(repeated.referrer_id, referrer.user_id)
        with self.assertRaisesRegex(ValueError, "Self-referrals"):
            attribute_contractor_registration(contractor=other, referral_code=second.code)

    def test_standard_reward_starts_at_first_qualified_paid_project(self):
        referrer = self.make_contractor("customer@example.com")
        referred = self.make_contractor("builder@example.com", qualified=True)
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(referrer.user).code,
        )
        receipt = self.make_receipt(referred, fee_cents=1200)
        earning = record_qualifying_receipt(receipt)

        attribution.refresh_from_db()
        self.assertEqual(attribution.program_code, ContractorReferral.PROGRAM_STANDARD)
        self.assertEqual(attribution.status, ContractorReferral.STATUS_EARNING)
        self.assertIsNotNone(attribution.verified_at)
        self.assertEqual(attribution.reward_rate_bps, 2500)
        self.assertEqual(attribution.earning_months, 3)
        self.assertEqual(earning.qualifying_platform_fee_cents, 1200)
        self.assertEqual(earning.reward_cents, 300)
        self.assertEqual(record_qualifying_receipt(receipt).pk, earning.pk)

    def test_customer_portal_provides_personal_contractor_referral_qr(self):
        customer = User.objects.create_user(email="homeowner-referrer@example.com", password="test-pass")
        token = _portal_token(customer.email)

        response = self.client.get(f"/api/projects/customer-portal/{token}/referrals/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("/signup?ref=", payload["referral_link"])
        self.assertTrue(payload["qr_code_data_url"].startswith("data:image/png;base64,"))
        self.assertEqual(payload["reward_terms"]["percent"], 25)
        self.assertEqual(payload["reward_terms"]["earning_months"], 3)
        self.assertEqual(payload["customer_payout"]["status"], "planning")

        referred = self.make_contractor("customer-referred-builder@example.com", qualified=True)
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=payload["code"],
        )
        self.assertEqual(attribution.referrer_id, customer.id)
        self.assertEqual(attribution.reward_rate_bps, 2500)
        self.assertEqual(attribution.earning_months, 3)

    def test_customer_portal_records_referral_qr_share(self):
        customer = User.objects.create_user(email="homeowner-share@example.com", password="test-pass")
        token = _portal_token(customer.email)

        response = self.client.post(
            f"/api/projects/customer-portal/{token}/referrals/",
            {"channel": "qr"},
        )

        self.assertEqual(response.status_code, 201)
        participant = participant_for_user(customer)
        self.assertEqual(participant.invitations.filter(channel="qr").count(), 1)

    def test_unverified_referral_does_not_activate_or_earn(self):
        referrer = self.make_contractor("advocate@example.com")
        referred = self.make_contractor("unverified@example.com")
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(referrer.user).code,
        )
        receipt = self.make_receipt(referred)

        self.assertIsNone(record_qualifying_receipt(receipt))
        attribution.refresh_from_db()
        self.assertEqual(attribution.status, ContractorReferral.STATUS_REGISTERED)
        self.assertIsNone(attribution.activated_at)

    def test_founding_award_and_locked_six_month_referral_terms(self):
        founder = self.make_contractor("founder@example.com", qualified=True)
        founder_award = founder.founding_award
        founding_receipt = self.make_receipt(founder)
        record_qualifying_receipt(founding_receipt)
        founder_award.refresh_from_db()
        self.assertEqual(founder_award.status, FoundingContractorAward.STATUS_AWARDED)

        referred = self.make_contractor("founder-referral@example.com", qualified=True)
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(founder.user).code,
        )
        self.assertEqual(attribution.program_code, ContractorReferral.PROGRAM_FOUNDING)
        self.assertEqual(attribution.reward_rate_bps, 5000)
        self.assertEqual(attribution.earning_months, 6)

        receipt = self.make_receipt(referred, fee_cents=1500)
        earning = record_qualifying_receipt(receipt)
        self.assertEqual(earning.reward_cents, 750)

    def test_activation_expires_after_180_days(self):
        referrer = self.make_contractor("late-referrer@example.com")
        referred = self.make_contractor("late-builder@example.com", qualified=True)
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(referrer.user).code,
        )
        attribution.activation_deadline = timezone.now() - timedelta(days=1)
        attribution.save(update_fields=["activation_deadline"])

        self.assertIsNone(record_qualifying_receipt(self.make_receipt(referred)))
        attribution.refresh_from_db()
        self.assertEqual(attribution.status, ContractorReferral.STATUS_EXPIRED)

    def test_expired_founding_reservation_releases_its_slot(self):
        first = self.make_contractor("first-slot@example.com")
        award = first.founding_award
        award.qualification_deadline = timezone.now() - timedelta(seconds=1)
        award.save(update_fields=["qualification_deadline"])

        replacement = self.make_contractor("replacement-slot@example.com")
        award.refresh_from_db()
        self.assertEqual(award.status, FoundingContractorAward.STATUS_EXPIRED)
        self.assertEqual(replacement.founding_award.slot_number, award.slot_number)

    def test_prelaunch_contractor_is_excluded_from_promotion(self):
        contractor = self.make_contractor("prelaunch@example.com")
        contractor.founding_award.delete()
        Contractor.objects.filter(pk=contractor.pk).update(
            created_at=PROMOTION_LAUNCH_AT - timedelta(minutes=1)
        )
        contractor.refresh_from_db()

        self.assertIsNone(reserve_founding_slot(contractor))
        participant = participant_for_user(contractor.user)
        self.assertFalse(participant.is_eligible)

    def test_pending_reward_releases_after_hold_only_without_refund_or_dispute(self):
        referrer = self.make_contractor("release-referrer@example.com")
        referred = self.make_contractor("release-builder@example.com", qualified=True)
        attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(referrer.user).code,
        )
        receipt = self.make_receipt(referred)
        earning = record_qualifying_receipt(receipt)
        earning.available_at = timezone.now() - timedelta(seconds=1)
        earning.save(update_fields=["available_at"])

        payment = Payment.objects.create(
            agreement=receipt.agreement,
            amount_cents=receipt.amount_paid_cents,
            status="succeeded",
        )
        refund = Refund.objects.create(payment=payment, amount_cents=100, status="pending")
        self.assertEqual(release_eligible_earnings(), 0)
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_PENDING)

        refund.status = "failed"
        refund.save(update_fields=["status"])
        self.assertEqual(release_eligible_earnings(), 1)
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_AVAILABLE)

    def test_contractor_referral_payout_executes_once_through_stripe_connect(self):
        referrer = self.make_contractor("paid-referrer@example.com", qualified=True)
        referred = self.make_contractor("paid-builder@example.com", qualified=True)
        participant = participant_for_user(referrer.user)
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred, fee_cents=2000))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])
        payout = ReferralPayout.objects.create(participant=participant)
        payout.earnings.add(earning)

        with patch(
            "projects.services.referral_payouts.stripe.Transfer.create",
            return_value={"id": "tr_referral_123"},
        ) as transfer_create:
            result = execute_contractor_referral_payout(payout.id, approved_by=referrer.user)

        self.assertEqual(result.status, ReferralPayout.STATUS_PAID)
        self.assertEqual(result.amount_cents, 500)
        self.assertEqual(result.stripe_transfer_id, "tr_referral_123")
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_PAID)
        transfer_create.assert_called_once_with(
            amount=500,
            currency="usd",
            destination="acct_test",
            metadata={
                "kind": "contractor_referral_reward",
                "referral_payout_id": str(payout.id),
                "participant_id": str(participant.id),
                "contractor_id": str(referrer.id),
            },
            idempotency_key=f"referral-payout:{payout.id}",
        )
        with self.assertRaisesRegex(ValueError, "already been paid"):
            execute_contractor_referral_payout(payout.id)

    def test_failed_stripe_transfer_does_not_consume_available_earnings(self):
        referrer = self.make_contractor("failed-referrer@example.com", qualified=True)
        referred = self.make_contractor("failed-builder@example.com", qualified=True)
        participant = participant_for_user(referrer.user)
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])
        payout = ReferralPayout.objects.create(participant=participant)
        payout.earnings.add(earning)

        with patch(
            "projects.services.referral_payouts.stripe.Transfer.create",
            side_effect=RuntimeError("Stripe unavailable"),
        ):
            result = execute_contractor_referral_payout(payout.id)

        self.assertEqual(result.status, ReferralPayout.STATUS_FAILED)
        self.assertIn("Stripe unavailable", result.failure_reason)
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_AVAILABLE)
