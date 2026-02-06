# backend/projects/services/agreements/refunds.py
from __future__ import annotations

import sys
from typing import Optional, List, Dict, Any, Tuple

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Milestone, Invoice


def _stripe_init_or_raise(stripe_mod):
    if stripe_mod is None:
        raise RuntimeError("stripe library not installed.")
    key = getattr(settings, "STRIPE_SECRET_KEY", None)
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured.")
    stripe_mod.api_key = key


def agreement_payment_intent_id(ag: Agreement) -> Optional[str]:
    for fname in (
        "escrow_payment_intent_id",
        "stripe_payment_intent_id",
        "payment_intent_id",
        "escrow_funding_payment_intent_id",
        "stripe_pi_id",
    ):
        if hasattr(ag, fname):
            val = getattr(ag, fname, None)
            if val:
                return str(val)
    return None


def is_owner_or_admin_for_agreement(request, ag: Agreement) -> bool:
    u = request.user
    if not u or not u.is_authenticated:
        return False
    if getattr(u, "is_staff", False) or getattr(u, "is_superuser", False):
        return True

    contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
    if contractor_user and u == contractor_user:
        role = getattr(u, "role", None)
        if role:
            return str(role).lower() in {"contractor_owner", "owner", "admin"}
        return True
    return False


def milestone_amount_cents(m: Milestone) -> int:
    if hasattr(m, "amount_cents") and getattr(m, "amount_cents", None) is not None:
        return int(getattr(m, "amount_cents") or 0)
    amt = getattr(m, "amount", None) or 0
    try:
        return int(round(float(amt) * 100))
    except Exception:
        return 0


def milestone_started(m: Milestone) -> bool:
    if hasattr(m, "started") and bool(getattr(m, "started")):
        return True
    if hasattr(m, "started_at") and getattr(m, "started_at", None):
        return True
    if bool(getattr(m, "completed", False)):
        return True
    if bool(getattr(m, "is_invoiced", False)):
        return True
    if getattr(m, "invoice_id", None):
        return True

    st = str(getattr(m, "status", "") or "").lower()
    if st in {"in_progress", "started"}:
        return True
    return False


def milestone_refunded_or_removed(m: Milestone) -> bool:
    if hasattr(m, "descope_status"):
        ds = str(getattr(m, "descope_status", "") or "").lower()
        if ds == "refunded":
            return True

    st = str(getattr(m, "status", "") or "").lower()
    if st in {"descoped_refunded", "refunded", "removed", "descoped"}:
        return True
    if hasattr(m, "descoped") and bool(getattr(m, "descoped")):
        return True
    return False


def milestone_disputed(m: Milestone) -> bool:
    st = str(getattr(m, "status", "") or "").lower()
    if "disput" in st:
        return True
    if hasattr(m, "is_disputed") and bool(getattr(m, "is_disputed")):
        return True
    return False


def _invoice_queryset_for_agreement(ag: Agreement):
    try:
        return ag.invoices.all()
    except Exception:
        try:
            return ag.invoice_set.all()
        except Exception:
            return Invoice.objects.filter(agreement=ag)


