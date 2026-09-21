from __future__ import annotations

import base64
from datetime import datetime, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from projects.models import Contractor, Homeowner, Invoice
from projects.models_referrals import (
    ContractorReferral,
    FoundingContractorAward,
    ReferralEarning,
    ReferralParticipant,
    ReferralPayout,
)


FOUNDING_SLOT_LIMIT = 100
REFERRAL_ACTIVATION_DAYS = 180
REWARD_HOLD_DAYS = 30
MAXIMUM_REWARD_POOL_BPS = 5000
FOUNDING_RATE_BPS = 5000
FOUNDING_EARNING_MONTHS = 6
STANDARD_RATE_BPS = 2500
STANDARD_EARNING_MONTHS = 3
PROMOTION_LAUNCH_AT = datetime(2026, 9, 16, 0, 0, tzinfo=ZoneInfo("America/Chicago"))


def contractor_is_promotion_eligible(contractor: Contractor) -> bool:
    return bool(contractor.created_at and contractor.created_at >= PROMOTION_LAUNCH_AT)


def homeowner_for_user(user):
    email = str(getattr(user, "email", "") or "").strip()
    if not email:
        return None
    return Homeowner.objects.filter(email__iexact=email).order_by("-updated_at", "-id").first()


def role_for_user(user, *, homeowner=None, preferred_role=""):
    valid_roles = {value for value, _label in ReferralParticipant.ROLE_CHOICES}
    if preferred_role in valid_roles:
        return preferred_role
    homeowner = homeowner or homeowner_for_user(user)
    if homeowner and homeowner.account_type == Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY:
        return ReferralParticipant.ROLE_PROPERTY_MANAGER
    if Contractor.objects.filter(user=user, is_active=True).exists():
        return ReferralParticipant.ROLE_CONTRACTOR
    return ReferralParticipant.ROLE_HOMEOWNER


def participant_for_user(user, *, role=""):
    participant, _ = ReferralParticipant.objects.get_or_create(user=user)
    resolved_role = role_for_user(user, preferred_role=role)
    update_fields = []
    if not participant.primary_role:
        participant.primary_role = resolved_role
        update_fields.append("primary_role")
    contractor = Contractor.objects.filter(user=user).only("created_at").first()
    if (
        resolved_role == ReferralParticipant.ROLE_CONTRACTOR
        and contractor
        and not contractor_is_promotion_eligible(contractor)
        and participant.is_eligible
    ):
        participant.is_eligible = False
        participant.disqualified_at = timezone.now()
        participant.disqualification_reason = "Contractor account predates the referral promotion launch."
        update_fields.extend(["is_eligible", "disqualified_at", "disqualification_reason"])
    if update_fields:
        participant.save(update_fields=[*dict.fromkeys(update_fields), "updated_at"])
    return participant


def _pool_for_role(role):
    return (
        FoundingContractorAward.POOL_CONTRACTOR
        if role == ReferralParticipant.ROLE_CONTRACTOR
        else FoundingContractorAward.POOL_CONSUMER
    )


@transaction.atomic
def reserve_founding_slot_for_user(user, *, role="", contractor=None):
    role = role_for_user(user, preferred_role=role)
    if role == ReferralParticipant.ROLE_CONTRACTOR:
        contractor = contractor or Contractor.objects.filter(user=user).first()
        if contractor is None or not contractor_is_promotion_eligible(contractor):
            return None
    participant = participant_for_user(user, role=role)
    if not participant.is_eligible:
        return None
    pool = _pool_for_role(role)
    existing = FoundingContractorAward.objects.select_for_update().filter(
        participant=participant,
        pool=pool,
    ).first()
    if existing:
        return existing
    if contractor:
        legacy = FoundingContractorAward.objects.select_for_update().filter(contractor=contractor).first()
        if legacy:
            changed = []
            if legacy.participant_id is None:
                legacy.participant = participant
                changed.append("participant")
            if legacy.pool != pool:
                legacy.pool = pool
                changed.append("pool")
            if changed:
                legacy.save(update_fields=[*changed, "updated_at"])
            return legacy
    now = timezone.now()
    FoundingContractorAward.objects.select_for_update().filter(
        pool=pool,
        status=FoundingContractorAward.STATUS_RESERVED,
        qualification_deadline__lt=now,
    ).update(status=FoundingContractorAward.STATUS_EXPIRED, updated_at=now)
    used = set(
        FoundingContractorAward.objects.select_for_update()
        .filter(pool=pool)
        .exclude(status=FoundingContractorAward.STATUS_EXPIRED)
        .values_list("slot_number", flat=True)
    )
    slot = next((number for number in range(1, FOUNDING_SLOT_LIMIT + 1) if number not in used), None)
    if slot is None:
        return None
    return FoundingContractorAward.objects.create(
        contractor=contractor,
        participant=participant,
        pool=pool,
        slot_number=slot,
        qualification_deadline=now + timedelta(days=90),
    )


