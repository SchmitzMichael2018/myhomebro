from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from payments.models import Payment, Refund
from projects.models import Agreement, InvoiceStatus
from projects.services.escrow_reimbursements import agreement_has_escrow_hold, incidentals_reserve_summary

logger = logging.getLogger(__name__)

AUTO_REFUND_REASON = "unused_incidentals_reserve"


def _cents(value) -> int:
    return int((Decimal(str(value or "0")) * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _final_milestone_release_at(agreement: Agreement):
    # Warranty and dispute-rework milestones are standalone $0 service records.
    # They may be appended after the paid project scope and must not replace the
    # last billable milestone when determining contingency-return eligibility.
    final_milestone = (
        agreement.milestones.filter(amount__gt=0)
        .order_by("-order", "-id")
        .select_related("invoice")
        .first()
    )
    if not final_milestone or not final_milestone.invoice_id:
        return None
    invoice = final_milestone.invoice
    if not (
        invoice.escrow_released
        or invoice.escrow_released_at
        or invoice.stripe_transfer_id
        or str(invoice.status or "").lower() == InvoiceStatus.PAID
    ):
        return None
    return invoice.escrow_released_at or invoice.approved_at


def contingency_refund_eligibility(agreement: Agreement, *, now=None, grace_days: int | None = None) -> dict:
    now = now or timezone.now()
    grace_days = grace_days if grace_days is not None else int(getattr(settings, "CONTINGENCY_AUTO_REFUND_GRACE_DAYS", 5))
    reserve = incidentals_reserve_summary(agreement)
    remaining_cents = _cents(reserve.get("remaining"))
    existing_cents = sum(
        Refund.objects.filter(
            payment__agreement=agreement,
            reason=AUTO_REFUND_REASON,
            status__in=["pending", "succeeded"],
        ).values_list("amount_cents", flat=True)
    )
    refundable_cents = max(remaining_cents - int(existing_cents or 0), 0)
    release_at = _final_milestone_release_at(agreement)
    eligible_at = release_at + timedelta(days=grace_days) if release_at else None

    blockers = []
    if str(getattr(agreement, "payment_mode", "") or "").lower() != "escrow":
        blockers.append("not_escrow")
    if remaining_cents <= 0:
        blockers.append("no_unused_contingency")
    if reserve.get("pending", Decimal("0.00")) > Decimal("0.00"):
        blockers.append("pending_contingency_request")
    if agreement_has_escrow_hold(agreement):
        blockers.append("escrow_hold")
    if release_at is None:
        blockers.append("final_milestone_not_paid")
    elif eligible_at > now:
        blockers.append("grace_period")
    if refundable_cents <= 0:
        blockers.append("already_refunded_or_pending")

    return {
        "eligible": not blockers,
        "blockers": blockers,
        "remaining_cents": remaining_cents,
        "refundable_cents": refundable_cents,
        "eligible_at": eligible_at,
    }


def auto_refund_unused_contingency(agreement: Agreement, *, now=None, grace_days: int | None = None) -> dict:
    check = contingency_refund_eligibility(agreement, now=now, grace_days=grace_days)
    if not check["eligible"]:
        return {"status": "skipped", **check}

    stripe.api_key = settings.STRIPE_SECRET_KEY
    remaining = int(check["refundable_cents"])
    results = []
    payments = Payment.objects.filter(
        agreement=agreement,
        status="succeeded",
    ).exclude(stripe_payment_intent_id__isnull=True).exclude(stripe_payment_intent_id="").order_by("-created_at", "-id")

    with transaction.atomic():
        locked = Agreement.objects.select_for_update().get(pk=agreement.pk)
        locked_check = contingency_refund_eligibility(locked, now=now, grace_days=grace_days)
        if not locked_check["eligible"]:
            return {"status": "skipped", **locked_check}
        remaining = int(locked_check["refundable_cents"])

        for payment in payments:
            if remaining <= 0:
                break
            refunded = sum(payment.refunds.filter(status__in=["pending", "succeeded"]).values_list("amount_cents", flat=True))
            available = max(int(payment.amount_cents or 0) - int(refunded or 0), 0)
            amount = min(remaining, available)
            if amount <= 0:
                continue
            row = Refund.objects.create(
                payment=payment,
                amount_cents=amount,
                currency=payment.currency or "usd",
                reason=AUTO_REFUND_REASON,
                note=f"Automatic return of unused contingency after {grace_days if grace_days is not None else getattr(settings, 'CONTINGENCY_AUTO_REFUND_GRACE_DAYS', 5)}-day closeout grace period.",
                status="pending",
            )
            try:
                remote = stripe.Refund.create(
                    payment_intent=payment.stripe_payment_intent_id,
                    amount=amount,
                    metadata={"agreement_id": str(agreement.id), "refund_db_id": str(row.id), "reason": AUTO_REFUND_REASON},
                    idempotency_key=f"mhb_unused_contingency_ag_{agreement.id}_refund_{row.id}",
                )
                row.stripe_refund_id = getattr(remote, "id", "") or ""
                row.status = str(getattr(remote, "status", "pending") or "pending").lower()
                row.save(update_fields=["stripe_refund_id", "status"])
                results.append({"refund_id": row.id, "amount_cents": amount, "status": row.status})
                remaining -= amount
            except Exception as exc:
                row.status = "failed"
                row.error_message = type(exc).__name__
                row.save(update_fields=["status", "error_message"])
                logger.exception("Unused contingency refund failed for agreement %s", agreement.id)
                return {"status": "failed", "agreement_id": agreement.id, "remaining_cents": remaining}

    return {"status": "requested", "agreement_id": agreement.id, "refunded_cents": int(check["refundable_cents"]) - remaining, "results": results}


def process_due_contingency_refunds(*, now=None) -> dict:
    now = now or timezone.now()
    totals = {"checked": 0, "requested": 0, "skipped": 0, "failed": 0}
    agreements = Agreement.objects.filter(incidentals_reserve_amount__gt=0, payment_mode="escrow").order_by("id")
    for agreement in agreements.iterator():
        totals["checked"] += 1
        result = auto_refund_unused_contingency(agreement, now=now)
        status = result.get("status", "failed")
        totals[status if status in totals else "failed"] += 1
    return totals
