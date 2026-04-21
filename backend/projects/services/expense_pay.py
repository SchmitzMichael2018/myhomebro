# backend/projects/services/expense_pay.py
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction

from projects.models import ExpenseRequest
from payments.fees import calculate_platform_fee

log = logging.getLogger(__name__)


def _to_cents(amount) -> int:
    if amount is None:
        return 0
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _frontend_url() -> str:
    v = str(getattr(settings, "FRONTEND_URL", "") or "").strip()
    return v.rstrip("/") if v else ""


def create_expense_checkout_session(expense: ExpenseRequest, *, token: str = "") -> str:
    """
    Creates a Stripe Checkout Session for an ExpenseRequest.

    - Destination charge → contractor receives funds immediately (Direct Pay style).
    - Adds metadata.expense_request_id for webhook.
    - ALSO adds PaymentIntent metadata so payment_intent.succeeded can update it.
    - If expense is already PAID, blocks.
    """
    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("STRIPE_SECRET_KEY not configured.")

    # paid guard
    if str(getattr(expense, "status", "") or "").lower() == "paid" or getattr(expense, "paid_at", None):
        raise ValueError("Expense is already PAID.")

    agreement = getattr(expense, "agreement", None)
    if not agreement:
        raise ValueError("ExpenseRequest has no agreement.")

    contractor = getattr(agreement, "contractor", None)
    if not contractor:
        raise ValueError("Agreement has no contractor.")

    stripe_acct = str(getattr(contractor, "stripe_account_id", "") or "").strip()
    if not stripe_acct:
        raise ValueError("Contractor has no Stripe Connect account (stripe_account_id missing).")

    amount_cents = _to_cents(getattr(expense, "amount", None))
    if amount_cents <= 0:
        raise ValueError("Expense amount must be greater than 0.")

    frontend_url = _frontend_url()
    success_url = (
        f"{frontend_url}/expense-paid?expense={expense.id}&session_id={{CHECKOUT_SESSION_ID}}"
        if frontend_url
        else "https://example.com/expense-paid?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = (
        f"{frontend_url}/expense-canceled?expense={expense.id}"
        if frontend_url
        else "https://example.com/expense-canceled"
    )

    try:
        import stripe  # type: ignore
    except Exception:
        raise ValueError("Stripe SDK not installed on server.")

    stripe.api_key = stripe_key

    with transaction.atomic():
        exp = ExpenseRequest.objects.select_for_update().select_related(
            "agreement", "agreement__contractor", "agreement__project"
        ).get(pk=expense.pk)

        if str(getattr(exp, "status", "") or "").lower() == "paid" or getattr(exp, "paid_at", None):
            raise ValueError("Expense is already PAID.")

        existing_url = str(getattr(exp, "stripe_checkout_url", "") or "").strip()
        if existing_url:
            return existing_url

        project_title = ""
        try:
            project_title = getattr(getattr(exp.agreement, "project", None), "title", "") or ""
        except Exception:
            project_title = ""

        project_id = getattr(exp.agreement, "project_id", None)
        fee_result = calculate_platform_fee(
            amount_cents=amount_cents,
            contractor=contractor,
            project_id=project_id,
            context="expense_checkout",
        )
        application_fee_amount = int(fee_result.platform_fee_cents)
        payout_cents = int(fee_result.payout_cents)

        # ✅ This metadata will be used in BOTH:
        # - checkout.session.completed (session.metadata)
        # - payment_intent.succeeded (payment_intent.metadata)
        meta = {
            "expense_request_id": str(exp.id),
            "agreement_id": str(getattr(exp, "agreement_id", "") or ""),
            "project_id": str(project_id or ""),
            "contractor_id": str(getattr(contractor, "id", "") or ""),
            "kind": "EXPENSE_REQUEST",
            "fee_context": "expense_checkout",
            "platform_fee_cents": str(application_fee_amount),
            "payout_cents": str(payout_cents),
        }

        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": int(amount_cents),
                        "product_data": {
                            "name": f"Expense Request #{exp.id}",
                            "description": project_title or (getattr(exp, "description", "") or "MyHomeBro Expense"),
                        },
                    },
                }
            ],
            metadata=meta,  # ✅ session metadata
            success_url=success_url,
            cancel_url=cancel_url,
            payment_intent_data={
                # ✅ PI metadata (THIS is what was empty in your screenshot)
                "metadata": meta,
                "transfer_data": {"destination": stripe_acct},
                "application_fee_amount": int(application_fee_amount),
            },
        )

        session_url = getattr(session, "url", None) or (session.get("url") if isinstance(session, dict) else "")
        if not session_url:
            raise ValueError("Stripe did not return a checkout URL.")

        session_id = getattr(session, "id", None) or (session.get("id") if isinstance(session, dict) else "")
        payment_intent_id = getattr(session, "payment_intent", None) or (
            session.get("payment_intent") if isinstance(session, dict) else ""
        )

        exp.stripe_checkout_session_id = str(session_id or "")
        exp.stripe_checkout_url = str(session_url or "")
        if hasattr(exp, "stripe_payment_intent_id") and payment_intent_id:
            exp.stripe_payment_intent_id = str(payment_intent_id)
        if hasattr(exp, "platform_fee_cents"):
            exp.platform_fee_cents = int(application_fee_amount)
        if hasattr(exp, "payout_cents"):
            exp.payout_cents = int(payout_cents)

        update_fields = ["stripe_checkout_session_id", "stripe_checkout_url"]
        if hasattr(exp, "stripe_payment_intent_id") and payment_intent_id:
            update_fields.append("stripe_payment_intent_id")
        if hasattr(exp, "platform_fee_cents"):
            update_fields.append("platform_fee_cents")
        if hasattr(exp, "payout_cents"):
            update_fields.append("payout_cents")
        exp.save(update_fields=list(dict.fromkeys(update_fields + ["updated_at"])))

        return session_url