def reserve_founding_slot(contractor: Contractor):
    return reserve_founding_slot_for_user(
        contractor.user,
        role=ReferralParticipant.ROLE_CONTRACTOR,
        contractor=contractor,
    )


def founding_requirements(contractor: Contractor | None = None, *, user=None, role="") -> dict:
    if contractor is not None:
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
    homeowner = homeowner_for_user(user) if user else None
    profile_complete = bool(homeowner and homeowner.full_name and homeowner.email)
    verified = bool(user and user.is_active and getattr(user, "is_verified", False))
    return {
        "profile_complete": profile_complete,
        "verified": verified,
        "payout_ready": False,
        "complete": profile_complete and verified,
    }


def _award_for_participant(participant, *, role, contractor=None):
    award = FoundingContractorAward.objects.select_for_update().filter(
        participant=participant,
        pool=_pool_for_role(role),
    ).first()
    if award is None and contractor:
        award = FoundingContractorAward.objects.select_for_update().filter(contractor=contractor).first()
    return award


def _qualify_founding_award(*, participant, role, contractor=None, at=None):
    at = at or timezone.now()
    award = _award_for_participant(participant, role=role, contractor=contractor)
    if not award or award.status != FoundingContractorAward.STATUS_RESERVED:
        return award
    complete = founding_requirements(contractor, user=participant.user, role=role)["complete"]
    if at <= award.qualification_deadline and complete:
        award.award(at=at)
        award.save(update_fields=["status", "awarded_at", "promotion_ends_at", "updated_at"])
    elif at > award.qualification_deadline:
        award.status = FoundingContractorAward.STATUS_EXPIRED
        award.save(update_fields=["status", "updated_at"])
    return award


def sync_referral_verification(referral: ContractorReferral, *, at=None) -> bool:
    if referral.verified_at or referral.status in {
        ContractorReferral.STATUS_EXPIRED,
        ContractorReferral.STATUS_DISQUALIFIED,
    }:
        return bool(referral.verified_at)
    if referral.referred_role == ReferralParticipant.ROLE_CONTRACTOR:
        ready = founding_requirements(referral.referred_contractor)["complete"]
    else:
        ready = founding_requirements(user=referral.referred_user, role=referral.referred_role)["complete"]
    if not ready:
        return False
    at = at or timezone.now()
    referral.verified_at = at
    referral.status = ContractorReferral.STATUS_VERIFIED
    referral.save(update_fields=["verified_at", "status", "updated_at"])
    return True


def _program_for_referrer(user, *, registered_at, participant=None):
    participant = participant or participant_for_user(user)
    award = participant.founding_awards.filter(
        status=FoundingContractorAward.STATUS_AWARDED,
        promotion_ends_at__gt=registered_at,
    ).order_by("promotion_ends_at").first()
    if award is None:
        contractor = Contractor.objects.filter(user=user).select_related("founding_award").first()
        legacy = getattr(contractor, "founding_award", None) if contractor else None
        if legacy and legacy.status == FoundingContractorAward.STATUS_AWARDED and legacy.promotion_ends_at and registered_at < legacy.promotion_ends_at:
            award = legacy
    if award:
        return ContractorReferral.PROGRAM_FOUNDING, FOUNDING_RATE_BPS, FOUNDING_EARNING_MONTHS
    return ContractorReferral.PROGRAM_STANDARD, STANDARD_RATE_BPS, STANDARD_EARNING_MONTHS


