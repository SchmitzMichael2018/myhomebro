from __future__ import annotations

from datetime import datetime, timedelta
import base64
from io import BytesIO
from zoneinfo import ZoneInfo
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from dateutil.relativedelta import relativedelta

from projects.models import Contractor
from projects.models_referrals import (
    ContractorReferral,
    FoundingContractorAward,
    ReferralEarning,
    ReferralParticipant,
)


FOUNDING_SLOT_LIMIT = 100
REFERRAL_ACTIVATION_DAYS = 180
REWARD_HOLD_DAYS = 30
PROMOTION_LAUNCH_AT = datetime(2026, 9, 16, 0, 0, tzinfo=ZoneInfo("America/Chicago"))


def contractor_is_promotion_eligible(contractor: Contractor) -> bool:
    return bool(contractor.created_at and contractor.created_at >= PROMOTION_LAUNCH_AT)


def participant_for_user(user):
    participant, _ = ReferralParticipant.objects.get_or_create(user=user)
    contractor = Contractor.objects.filter(user=user).only("created_at").first()
    if contractor and not contractor_is_promotion_eligible(contractor) and participant.is_eligible:
        participant.is_eligible = False
        participant.disqualified_at = timezone.now()
        participant.disqualification_reason = "Contractor account predates the referral promotion launch."
        participant.save(update_fields=[
            "is_eligible", "disqualified_at", "disqualification_reason", "updated_at",
        ])
    return participant


@transaction.atomic
def reserve_founding_slot(contractor: Contractor):
    if not contractor_is_promotion_eligible(contractor):
        return None
    existing = FoundingContractorAward.objects.select_for_update().filter(contractor=contractor).first()
    if existing:
        return existing
    now = timezone.now()
    FoundingContractorAward.objects.select_for_update().filter(
        status=FoundingContractorAward.STATUS_RESERVED,
        qualification_deadline__lt=now,
    ).update(status=FoundingContractorAward.STATUS_EXPIRED, updated_at=now)
    used = set(FoundingContractorAward.objects.select_for_update().exclude(
        status=FoundingContractorAward.STATUS_EXPIRED
    ).values_list("slot_number", flat=True))
    slot = next((number for number in range(1, FOUNDING_SLOT_LIMIT + 1) if number not in used), None)
    if slot is None:
        return None
    return FoundingContractorAward.objects.create(
        contractor=contractor,
        slot_number=slot,
        qualification_deadline=now + timedelta(days=90),
    )


def founding_requirements(contractor: Contractor) -> dict:
    profile_complete = all(bool(str(getattr(contractor, field, "") or "").strip()) for field in (
        "business_name", "phone", "address", "city", "state", "zip",
    ))
    verified = contractor.marketplace_verification_status == Contractor.MARKETPLACE_VERIFIED
    payout_ready = bool(contractor.stripe_account_id and contractor.details_submitted and contractor.payouts_enabled)
    return {
        "profile_complete": profile_complete,
        "verified": verified,
        "payout_ready": payout_ready,
        "complete": profile_complete and verified and payout_ready,
    }


def sync_referral_verification(referral: ContractorReferral, *, at=None) -> bool:
    """Advance registration to verified only from authoritative onboarding state."""
    if referral.verified_at or referral.status in {
        ContractorReferral.STATUS_EXPIRED,
        ContractorReferral.STATUS_DISQUALIFIED,
    }:
        return bool(referral.verified_at)
    if not founding_requirements(referral.referred_contractor)["complete"]:
        return False
    at = at or timezone.now()
    referral.verified_at = at
    referral.status = ContractorReferral.STATUS_VERIFIED
    referral.save(update_fields=["verified_at", "status", "updated_at"])
    return True


def _program_for_referrer(user, *, registered_at):
    contractor = Contractor.objects.filter(user=user).select_related("founding_award").first()
    award = getattr(contractor, "founding_award", None) if contractor else None
    if (
        award
        and award.status == FoundingContractorAward.STATUS_AWARDED
        and award.promotion_ends_at
        and registered_at < award.promotion_ends_at
    ):
        return ContractorReferral.PROGRAM_FOUNDING, 5000, 6
    return ContractorReferral.PROGRAM_STANDARD, 2500, 3


