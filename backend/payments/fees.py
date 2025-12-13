# backend/backend/payments/fees.py
# v2025-12-03 — Central fee engine for MyHomeBro
#
# This module ONLY handles MyHomeBro platform fees:
# - 60-day intro rate for new contractors
# - Tiered rates by monthly volume
# - Optional high-risk surcharge
# - $1 flat fee
# - Maximum fee cap per project
# - Who pays the fee (contractor / homeowner / split)
#
# Stripe processing fees (2.9% + $0.30 etc.) are handled
# separately in your Stripe views when you build the PaymentIntent.

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FeePayer = Literal["contractor", "homeowner", "split"]

# 60-day intro window
INTRO_DAYS = 60
INTRO_RATE = Decimal("0.03")     # 3%

# Tiered rates AFTER intro window, based on monthly volume
TIER1_RATE = Decimal("0.045")    # 4.5%   for $0–$9,999
TIER2_RATE = Decimal("0.040")    # 4.0%   for $10k–$24,999
TIER3_RATE = Decimal("0.035")    # 3.5%   for $25k+

# Optional surcharge for high-risk categories (roofing, plumbing, etc.)
HIGH_RISK_SURCHARGE = Decimal("0.015")  # +1.5%

# Flat fee added to every project
FLAT_FEE = Decimal("1.00")       # $1 per transaction

# Maximum platform fee per project (cap)
MAX_PLATFORM_FEE = Decimal("750.00")


# ---------------------------------------------------------------------------
# Dataclasses for structured results
# ---------------------------------------------------------------------------

@dataclass
class FeeRateInfo:
    """
    Describes which percentage rate we applied and why.
    """
    rate: Decimal                 # e.g. 0.045
    flat_fee: Decimal             # usually $1.00
    is_intro: bool                # True if in 60-day intro period
    tier_name: str                # "intro", "tier1", "tier2", "tier3"
    high_risk_applied: bool       # True if HIGH_RISK_SURCHARGE added


@dataclass
class PlatformFeeResult:
    """
    Platform fee for a single project (before deciding who pays it).
    """
    project_amount: Decimal       # contractor's price (rounded)
    rate_info: FeeRateInfo
    variable_fee: Decimal         # project_amount * rate
    total_fee: Decimal            # variable_fee + flat_fee (capped)


@dataclass
class SplitResult:
    """
    How the platform fee is distributed between contractor & homeowner.
    (Stripe fees are NOT included here.)
    """
    project_amount: Decimal
    platform_fee: Decimal
    contractor_payout: Decimal    # what contractor actually receives
    homeowner_escrow: Decimal     # what homeowner deposits into escrow
    contractor_fee_share: Decimal # portion of platform_fee they cover
    homeowner_fee_share: Decimal  # portion of platform_fee they cover


@dataclass
class FeeSummary:
    """
    High-level summary used by views/serializers.
    """
    project_amount: Decimal
    rate_info: FeeRateInfo
    platform_fee: Decimal
    contractor_payout: Decimal
    homeowner_escrow: Decimal
    contractor_fee_share: Decimal
    homeowner_fee_share: Decimal


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_date(value) -> date:
    """
    Normalize contractor_created_at, which might be a date OR datetime.
    """
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    raise TypeError("contractor_created_at must be a date or datetime")


def _round_money(value: Decimal) -> Decimal:
    """
    Round to 2 decimal places using bankers-friendly HALF_UP.
    """
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Core fee logic
# ---------------------------------------------------------------------------

def get_fee_rate_for_contractor(
    *,
    contractor_created_at,
    monthly_volume: Decimal,
    is_high_risk: bool = False,
    today: Optional[date] = None,
) -> FeeRateInfo:
    """
    Decide which percentage rate applies to this contractor for THIS project.

    Order:
      1) 60-day intro rate (3%) overrides everything.
      2) After intro, tier by monthly_volume:
           - < 10,000      -> 4.5%  (tier1)
           - 10,000–24,999 -> 4.0%  (tier2)
           - 25,000+       -> 3.5%  (tier3)
      3) If high-risk, add HIGH_RISK_SURCHARGE (+1.5%).
    """
    today = today or date.today()
    cdate = _to_date(contractor_created_at)
    days_active = (today - cdate).days

    # 1) Intro period
    if days_active <= INTRO_DAYS:
        base_rate = INTRO_RATE
        tier_name = "intro"
        is_intro = True
    else:
        is_intro = False

        # 2) Volume-based tiers
        if monthly_volume < Decimal("10000"):
            base_rate = TIER1_RATE
            tier_name = "tier1"
        elif monthly_volume < Decimal("25000"):
            base_rate = TIER2_RATE
            tier_name = "tier2"
        else:
            base_rate = TIER3_RATE
            tier_name = "tier3"

    # 3) Optional high-risk surcharge
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
    """
    Compute the MyHomeBro platform fee for a single Agreement.

    Applies:
      - percentage from rate_info.rate
      - FLAT_FEE
      - MAX_PLATFORM_FEE cap
    """
    project_amount = _round_money(project_amount)

    variable_fee = _round_money(project_amount * rate_info.rate)
    uncapped_total = variable_fee + rate_info.flat_fee

    total_fee = _round_money(uncapped_total)
    if total_fee > MAX_PLATFORM_FEE:
        total_fee = MAX_PLATFORM_FEE

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
    """
    Decide who effectively covers the platform fee.

      fee_payer == "contractor":
          - Homeowner escrow: project_amount
          - Contractor payout: project_amount - platform_fee

      fee_payer == "homeowner":
          - Homeowner escrow: project_amount + platform_fee
          - Contractor payout: project_amount

      fee_payer == "split":
          - Each covers ~50% of the fee.
    """
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
        homeowner_fee_share = platform_fee - half  # keep cents consistent
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
    Convenience wrapper used by views/serializers.

    IMPORTANT:
      - This only computes MyHomeBro platform fees.
      - Stripe processing fees must be added separately in your Stripe code.

    Returns a FeeSummary with:
      - project_amount (rounded)
      - rate_info (intro/tier/high-risk metadata)
      - platform_fee (total fee MyHomeBro earns)
      - contractor_payout (before Stripe)
      - homeowner_escrow (before Stripe)
      - contractor_fee_share / homeowner_fee_share
    """
    rate_info = get_fee_rate_for_contractor(
        contractor_created_at=contractor_created_at,
        monthly_volume=monthly_volume,
        is_high_risk=is_high_risk,
        today=today,
    )

    platform = calculate_platform_fee(
        project_amount=project_amount,
        rate_info=rate_info,
    )

    split = split_fee_between_parties(
        project_amount=platform.project_amount,
        platform_fee=platform.total_fee,
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
