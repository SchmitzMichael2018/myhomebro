from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from payments.models import Payment, Refund
from projects.models import Agreement, Contractor, Homeowner, Invoice, Project
from projects.models_referrals import ContractorReferral, FoundingContractorAward, ReferralEarning, ReferralPayout, ReferralProjectCredit, ReferralVisit
from projects.services.referral_payouts import execute_contractor_referral_payout, request_cash_out, reserve_project_credit
from projects.services.referrals import (
    PROMOTION_LAUNCH_AT,
    attribute_customer_registration,
    attribute_contractor_registration,
    participant_for_user,
    record_qualifying_receipt,
    release_eligible_earnings,
    reverse_receipt_earnings,
    reserve_founding_slot,
    reserve_founding_slot_for_user,
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

    def make_customer(self, email, *, property_manager=False, verified=True):
        user = User.objects.create_user(email=email, password="test-pass", is_active=True, is_verified=verified)
        homeowner = Homeowner.objects.create(
            full_name="Property Manager" if property_manager else "Homeowner",
            email=email,
            account_type=(
                Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY
                if property_manager
                else Homeowner.ACCOUNT_TYPE_INDIVIDUAL
            ),
        )
        reserve_founding_slot_for_user(
            user,
            role="property_manager" if property_manager else "homeowner",
        )
        return user, homeowner

    def make_receipt(self, contractor, *, homeowner=None, fee_cents=1000, created_at=None):
        project = Project.objects.create(contractor=contractor, homeowner=homeowner, title="Referral project")
        agreement = Agreement.objects.create(project=project, contractor=contractor, homeowner=homeowner)
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
        self.assertIn("/refer/", payload["referral_link"])
        self.assertTrue(payload["qr_code_data_url"].startswith("data:image/png;base64,"))
        self.assertEqual(payload["reward_terms"]["percent"], 25)
        self.assertEqual(payload["reward_terms"]["earning_months"], 3)
        self.assertEqual(payload["customer_payout"]["status"], "not_started")

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

    def test_one_stable_referral_identity_for_every_supported_role(self):
        contractor = self.make_contractor("identity-contractor@example.com")
        homeowner_user, _ = self.make_customer("identity-homeowner@example.com")
        manager_user, _ = self.make_customer("identity-manager@example.com", property_manager=True)

        rows = [
            participant_for_user(contractor.user),
            participant_for_user(homeowner_user, role="homeowner"),
            participant_for_user(manager_user, role="property_manager"),
        ]
        self.assertEqual(len({row.code for row in rows}), 3)
        for row in rows:
            self.assertEqual(participant_for_user(row.user).code, row.code)

    def test_public_referral_route_records_first_touch_and_preserves_stable_code(self):
        referrer, _ = self.make_customer("short-link-referrer@example.com")
        participant = participant_for_user(referrer, role="homeowner")

        response = self.client.get(f"/refer/{participant.code}?medium=qr")

        self.assertRedirects(
            response,
            f"/register?ref={participant.code}",
            fetch_redirect_response=False,
        )
        visit = ReferralVisit.objects.get(participant=participant)
        self.assertEqual(visit.medium, "qr")
        self.assertEqual(self.client.session["referral_code"], participant.code)

    def test_public_referral_route_rejects_invalid_and_disabled_codes(self):
        self.assertEqual(self.client.get("/refer/DOESNOTEXIST").status_code, 404)
        referrer, _ = self.make_customer("disabled-short-link@example.com")
        participant = participant_for_user(referrer, role="homeowner")
        participant.is_eligible = False
        participant.save(update_fields=["is_eligible", "updated_at"])
        self.assertEqual(self.client.get(f"/refer/{participant.code}").status_code, 404)

    def test_homeowner_and_property_manager_signup_attribution_is_role_neutral(self):
        contractor_referrer = self.make_contractor("role-contractor-referrer@example.com")
        homeowner_referrer, _ = self.make_customer("role-homeowner-referrer@example.com")
        manager_referrer, _ = self.make_customer("role-manager-referrer@example.com", property_manager=True)
        referrers = [contractor_referrer.user, homeowner_referrer, manager_referrer]

        for index, referrer in enumerate(referrers):
            referred_user, referred_homeowner = self.make_customer(
                f"role-referred-{index}@example.com",
                property_manager=index == 2,
            )
            attribution = attribute_customer_registration(
                user=referred_user,
                homeowner=referred_homeowner,
                referral_code=participant_for_user(referrer).code,
            )
            self.assertEqual(attribution.referred_user_id, referred_user.id)
            self.assertIn(attribution.referrer_role, {"contractor", "homeowner", "property_manager"})
            self.assertEqual(
                attribution.referred_role,
                "property_manager" if index == 2 else "homeowner",
            )

    def test_every_referrer_and_referred_role_combination_is_supported(self):
        referrers = {
            "contractor": self.make_contractor("matrix-referrer-contractor@example.com").user,
            "homeowner": self.make_customer("matrix-referrer-homeowner@example.com")[0],
            "property_manager": self.make_customer(
                "matrix-referrer-manager@example.com", property_manager=True
            )[0],
        }
        for referrer_role, referrer in referrers.items():
            for referred_role in ("contractor", "homeowner", "property_manager"):
                suffix = f"{referrer_role}-{referred_role}"
                if referred_role == "contractor":
                    referred = self.make_contractor(f"matrix-{suffix}@example.com")
                    attribution = attribute_contractor_registration(
                        contractor=referred,
                        referral_code=participant_for_user(referrer).code,
                    )
                else:
                    referred_user, homeowner = self.make_customer(
                        f"matrix-{suffix}@example.com",
                        property_manager=referred_role == "property_manager",
                    )
                    attribution = attribute_customer_registration(
                        user=referred_user,
                        homeowner=homeowner,
                        referral_code=participant_for_user(referrer).code,
                    )
                self.assertEqual(attribution.referrer_role, referrer_role)
                self.assertEqual(attribution.referred_role, referred_role)

    def test_founding_pools_are_independent(self):
        contractor = self.make_contractor("pool-contractor@example.com")
        homeowner_user, _ = self.make_customer("pool-homeowner@example.com")
        manager_user, _ = self.make_customer("pool-manager@example.com", property_manager=True)

        contractor_award = contractor.founding_award
        homeowner_award = homeowner_user.referral_participant.founding_awards.get(pool="consumer")
        manager_award = manager_user.referral_participant.founding_awards.get(pool="consumer")
        self.assertEqual(contractor_award.slot_number, 1)
        self.assertEqual(homeowner_award.slot_number, 1)
        self.assertEqual(manager_award.slot_number, 2)

    def test_each_founding_pool_stops_after_slot_one_hundred(self):
        contractor_users = [
            User(email=f"pool-limit-contractor-{index}@example.com") for index in range(101)
        ]
        User.objects.bulk_create(contractor_users)
        contractors = [Contractor(user=user) for user in contractor_users]
        Contractor.objects.bulk_create(contractors)
        contractor_awards = [
            reserve_founding_slot_for_user(user, role="contractor", contractor=contractor)
            for user, contractor in zip(contractor_users, contractors)
        ]
        self.assertEqual([row.slot_number for row in contractor_awards[:100]], list(range(1, 101)))
        self.assertIsNone(contractor_awards[100])

        consumer_users = [
            User(email=f"pool-limit-consumer-{index}@example.com") for index in range(101)
        ]
        User.objects.bulk_create(consumer_users)
        consumer_awards = [
            reserve_founding_slot_for_user(
                user,
                role="homeowner" if index % 2 == 0 else "property_manager",
            )
            for index, user in enumerate(consumer_users)
        ]
        self.assertEqual([row.slot_number for row in consumer_awards[:100]], list(range(1, 101)))
        self.assertIsNone(consumer_awards[100])

    def test_expired_founding_privilege_only_changes_new_referrals(self):
        founder = self.make_contractor("expired-founder@example.com", qualified=True)
        award = founder.founding_award
        award.award(at=timezone.now() - timedelta(days=370))
        award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])

        new_referred = self.make_contractor("post-privilege@example.com", qualified=True)
        new_attribution = attribute_contractor_registration(
            contractor=new_referred,
            referral_code=participant_for_user(founder.user).code,
        )
        self.assertEqual(new_attribution.program_code, ContractorReferral.PROGRAM_STANDARD)
        self.assertEqual(new_attribution.reward_rate_bps, 2500)
        self.assertEqual(new_attribution.earning_months, 3)

        award.promotion_ends_at = timezone.now() + timedelta(days=1)
        award.save(update_fields=["promotion_ends_at", "updated_at"])
        earlier_referred = self.make_contractor("pre-expiry-snapshot@example.com", qualified=True)
        earlier = attribute_contractor_registration(
            contractor=earlier_referred,
            referral_code=participant_for_user(founder.user).code,
        )
        self.assertEqual(earlier.program_code, ContractorReferral.PROGRAM_FOUNDING)
        award.promotion_ends_at = timezone.now() - timedelta(seconds=1)
        award.save(update_fields=["promotion_ends_at", "updated_at"])
        earlier.refresh_from_db()
        self.assertEqual(earlier.reward_rate_bps, 5000)
        self.assertEqual(earlier.earning_months, 6)

    def test_each_referred_account_has_an_independent_earning_clock(self):
        referrer = self.make_contractor("clock-referrer@example.com")
        first = self.make_contractor("clock-first@example.com", qualified=True)
        second = self.make_contractor("clock-second@example.com", qualified=True)
        first_referral = attribute_contractor_registration(
            contractor=first,
            referral_code=participant_for_user(referrer.user).code,
        )
        second_referral = attribute_contractor_registration(
            contractor=second,
            referral_code=participant_for_user(referrer.user).code,
        )
        first_at = timezone.now() - timedelta(days=20)
        second_at = timezone.now() - timedelta(days=5)
        record_qualifying_receipt(self.make_receipt(first, created_at=first_at))
        record_qualifying_receipt(self.make_receipt(second, created_at=second_at))
        first_referral.refresh_from_db()
        second_referral.refresh_from_db()
        self.assertEqual(first_referral.earning_starts_at, first_at)
        self.assertEqual(second_referral.earning_starts_at, second_at)
        self.assertNotEqual(first_referral.earning_ends_at, second_referral.earning_ends_at)

    def test_rewards_follow_referred_accounts_across_multiple_projects_and_properties(self):
        referrer = self.make_contractor("multi-project-referrer@example.com")
        referred_contractor = self.make_contractor("multi-project-contractor@example.com", qualified=True)
        attribute_contractor_registration(
            contractor=referred_contractor,
            referral_code=participant_for_user(referrer.user).code,
        )
        contractor_earnings = [
            record_qualifying_receipt(self.make_receipt(referred_contractor, fee_cents=1000))
            for _index in range(2)
        ]
        self.assertEqual(sum(row.reward_cents for row in contractor_earnings), 500)

        manager_user, first_property = self.make_customer(
            "multi-property-manager@example.com", property_manager=True
        )
        manager_referrer = self.make_contractor("multi-property-referrer@example.com")
        attribute_customer_registration(
            user=manager_user,
            homeowner=first_property,
            referral_code=participant_for_user(manager_referrer.user).code,
        )
        second_property = Homeowner.objects.create(
            full_name="Second managed property",
            email=manager_user.email,
            account_type=Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY,
        )
        service_contractor = self.make_contractor("multi-property-service@example.com", qualified=True)
        manager_earnings = [
            record_qualifying_receipt(
                self.make_receipt(service_contractor, homeowner=property_row, fee_cents=1000)
            )
            for property_row in (first_property, second_property)
        ]
        self.assertEqual(sum(row.reward_cents for row in manager_earnings), 500)

    def test_both_referred_sides_share_single_fifty_percent_fee_pool(self):
        contractor_referrer = self.make_contractor("two-sided-contractor-referrer@example.com", qualified=True)
        contractor_award = contractor_referrer.founding_award
        contractor_award.award()
        contractor_award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])

        homeowner_referrer, _ = self.make_customer("two-sided-homeowner-referrer@example.com")
        homeowner_award = homeowner_referrer.referral_participant.founding_awards.get(pool="consumer")
        homeowner_award.award()
        homeowner_award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])

        referred_contractor = self.make_contractor("two-sided-contractor@example.com", qualified=True)
        referred_user, referred_homeowner = self.make_customer("two-sided-homeowner@example.com")
        attribute_contractor_registration(
            contractor=referred_contractor,
            referral_code=participant_for_user(contractor_referrer.user).code,
        )
        attribute_customer_registration(
            user=referred_user,
            homeowner=referred_homeowner,
            referral_code=participant_for_user(homeowner_referrer).code,
        )

        receipt = self.make_receipt(referred_contractor, homeowner=referred_homeowner, fee_cents=40000)
        earnings = record_qualifying_receipt(receipt)
        self.assertIsInstance(earnings, list)
        self.assertEqual(len(earnings), 2)
        self.assertEqual(sum(row.reward_cents for row in earnings), 20000)
        self.assertEqual({row.reward_cents for row in earnings}, {10000})
        self.assertEqual(ReferralEarning.objects.filter(receipt=receipt).count(), 2)
        self.assertEqual(len(record_qualifying_receipt(receipt)), 2)

    def test_one_sided_founding_reward_and_mixed_rates_never_exceed_half_the_fee(self):
        founder = self.make_contractor("one-sided-founder@example.com", qualified=True)
        award = founder.founding_award
        award.award()
        award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])
        referred = self.make_contractor("one-sided-referred@example.com", qualified=True)
        attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(founder.user).code,
        )
        earning = record_qualifying_receipt(self.make_receipt(referred, fee_cents=40000))
        self.assertEqual(earning.reward_cents, 20000)
        self.assertEqual(earning.maximum_reward_pool_cents, 20000)

        standard_referrer, _ = self.make_customer("mixed-standard-referrer@example.com")
        referred_user, homeowner = self.make_customer("mixed-referred-homeowner@example.com")
        attribute_customer_registration(
            user=referred_user,
            homeowner=homeowner,
            referral_code=participant_for_user(standard_referrer).code,
        )
        mixed = record_qualifying_receipt(
            self.make_receipt(referred, homeowner=homeowner, fee_cents=40000)
        )
        self.assertEqual(sum(row.reward_cents for row in mixed), 20000)
        self.assertEqual(sorted(row.reward_cents for row in mixed), [6666, 13334])

    def test_earning_period_end_and_financial_reversal_stop_rewards(self):
        referrer = self.make_contractor("ending-referrer@example.com")
        referred = self.make_contractor("ending-referred@example.com", qualified=True)
        attribution = attribute_contractor_registration(
            contractor=referred,
            referral_code=participant_for_user(referrer.user).code,
        )
        first = record_qualifying_receipt(self.make_receipt(referred, fee_cents=1000))
        attribution.refresh_from_db()
        attribution.earning_ends_at = timezone.now() - timedelta(seconds=1)
        attribution.save(update_fields=["earning_ends_at", "updated_at"])
        self.assertIsNone(record_qualifying_receipt(self.make_receipt(referred, fee_cents=1000)))
        attribution.refresh_from_db()
        self.assertEqual(attribution.status, ContractorReferral.STATUS_COMPLETED)

        first.status = ReferralEarning.STATUS_AVAILABLE
        first.save(update_fields=["status"])
        self.assertEqual(reverse_receipt_earnings(first.receipt, reason="Refunded"), 1)
        first.refresh_from_db()
        self.assertEqual(first.status, ReferralEarning.STATUS_REVERSED)
        self.assertEqual(reverse_receipt_earnings(first.receipt, reason="Refunded again"), 0)

    def test_non_contractor_cash_out_waits_for_supported_payout_onboarding(self):
        referrer, _ = self.make_customer("cashout-homeowner@example.com")
        referred = self.make_contractor("cashout-builder@example.com", qualified=True)
        participant = participant_for_user(referrer, role="homeowner")
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])

        payout = request_cash_out(participant=participant, requested_by=referrer)

        self.assertEqual(payout.status, ReferralPayout.STATUS_NEEDS_ONBOARDING)
        self.assertEqual(payout.payout_method, ReferralPayout.METHOD_PARTICIPANT_STRIPE)
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_AVAILABLE)

    def test_property_manager_cash_out_also_waits_for_supported_payout_onboarding(self):
        manager, _ = self.make_customer("cashout-manager@example.com", property_manager=True)
        referred = self.make_contractor("cashout-manager-builder@example.com", qualified=True)
        participant = participant_for_user(manager, role="property_manager")
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])
        payout = request_cash_out(participant=participant, requested_by=manager)
        self.assertEqual(payout.status, ReferralPayout.STATUS_NEEDS_ONBOARDING)
        self.assertEqual(payout.amount_cents, earning.reward_cents)

    def test_project_credit_reservation_prevents_double_spend(self):
        referrer, homeowner = self.make_customer("credit-homeowner@example.com")
        referred = self.make_contractor("credit-builder@example.com", qualified=True)
        participant = participant_for_user(referrer, role="homeowner")
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred, fee_cents=2000))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])
        project = Project.objects.create(contractor=referred, homeowner=homeowner, title="Credit target")
        agreement = Agreement.objects.create(project=project, contractor=referred, homeowner=homeowner)
        invoice = Invoice.objects.create(agreement=agreement, amount="5.00")

        credit = reserve_project_credit(
            participant=participant,
            requested_by=referrer,
            project=project,
            invoice=invoice,
            amount_cents=earning.reward_cents,
        )

        self.assertEqual(credit.status, ReferralProjectCredit.STATUS_PENDING_INTEGRATION)
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_RESERVED)
        with self.assertRaisesRegex(ValueError, "No available|positive"):
            reserve_project_credit(
                participant=participant,
                requested_by=referrer,
                project=project,
                invoice=invoice,
                amount_cents=earning.reward_cents,
            )

    def test_customer_portal_can_reserve_credit_without_cross_redeeming_as_cash(self):
        referrer, homeowner = self.make_customer("portal-credit-homeowner@example.com")
        referred = self.make_contractor("portal-credit-builder@example.com", qualified=True)
        participant = participant_for_user(referrer, role="homeowner")
        attribute_contractor_registration(contractor=referred, referral_code=participant.code)
        earning = record_qualifying_receipt(self.make_receipt(referred, fee_cents=2000))
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status"])
        project = Project.objects.create(contractor=referred, homeowner=homeowner, title="Portal credit")
        agreement = Agreement.objects.create(project=project, contractor=referred, homeowner=homeowner)
        invoice = Invoice.objects.create(agreement=agreement, amount="5.00")
        token = _portal_token(referrer.email)

        response = self.client.post(
            f"/api/projects/customer-portal/{token}/referrals/",
            {
                "action": "project_credit",
                "project_id": project.id,
                "invoice_id": invoice.id,
                "amount_cents": earning.reward_cents,
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["integration_required"])
        earning.refresh_from_db()
        self.assertEqual(earning.status, ReferralEarning.STATUS_RESERVED)
        cash_response = self.client.post(
            f"/api/projects/customer-portal/{token}/referrals/",
            {"action": "cash_out"},
        )
        self.assertEqual(cash_response.status_code, 400)