@transaction.atomic
def attribute_registration(
    *,
    referred_user,
    referred_role,
    referral_code,
    contractor=None,
    homeowner=None,
    medium="link",
    landing_page="",
    first_touch_at=None,
):
    code = str(referral_code or "").strip().upper()
    if not code:
        return None
    existing = ContractorReferral.objects.select_for_update().filter(referred_user=referred_user).first()
    if existing is None and contractor is not None:
        existing = ContractorReferral.objects.select_for_update().filter(referred_contractor=contractor).first()
    if existing:
        return existing
    participant = ReferralParticipant.objects.select_for_update().filter(
        code=code,
        is_eligible=True,
    ).select_related("user").first()
    if participant is None:
        raise ValueError("This referral link is invalid or no longer eligible.")
    if participant.user_id == referred_user.id:
        raise ValueError("Self-referrals are not eligible.")
    registered_at = timezone.now()
    program, rate_bps, earning_months = _program_for_referrer(
        participant.user,
        registered_at=registered_at,
        participant=participant,
    )
    return ContractorReferral.objects.create(
        referrer=participant.user,
        participant=participant,
        referred_user=referred_user,
        referred_contractor=contractor,
        referred_homeowner=homeowner,
        referrer_role=role_for_user(participant.user),
        referred_role=referred_role,
        attributed_code=participant.code,
        acquisition_channel="referral",
        medium=str(medium or "link")[:24],
        landing_page=str(landing_page or "")[:255],
        first_touch_at=first_touch_at or registered_at,
        attribution_locked_at=registered_at,
        registered_at=registered_at,
        activation_deadline=registered_at + timedelta(days=REFERRAL_ACTIVATION_DAYS),
        program_code=program,
        reward_rate_bps=rate_bps,
        earning_months=earning_months,
    )


def attribute_contractor_registration(*, contractor: Contractor, referral_code: str, **kwargs):
    if not contractor_is_promotion_eligible(contractor):
        raise ValueError("This contractor account predates the referral promotion and is not eligible.")
    return attribute_registration(
        referred_user=contractor.user,
        referred_role=ReferralParticipant.ROLE_CONTRACTOR,
        referral_code=referral_code,
        contractor=contractor,
        **kwargs,
    )


def attribute_customer_registration(*, user, homeowner, referral_code, **kwargs):
    role = (
        ReferralParticipant.ROLE_PROPERTY_MANAGER
        if homeowner.account_type == Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY
        else ReferralParticipant.ROLE_HOMEOWNER
    )
    reserve_founding_slot_for_user(user, role=role)
    return attribute_registration(
        referred_user=user,
        referred_role=role,
        referral_code=referral_code,
        homeowner=homeowner,
        **kwargs,
    )


def eligible_platform_fee_cents(receipt) -> int:
    """Return the non-refunded MyHomeBro fee that is authoritative for rewards."""
    fee_cents = max(int(getattr(receipt, "platform_fee_cents", 0) or 0), 0)
    invoice = getattr(receipt, "invoice", None)
    agreement = getattr(receipt, "agreement", None) or getattr(invoice, "agreement", None)
    if fee_cents <= 0 or invoice is None or agreement is None or getattr(invoice, "status", "") == "refunded":
        return 0
    return fee_cents


def _contractor_for_receipt(receipt):
    agreement = receipt.agreement or getattr(receipt.invoice, "agreement", None)
    if agreement is None:
        return None
    return getattr(agreement, "contractor", None) or getattr(getattr(agreement, "project", None), "contractor", None)


def _homeowner_for_receipt(receipt):
    agreement = receipt.agreement or getattr(receipt.invoice, "agreement", None)
    if agreement is None:
        return None
    return getattr(agreement, "homeowner", None) or getattr(getattr(agreement, "project", None), "homeowner", None)


