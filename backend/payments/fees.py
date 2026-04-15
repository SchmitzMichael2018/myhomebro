# backend/backend/payments/fees.py
# v2025-12-29 — Central fee engine for MyHomeBro (compat + agreement-level cap)
#
# Supports BOTH:
# - Legacy callers: compute_fee_summary(...)  (used by projects/views/funding.py)
# - Magic invoice callers:
#       compute_fee_summary_for_invoice_payment(...)
#       calculate_platform_fee_cents_for_invoice(...)
#
# Business rules:
# - 60-day intro: 3% + $1
# - After intro: tiered by MONTHLY volume:
#       < $10k      -> 4.5% + $1
#       $10k-$24,999-> 4.0% + $1
#       $25k+       -> 3.5% + $1
# - Optional high-risk surcharge (+1.5%)
# - Cap: $750 PER AGREEMENT (across all milestone payments), when agreement_id is provided

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional, Tuple

from django.utils import timezone


FeePayer = Literal["contractor", "homeowner", "split"]

FEE_ENGINE_VERSION = "v2025-12-29"

INTRO_DAYS = 60
INTRO_RATE = Decimal("0.03")

TIER1_RATE = Decimal("0.045")
TIER2_RATE = Decimal("0.040")
TIER3_RATE = Decimal("0.035")

HIGH_RISK_SURCHARGE = Decimal("0.015")

FLAT_FEE = Decimal("1.00")

MAX_PLATFORM_FEE = Decimal("750.00")


@dataclass
class FeeRateInfo:
    rate: Decimal
    flat_fee: Decimal
    is_intro: bool
    tier_name: str
    high_risk_applied: bool


@dataclass
class PlatformFeeResult:
    project_amount: Decimal
    rate_info: FeeRateInfo
    variable_fee: Decimal
    total_fee: Decimal


@dataclass
class SplitResult:
    project_amount: Decimal
    platform_fee: Decimal
    contractor_payout: Decimal
    homeowner_escrow: Decimal
    contractor_fee_share: Decimal
    homeowner_fee_share: Decimal


@dataclass
class FeeSummary:
    project_amount: Decimal
    rate_info: FeeRateInfo
    platform_fee: Decimal
    contractor_payout: Decimal
    homeowner_escrow: Decimal
    contractor_fee_share: Decimal
    homeowner_fee_share: Decimal


@dataclass
class AgreementCapInfo:
    cap_total: Decimal
    already_collected: Decimal
    remaining_cap: Decimal


@dataclass
class InvoicePaymentFeeSummary:
    project_amount: Decimal
    rate_info: FeeRateInfo
    platform_fee: Decimal
    agreement_cap: AgreementCapInfo

    # For audit/debug
    monthly_volume_used: Decimal
    platform_fee_uncapped: Decimal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_date(value) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    raise TypeError("contractor_created_at must be a date or datetime")


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _money_from_cents(cents: int) -> Decimal:
    return _round_money(Decimal(cents) / Decimal("100"))


