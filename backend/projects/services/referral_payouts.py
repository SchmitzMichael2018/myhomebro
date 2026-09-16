from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from payments.stripe_config import stripe
from projects.models_referrals import ReferralEarning, ReferralPayout


def execute_contractor_referral_payout(payout_id: int, *, approved_by=None) -> ReferralPayout:
    """Execute one reviewed referral payout through Stripe Connect."""
    with transaction.atomic():
        payout = (
            ReferralPayout.objects.select_for_update()
            .select_related("participant__user")
            .prefetch_related("earnings")
            .get(pk=payout_id)
        )
        if payout.status == ReferralPayout.STATUS_PAID or payout.paid_at or payout.stripe_transfer_id:
            raise ValueError("This referral payout has already been paid.")
        if payout.status not in {ReferralPayout.STATUS_PENDING, ReferralPayout.STATUS_FAILED}:
            raise ValueError("Only pending or failed referral payouts can be executed.")
        if payout.payout_method != ReferralPayout.METHOD_CONTRACTOR_STRIPE:
            raise ValueError("This payout is not configured for contractor Stripe Connect.")

        earnings = list(payout.earnings.select_for_update().all())
        if not earnings:
            raise ValueError("Select at least one available referral earning.")
        if any(item.referral.participant_id != payout.participant_id for item in earnings):
            raise ValueError("All earnings must belong to the payout participant.")
        if any(item.status != ReferralEarning.STATUS_AVAILABLE for item in earnings):
            raise ValueError("Only available referral earnings can be paid.")
        if ReferralPayout.objects.filter(
            earnings__in=earnings,
            status__in=(ReferralPayout.STATUS_PROCESSING, ReferralPayout.STATUS_PAID),
        ).exclude(pk=payout.pk).exists():
            raise ValueError("One or more earnings are already assigned to another active payout.")

        amount_cents = sum(int(item.reward_cents) for item in earnings)
        if amount_cents <= 0:
            raise ValueError("Referral payout amount must be greater than zero.")
        user = payout.participant.user
        contractor = getattr(user, "contractor_profile", None)
        if contractor is None:
            raise ValueError("Contractor Stripe payouts require a contractor account.")
        if not user.is_active:
            raise ValueError("The contractor account is inactive.")
        stripe_account_id = str(contractor.stripe_account_id or "").strip()
        if not stripe_account_id or not contractor.details_submitted or not contractor.payouts_enabled:
            raise ValueError("The contractor Stripe account is not ready to receive payouts.")

        payout.amount_cents = amount_cents
        payout.status = ReferralPayout.STATUS_PROCESSING
        payout.approved_by = approved_by
        payout.approved_at = timezone.now()
        payout.failure_reason = ""
        payout.save(update_fields=[
            "amount_cents", "status", "approved_by", "approved_at", "failure_reason", "updated_at",
        ])
        try:
            transfer = stripe.Transfer.create(
                amount=amount_cents,
                currency="usd",
                destination=stripe_account_id,
                metadata={
                    "kind": "contractor_referral_reward",
                    "referral_payout_id": str(payout.id),
                    "participant_id": str(payout.participant_id),
                    "contractor_id": str(contractor.id),
                },
                idempotency_key=f"referral-payout:{payout.id}",
            )
        except Exception as exc:
            payout.status = ReferralPayout.STATUS_FAILED
            payout.failure_reason = str(exc)
            payout.save(update_fields=["status", "failure_reason", "updated_at"])
            return payout

        transfer_id = str(transfer.get("id") or "")
        if not transfer_id:
            raise ValueError("Stripe did not return a transfer ID.")
        paid_at = timezone.now()
        payout.status = ReferralPayout.STATUS_PAID
        payout.stripe_transfer_id = transfer_id
        payout.external_reference = transfer_id
        payout.paid_at = paid_at
        payout.failure_reason = ""
        payout.save(update_fields=[
            "status", "stripe_transfer_id", "external_reference", "paid_at", "failure_reason", "updated_at",
        ])
        ReferralEarning.objects.filter(pk__in=[item.pk for item in earnings]).update(
            status=ReferralEarning.STATUS_PAID,
            paid_at=paid_at,
            updated_at=paid_at,
        )
        return payout