@transaction.atomic
def attribute_contractor_registration(*, contractor: Contractor, referral_code: str):
    code = str(referral_code or "").strip().upper()
    if not code:
        return None
    if not contractor_is_promotion_eligible(contractor):
        raise ValueError("This contractor account predates the referral promotion and is not eligible.")
    existing = ContractorReferral.objects.select_for_update().filter(referred_contractor=contractor).first()
    if existing:
        return existing
    participant = ReferralParticipant.objects.select_for_update().filter(code=code, is_eligible=True).select_related("user").first()
    if participant is None:
        raise ValueError("This referral link is invalid or no longer eligible.")
    if participant.user_id == contractor.user_id:
        raise ValueError("Self-referrals are not eligible.")
    registered_at = timezone.now()
    program, rate_bps, earning_months = _program_for_referrer(participant.user, registered_at=registered_at)
    return ContractorReferral.objects.create(
        referrer=participant.user,
        participant=participant,
        referred_contractor=contractor,
        attributed_code=participant.code,
        registered_at=registered_at,
        activation_deadline=registered_at + timedelta(days=REFERRAL_ACTIVATION_DAYS),
        program_code=program,
        reward_rate_bps=rate_bps,
        earning_months=earning_months,
    )


def _contractor_for_receipt(receipt):
    agreement = receipt.agreement or getattr(receipt.invoice, "agreement", None)
    if agreement is None:
        return None
    return getattr(agreement, "contractor", None) or getattr(getattr(agreement, "project", None), "contractor", None)


@transaction.atomic
def record_qualifying_receipt(receipt):
    contractor = _contractor_for_receipt(receipt)
    if contractor is None or int(receipt.platform_fee_cents or 0) <= 0:
        return None
    now = getattr(receipt, "created_at", None) or timezone.now()

    award = FoundingContractorAward.objects.select_for_update().filter(contractor=contractor).first()
    if award and award.status == FoundingContractorAward.STATUS_RESERVED:
        if now <= award.qualification_deadline and founding_requirements(contractor)["complete"]:
            award.award(at=now)
            award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])
        elif now > award.qualification_deadline:
            award.status = FoundingContractorAward.STATUS_EXPIRED
            award.save(update_fields=["status", "updated_at"])

    referral = ContractorReferral.objects.select_for_update().filter(referred_contractor=contractor).first()
    if referral is None or referral.status in {ContractorReferral.STATUS_EXPIRED, ContractorReferral.STATUS_DISQUALIFIED}:
        return None
    if referral.earning_starts_at is None:
        if now > referral.activation_deadline:
            referral.status = ContractorReferral.STATUS_EXPIRED
            referral.save(update_fields=["status", "updated_at"])
            return None
        if not sync_referral_verification(referral, at=now):
            return None
        referral.activated_at = now
        referral.earning_starts_at = now
        referral.earning_ends_at = now + relativedelta(months=referral.earning_months)
        referral.status = ContractorReferral.STATUS_EARNING
        referral.save(update_fields=[
            "verified_at", "activated_at", "earning_starts_at", "earning_ends_at", "status", "updated_at",
        ])
    if not (referral.earning_starts_at <= now < referral.earning_ends_at):
        if now >= referral.earning_ends_at and referral.status != ContractorReferral.STATUS_COMPLETED:
            referral.status = ContractorReferral.STATUS_COMPLETED
            referral.completed_at = now
            referral.save(update_fields=["status", "completed_at", "updated_at"])
        return None
    fee_cents = int(receipt.platform_fee_cents or 0)
    reward_cents = fee_cents * referral.reward_rate_bps // 10000
    earning, _ = ReferralEarning.objects.get_or_create(
        receipt=receipt,
        defaults={
            "referral": referral,
            "qualifying_platform_fee_cents": fee_cents,
            "reward_rate_bps": referral.reward_rate_bps,
            "reward_cents": reward_cents,
            "available_at": now + timedelta(days=REWARD_HOLD_DAYS),
        },
    )
    return earning