def _cents_from_money(amount: Decimal) -> int:
    return int((_round_money(amount) * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def get_monthly_paid_invoice_volume_for_contractor(contractor) -> Decimal:
    monthly_volume = Decimal("0.00")
    try:
        from projects.models import Invoice  # type: ignore

        now_dt = timezone.now()
        month_start = now_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        paid_like = ("paid", "released", "completed")

        qs = Invoice.objects.filter(agreement__contractor=contractor)
        if hasattr(Invoice, "paid_at"):
            qs = qs.filter(paid_at__gte=month_start)
        elif hasattr(Invoice, "updated_at"):
            qs = qs.filter(updated_at__gte=month_start)

        total = Decimal("0.00")
        for inv in qs.only("amount", "status"):
            s = str(getattr(inv, "status", "")).lower()
            if not any(k in s for k in paid_like):
                continue
            amt = getattr(inv, "amount", None)
            if amt is not None:
                total += _round_money(Decimal(str(amt)))
        monthly_volume = _round_money(total)
    except Exception:
        monthly_volume = Decimal("0.00")
    return monthly_volume


# ---------------------------------------------------------------------------
# Core tier logic
# ---------------------------------------------------------------------------

def get_fee_rate_for_contractor(
    *,
    contractor_created_at,
    monthly_volume: Decimal,
    is_high_risk: bool = False,
    today: Optional[date] = None,
) -> FeeRateInfo:
    today = today or date.today()
    cdate = _to_date(contractor_created_at)
    days_active = (today - cdate).days

    if days_active <= INTRO_DAYS:
        base_rate = INTRO_RATE
        tier_name = "intro"
        is_intro = True
    else:
        is_intro = False
        if monthly_volume < Decimal("10000"):
            base_rate = TIER1_RATE
            tier_name = "tier1"
        elif monthly_volume < Decimal("25000"):
            base_rate = TIER2_RATE
            tier_name = "tier2"
        else:
            base_rate = TIER3_RATE
            tier_name = "tier3"

    high_risk_applied = False
    if is_high_risk:
        base_rate = base_rate + HIGH_RISK_SURCHARGE
        high_risk_applied = True

    return FeeRateInfo(
        rate=base_rate,
        flat_fee=FLAT_FEE,
        is_intro=is_intro,
        tier_name=tier_name,
        high_risk_applied=high_risk_applied,
    )


def calculate_platform_fee(
    *,
    project_amount: Decimal,
    rate_info: FeeRateInfo,
) -> PlatformFeeResult:
    project_amount = _round_money(project_amount)
    variable_fee = _round_money(project_amount * rate_info.rate)
    total_fee = _round_money(variable_fee + rate_info.flat_fee)
    return PlatformFeeResult(
        project_amount=project_amount,
        rate_info=rate_info,
        variable_fee=variable_fee,
        total_fee=total_fee,
    )


def split_fee_between_parties(
    *,
    project_amount: Decimal,
    platform_fee: Decimal,
    fee_payer: FeePayer,
) -> SplitResult:
    project_amount = _round_money(project_amount)
    platform_fee = _round_money(platform_fee)

    if fee_payer == "contractor":
        contractor_fee_share = platform_fee
        homeowner_fee_share = Decimal("0.00")
        contractor_payout = project_amount - platform_fee
        homeowner_escrow = project_amount

    elif fee_payer == "homeowner":
        contractor_fee_share = Decimal("0.00")
        homeowner_fee_share = platform_fee
        contractor_payout = project_amount
        homeowner_escrow = project_amount + platform_fee

    elif fee_payer == "split":
        half = _round_money(platform_fee / 2)
        contractor_fee_share = half
        homeowner_fee_share = platform_fee - half
        contractor_payout = project_amount - contractor_fee_share
        homeowner_escrow = project_amount + homeowner_fee_share

    else:
        raise ValueError("fee_payer must be 'contractor', 'homeowner', or 'split'")

    return SplitResult(
        project_amount=project_amount,
        platform_fee=platform_fee,
        contractor_payout=_round_money(contractor_payout),
        homeowner_escrow=_round_money(homeowner_escrow),
        contractor_fee_share=_round_money(contractor_fee_share),
        homeowner_fee_share=_round_money(homeowner_fee_share),
    )


# ---------------------------------------------------------------------------
# Agreement-level cap support
# ---------------------------------------------------------------------------

def get_collected_platform_fees_for_agreement(agreement_id: Optional[int]) -> Decimal:
    """
    Best-effort:
      - Prefer Receipt.platform_fee_cents / platform_fee_amount if present
      - Else fall back to Invoice.platform_fee_cents (paid-like statuses)
    """
    if not agreement_id:
        return Decimal("0.00")

    # Prefer receipts
    try:
        from receipts.models import Receipt  # type: ignore

        qs = Receipt.objects.filter(agreement_id=agreement_id)
        if hasattr(Receipt, "platform_fee_cents"):
            total_cents = 0
            for r in qs.only("platform_fee_cents"):
                total_cents += int(getattr(r, "platform_fee_cents") or 0)
            return _money_from_cents(total_cents)

        if hasattr(Receipt, "platform_fee_amount"):
            total = Decimal("0.00")
            for r in qs.only("platform_fee_amount"):
                v = getattr(r, "platform_fee_amount")
                if v is not None:
                    total += _round_money(Decimal(str(v)))
            return _round_money(total)
    except Exception:
        pass

    # Fallback to invoices
    try:
        from projects.models import Invoice  # type: ignore
    except Exception:
        return Decimal("0.00")

    paid_like = ("paid", "released", "completed")
    try:
        qs = Invoice.objects.filter(agreement_id=agreement_id)
        if hasattr(Invoice, "platform_fee_cents"):
            total_cents = 0
            for inv in qs.only("platform_fee_cents", "status"):
                s = str(getattr(inv, "status", "")).lower()
                if not any(k in s for k in paid_like):
                    continue
                total_cents += int(getattr(inv, "platform_fee_cents") or 0)
            return _money_from_cents(total_cents)
    except Exception:
        pass

    return Decimal("0.00")


def apply_agreement_cap(
    *,
    agreement_id: Optional[int],
    uncapped_fee: Decimal,
) -> Tuple[Decimal, AgreementCapInfo]:
    cap_total = _round_money(MAX_PLATFORM_FEE)
    already = _round_money(get_collected_platform_fees_for_agreement(agreement_id))
    remaining = _round_money(cap_total - already)
    if remaining < Decimal("0.00"):
        remaining = Decimal("0.00")

    applied = _round_money(uncapped_fee)
    if applied > remaining:
        applied = remaining

    return applied, AgreementCapInfo(
        cap_total=cap_total,
        already_collected=already,
        remaining_cap=remaining,
    )


# ---------------------------------------------------------------------------
# Legacy API
# ---------------------------------------------------------------------------

def compute_fee_summary(
    *,
    project_amount: Decimal,
    contractor_created_at,
    monthly_volume: Decimal,
    fee_payer: FeePayer,
    is_high_risk: bool = False,
    today: Optional[date] = None,
) -> FeeSummary:
    """
    Backward compatible fee summary used by older code paths.
    NOTE: This uses PER-CALL cap (historical behavior) by applying MAX_PLATFORM_FEE here.
    """
    rate_info = get_fee_rate_for_contractor(
        contractor_created_at=contractor_created_at,
        monthly_volume=_round_money(monthly_volume),
        is_high_risk=is_high_risk,
        today=today,
    )

    platform = calculate_platform_fee(
        project_amount=_round_money(Decimal(str(project_amount))),
        rate_info=rate_info,
    )

    platform_fee = platform.total_fee
    if platform_fee > MAX_PLATFORM_FEE:
        platform_fee = MAX_PLATFORM_FEE

    split = split_fee_between_parties(
        project_amount=platform.project_amount,
        platform_fee=platform_fee,
        fee_payer=fee_payer,
    )

    return FeeSummary(
        project_amount=split.project_amount,
        rate_info=rate_info,
        platform_fee=split.platform_fee,
        contractor_payout=split.contractor_payout,
        homeowner_escrow=split.homeowner_escrow,
        contractor_fee_share=split.contractor_fee_share,
        homeowner_fee_share=split.homeowner_fee_share,
    )


# ---------------------------------------------------------------------------
# New API used by invoice payments
# ---------------------------------------------------------------------------

def compute_fee_summary_for_invoice_payment(
    *,
    amount_cents: int,
    contractor,
    agreement_id: Optional[int],
    is_high_risk: bool = False,
) -> InvoicePaymentFeeSummary:
    """
    Computes the platform fee for a MILESTONE payment and applies $750 cap PER AGREEMENT.
    """
    contractor_created_at = (
        getattr(contractor, "created_at", None)
        or getattr(contractor, "created", None)
        or getattr(getattr(contractor, "user", None), "date_joined", None)
        or timezone.now()
    )

    monthly_volume = get_monthly_paid_invoice_volume_for_contractor(contractor)

    rate_info = get_fee_rate_for_contractor(
        contractor_created_at=contractor_created_at,
        monthly_volume=monthly_volume,
        is_high_risk=is_high_risk,
        today=date.today(),
    )

    amount = _money_from_cents(int(amount_cents))
    uncapped = calculate_platform_fee(project_amount=amount, rate_info=rate_info).total_fee

    applied_fee, cap_info = apply_agreement_cap(
        agreement_id=agreement_id,
        uncapped_fee=uncapped,
    )

    return InvoicePaymentFeeSummary(
        project_amount=amount,
        rate_info=rate_info,
        platform_fee=applied_fee,
        agreement_cap=cap_info,
        monthly_volume_used=monthly_volume,
        platform_fee_uncapped=uncapped,
    )


def calculate_platform_fee_cents_for_invoice(
    *,
    amount_cents: int,
    contractor,
    agreement_id: Optional[int],
    is_high_risk: bool = False,
) -> int:
    summary = compute_fee_summary_for_invoice_payment(
        amount_cents=amount_cents,
        contractor=contractor,
        agreement_id=agreement_id,
        is_high_risk=is_high_risk,
    )
    return _cents_from_money(summary.platform_fee)


def calculate_total_allowed_fee_cents_for_agreement_total(
    *,
    contract_amount_cents: int,
    contractor,
    is_high_risk: bool = False,
) -> int:
    contractor_created_at = (
        getattr(contractor, "created_at", None)
        or getattr(contractor, "created", None)
        or getattr(getattr(contractor, "user", None), "date_joined", None)
        or timezone.now()
    )
    monthly_volume = get_monthly_paid_invoice_volume_for_contractor(contractor)
    rate_info = get_fee_rate_for_contractor(
        contractor_created_at=contractor_created_at,
        monthly_volume=monthly_volume,
        is_high_risk=is_high_risk,
        today=date.today(),
    )
    amount = _money_from_cents(int(contract_amount_cents or 0))
    uncapped = calculate_platform_fee(project_amount=amount, rate_info=rate_info).total_fee
    capped = min(_round_money(uncapped), _round_money(MAX_PLATFORM_FEE))
    return _cents_from_money(capped)


def build_invoice_payment_fee_snapshot(summary: InvoicePaymentFeeSummary) -> dict:
    """
    Returns a dict you can persist on Receipt for auditability.
    """
    ri = summary.rate_info
    cap = summary.agreement_cap

    fee_plan_code = ri.tier_name + ("+risk" if ri.high_risk_applied else "")

    return {
        "fee_engine_version": FEE_ENGINE_VERSION,
        "fee_plan_code": fee_plan_code,
        "fee_rate": ri.rate,
        "flat_fee": ri.flat_fee,
        "monthly_volume_used": summary.monthly_volume_used,
        "platform_fee_uncapped_cents": _cents_from_money(summary.platform_fee_uncapped),
        "cap_total_cents": _cents_from_money(cap.cap_total),
        "cap_already_collected_cents": _cents_from_money(cap.already_collected),
        "cap_remaining_cents": _cents_from_money(cap.remaining_cap),
        "is_intro": ri.is_intro,
        "high_risk_applied": ri.high_risk_applied,
        "tier_name": ri.tier_name,
        # NOTE: platform_fee_cents itself is stored separately on Receipt as "platform_fee_cents"
    }