def _candidate_referrals_for_receipt(receipt):
    rows = []
    contractor = _contractor_for_receipt(receipt)
    if contractor:
        referral = ContractorReferral.objects.select_for_update().filter(referred_contractor=contractor).first()
        if referral:
            rows.append(referral)
        participant = participant_for_user(contractor.user, role=ReferralParticipant.ROLE_CONTRACTOR)
        _qualify_founding_award(
            participant=participant,
            role=ReferralParticipant.ROLE_CONTRACTOR,
            contractor=contractor,
            at=getattr(receipt, "created_at", None),
        )
    homeowner = _homeowner_for_receipt(receipt)
    if homeowner and homeowner.email:
        user = get_user_model().objects.filter(email__iexact=homeowner.email).first()
        if user:
            referral = ContractorReferral.objects.select_for_update().filter(referred_user=user).first()
            if referral and referral.pk not in {row.pk for row in rows}:
                rows.append(referral)
            preferred_role = (
                ReferralParticipant.ROLE_PROPERTY_MANAGER
                if homeowner.account_type == Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY
                else ReferralParticipant.ROLE_HOMEOWNER
            )
            participant = participant_for_user(user, role=preferred_role)
            _qualify_founding_award(participant=participant, role=preferred_role, at=getattr(receipt, "created_at", None))
    return rows


def _activate_referral_for_fee(referral, *, at):
    if referral.status in {ContractorReferral.STATUS_EXPIRED, ContractorReferral.STATUS_DISQUALIFIED}:
        return False
    if referral.earning_starts_at is None:
        if at > referral.activation_deadline:
            referral.status = ContractorReferral.STATUS_EXPIRED
            referral.save(update_fields=["status", "updated_at"])
            return False
        if not sync_referral_verification(referral, at=at):
            return False
        referral.activated_at = at
        referral.earning_starts_at = at
        referral.earning_ends_at = at + relativedelta(months=referral.earning_months)
        referral.status = ContractorReferral.STATUS_EARNING
        referral.save(update_fields=[
            "verified_at", "activated_at", "earning_starts_at", "earning_ends_at", "status", "updated_at",
        ])
    if not (referral.earning_starts_at <= at < referral.earning_ends_at):
        if at >= referral.earning_ends_at and referral.status != ContractorReferral.STATUS_COMPLETED:
            referral.status = ContractorReferral.STATUS_COMPLETED
            referral.completed_at = at
            referral.save(update_fields=["status", "completed_at", "updated_at"])
        return False
    return True


