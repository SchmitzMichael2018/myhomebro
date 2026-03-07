# backend/projects/services/direct_pay.py
# v2026-03-03 — Option A: Agreement is source-of-truth for customer in Direct Pay
# - Checkout Session uses customer_email from agreement.homeowner.email
# - Adds receipt_email to PaymentIntent (best effort) + metadata customer fields
# - Keeps pricing + idempotency + locking unchanged

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Tuple

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import Invoice, InvoiceStatus

# ✅ canonical agreement completion recompute
from projects.services.agreement_completion import recompute_and_apply_agreement_completion

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


def _get_agreement_customer(agreement) -> Tuple[Optional[object], str, str]:
    """
    Option A:
    Agreement.homeowner is canonical "Customer". Fallback to agreement.project.homeowner for legacy.

    Returns: (customer_obj, customer_email, customer_name)
    """
    if not agreement:
        return (None, "", "")

    customer = getattr(agreement, "homeowner", None) or getattr(agreement, "customer", None)
    if not customer:
        project = getattr(agreement, "project", None)
        customer = getattr(project, "homeowner", None) if project else None

    email = getattr(customer, "email", "") if customer else ""
    name = (
        getattr(customer, "full_name", None)
        or getattr(customer, "name", None)
        or getattr(customer, "display_name", None)
        or email
        or ""
    )
    return (customer, str(email or "").strip(), str(name or "").strip())


def create_direct_pay_checkout_for_invoice(invoice: Invoice) -> str:
    """
    Create (or reuse) a Stripe Checkout Session that pays directly to the contractor's
    Stripe Connect account.

    This is NOT escrow. Funds go to the contractor account at payment time.

    Pricing (LOCKED):
      - Free plan: 2% + $1
      - AI Pro:    1% + $1

    Option A:
      - The payer identity should follow agreement.homeowner (customer)
      - We pass customer_email + receipt_email where possible

    Idempotent behavior:
    - If invoice already has a direct_pay_checkout_url and is not paid, return it.
    - Uses select_for_update to prevent double-creation on concurrent requests.
    """

    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("STRIPE_SECRET_KEY not configured.")

    agreement = getattr(invoice, "agreement", None)
    if not agreement:
        raise ValueError("Invoice has no agreement.")

    # Direct Pay driven by agreement.payment_mode
    if str(getattr(agreement, "payment_mode", "") or "").lower() != "direct":
        raise ValueError("Agreement is not in Direct Pay mode (payment_mode != 'direct').")

    contractor = getattr(agreement, "contractor", None)
    if not contractor:
        raise ValueError("Agreement has no contractor.")
    if not str(getattr(contractor, "stripe_account_id", "") or "").strip():
        raise ValueError("Contractor has no Stripe Connect account (stripe_account_id missing).")

    amount_cents = _to_cents(getattr(invoice, "amount", None))
    if amount_cents <= 0:
        raise ValueError("Invoice amount must be greater than 0.")

    frontend_url = _frontend_url()
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

    is_ai_pro = _is_ai_pro(contractor)
    application_fee_amount = _compute_direct_pay_fee_cents(amount_cents, is_ai_pro=is_ai_pro)

    try:
        import stripe  # type: ignore
    except Exception:
        raise ValueError("Stripe SDK not installed on server.")

    stripe.api_key = stripe_key

    with transaction.atomic():
        inv = (
            Invoice.objects
            .select_for_update()
            .select_related("agreement", "agreement__contractor", "agreement__project", "agreement__homeowner")
            .get(pk=invoice.pk)
        )

        # If already paid, block
        if _is_paid(inv) or inv.status == InvoiceStatus.PAID:
            raise ValueError("Invoice is already PAID.")

        # If link already exists, reuse
        existing_url = str(getattr(inv, "direct_pay_checkout_url", "") or "").strip()
        if existing_url:
            return existing_url

        # ✅ Option A customer identity (from agreement)
        agreement_locked = getattr(inv, "agreement", None)
        _cust_obj, customer_email, customer_name = _get_agreement_customer(agreement_locked)

        if not customer_email:
            # We can still create a session, but it will be worse UX. Fail fast for consistency.
            raise ValueError("Agreement customer email is missing. Set the Customer email before creating Direct Pay link.")

        # Create Checkout session
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                payment_method_types=["card"],

                # ✅ This pre-fills email on Stripe Checkout and ties receipts to customer email
                customer_email=customer_email,

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
                    "customer_email": customer_email,
                    "customer_name": customer_name,
                },
                success_url=success_url,
                cancel_url=cancel_url,
                payment_intent_data={
                    "transfer_data": {"destination": contractor.stripe_account_id},
                    "application_fee_amount": int(application_fee_amount),

                    # ✅ Best-effort: makes Stripe send receipts to this email (if enabled)
                    "receipt_email": customer_email,

                    "metadata": {
                        "kind": "direct_pay_checkout",
                        "invoice_id": str(inv.id),
                        "invoice_number": str(inv.invoice_number),
                        "agreement_id": str(inv.agreement_id),
                        "customer_email": customer_email,
                    },
                },
            )
        except Exception as e:
            log.exception("Direct Pay: Stripe checkout create failed (invoice_id=%s)", getattr(inv, "id", None))
            raise ValueError(f"Stripe error: {str(e)}")

        session_id = getattr(session, "id", None) or (session.get("id") if isinstance(session, dict) else "")
        session_url = getattr(session, "url", None) or (session.get("url") if isinstance(session, dict) else "")

        # Capture payment_intent if Stripe returns it on session
        payment_intent_id = getattr(session, "payment_intent", None) or (
            session.get("payment_intent") if isinstance(session, dict) else ""
        )

        if not session_url:
            raise ValueError("Stripe did not return a checkout URL.")

        inv.direct_pay_checkout_session_id = session_id or ""
        inv.direct_pay_checkout_url = session_url or ""
        if hasattr(inv, "direct_pay_payment_intent_id") and payment_intent_id:
            inv.direct_pay_payment_intent_id = str(payment_intent_id)
        inv.status = InvoiceStatus.SENT

        update_fields = ["direct_pay_checkout_session_id", "direct_pay_checkout_url", "status"]
        if hasattr(inv, "direct_pay_payment_intent_id") and payment_intent_id:
            update_fields.append("direct_pay_payment_intent_id")

        inv.save(update_fields=update_fields)

        return inv.direct_pay_checkout_url


