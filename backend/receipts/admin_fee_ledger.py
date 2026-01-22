# backend/backend/receipts/admin_fee_ledger.py
# Admin Fee Ledger endpoint for MyHomeBro
#
# Provides an auditable ledger:
# - uses Receipt as source of truth
# - compares fee_charged vs fee_expected (from stored snapshot)
#
# URL: /api/admin/fees/ledger/

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_GET

from receipts.models import Receipt


def _cents_to_decimal(cents: int) -> Decimal:
    return (Decimal(int(cents or 0)) / Decimal("100")).quantize(Decimal("0.01"))


def _decimal_to_cents(amount: Decimal) -> int:
    amt = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((amt * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _expected_fee_cents_from_snapshot(r: Receipt) -> Optional[int]:
    """
    Expected fee (after agreement cap) computed from the stored snapshot.

    We store:
      - platform_fee_uncapped_cents (uncapped)
      - cap_remaining_cents (remaining cap BEFORE applying this payment)
    Expected applied fee = min(uncapped, cap_remaining)

    Returns None if insufficient snapshot.
    """
    uncapped = getattr(r, "platform_fee_uncapped_cents", None)
    remaining = getattr(r, "cap_remaining_cents", None)

    if uncapped is None:
        return None

    try:
        uncapped = int(uncapped)
    except Exception:
        return None

    if remaining is None:
        return max(uncapped, 0)

    try:
        remaining = int(remaining)
    except Exception:
        return max(uncapped, 0)

    if remaining < 0:
        remaining = 0

    return max(min(uncapped, remaining), 0)


def _parse_int(value: str, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _is_admin_user(user) -> bool:
    try:
        return bool(getattr(user, "is_authenticated", False)) and (
            bool(getattr(user, "is_superuser", False)) or bool(getattr(user, "is_staff", False))
        )
    except Exception:
        return False


@require_GET
def admin_fee_ledger(request):
    """
    GET /api/admin/fees/ledger/?start=YYYY-MM-DD&end=YYYY-MM-DD&contractor_id=123&mismatch_only=1&limit=500

    Returns:
      - rows: list of receipts with charged vs expected vs delta
      - summary totals
    """
    if not _is_admin_user(getattr(request, "user", None)):
        return JsonResponse({"detail": "Forbidden"}, status=403)

    start_s = (request.GET.get("start") or "").strip()
    end_s = (request.GET.get("end") or "").strip()
    contractor_id_s = (request.GET.get("contractor_id") or "").strip()
    mismatch_only = (request.GET.get("mismatch_only") or "").strip() in ("1", "true", "yes", "on")
    limit = _parse_int((request.GET.get("limit") or "500").strip(), default=500)
    limit = max(1, min(limit, 2000))

    start_date = parse_date(start_s) if start_s else None
    end_date = parse_date(end_s) if end_s else None

    qs = Receipt.objects.select_related(
        "invoice",
        "agreement",
        "invoice__agreement",
        "invoice__agreement__contractor",
    ).order_by("-created_at")

    if start_date:
        qs = qs.filter(created_at__date__gte=start_date)
    if end_date:
        qs = qs.filter(created_at__date__lte=end_date)

    if contractor_id_s:
        try:
            contractor_id = int(contractor_id_s)
            # Prefer receipt.agreement -> contractor; fallback to invoice.agreement -> contractor
            qs = qs.filter(invoice__agreement__contractor_id=contractor_id)
        except Exception:
            pass

    rows: List[Dict[str, Any]] = []
    totals = {
        "count": 0,
        "gross_cents": 0,
        "fee_charged_cents": 0,
        "fee_expected_cents": 0,
        "delta_cents": 0,
        "mismatch_count": 0,
    }

    for r in qs[:limit]:
        charged = int(getattr(r, "platform_fee_cents", 0) or 0)
        expected = _expected_fee_cents_from_snapshot(r)
        if expected is None:
            expected = charged  # if missing snapshot, treat as neutral (won't spam mismatches)

        delta = charged - expected

        is_mismatch = abs(delta) > 1  # > $0.01

        if mismatch_only and not is_mismatch:
            continue

        inv = getattr(r, "invoice", None)
        ag = getattr(r, "agreement", None) or getattr(inv, "agreement", None)
        contractor = getattr(ag, "contractor", None) if ag else None

        row = {
            "receipt_id": r.id,
            "receipt_number": getattr(r, "receipt_number", ""),
            "created_at": r.created_at.isoformat() if getattr(r, "created_at", None) else None,

            "invoice_id": getattr(inv, "id", None),
            "agreement_id": getattr(ag, "id", None),

            "contractor_id": getattr(contractor, "id", None),
            "contractor_name": (
                getattr(contractor, "business_name", None)
                or getattr(contractor, "name", None)
                or getattr(getattr(contractor, "user", None), "email", None)
                or ""
            ),

            "gross_cents": int(getattr(r, "amount_paid_cents", 0) or 0),
            "fee_charged_cents": charged,
            "fee_expected_cents": int(expected),
            "delta_cents": int(delta),
            "is_mismatch": bool(is_mismatch),

            "fee_plan_code": getattr(r, "fee_plan_code", None),
            "tier_name": getattr(r, "tier_name", None),
            "fee_engine_version": getattr(r, "fee_engine_version", None),

            "platform_fee_uncapped_cents": getattr(r, "platform_fee_uncapped_cents", None),
            "cap_total_cents": getattr(r, "cap_total_cents", None),
            "cap_already_collected_cents": getattr(r, "cap_already_collected_cents", None),
            "cap_remaining_cents": getattr(r, "cap_remaining_cents", None),

            "stripe_payment_intent_id": getattr(r, "stripe_payment_intent_id", None),
            "stripe_charge_id": getattr(r, "stripe_charge_id", None),
        }
        rows.append(row)

        totals["count"] += 1
        totals["gross_cents"] += row["gross_cents"]
        totals["fee_charged_cents"] += charged
        totals["fee_expected_cents"] += int(expected)
        totals["delta_cents"] += int(delta)
        if is_mismatch:
            totals["mismatch_count"] += 1

    # Friendly dollar totals
    summary = {
        **totals,
        "gross": str(_cents_to_decimal(totals["gross_cents"])),
        "fee_charged": str(_cents_to_decimal(totals["fee_charged_cents"])),
        "fee_expected": str(_cents_to_decimal(totals["fee_expected_cents"])),
        "delta": str(_cents_to_decimal(totals["delta_cents"])),
    }

    return JsonResponse({"rows": rows, "summary": summary}, status=200)
