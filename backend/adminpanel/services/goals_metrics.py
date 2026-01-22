from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from django.apps import apps
from django.db.models import Sum
from django.utils.timezone import now


D0 = Decimal("0.00")
HUNDRED = Decimal("100")


def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None


def _cents_to_money(cents: int) -> Decimal:
    try:
        return (Decimal(int(cents or 0)) / HUNDRED).quantize(D0)
    except Exception:
        return D0


def _money_to_cents(dec: Decimal) -> int:
    try:
        return int((Decimal(str(dec)) * HUNDRED).quantize(Decimal("1")))
    except Exception:
        return 0


def _fmt_money(dec: Decimal) -> str:
    try:
        return f"{Decimal(str(dec)).quantize(D0):.2f}"
    except Exception:
        return "0.00"


def _safe_decimal(value) -> Decimal:
    try:
        if value is None:
            return D0
        return Decimal(str(value)).quantize(D0)
    except Exception:
        return D0


@dataclass
class GoalsSnapshot:
    generated_at: str

    # Goal config
    goal_key: str
    goal_target_cents: int

    # Primary truth: platform fees (rolling 12 months)
    platform_fees_l12m_cents: int
    platform_fees_last_30d_cents: int
    platform_fees_projection_annual_cents: int  # last 30d * 12

    # Helpful driver context
    escrow_funded_l12m_cents: int
    gross_paid_l12m_cents: int

    # Derived
    effective_take_rate_l12m: float  # fees / escrow
    implied_escrow_needed_for_goal_cents: int  # goal / take_rate

    # Pace status
    pace_ratio: float  # actual pace vs needed pace
    status: str  # on_track | at_risk | off_track


def compute_goals_snapshot(*, goal_key: str, goal_target_cents: int) -> GoalsSnapshot:
    """
    Computes salary-goal progress using Receipt as the authoritative platform fee ledger.

    Assumptions based on your existing admin views:
      - Receipt.amount_paid_cents exists
      - Receipt.platform_fee_cents exists
      - Agreement.escrow_funded_amount exists (Decimal dollars)
    """
    Receipt = _get_model("receipts", "Receipt")
    Agreement = _get_model("projects", "Agreement")

    ts_now = now()
    start_l12m = ts_now - timedelta(days=365)
    start_30d = ts_now - timedelta(days=30)

    # --- Platform fees (authoritative) ---
    fees_l12m_cents = 0
    fees_30d_cents = 0
    gross_paid_l12m_cents = 0

    if Receipt is not None:
        try:
            agg = Receipt.objects.filter(created_at__gte=start_l12m).aggregate(total=Sum("platform_fee_cents"))
            fees_l12m_cents = int(agg.get("total") or 0)
        except Exception:
            fees_l12m_cents = 0

        try:
            agg = Receipt.objects.filter(created_at__gte=start_30d).aggregate(total=Sum("platform_fee_cents"))
            fees_30d_cents = int(agg.get("total") or 0)
        except Exception:
            fees_30d_cents = 0

        try:
            agg = Receipt.objects.filter(created_at__gte=start_l12m).aggregate(total=Sum("amount_paid_cents"))
            gross_paid_l12m_cents = int(agg.get("total") or 0)
        except Exception:
            gross_paid_l12m_cents = 0

    # --- Escrow funded (driver) ---
    escrow_funded_l12m_cents = 0
    if Agreement is not None and hasattr(Agreement, "escrow_funded_amount"):
        try:
            agg = Agreement.objects.filter(created_at__gte=start_l12m).aggregate(total=Sum("escrow_funded_amount"))
            total_dec = _safe_decimal(agg.get("total"))
            escrow_funded_l12m_cents = _money_to_cents(total_dec)
        except Exception:
            escrow_funded_l12m_cents = 0

    # --- Derived metrics ---
    projection_annual_cents = fees_30d_cents * 12

    take_rate = 0.0
    if escrow_funded_l12m_cents > 0:
        take_rate = float(fees_l12m_cents / escrow_funded_l12m_cents)

    implied_escrow_needed_cents = 0
    if take_rate > 0:
        implied_escrow_needed_cents = int(goal_target_cents / take_rate)

    # Pace: compare projected annual fees to goal
    pace_ratio = 0.0
    if goal_target_cents > 0:
        pace_ratio = float(projection_annual_cents / goal_target_cents)

    if pace_ratio >= 0.95:
        status = "on_track"
    elif pace_ratio >= 0.80:
        status = "at_risk"
    else:
        status = "off_track"

    return GoalsSnapshot(
        generated_at=ts_now.isoformat(),

        goal_key=goal_key,
        goal_target_cents=int(goal_target_cents or 0),

        platform_fees_l12m_cents=int(fees_l12m_cents),
        platform_fees_last_30d_cents=int(fees_30d_cents),
        platform_fees_projection_annual_cents=int(projection_annual_cents),

        escrow_funded_l12m_cents=int(escrow_funded_l12m_cents),
        gross_paid_l12m_cents=int(gross_paid_l12m_cents),

        effective_take_rate_l12m=float(take_rate),
        implied_escrow_needed_for_goal_cents=int(implied_escrow_needed_cents),

        pace_ratio=float(pace_ratio),
        status=status,
    )


def snapshot_to_api_dict(s: GoalsSnapshot) -> Dict[str, Any]:
    """
    User-friendly API payload with both cents and formatted strings.
    """
    fees_l12m = _cents_to_money(s.platform_fees_l12m_cents)
    fees_30d = _cents_to_money(s.platform_fees_last_30d_cents)
    proj = _cents_to_money(s.platform_fees_projection_annual_cents)

    escrow_l12m = _cents_to_money(s.escrow_funded_l12m_cents)
    gross_paid_l12m = _cents_to_money(s.gross_paid_l12m_cents)

    implied_escrow = _cents_to_money(s.implied_escrow_needed_for_goal_cents)
    goal_target = _cents_to_money(s.goal_target_cents)

    return {
        "generated_at": s.generated_at,
        "goal": {
            "key": s.goal_key,
            "timeframe": "rolling_12_months",
            "target_cents": s.goal_target_cents,
            "target": _fmt_money(goal_target),
        },
        "salary_tracker": {
            "platform_fees_l12m_cents": s.platform_fees_l12m_cents,
            "platform_fees_l12m": _fmt_money(fees_l12m),

            "platform_fees_last_30d_cents": s.platform_fees_last_30d_cents,
            "platform_fees_last_30d": _fmt_money(fees_30d),

            "projection_annual_cents": s.platform_fees_projection_annual_cents,
            "projection_annual": _fmt_money(proj),

            "pace_ratio": s.pace_ratio,
            "status": s.status,
        },
        "drivers": {
            "escrow_funded_l12m_cents": s.escrow_funded_l12m_cents,
            "escrow_funded_l12m": _fmt_money(escrow_l12m),

            "gross_paid_l12m_cents": s.gross_paid_l12m_cents,
            "gross_paid_l12m": _fmt_money(gross_paid_l12m),
        },
        "derived": {
            "effective_take_rate_l12m": s.effective_take_rate_l12m,
            "implied_escrow_needed_for_goal_cents": s.implied_escrow_needed_for_goal_cents,
            "implied_escrow_needed_for_goal": _fmt_money(implied_escrow),
        },
    }
