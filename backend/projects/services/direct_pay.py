# backend/projects/services/direct_pay.py

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction

from projects.models import Invoice, InvoiceStatus

log = logging.getLogger(__name__)


def _to_cents(amount) -> int:
    """
    Convert Decimal dollars to integer cents.
    Uses Decimal arithmetic to avoid float drift.
    """
    if amount is None:
        return 0
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _is_paid(invoice: Invoice) -> bool:
    """
    Treat invoice as paid if:
    - status == PAID (or contains 'paid')
    - OR direct_pay_paid_at is set (webhook sets this)
    """
    try:
        st = str(getattr(invoice, "status", "") or "").lower()
        if st == "paid" or "paid" in st:
            return True
    except Exception:
        pass

    try:
        if getattr(invoice, "direct_pay_paid_at", None):
            return True
    except Exception:
        pass

    return False


def _frontend_url() -> str:
    """
    Optional. Used for success/cancel.
    """
    v = str(getattr(settings, "FRONTEND_URL", "") or "").strip()
    return v.rstrip("/") if v else ""


def _is_ai_pro(contractor) -> bool:
    """
    v1 subscription flag check (tolerant):
    - contractor.ai_subscription_active (if you add it directly)
    - contractor.billing_profile.ai_subscription_active (recommended)
    """
    if contractor is None:
        return False

    try:
        if getattr(contractor, "ai_subscription_active", False) is True:
            return True
    except Exception:
        pass

    try:
        bp = getattr(contractor, "billing_profile", None)
        if bp and getattr(bp, "ai_subscription_active", False) is True:
            return True
    except Exception:
        pass

    return False


def _compute_direct_pay_fee_cents(amount_cents: int, *, is_ai_pro: bool) -> int:
    """
    LOCKED PRICING:

    - Free plan: 2% + $1
    - AI Pro:    1% + $1

    Returns Stripe application_fee_amount in cents.
    """
    if amount_cents <= 0:
        return 0

    rate = Decimal("0.01") if is_ai_pro else Decimal("0.02")
    pct_fee = (Decimal(amount_cents) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    flat_fee = Decimal("100")  # $1.00

    total = int(pct_fee + flat_fee)

    # Safety: never exceed invoice amount
    if total > amount_cents:
        total = amount_cents
    if total < 0:
        total = 0

    return total


def create_direct_pay_checkout_for_invoice(invoice: Invoice) -> str:
    """
    Create (or reuse) a Stripe Checkout Session that pays directly to the contractor's
    Stripe Connect account.

    This is NOT escrow. Funds go to the contractor account at payment time.

    Pricing (LOCKED):
      - Free plan: 2% + $1
      - AI Pro:    1% + $1

    Idempotent behavior:
    - If invoice already has a direct_pay_checkout_url and is not paid, return it.
    - Uses select_for_update to prevent double-creation on concurrent requests.
    """

    # Stripe key
    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("STRIPE_SECRET_KEY not configured.")

    agreement = getattr(invoice, "agreement", None)
    if not agreement:
        raise ValueError("Invoice has no agreement.")

    # ✅ Direct Pay driven by agreement.payment_mode
    if str(getattr(agreement, "payment_mode", "") or "").lower() != "direct":
        raise ValueError("Agreement is not in Direct Pay mode (payment_mode != 'direct').")

    contractor = getattr(agreement, "contractor", None)
    if not contractor:
        raise ValueError("Agreement has no contractor.")
    if not str(getattr(contractor, "stripe_account_id", "") or "").strip():
        raise ValueError("Contractor has no Stripe Connect account (stripe_account_id missing).")

    # Amount validation
    amount_cents = _to_cents(getattr(invoice, "amount", None))
    if amount_cents <= 0:
        raise ValueError("Invoice amount must be greater than 0.")

    # Success/cancel URLs
    frontend_url = _frontend_url()
    # Don’t hard-fail if FRONTEND_URL missing; provide safe placeholders.
    # (Webhook is the real source of truth.)
    success_url = (
        f"{frontend_url}/invoice-paid?invoice={invoice.invoice_number}&session_id={{CHECKOUT_SESSION_ID}}"
        if frontend_url
        else "https://example.com/invoice-paid?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = (
        f"{frontend_url}/invoice-canceled?invoice={invoice.invoice_number}"
        if frontend_url
        else "https://example.com/invoice-canceled"
    )

    project_title = ""
    try:
        project_title = getattr(getattr(agreement, "project", None), "title", "") or ""
    except Exception:
        project_title = ""

    # ✅ NEW: Direct Pay fee logic (locked pricing)
    is_ai_pro = _is_ai_pro(contractor)
    application_fee_amount = _compute_direct_pay_fee_cents(amount_cents, is_ai_pro=is_ai_pro)

    # Import stripe safely
    try:
        import stripe  # type: ignore
    except Exception:
        raise ValueError("Stripe SDK not installed on server.")

    stripe.api_key = stripe_key

    # ------------------------------------------------------------------
    # ✅ Idempotent + concurrency-safe creation
    # ------------------------------------------------------------------
    with transaction.atomic():
        inv = (
            Invoice.objects
            .select_for_update()
            .select_related("agreement", "agreement__contractor", "agreement__project")
            .get(pk=invoice.pk)
        )

        # If already paid, block
        if _is_paid(inv) or inv.status == InvoiceStatus.PAID:
            raise ValueError("Invoice is already PAID.")

        # If link already exists, reuse (prevents multi-sessions)
        existing_url = str(getattr(inv, "direct_pay_checkout_url", "") or "").strip()
        if existing_url:
            return existing_url

        # Create Checkout session
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                payment_method_types=["card"],  # add ACH later if desired
                line_items=[
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": "usd",
                            "unit_amount": int(amount_cents),
                            "product_data": {
                                "name": f"Invoice {inv.invoice_number}",
                                "description": project_title or "MyHomeBro Invoice",
                            },
                        },
                    }
                ],
                metadata={
                    "invoice_id": str(inv.id),
                    "invoice_number": str(inv.invoice_number),
                    "agreement_id": str(inv.agreement_id),
                    "payment_mode": "DIRECT",
                },
                success_url=success_url,
                cancel_url=cancel_url,
                payment_intent_data={
                    # ✅ Destination charge → contractor receives funds directly
                    "transfer_data": {"destination": contractor.stripe_account_id},
                    # ✅ MyHomeBro fee (locked pricing)
                    "application_fee_amount": int(application_fee_amount),
                },
            )
        except Exception as e:
            log.exception("Direct Pay: Stripe checkout create failed (invoice_id=%s)", getattr(inv, "id", None))
            raise ValueError(f"Stripe error: {str(e)}")

        session_id = getattr(session, "id", None) or (session.get("id") if isinstance(session, dict) else "")
        session_url = getattr(session, "url", None) or (session.get("url") if isinstance(session, dict) else "")

        if not session_url:
            raise ValueError("Stripe did not return a checkout URL.")

        # Persist session + URL
        inv.direct_pay_checkout_session_id = session_id or ""
        inv.direct_pay_checkout_url = session_url or ""
        inv.status = InvoiceStatus.SENT
        inv.save(update_fields=["direct_pay_checkout_session_id", "direct_pay_checkout_url", "status"])

        return inv.direct_pay_checkout_url