def finalize_direct_pay_invoice_paid(
    *,
    invoice_id: Optional[int] = None,
    invoice_number: Optional[str] = None,
    checkout_session_id: Optional[str] = None,
    payment_intent_id: Optional[str] = None,
    paid_at: Optional[timezone.datetime] = None,
) -> Invoice:
    """
    Canonical helper for Stripe webhook handler(s).
    Marks the invoice PAID and stamps direct_pay_paid_at, then recomputes agreement completion.

    You can locate the invoice by:
      - invoice_id (preferred)
      - invoice_number
      - checkout_session_id
      - payment_intent_id (if stored)
    """
    if not any([invoice_id, invoice_number, checkout_session_id, payment_intent_id]):
        raise ValueError("Must provide at least one identifier to finalize direct pay invoice.")

    paid_at = paid_at or timezone.now()

    with transaction.atomic():
        qs = Invoice.objects.select_for_update().all()

        inv = None
        if invoice_id:
            inv = qs.filter(id=invoice_id).first()
        if inv is None and invoice_number:
            inv = qs.filter(invoice_number=invoice_number).first()
        if inv is None and checkout_session_id:
            inv = qs.filter(direct_pay_checkout_session_id=checkout_session_id).first()
        if inv is None and payment_intent_id:
            inv = qs.filter(direct_pay_payment_intent_id=payment_intent_id).first()

        if inv is None:
            raise ValueError("Invoice not found for direct pay finalization.")

        # Idempotent: if already paid, ensure fields are set and return.
        already_paid = _is_paid(inv) or inv.status == InvoiceStatus.PAID

        inv.status = InvoiceStatus.PAID
        if hasattr(inv, "direct_pay_paid_at") and not getattr(inv, "direct_pay_paid_at", None):
            inv.direct_pay_paid_at = paid_at

        if payment_intent_id and hasattr(inv, "direct_pay_payment_intent_id"):
            # Store for audit/traceability if not already set
            if not (getattr(inv, "direct_pay_payment_intent_id", "") or "").strip():
                inv.direct_pay_payment_intent_id = str(payment_intent_id)

        update_fields = ["status"]
        if hasattr(inv, "direct_pay_paid_at"):
            update_fields.append("direct_pay_paid_at")
        if payment_intent_id and hasattr(inv, "direct_pay_payment_intent_id"):
            update_fields.append("direct_pay_payment_intent_id")

        inv.save(update_fields=list(set(update_fields)))

    # recompute agreement completion after invoice becomes paid
    try:
        if getattr(inv, "agreement_id", None):
            recompute_and_apply_agreement_completion(int(inv.agreement_id))
    except Exception as exc:
        log.warning("Agreement completion recompute failed for direct pay invoice %s: %s", getattr(inv, "id", None), exc)

    inv.refresh_from_db()
    return inv