def build_refund_preview(request, ag: Agreement, stripe_mod) -> Tuple[Dict[str, Any], int]:
    if not is_owner_or_admin_for_agreement(request, ag):
        return {"detail": "Not allowed. Owner/admin only."}, 403

    if not getattr(ag, "escrow_funded", False):
        return {"detail": "Escrow is not funded for this agreement."}, 400

    # Funded total
    funded_total = 0
    if hasattr(ag, "escrow_funded_amount"):
        try:
            funded_total = int(round(float(getattr(ag, "escrow_funded_amount") or 0) * 100))
        except Exception:
            funded_total = 0
    if funded_total <= 0:
        funded_total = sum(milestone_amount_cents(m) for m in Milestone.objects.filter(agreement=ag))

    inv_qs = _invoice_queryset_for_agreement(ag)

    invoice_by_id = {}
    try:
        for inv in inv_qs:
            invoice_by_id[getattr(inv, "id", None)] = inv
    except Exception:
        pass

    released_invoice_ids = set()
    try:
        released_invoice_ids |= set(inv_qs.filter(escrow_released=True).values_list("id", flat=True))
    except Exception:
        pass
    try:
        released_invoice_ids |= set(inv_qs.filter(status="paid").values_list("id", flat=True))
    except Exception:
        pass
    try:
        released_invoice_ids |= set(inv_qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).values_list("id", flat=True))
    except Exception:
        pass
    try:
        released_invoice_ids |= set(inv_qs.exclude(escrow_released_at__isnull=True).values_list("id", flat=True))
    except Exception:
        pass

    stripe_remaining = None
    pi_id = agreement_payment_intent_id(ag)
    if pi_id:
        try:
            _stripe_init_or_raise(stripe_mod)
            pi = stripe_mod.PaymentIntent.retrieve(pi_id)
            received = int(pi.get("amount_received") or 0)
            refunded = int(pi.get("amount_refunded") or 0)
            stripe_remaining = max(0, received - refunded)
        except Exception:
            stripe_remaining = None

    qs = Milestone.objects.filter(agreement=ag).order_by("order", "id")

    milestones_payload: List[Dict[str, Any]] = []
    released_total = 0
    unreleased_total = 0

    for m in qs:
        amount_cents = milestone_amount_cents(m)
        started = milestone_started(m)
        refunded = milestone_refunded_or_removed(m)

        released_cents = 0
        unreleased_cents = amount_cents

        inv_id = getattr(m, "invoice_id", None)
        if inv_id:
            inv_obj = invoice_by_id.get(inv_id)
            if inv_id in released_invoice_ids or (
                inv_obj
                and (
                    getattr(inv_obj, "escrow_released", False) is True
                    or str(getattr(inv_obj, "status", "") or "").lower() == "paid"
                    or getattr(inv_obj, "escrow_released_at", None)
                    or (getattr(inv_obj, "stripe_transfer_id", None) not in (None, ""))
                )
            ):
                released_cents = amount_cents
                unreleased_cents = 0

        if refunded:
            released_cents = 0
            unreleased_cents = 0

        released_total += int(released_cents)
        unreleased_total += int(unreleased_cents)

        refundable = True
        reason = None

        if refunded:
            refundable = False
            reason = "Milestone already refunded."
        elif started:
            refundable = False
            reason = "Work started (completed/invoiced). Use dispute flow."
        elif milestone_disputed(m):
            refundable = False
            reason = "Milestone is disputed. Use dispute resolution."
        elif amount_cents <= 0:
            refundable = False
            reason = "Invalid milestone amount."
        elif unreleased_cents <= 0:
            refundable = False
            reason = "No unreleased escrow remaining for this milestone."
        elif stripe_remaining is not None and unreleased_cents > stripe_remaining:
            refundable = False
            reason = "Not enough refundable balance remaining on Stripe."

        ds = str(getattr(m, "descope_status", "") or "").lower() if hasattr(m, "descope_status") else ""
        if ds == "refunded":
            st = "descoped_refunded"
        elif released_cents > 0:
            st = "paid"
        elif refundable:
            st = "funded_unstarted"
        elif started:
            st = "started"
        else:
            st = "unknown"

        milestones_payload.append(
            {
                "id": m.id,
                "title": getattr(m, "title", None) or f"Milestone #{m.id}",
                "amount_cents": amount_cents,
                "funded_cents": amount_cents,
                "released_cents": int(released_cents),
                "unreleased_cents": int(unreleased_cents),
                "status": st,
                "refundable": refundable,
                "refund_block_reason": reason,
                "descope_status": getattr(m, "descope_status", None) if hasattr(m, "descope_status") else None,
            }
        )

    resp: Dict[str, Any] = {
        "agreement_id": ag.id,
        "currency": "usd",
        "owner_only": True,
        "has_releases": bool(released_total > 0),
        "escrow": {
            "funded_total_cents": int(funded_total),
            "already_released_total_cents": int(released_total),
            "unreleased_total_cents": int(max(unreleased_total, 0)),
        },
        "stripe": {"remaining_refundable_cents": stripe_remaining} if stripe_remaining is not None else None,
        "milestones": milestones_payload,
        "notes": [
            "Released amounts are computed from invoices with escrow released / paid status.",
            "Refunds apply only to unreleased escrow.",
            "If work has started (completed/invoiced), refunds must go through dispute resolution.",
        ],
    }
    return resp, 200