def _earning_has_financial_hold(earning: ReferralEarning) -> bool:
    """Conservatively retain rewards while refund/dispute state is unresolved."""
    receipt = earning.receipt
    invoice = receipt.invoice
    agreement = receipt.agreement or invoice.agreement
    if invoice.disputed:
        return True
    if agreement.disputes.filter(
        status__in=("initiated", "open", "under_review"),
        is_archived=False,
    ).exists():
        return True
    return agreement.payments.filter(refunds__status__in=("pending", "succeeded")).exists()


def release_eligible_earnings(*, now=None, participant=None):
    now = now or timezone.now()
    released = 0
    eligible = ReferralEarning.objects.filter(
        status=ReferralEarning.STATUS_PENDING,
        available_at__lte=now,
    ).select_related("receipt__invoice__agreement", "receipt__agreement")
    if participant is not None:
        eligible = eligible.filter(referral__participant=participant)
    for earning in eligible:
        if _earning_has_financial_hold(earning):
            continue
        earning.status = ReferralEarning.STATUS_AVAILABLE
        earning.save(update_fields=["status", "updated_at"])
        released += 1
    return released


def referral_dashboard(user, request=None):
    participant = participant_for_user(user)
    release_eligible_earnings(participant=participant)
    referrals = participant.referrals.select_related("referred_contractor", "referred_contractor__user").prefetch_related("earnings").order_by("-registered_at")
    for referral in referrals:
        sync_referral_verification(referral)
    totals = ReferralEarning.objects.filter(referral__participant=participant).values("status").annotate(cents=Sum("reward_cents"))
    totals_by_status = {row["status"]: int(row["cents"] or 0) for row in totals}
    site_url = (getattr(settings, "SITE_URL", "") or (request.build_absolute_uri("/") if request else "")).rstrip("/")
    referral_link = f"{site_url}/signup?ref={participant.code}"
    import qrcode
    qr = qrcode.make(referral_link)
    qr_buffer = BytesIO()
    qr.save(qr_buffer, format="PNG")
    contractor = Contractor.objects.filter(user=user).select_related("founding_award").first()
    award = getattr(contractor, "founding_award", None) if contractor else None
    return {
        "code": participant.code,
        "referral_link": referral_link,
        "qr_code_data_url": f"data:image/png;base64,{base64.b64encode(qr_buffer.getvalue()).decode('ascii')}",
        "eligible": participant.is_eligible,
        "founding": {
            "status": award.status,
            "slot_number": award.slot_number,
            "qualification_deadline": award.qualification_deadline,
            "awarded_at": award.awarded_at,
            "promotion_ends_at": award.promotion_ends_at,
            "requirements": founding_requirements(contractor),
        } if award else None,
        "summary": {
            "invitations": participant.invitations.count(),
            "registrations": referrals.count(),
            "verified": referrals.filter(verified_at__isnull=False).count(),
            "activated": referrals.filter(activated_at__isnull=False).count(),
            "active_earning_periods": referrals.filter(status=ContractorReferral.STATUS_EARNING).count(),
            "expired_or_disqualified": referrals.filter(
                status__in=(ContractorReferral.STATUS_EXPIRED, ContractorReferral.STATUS_DISQUALIFIED)
            ).count(),
            "pending_cents": totals_by_status.get(ReferralEarning.STATUS_PENDING, 0),
            "available_cents": totals_by_status.get(ReferralEarning.STATUS_AVAILABLE, 0),
            "paid_cents": totals_by_status.get(ReferralEarning.STATUS_PAID, 0),
            "completed_payouts": participant.payouts.filter(status="paid").count(),
        },
        "referrals": [{
            "id": row.id,
            "contractor_name": row.referred_contractor.business_name or row.referred_contractor.email,
            "status": row.status,
            "program_code": row.program_code,
            "reward_percent": row.reward_rate_bps / 100,
            "registered_at": row.registered_at,
            "activation_deadline": row.activation_deadline,
            "earning_starts_at": row.earning_starts_at,
            "earning_ends_at": row.earning_ends_at,
            "pending_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_PENDING),
            "available_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_AVAILABLE),
            "paid_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_PAID),
        } for row in referrals],
    }
