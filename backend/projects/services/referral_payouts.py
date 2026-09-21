from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from payments.stripe_config import stripe
from projects.models_referrals import ReferralEarning, ReferralParticipant, ReferralPayout, ReferralProjectCredit


def _payout_destination(payout):
    user = payout.participant.user
    contractor = getattr(user, "contractor_profile", None)
    if payout.payout_method == ReferralPayout.METHOD_CONTRACTOR_STRIPE:
        if contractor is None:
            raise ValueError("Contractor Stripe payouts require a contractor account.")
        if not user.is_active:
            raise ValueError("The contractor account is inactive.")
        if not contractor.stripe_account_id or not contractor.details_submitted or not contractor.payouts_enabled:
            raise ValueError("The contractor Stripe account is not ready to receive payouts.")
        return contractor.stripe_account_id, {"contractor_id": str(contractor.id)}
    if payout.payout_method == ReferralPayout.METHOD_PARTICIPANT_STRIPE:
        participant = payout.participant
        if not participant.payout_stripe_account_id or not participant.payout_details_submitted or not participant.payout_enabled:
            raise ValueError("This participant must complete supported Stripe payout onboarding before cashing out.")
        return participant.payout_stripe_account_id, {"participant_role": participant.primary_role}
    raise ValueError("This payout method is not configured for Stripe Connect.")


def execute_contractor_referral_payout(payout_id: int, *, approved_by=None) -> ReferralPayout:
    """Execute one reviewed, payout-ready referral payout through Stripe Connect."""
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
        if payout.payout_method not in {
            ReferralPayout.METHOD_CONTRACTOR_STRIPE,
            ReferralPayout.METHOD_PARTICIPANT_STRIPE,
        }:
            raise ValueError("This payout is not configured for Stripe Connect.")

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
        stripe_account_id, destination_metadata = _payout_destination(payout)

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
                    "kind": (
                        "contractor_referral_reward"
                        if payout.payout_method == ReferralPayout.METHOD_CONTRACTOR_STRIPE
                        else "participant_referral_reward"
                    ),
                    "referral_payout_id": str(payout.id),
                    "participant_id": str(payout.participant_id),
                    **destination_metadata,
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


@transaction.atomic
def request_cash_out(*, participant: ReferralParticipant, requested_by) -> ReferralPayout:
    if participant.user_id != requested_by.id:
        raise ValueError("Referral rewards may only be redeemed by their owner.")
    earnings = list(
        ReferralEarning.objects.select_for_update()
        .filter(referral__participant=participant, status=ReferralEarning.STATUS_AVAILABLE)
        .exclude(payouts__status__in=(
            ReferralPayout.STATUS_PENDING,
            ReferralPayout.STATUS_NEEDS_ONBOARDING,
            ReferralPayout.STATUS_PROCESSING,
            ReferralPayout.STATUS_PAID,
        ))
        .order_by("available_at", "id")
    )
    if not earnings:
        raise ValueError("No available referral rewards can be cashed out.")
    contractor = getattr(participant.user, "contractor_profile", None)
    contractor_ready = bool(contractor and contractor.details_submitted and contractor.payouts_enabled and contractor.stripe_account_id)
    participant_ready = bool(
        participant.payout_details_submitted
        and participant.payout_enabled
        and participant.payout_stripe_account_id
    )
    payout = ReferralPayout.objects.create(
        participant=participant,
        payout_method=(
            ReferralPayout.METHOD_CONTRACTOR_STRIPE
            if contractor_ready
            else ReferralPayout.METHOD_PARTICIPANT_STRIPE
        ),
        status=(
            ReferralPayout.STATUS_PENDING
            if contractor_ready or participant_ready
            else ReferralPayout.STATUS_NEEDS_ONBOARDING
        ),
        amount_cents=sum(item.reward_cents for item in earnings),
    )
    payout.earnings.add(*earnings)
    return payout


@transaction.atomic
def reserve_project_credit(*, participant, requested_by, project, invoice=None, amount_cents=None):
    if participant.user_id != requested_by.id:
        raise ValueError("Referral rewards may only be redeemed by their owner.")
    homeowner = getattr(project, "homeowner", None)
    if homeowner is None or str(homeowner.email or "").lower() != str(requested_by.email or "").lower():
        raise ValueError("Choose one of your own qualifying MyHomeBro projects.")
    if invoice is None or invoice.agreement.project_id != project.id:
        raise ValueError("Choose a qualifying project invoice before applying referral rewards.")
    earnings = list(
        ReferralEarning.objects.select_for_update()
        .filter(referral__participant=participant, status=ReferralEarning.STATUS_AVAILABLE)
        .exclude(payouts__status__in=(
            ReferralPayout.STATUS_PENDING,
            ReferralPayout.STATUS_NEEDS_ONBOARDING,
            ReferralPayout.STATUS_PROCESSING,
            ReferralPayout.STATUS_PAID,
        ))
        .exclude(project_credits__status__in=(
            ReferralProjectCredit.STATUS_PENDING_INTEGRATION,
            ReferralProjectCredit.STATUS_APPLIED,
        ))
        .order_by("available_at", "id")
    )
    available = sum(item.reward_cents for item in earnings)
    payment_cap = int(Decimal(str(getattr(invoice, "amount", 0) or 0)) * 100)
    requested = int(amount_cents or min(available, payment_cap))
    if requested <= 0 or requested > available or requested > payment_cap:
        raise ValueError("Project credit must be positive and cannot exceed available rewards or the qualifying payment.")
    selected = []
    selected_total = 0
    for earning in earnings:
        if selected_total + earning.reward_cents > requested:
            # Earnings are immutable whole ledger entries; partial splitting requires payment integration.
            continue
        selected.append(earning)
        selected_total += earning.reward_cents
        if selected_total == requested:
            break
    if selected_total != requested:
        raise ValueError("Choose an amount that can be represented by complete available reward entries.")
    credit = ReferralProjectCredit.objects.create(
        participant=participant,
        project=project,
        agreement=invoice.agreement,
        invoice=invoice,
        amount_cents=requested,
        requested_by=requested_by,
        status=ReferralProjectCredit.STATUS_PENDING_INTEGRATION,
        failure_reason="Payment-funding integration must be verified before this credit can be applied.",
    )
    credit.earnings.add(*selected)
    ReferralEarning.objects.filter(pk__in=[item.pk for item in selected]).update(
        status=ReferralEarning.STATUS_RESERVED,
        updated_at=timezone.now(),
    )
    return credit