def _allocate_reward_pool(*, fee_cents, referrals):
    maximum_pool = fee_cents * MAXIMUM_REWARD_POOL_BPS // 10000
    desired = [fee_cents * row.reward_rate_bps // 10000 for row in referrals]
    desired_total = sum(desired)
    if desired_total <= maximum_pool:
        return maximum_pool, desired
    allocated = [value * maximum_pool // desired_total for value in desired]
    remainder = maximum_pool - sum(allocated)
    for index in range(len(allocated)):
        if remainder <= 0:
            break
        if allocated[index] < desired[index]:
            allocated[index] += 1
            remainder -= 1
    return maximum_pool, allocated


@transaction.atomic
def record_qualifying_receipt(receipt):
    from receipts.models import Receipt

    receipt = Receipt.objects.select_for_update().select_related(
        "invoice__agreement__project__contractor",
        "invoice__agreement__homeowner",
        "agreement__project__contractor",
        "agreement__homeowner",
    ).get(pk=receipt.pk)
    existing = list(receipt.referral_earnings.order_by("id"))
    if existing:
        return existing[0] if len(existing) == 1 else existing
    fee_cents = eligible_platform_fee_cents(receipt)
    if fee_cents <= 0:
        return None
    now = getattr(receipt, "created_at", None) or timezone.now()
    active = [row for row in _candidate_referrals_for_receipt(receipt) if _activate_referral_for_fee(row, at=now)]
    if not active:
        return None
    maximum_pool, allocations = _allocate_reward_pool(fee_cents=fee_cents, referrals=active)
    earnings = []
    for referral, reward_cents in zip(active, allocations):
        if reward_cents <= 0:
            continue
        earnings.append(ReferralEarning.objects.create(
            referral=referral,
            receipt=receipt,
            allocation_side=referral.referred_role,
            qualifying_platform_fee_cents=fee_cents,
            maximum_reward_pool_cents=maximum_pool,
            reward_rate_bps=referral.reward_rate_bps,
            reward_cents=reward_cents,
            available_at=now + timedelta(days=REWARD_HOLD_DAYS),
        ))
    return earnings[0] if len(earnings) == 1 else earnings


def _earning_has_financial_hold(earning: ReferralEarning) -> bool:
    receipt = earning.receipt
    invoice = receipt.invoice
    agreement = receipt.agreement or invoice.agreement
    if invoice.disputed or getattr(invoice, "status", "") == "refunded":
        return True
    if agreement.disputes.filter(status__in=("initiated", "open", "under_review"), is_archived=False).exists():
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


@transaction.atomic
def reverse_receipt_earnings(receipt, *, reason):
    reversed_at = timezone.now()
    updated = 0
    for earning in receipt.referral_earnings.select_for_update().exclude(status=ReferralEarning.STATUS_REVERSED):
        if earning.status in {ReferralEarning.STATUS_PAID, ReferralEarning.STATUS_REDEEMED}:
            earning.reversal_reason = f"REVIEW REQUIRED: {reason}"
            earning.save(update_fields=["reversal_reason", "updated_at"])
            continue
        earning.status = ReferralEarning.STATUS_REVERSED
        earning.reversed_at = reversed_at
        earning.reversal_reason = str(reason or "Underlying platform fee reversed.")
        earning.save(update_fields=["status", "reversed_at", "reversal_reason", "updated_at"])
        updated += 1
    return updated


def _display_name(referral):
    if referral.referred_contractor_id:
        return referral.referred_contractor.business_name or referral.referred_contractor.email
    if referral.referred_homeowner_id:
        return referral.referred_homeowner.company_name or referral.referred_homeowner.full_name or referral.referred_homeowner.email
    user = referral.referred_user
    if user:
        return user.get_full_name() or user.email
    return "Referred account"


def referral_dashboard(user, request=None):
    participant = participant_for_user(user)
    release_eligible_earnings(participant=participant)
    referrals = participant.referrals.select_related(
        "referred_contractor",
        "referred_contractor__user",
        "referred_homeowner",
        "referred_user",
    ).prefetch_related("earnings").order_by("-registered_at")
    for referral in referrals:
        sync_referral_verification(referral)
    totals = ReferralEarning.objects.filter(referral__participant=participant).values("status").annotate(cents=Sum("reward_cents"))
    totals_by_status = {row["status"]: int(row["cents"] or 0) for row in totals}
    site_url = (getattr(settings, "SITE_URL", "") or (request.build_absolute_uri("/") if request else "")).rstrip("/")
    referral_link = f"{site_url}/refer/{participant.code}"
    import qrcode

    qr = qrcode.make(referral_link)
    qr_buffer = BytesIO()
    qr.save(qr_buffer, format="PNG")
    awards = list(participant.founding_awards.order_by("pool", "slot_number"))
    contractor = Contractor.objects.filter(user=user).select_related("founding_award").first()
    if not awards and contractor and getattr(contractor, "founding_award", None):
        awards = [contractor.founding_award]
    role = role_for_user(user, preferred_role=participant.primary_role)
    total_paid = totals_by_status.get(ReferralEarning.STATUS_PAID, 0)
    total_redeemed = totals_by_status.get(ReferralEarning.STATUS_REDEEMED, 0)
    active_payout_statuses = (
        ReferralPayout.STATUS_PENDING,
        ReferralPayout.STATUS_NEEDS_ONBOARDING,
        ReferralPayout.STATUS_PROCESSING,
        ReferralPayout.STATUS_PAID,
    )
    spendable_available = ReferralEarning.objects.filter(
        referral__participant=participant,
        status=ReferralEarning.STATUS_AVAILABLE,
    ).exclude(payouts__status__in=active_payout_statuses).aggregate(cents=Sum("reward_cents"))["cents"] or 0
    pending_cash_out = ReferralPayout.objects.filter(
        participant=participant,
        status__in=(
            ReferralPayout.STATUS_PENDING,
            ReferralPayout.STATUS_NEEDS_ONBOARDING,
            ReferralPayout.STATUS_PROCESSING,
        ),
    ).aggregate(cents=Sum("amount_cents"))["cents"] or 0
    credit_options = [
        {
            "project_id": invoice.agreement.project_id,
            "project_title": invoice.agreement.project.title,
            "invoice_id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "invoice_amount_cents": int(invoice.amount * 100),
        }
        for invoice in Invoice.objects.filter(
            agreement__project__homeowner__email__iexact=user.email,
            disputed=False,
        ).exclude(status="refunded").select_related("agreement__project").order_by("-created_at")[:100]
    ]
    return {
        "code": participant.code,
        "role": role,
        "referral_link": referral_link,
        "qr_code_data_url": f"data:image/png;base64,{base64.b64encode(qr_buffer.getvalue()).decode('ascii')}",
        "eligible": participant.is_eligible,
        "founding": [{
            "pool": award.pool,
            "status": award.status,
            "slot_number": award.slot_number,
            "qualification_deadline": award.qualification_deadline,
            "awarded_at": award.awarded_at,
            "promotion_ends_at": award.promotion_ends_at,
            "requirements": founding_requirements(
                contractor if award.pool == FoundingContractorAward.POOL_CONTRACTOR else None,
                user=user,
                role=role,
            ),
        } for award in awards],
        "reward_terms": {
            "founding_percent": FOUNDING_RATE_BPS / 100,
            "founding_earning_months": FOUNDING_EARNING_MONTHS,
            "standard_percent": STANDARD_RATE_BPS / 100,
            "standard_earning_months": STANDARD_EARNING_MONTHS,
            "percent": STANDARD_RATE_BPS / 100,
            "earning_months": STANDARD_EARNING_MONTHS,
            "hold_days": REWARD_HOLD_DAYS,
            "maximum_pool_percent": MAXIMUM_REWARD_POOL_BPS / 100,
        },
        "payout_readiness": {
            "status": participant.payout_onboarding_status,
            "cash_out_supported": bool(participant.payout_enabled or (contractor and contractor.details_submitted and contractor.payouts_enabled)),
            "requires_onboarding": not bool(participant.payout_enabled or (contractor and contractor.details_submitted and contractor.payouts_enabled)),
        },
        "customer_payout": {
            "status": participant.payout_onboarding_status,
            "message": "Rewards may accrue before payout onboarding. Cash payout remains gated until a supported Stripe payout identity is ready.",
        },
        "summary": {
            "invitations": participant.invitations.count(),
            "registrations": referrals.count(),
            "verified": referrals.filter(verified_at__isnull=False).count(),
            "activated": referrals.filter(activated_at__isnull=False).count(),
            "active_earning_periods": referrals.filter(status=ContractorReferral.STATUS_EARNING).count(),
            "expired_or_disqualified": referrals.filter(status__in=(ContractorReferral.STATUS_EXPIRED, ContractorReferral.STATUS_DISQUALIFIED)).count(),
            "pending_cents": totals_by_status.get(ReferralEarning.STATUS_PENDING, 0),
            "available_cents": int(spendable_available),
            "reserved_cents": totals_by_status.get(ReferralEarning.STATUS_RESERVED, 0),
            "cash_out_requested_cents": int(pending_cash_out),
            "cash_paid_cents": total_paid,
            "project_credit_cents": total_redeemed,
            "paid_cents": total_paid,
            "lifetime_cents": sum(
                cents for state, cents in totals_by_status.items()
                if state != ReferralEarning.STATUS_REVERSED
            ),
            "completed_payouts": participant.payouts.filter(status=ReferralPayout.STATUS_PAID).count(),
        },
        "credit_options": credit_options,
        "referrals": [{
            "id": row.id,
            "account_name": _display_name(row),
            "contractor_name": _display_name(row),
            "referred_role": row.referred_role,
            "referrer_role": row.referrer_role,
            "status": row.status,
            "program_code": row.program_code,
            "reward_percent": row.reward_rate_bps / 100,
            "earning_months": row.earning_months,
            "registered_at": row.registered_at,
            "activation_deadline": row.activation_deadline,
            "earning_starts_at": row.earning_starts_at,
            "earning_ends_at": row.earning_ends_at,
            "pending_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_PENDING),
            "available_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_AVAILABLE),
            "paid_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_PAID),
            "project_credit_cents": sum(item.reward_cents for item in row.earnings.all() if item.status == ReferralEarning.STATUS_REDEEMED),
        } for row in referrals],
    }