def execute_refund(request, ag: Agreement, stripe_mod) -> Tuple[Dict[str, Any], int]:
    if not is_owner_or_admin_for_agreement(request, ag):
        return {"detail": "Not allowed. Owner/admin only."}, 403

    if not getattr(ag, "escrow_funded", False):
        return {"detail": "Escrow is not funded for this agreement."}, 400

    confirm = str(request.data.get("confirm", "")).strip().upper()
    if confirm != "REFUND":
        return {"detail": "Confirmation required. Type REFUND."}, 400

    milestone_ids = request.data.get("milestone_ids") or []
    if not isinstance(milestone_ids, list) or len(milestone_ids) == 0:
        return {"detail": "milestone_ids must be a non-empty list."}, 400

    qs = Milestone.objects.filter(agreement=ag, id__in=milestone_ids).order_by("order", "id")
    found_ids = set(m.id for m in qs)
    wanted_ids = set(int(x) for x in milestone_ids if str(x).isdigit())

    missing = sorted(list(wanted_ids - found_ids))
    if missing:
        return {"detail": f"Milestone(s) not found on this agreement: {missing}"}, 400

    funded_total = 0
    if hasattr(ag, "escrow_funded_amount"):
        try:
            funded_total = int(round(float(getattr(ag, "escrow_funded_amount") or 0) * 100))
        except Exception:
            funded_total = 0
    if funded_total <= 0:
        funded_total = sum(milestone_amount_cents(m) for m in Milestone.objects.filter(agreement=ag))

    inv_qs = _invoice_queryset_for_agreement(ag)

    released_ids = set()
    try:
        released_ids |= set(inv_qs.filter(escrow_released=True).values_list("id", flat=True))
    except Exception:
        pass
    try:
        released_ids |= set(inv_qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).values_list("id", flat=True))
    except Exception:
        pass

    released_total = 0
    if released_ids:
        for inv in inv_qs.filter(id__in=list(released_ids)):
            try:
                released_total += int(round(float(getattr(inv, "amount", 0) or 0) * 100))
            except Exception:
                pass

    unreleased_total = max(0, funded_total - released_total)

    pi_id = agreement_payment_intent_id(ag)
    if not pi_id:
        return {"detail": "Agreement has no PaymentIntent on record. Cannot refund."}, 400

    try:
        _stripe_init_or_raise(stripe_mod)
        pi = stripe_mod.PaymentIntent.retrieve(pi_id)
        received = int(pi.get("amount_received") or 0)
        already_refunded = int(pi.get("amount_refunded") or 0)
        stripe_remaining = max(0, received - already_refunded)
    except Exception as e:
        return {"detail": f"Stripe not ready: {e}"}, 500

    blocked = []
    refundable_rows = []
    refund_total_cents = 0

    for m in qs:
        amount_cents = milestone_amount_cents(m)
        started = milestone_started(m)
        refunded = milestone_refunded_or_removed(m)

        if refunded:
            blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Already refunded."})
            continue
        if started:
            blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Work started (completed/invoiced). Use dispute flow."})
            continue
        if milestone_disputed(m):
            blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Milestone is disputed."})
            continue
        if amount_cents <= 0:
            blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Invalid milestone amount."})
            continue

        refundable_rows.append((m, amount_cents))
        refund_total_cents += amount_cents

    if blocked:
        return {"detail": "One or more selected milestones cannot be refunded.", "blocked": blocked}, 400

    if refund_total_cents <= 0:
        return {"detail": "Nothing to refund."}, 400

    if refund_total_cents > unreleased_total:
        return {
            "detail": "Refund exceeds remaining unreleased escrow.",
            "requested_refund_cents": int(refund_total_cents),
            "unreleased_escrow_cents": int(unreleased_total),
        }, 400

    if refund_total_cents > stripe_remaining:
        return {
            "detail": "Refund exceeds remaining refundable amount on Stripe PaymentIntent.",
            "requested_refund_cents": int(refund_total_cents),
            "stripe_remaining_refundable_cents": int(stripe_remaining),
        }, 400

    mid_part = "_".join(str(m.id) for m, _amt in refundable_rows)
    idempotency_key = f"mhb_refund_agreement_{ag.id}_{mid_part}"

    try:
        with transaction.atomic():
            refund_obj = stripe_mod.Refund.create(
                payment_intent=pi_id,
                amount=int(refund_total_cents),
                reason="requested_by_customer",
                idempotency_key=idempotency_key,
                metadata={
                    "agreement_id": str(ag.id),
                    "milestone_ids": ",".join(str(m.id) for m, _amt in refundable_rows),
                    "requested_by_user_id": str(request.user.id),
                    "requested_by_email": getattr(request.user, "email", "") or "",
                    "type": "agreement_level_refund",
                },
            )

            ts = timezone.now()
            for m, amt in refundable_rows:
                if hasattr(m, "descope_status"):
                    m.descope_status = "refunded"
                if hasattr(m, "status"):
                    m.status = "descoped_refunded"
                if hasattr(m, "descoped"):
                    m.descoped = True
                if hasattr(m, "descoped_at"):
                    m.descoped_at = ts
                if hasattr(m, "refunded_at"):
                    m.refunded_at = ts
                if hasattr(m, "refunded_cents"):
                    m.refunded_cents = int(amt)
                if hasattr(m, "refund_amount_cents"):
                    m.refund_amount_cents = int(amt)
                if hasattr(m, "descope_decision_at"):
                    m.descope_decision_at = ts
                if hasattr(m, "descope_decision_note"):
                    m.descope_decision_note = "Refunded via agreement refund tool."
                m.save()

    except Exception as e:
        msg = getattr(e, "user_message", None) or str(e)
        return {"detail": f"Refund failed: {msg}"}, 400

    return {
        "message": f"Refund submitted for ${refund_total_cents/100:.2f}.",
        "refund_total_cents": int(refund_total_cents),
        "currency": "usd",
        "stripe_refund_id": getattr(refund_obj, "id", None) if hasattr(refund_obj, "id") else refund_obj.get("id"),
        "milestone_ids": [m.id for m, _amt in refundable_rows],
    }, 200
