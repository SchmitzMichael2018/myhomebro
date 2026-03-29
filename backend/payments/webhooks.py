# backend/payments/webhooks.py
# Unified Stripe webhook (Connect + escrow funding with amendment support + invoice payment support + refund sync)
#
# v2026-02-23:
# - ✅ Agreement completion: recompute after any invoice becomes PAID (direct pay + PI invoice payments)
#
# v2026-03-05:
# - ✅ FIX: Escrow funding now generates an Invoice + Receipt for EVERY escrow payment (partial + full).
# - ✅ Uses Invoice.stripe_payment_intent_id (nullable) to keep escrow separate from direct pay fields.
# - ✅ Idempotent on Stripe retries (keyed by PI id).
# - ✅ Backfills card brand/last4 + charge id by retrieving PI expanded charges when needed.
# - ✅ Ensures core/urls.py can import `stripe_webhook`.

from __future__ import annotations

import logging
import os
import uuid
from decimal import Decimal

from django.apps import apps
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse, HttpResponseBadRequest
from django.utils.timezone import now
from django.views.decorators.csrf import csrf_exempt

# ✅ Canonical agreement completion recompute
from projects.services.agreement_completion import recompute_and_apply_agreement_completion

log = logging.getLogger(__name__)


def _webhook_secret() -> str:
    return (
        (getattr(settings, "STRIPE_WEBHOOK_SECRET", None) or os.environ.get("STRIPE_WEBHOOK_SECRET", ""))
        .strip()
    )


def _stripe_api_key() -> str:
    """
    Best-effort Stripe secret key lookup.
    """
    return (
        (getattr(settings, "STRIPE_SECRET_KEY", None) or os.environ.get("STRIPE_SECRET_KEY", ""))
        .strip()
    )


def _get_model(app_label: str, name: str):
    try:
        return apps.get_model(app_label, name)
    except Exception:
        return None


def _update_contractor_from_account_obj(account_obj: dict) -> int:
    Contractor = _get_model("projects", "Contractor")
    if Contractor is None:
        return 0

    acct_id = account_obj.get("id")
    if not acct_id:
        return 0

    charges_enabled = bool(account_obj.get("charges_enabled"))
    payouts_enabled = bool(account_obj.get("payouts_enabled"))
    details_submitted = bool(account_obj.get("details_submitted"))

    reqs = account_obj.get("requirements") or {}
    currently_due = reqs.get("currently_due") or []
    requirements_due_count = len(currently_due)

    with transaction.atomic():
        return Contractor.objects.filter(stripe_account_id=acct_id).update(
            **({"charges_enabled": charges_enabled} if hasattr(Contractor, "charges_enabled") else {}),
            **({"payouts_enabled": payouts_enabled} if hasattr(Contractor, "payouts_enabled") else {}),
            **({"details_submitted": details_submitted} if hasattr(Contractor, "details_submitted") else {}),
            **({"requirements_due_count": requirements_due_count} if hasattr(Contractor, "requirements_due_count") else {}),
            **({"stripe_status_updated_at": now()} if hasattr(Contractor, "stripe_status_updated_at") else {}),
        )


def _to_decimal_cents(amount_in_cents) -> Decimal:
    """
    Stripe sends amounts in integer cents. Convert to Decimal dollars with 2dp.
    """
    try:
        return (Decimal(str(amount_in_cents or 0)) / Decimal("100")).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _to_int_cents(amount_in_cents) -> int:
    try:
        return int(amount_in_cents or 0)
    except Exception:
        return 0


def _compute_total_required_for_agreement(Agreement, Milestone, ag) -> Decimal:
    """
    Determine total escrow required for an agreement.
    Prefer ag.total_cost if set; otherwise sum milestones.
    """
    try:
        tc = getattr(ag, "total_cost", None)
        if tc is not None:
            tc_d = Decimal(str(tc))
            if tc_d > 0:
                return tc_d.quantize(Decimal("0.01"))
    except Exception:
        pass

    try:
        total = (Milestone.objects.filter(agreement=ag).aggregate(total=Sum("amount")).get("total") or Decimal("0.00"))
        return Decimal(str(total)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _receipt_number(prefix: str, obj_id: int) -> str:
    return f"{prefix}-{now().strftime('%Y%m%d')}-{int(obj_id):06d}"


def _extract_charge_card_details(intent: dict):
    """
    Try extracting:
      - stripe_charge_id
      - card_brand
      - card_last4
    from PI payload (requires expanded charges).
    """
    stripe_charge_id = None
    card_brand = None
    card_last4 = None

    try:
        charges = (intent.get("charges") or {}).get("data") or []
        if charges:
            ch = charges[0] or {}
            stripe_charge_id = ch.get("id")
            pm = ch.get("payment_method_details") or {}
            card = (pm.get("card") or {}) if isinstance(pm, dict) else {}
            card_brand = card.get("brand")
            card_last4 = card.get("last4")
    except Exception:
        pass

    return stripe_charge_id, card_brand, card_last4


def _fetch_pi_with_expanded_charges(pi_id: str):
    """
    Retrieve PaymentIntent with expanded charge payment method details.
    """
    try:
        import stripe  # type: ignore

        api_key = _stripe_api_key()
        if api_key:
            stripe.api_key = api_key

        return stripe.PaymentIntent.retrieve(pi_id, expand=["charges.data.payment_method_details"])
    except Exception:
        return None


def _backfill_card_details_from_stripe(pi_id: str):
    pi = _fetch_pi_with_expanded_charges(pi_id)
    if not pi:
        return None, None, None

    try:
        intent = pi if isinstance(pi, dict) else dict(pi)
    except Exception:
        try:
            intent = dict(pi)
        except Exception:
            return None, None, None

    return _extract_charge_card_details(intent)


def _mark_invoice_paid(inv, pi_id: str, stripe_charge_id: str | None):
    current_status = str(getattr(inv, "status", "") or "").lower()
    if "paid" in current_status or "released" in current_status:
        return False

    try:
        from projects.models import InvoiceStatus  # type: ignore

        if hasattr(InvoiceStatus, "PAID"):
            inv.status = InvoiceStatus.PAID
        else:
            inv.status = "paid"
    except Exception:
        inv.status = "paid"

    # Optional paid_at field (your Invoice has created_at; may or may not have paid_at)
    if hasattr(inv, "paid_at"):
        inv.paid_at = now()

    # Keep PI id if the Invoice has the field
    if hasattr(inv, "stripe_payment_intent_id"):
        inv.stripe_payment_intent_id = pi_id

    if stripe_charge_id and hasattr(inv, "stripe_charge_id"):
        inv.stripe_charge_id = stripe_charge_id

    update_fields = ["status"]
    for f in ("paid_at", "stripe_payment_intent_id", "stripe_charge_id"):
        if hasattr(inv, f):
            update_fields.append(f)

    try:
        inv.save(update_fields=update_fields)
    except Exception:
        inv.save()

    return True


def _handle_invoice_payment_succeeded(intent: dict) -> None:
    """
    For invoice payments: mark invoice paid + create receipt, PDF, email.
    Requires PI metadata.invoice_id to be present.
    """
    metadata = intent.get("metadata") or {}
    invoice_id = metadata.get("invoice_id")
    if not invoice_id:
        return

    Invoice = _get_model("projects", "Invoice")
    if Invoice is None:
        log.warning("Invoice payment handler skipped: Invoice model not available.")
        return

    invoice_id_int = _safe_int(invoice_id, default=0)
    if invoice_id_int <= 0:
        log.warning("Invoice payment handler skipped: invalid invoice_id=%s", invoice_id)
        return

    pi_id = intent.get("id") or ""
    if not pi_id:
        log.warning("Invoice payment handler skipped: missing PI id for invoice_id=%s", invoice_id)
        return

    amount_received_cents = _to_int_cents(intent.get("amount_received", 0) or intent.get("amount", 0))
    if amount_received_cents <= 0:
        log.warning("Invoice payment handler skipped: amount_received_cents<=0 for pi=%s invoice_id=%s", pi_id, invoice_id)
        return

    stripe_charge_id, card_brand, card_last4 = _extract_charge_card_details(intent)
    if not stripe_charge_id or not card_brand or not card_last4:
        f_charge_id, f_brand, f_last4 = _backfill_card_details_from_stripe(pi_id)
        stripe_charge_id = stripe_charge_id or f_charge_id
        card_brand = card_brand or f_brand
        card_last4 = card_last4 or f_last4

    Receipt = _get_model("receipts", "Receipt")
    platform_fee_cents = _safe_int(metadata.get("platform_fee_cents"), default=0)

    with transaction.atomic():
        try:
            inv = Invoice.objects.select_for_update().get(id=invoice_id_int)
        except Exception:
            log.warning("Invoice payment handler skipped: invoice not found id=%s (pi=%s)", invoice_id, pi_id)
            return

        changed = _mark_invoice_paid(inv, pi_id=pi_id, stripe_charge_id=stripe_charge_id)

        # ✅ recompute agreement completion AFTER commit if invoice changed to paid
        if changed:
            try:
                ag_id = getattr(inv, "agreement_id", None)
                if ag_id:
                    transaction.on_commit(lambda: recompute_and_apply_agreement_completion(int(ag_id)))
            except Exception as exc:
                log.warning("Agreement completion recompute scheduling failed (invoice=%s): %s", getattr(inv, "id", None), exc)

        # Fee snapshot logic (kept from your original)
        fee_snapshot = {}
        computed_fee_cents = 0

        try:
            agreement = getattr(inv, "agreement", None)
            contractor = getattr(agreement, "contractor", None) if agreement else None
            agreement_id = getattr(inv, "agreement_id", None)

            if contractor is not None:
                from payments.fees import (
                    compute_fee_summary_for_invoice_payment,
                    build_invoice_payment_fee_snapshot,
                    _cents_from_money,
                )

                summary = compute_fee_summary_for_invoice_payment(
                    amount_cents=amount_received_cents,
                    contractor=contractor,
                    agreement_id=agreement_id,
                    is_high_risk=False,
                )

                fee_snapshot = build_invoice_payment_fee_snapshot(summary)
                computed_fee_cents = _cents_from_money(summary.platform_fee)
        except Exception:
            log.exception("Fee snapshot build failed (invoice=%s, pi=%s).", getattr(inv, "id", None), pi_id)
            fee_snapshot = {}
            computed_fee_cents = 0

        if computed_fee_cents > 0:
            platform_fee_cents = computed_fee_cents
        elif platform_fee_cents <= 0 and hasattr(inv, "platform_fee_cents"):
            try:
                platform_fee_cents = int(getattr(inv, "platform_fee_cents") or 0)
            except Exception:
                platform_fee_cents = 0

        if Receipt is not None:
            try:
                existing = Receipt.objects.filter(invoice_id=inv.id).first()
                if existing:
                    log.info("Receipt already exists for invoice=%s (pi=%s). Skipping receipt create.", inv.id, pi_id)
                else:
                    create_kwargs = dict(
                        invoice=inv,
                        receipt_number=_receipt_number("RCT", inv.id),
                        stripe_payment_intent_id=pi_id,
                        stripe_charge_id=stripe_charge_id,
                        amount_paid_cents=amount_received_cents,
                        platform_fee_cents=max(int(platform_fee_cents), 0),
                        card_brand=card_brand,
                        card_last4=card_last4,
                    )

                    try:
                        if hasattr(Receipt, "agreement") and getattr(inv, "agreement_id", None):
                            create_kwargs["agreement_id"] = inv.agreement_id
                    except Exception:
                        pass

                    for k, v in (fee_snapshot or {}).items():
                        try:
                            if hasattr(Receipt, k):
                                create_kwargs[k] = v
                        except Exception:
                            pass

                    receipt = Receipt.objects.create(**create_kwargs)

                    try:
                        from receipts.pdf import generate_receipt_pdf as _gen  # type: ignore
                        _gen(receipt)
                    except Exception:
                        log.exception("Receipt PDF generation failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)

                    try:
                        from receipts.emails import send_receipt_email as _send  # type: ignore
                        _send(receipt)
                    except Exception:
                        log.exception("Receipt email failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)

                    log.info("Receipt created for invoice=%s pi=%s cents=%s", inv.id, pi_id, amount_received_cents)
            except Exception:
                log.exception("Receipt flow failed for invoice=%s (pi=%s).", inv.id, pi_id)

        if changed:
            log.info("Invoice marked PAID invoice=%s pi=%s cents=%s", inv.id, pi_id, amount_received_cents)
        else:
            log.info("Invoice already paid/released invoice=%s pi=%s", inv.id, pi_id)


def _handle_direct_pay_checkout_completed(session: dict) -> None:
    meta = session.get("metadata") or {}

    payment_mode = str(meta.get("payment_mode") or "").strip()
    if payment_mode.lower() != "direct":
        return

    invoice_id = meta.get("invoice_id")
    if not invoice_id:
        return

    Invoice = _get_model("projects", "Invoice")
    if Invoice is None:
        return

    inv_id = _safe_int(invoice_id, default=0)
    if inv_id <= 0:
        return

    session_id = session.get("id") or ""
    payment_intent = session.get("payment_intent") or ""

    with transaction.atomic():
        try:
            inv = Invoice.objects.select_for_update().select_related("agreement").get(id=inv_id)
        except Exception:
            log.warning("Direct Pay checkout handler: invoice not found id=%s (session=%s)", invoice_id, session_id)
            return

        try:
            ag = getattr(inv, "agreement", None)
            if ag and str(getattr(ag, "payment_mode", "") or "").lower() != "direct":
                log.warning("Direct Pay checkout handler: invoice=%s agreement not direct; skipping", inv_id)
                return
        except Exception:
            pass

        if str(getattr(inv, "status", "") or "").lower() == "paid":
            return
        if getattr(inv, "direct_pay_paid_at", None):
            return

        update_fields = []

        try:
            from projects.models import InvoiceStatus  # type: ignore
            inv.status = InvoiceStatus.PAID if hasattr(InvoiceStatus, "PAID") else "paid"
        except Exception:
            inv.status = "paid"
        update_fields.append("status")

        if hasattr(inv, "direct_pay_paid_at"):
            inv.direct_pay_paid_at = now()
            update_fields.append("direct_pay_paid_at")

        if payment_intent and hasattr(inv, "direct_pay_payment_intent_id"):
            inv.direct_pay_payment_intent_id = payment_intent
            update_fields.append("direct_pay_payment_intent_id")

        if session_id and hasattr(inv, "direct_pay_checkout_session_id"):
            inv.direct_pay_checkout_session_id = session_id
            update_fields.append("direct_pay_checkout_session_id")

        try:
            if update_fields:
                inv.save(update_fields=update_fields)
            else:
                inv.save()
        except Exception:
            inv.save()

        # ✅ recompute agreement completion AFTER commit
        try:
            ag_id = getattr(inv, "agreement_id", None)
            if ag_id:
                transaction.on_commit(lambda: recompute_and_apply_agreement_completion(int(ag_id)))
        except Exception as exc:
            log.warning("Agreement completion recompute scheduling failed (direct pay inv=%s): %s", inv_id, exc)

        log.info("Direct Pay invoice marked PAID invoice=%s session=%s pi=%s", inv_id, session_id, payment_intent)


def _handle_expense_checkout_completed(session: dict) -> None:
    meta = session.get("metadata") or {}
    expense_id = meta.get("expense_request_id") or meta.get("expense_id")
    if not expense_id:
        return

    ExpenseRequest = _get_model("projects", "ExpenseRequest")
    if ExpenseRequest is None:
        return

    exp_id = _safe_int(expense_id, default=0)
    if exp_id <= 0:
        return

    session_id = session.get("id") or ""
    payment_intent = session.get("payment_intent") or ""

    with transaction.atomic():
        try:
            exp = ExpenseRequest.objects.select_for_update().get(id=exp_id)
        except Exception:
            log.warning("Expense checkout handler: expense not found id=%s (session=%s)", expense_id, session_id)
            return

        current_status = str(getattr(exp, "status", "") or "").lower()
        if current_status == "paid":
            return
        if getattr(exp, "paid_at", None):
            return

        try:
            exp.status = ExpenseRequest.Status.PAID
        except Exception:
            exp.status = "paid"

        if hasattr(exp, "paid_at"):
            exp.paid_at = now()

        if hasattr(exp, "homeowner_acted_at") and not getattr(exp, "homeowner_acted_at", None):
            exp.homeowner_acted_at = now()

        update_fields = ["status"]
        for f in ("paid_at", "homeowner_acted_at"):
            if hasattr(exp, f):
                update_fields.append(f)

        try:
            exp.save(update_fields=update_fields)
        except Exception:
            exp.save()

        log.info("ExpenseRequest marked PAID expense=%s session=%s pi=%s", exp_id, session_id, payment_intent)


def _handle_expense_payment_intent_succeeded(intent: dict) -> None:
    meta = intent.get("metadata") or {}
    expense_id = meta.get("expense_request_id") or meta.get("expense_id")
    if not expense_id:
        return

    ExpenseRequest = _get_model("projects", "ExpenseRequest")
    if ExpenseRequest is None:
        return

    exp_id = _safe_int(expense_id, default=0)
    if exp_id <= 0:
        return

    pi_id = intent.get("id") or ""

    with transaction.atomic():
        try:
            exp = ExpenseRequest.objects.select_for_update().get(id=exp_id)
        except Exception:
            log.warning("Expense PI handler: expense not found id=%s (pi=%s)", expense_id, pi_id)
            return

        current_status = str(getattr(exp, "status", "") or "").lower()
        if current_status == "paid":
            return
        if getattr(exp, "paid_at", None):
            return

        try:
            exp.status = ExpenseRequest.Status.PAID
        except Exception:
            exp.status = "paid"

        if hasattr(exp, "paid_at"):
            exp.paid_at = now()

        if hasattr(exp, "homeowner_acted_at") and not getattr(exp, "homeowner_acted_at", None):
            exp.homeowner_acted_at = now()

        update_fields = ["status"]
        for f in ("paid_at", "homeowner_acted_at"):
            if hasattr(exp, f):
                update_fields.append(f)

        try:
            exp.save(update_fields=update_fields)
        except Exception:
            exp.save()

        log.info("ExpenseRequest marked PAID (PI) expense=%s pi=%s", exp_id, pi_id)


def _upsert_payment_for_escrow_funding(ag, pi_id: str, paid: Decimal, currency: str, stripe_charge_id: str | None = None) -> None:
    """
    Upsert payments.Payment row for escrow funding.
    Updated: also store stripe_charge_id when available.
    """
    Payment = _get_model("payments", "Payment")
    if Payment is None:
        return

    paid_cents = int((paid.quantize(Decimal("0.01")) * Decimal("100")).to_integral_value())
    currency_lc = (currency or "USD").lower()

    payment = Payment.objects.select_for_update().filter(stripe_payment_intent_id=pi_id).first()
    if payment is None:
        Payment.objects.create(
            agreement=ag,
            stripe_payment_intent_id=pi_id,
            stripe_charge_id=stripe_charge_id or None,
            amount_cents=paid_cents,
            currency=currency_lc,
            status="succeeded",
        )
        return

    update_fields = []
    if getattr(payment, "status", None) != "succeeded":
        payment.status = "succeeded"
        update_fields.append("status")

    try:
        if int(getattr(payment, "amount_cents", 0) or 0) < paid_cents:
            payment.amount_cents = paid_cents
            update_fields.append("amount_cents")
    except Exception:
        payment.amount_cents = paid_cents
        update_fields.append("amount_cents")

    if (getattr(payment, "currency", "") or "").lower() != currency_lc:
        payment.currency = currency_lc
        update_fields.append("currency")

    if stripe_charge_id:
        if (getattr(payment, "stripe_charge_id", "") or "").strip() != stripe_charge_id:
            payment.stripe_charge_id = stripe_charge_id
            update_fields.append("stripe_charge_id")

    if update_fields:
        payment.save(update_fields=update_fields)


def _ensure_escrow_payment_invoice_and_receipt(ag, pi_id: str, intent: dict, paid_cents: int) -> None:
    """
    Create an Invoice + Receipt for EVERY escrow payment.

    Uses:
      - Invoice.stripe_payment_intent_id = pi_id  (keeps escrow separate from direct pay fields)
      - Receipt.stripe_payment_intent_id = pi_id (hard idempotency)
    """
    Invoice = _get_model("projects", "Invoice")
    Receipt = _get_model("receipts", "Receipt")
    if Invoice is None or Receipt is None:
        return

    ag_id = getattr(ag, "id", None)
    if not ag_id:
        return

    pi_id = (pi_id or "").strip()
    if not pi_id:
        return

    # Idempotency: if Receipt already exists for this PI, done.
    try:
        if Receipt.objects.filter(stripe_payment_intent_id=pi_id).exists():
            return
    except Exception:
        pass

    # Card details
    stripe_charge_id, card_brand, card_last4 = _extract_charge_card_details(intent)
    if not stripe_charge_id or not card_brand or not card_last4:
        f_charge_id, f_brand, f_last4 = _backfill_card_details_from_stripe(pi_id)
        stripe_charge_id = stripe_charge_id or f_charge_id
        card_brand = card_brand or f_brand
        card_last4 = card_last4 or f_last4

    # Fee calc (platform_fee_cents NOT NULL on Invoice + Receipt)
    fee_snapshot = {}
    computed_fee_cents = 0
    try:
        contractor = getattr(ag, "contractor", None)
        if contractor is not None:
            from payments.fees import (
                compute_fee_summary_for_invoice_payment,
                build_invoice_payment_fee_snapshot,
                _cents_from_money,
            )

            summary = compute_fee_summary_for_invoice_payment(
                amount_cents=int(paid_cents),
                contractor=contractor,
                agreement_id=int(ag_id),
                is_high_risk=False,
            )

            fee_snapshot = build_invoice_payment_fee_snapshot(summary)
            computed_fee_cents = _cents_from_money(summary.platform_fee)
    except Exception:
        log.exception("Escrow fee snapshot build failed (agreement=%s, pi=%s).", ag_id, pi_id)
        fee_snapshot = {}
        computed_fee_cents = 0

    platform_fee_cents = max(int(computed_fee_cents or 0), 0)
    payout_cents = max(int(paid_cents) - platform_fee_cents, 0)

    pi_suffix = pi_id[-8:] if len(pi_id) >= 8 else pi_id
    invoice_number = f"ESCROW-{ag_id}-{pi_suffix}"

    # Mark as funding invoice (so completion logic can ignore it)
    milestone_title = "Escrow Funding Payment"
    milestone_desc = f"Escrow funding payment for Agreement #{ag_id}. (PI {pi_id})"

    with transaction.atomic():
        inv = (
            Invoice.objects.select_for_update()
            .filter(agreement_id=ag_id, stripe_payment_intent_id=pi_id)
            .order_by("-id")
            .first()
        )

        if inv is None:
            # Your Invoice model has many non-null snapshot fields; populate them defensively.
            inv = Invoice.objects.create(
                agreement_id=ag_id,
                invoice_number=invoice_number,
                amount=_to_decimal_cents(paid_cents),
                status="paid",
                public_token=uuid.uuid4(),
                pdf_file=None,
                escrow_released=False,
                escrow_released_at=None,
                stripe_transfer_id="",
                stripe_payment_intent_id=pi_id,  # ✅ escrow PI stored here
                platform_fee_cents=platform_fee_cents,
                payout_cents=payout_cents,
                disputed=False,
                dispute_reason="",
                dispute_by="",
                disputed_at=None,
                marked_complete_at=None,
                approved_at=None,
                email_sent_at=None,
                email_message_id="",
                last_email_error="",
                milestone_id_snapshot=None,
                milestone_title_snapshot=milestone_title,
                milestone_description_snapshot=milestone_desc,
                milestone_completion_notes="",
                milestone_attachments_snapshot=[],
                direct_pay_checkout_session_id="",
                direct_pay_payment_intent_id="",
                direct_pay_checkout_url="",
                direct_pay_paid_at=None,
            )

        if Receipt.objects.filter(invoice_id=inv.id).exists():
            return

        create_kwargs = dict(
            invoice=inv,
            agreement_id=ag_id,
            receipt_number=_receipt_number("RCT", inv.id),
            stripe_payment_intent_id=pi_id,
            stripe_charge_id=stripe_charge_id,
            amount_paid_cents=int(paid_cents),
            platform_fee_cents=int(platform_fee_cents),
            card_brand=card_brand,
            card_last4=card_last4,
            is_intro=False,
            high_risk_applied=False,
        )

        for k, v in (fee_snapshot or {}).items():
            try:
                if hasattr(Receipt, k):
                    create_kwargs[k] = v
            except Exception:
                pass

        receipt = Receipt.objects.create(**create_kwargs)

        try:
            from receipts.pdf import generate_receipt_pdf as _gen  # type: ignore
            _gen(receipt)
        except Exception:
            log.exception("Escrow receipt PDF generation failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)

        try:
            from receipts.emails import send_receipt_email as _send  # type: ignore
            _send(receipt)
        except Exception:
            log.exception("Escrow receipt email failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)


def _sync_refund_from_stripe(refund_obj: dict) -> None:
    Refund = _get_model("payments", "Refund")
    Payment = _get_model("payments", "Payment")

    if Refund is None:
        return

    stripe_refund_id = refund_obj.get("id") or ""
    if not stripe_refund_id:
        return

    status_val = (refund_obj.get("status") or "").lower() or "pending"
    amount_cents = _to_int_cents(refund_obj.get("amount"))
    currency = (refund_obj.get("currency") or "usd").lower()
    failure_reason = refund_obj.get("failure_reason") or refund_obj.get("failure_message") or ""

    charge_id = refund_obj.get("charge") or ""
    pi_id = refund_obj.get("payment_intent") or ""

    with transaction.atomic():
        r = Refund.objects.select_for_update().filter(stripe_refund_id=stripe_refund_id).first()

        if r is None and Payment is not None:
            p = None
            if pi_id:
                p = Payment.objects.filter(stripe_payment_intent_id=pi_id).order_by("-id").first()
            if p is None and charge_id:
                p = Payment.objects.filter(stripe_charge_id=charge_id).order_by("-id").first()

            if p is not None:
                try:
                    r = Refund.objects.create(
                        payment=p,
                        created_by=None,
                        amount_cents=amount_cents,
                        currency=currency,
                        reason="",
                        note="(created by webhook sync)",
                        status=status_val,
                        stripe_refund_id=stripe_refund_id,
                        error_message=failure_reason or "",
                    )
                except Exception:
                    log.exception("Refund sync: failed creating Refund row for stripe_refund_id=%s", stripe_refund_id)
                    return
            else:
                return

        if r is None:
            return

        update_fields = []

        if hasattr(r, "status") and (getattr(r, "status", "") or "").lower() != status_val:
            r.status = status_val
            update_fields.append("status")

        if hasattr(r, "amount_cents") and amount_cents and int(getattr(r, "amount_cents", 0) or 0) != amount_cents:
            r.amount_cents = amount_cents
            update_fields.append("amount_cents")

        if hasattr(r, "currency") and currency and (getattr(r, "currency", "") or "").lower() != currency:
            r.currency = currency
            update_fields.append("currency")

        if hasattr(r, "error_message"):
            new_err = (failure_reason or "").strip()
            if status_val in ("failed", "canceled") and new_err and (getattr(r, "error_message", "") or "") != new_err:
                r.error_message = new_err
                update_fields.append("error_message")
            if status_val == "succeeded" and (getattr(r, "error_message", "") or ""):
                r.error_message = ""
                update_fields.append("error_message")

        if update_fields:
            try:
                r.save(update_fields=update_fields)
            except Exception:
                r.save()

        log.info(
            "Refund sync: stripe_refund_id=%s status=%s amount_cents=%s currency=%s",
            stripe_refund_id,
            status_val,
            amount_cents,
            currency,
        )


@csrf_exempt
def stripe_webhook(request):
    """
    Public Django view imported by core/urls.py:
      from payments.webhooks import stripe_webhook
    """
    try:
        if request.method in ("GET", "HEAD"):
            return HttpResponse("Stripe webhook is live.", status=200)

        if request.method != "POST":
            return HttpResponseBadRequest("Invalid method")

        secret = _webhook_secret()
        if not secret:
            log.error("STRIPE_WEBHOOK_SECRET not configured.")
            return HttpResponseBadRequest("Webhook secret not configured")

        try:
            import stripe  # type: ignore
        except Exception as exc:
            log.exception("Stripe SDK import failed: %s", exc)
            return HttpResponse(status=200)

        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

        try:
            event = stripe.Webhook.construct_event(payload=payload, sig_header=sig_header, secret=secret)
        except Exception as exc:
            log.warning("Stripe webhook signature verification failed: %s", exc)
            return HttpResponseBadRequest("Invalid signature")

        event_type = event.get("type")
        data_obj = (event.get("data") or {}).get("object") or {}

        if event_type == "account.updated":
            _update_contractor_from_account_obj(data_obj)
            return HttpResponse(status=200)

        if event_type == "account.application.deauthorized":
            Contractor = _get_model("projects", "Contractor")
            acct_id = data_obj.get("id")
            if Contractor and acct_id:
                with transaction.atomic():
                    Contractor.objects.filter(stripe_account_id=acct_id).update(
                        charges_enabled=False,
                        payouts_enabled=False,
                        stripe_status_updated_at=now(),
                    )
            return HttpResponse(status=200)

        if event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            # NOTE: escrow funding is handled via payment_intent.succeeded
            try:
                _handle_direct_pay_checkout_completed(data_obj)
            except Exception:
                log.exception("Direct Pay checkout handler failed (session=%s).", data_obj.get("id"))

            try:
                _handle_expense_checkout_completed(data_obj)
            except Exception:
                log.exception("Expense checkout handler failed (session=%s).", data_obj.get("id"))

            return HttpResponse(status=200)

        if event_type == "refund.updated":
            try:
                _sync_refund_from_stripe(data_obj)
            except Exception:
                log.exception("Refund sync failed for refund.updated id=%s", data_obj.get("id"))
            return HttpResponse(status=200)

        if event_type == "charge.refunded":
            try:
                refunds = (data_obj.get("refunds") or {}).get("data") or []
                for r in refunds:
                    if isinstance(r, dict):
                        _sync_refund_from_stripe(r)
            except Exception:
                log.exception("Refund sync failed for charge.refunded charge=%s", data_obj.get("id"))
            return HttpResponse(status=200)

        if event_type != "payment_intent.succeeded":
            return HttpResponse(status=200)

        # --- payment_intent.succeeded ---
        intent = data_obj
        metadata = intent.get("metadata") or {}

        # ✅ Invoice payments
        if metadata.get("invoice_id"):
            try:
                _handle_invoice_payment_succeeded(intent)
            except Exception:
                log.exception("Invoice payment handler failed (pi=%s).", intent.get("id"))
            return HttpResponse(status=200)

        # ✅ Expense payments (PI)
        if metadata.get("expense_request_id") or metadata.get("expense_id"):
            try:
                _handle_expense_payment_intent_succeeded(intent)
            except Exception:
                log.exception("Expense PI handler failed (pi=%s).", intent.get("id"))
            return HttpResponse(status=200)

        # ✅ Escrow funding payments (Agreement)
        Agreement = _get_model("projects", "Agreement")
        Milestone = _get_model("projects", "Milestone")
        AgreementFundingLink = _get_model("projects", "AgreementFundingLink")

        if Agreement is None:
            log.error("Agreement model not available in webhook.")
            return HttpResponse(status=200)

        agreement_id = metadata.get("agreement_id")
        funding_link_id = metadata.get("funding_link_id")

        if not agreement_id:
            log.warning("payment_intent.succeeded without agreement_id metadata")
            return HttpResponse(status=200)

        pi_id = intent.get("id") or ""
        paid = _to_decimal_cents(intent.get("amount_received", 0))
        currency = (intent.get("currency") or "usd").upper()

        if not pi_id or paid <= 0:
            log.warning("payment_intent.succeeded missing pi_id or paid amount (pi_id=%s paid=%s)", pi_id, paid)
            return HttpResponse(status=200)

        paid_cents = _to_int_cents(intent.get("amount_received", 0) or intent.get("amount", 0))
        if paid_cents <= 0:
            paid_cents = int((paid * Decimal("100")).to_integral_value())

        # Charge id for Payment upsert
        stripe_charge_id, _, _ = _extract_charge_card_details(intent)
        if not stripe_charge_id:
            f_charge_id, _, _ = _backfill_card_details_from_stripe(pi_id)
            stripe_charge_id = stripe_charge_id or f_charge_id

        with transaction.atomic():
            link = None
            if funding_link_id and AgreementFundingLink is not None:
                try:
                    link = AgreementFundingLink.objects.select_for_update().get(id=funding_link_id)
                    if getattr(link, "used_at", None):
                        log.info("payment_intent.succeeded already processed via funding link id=%s (pi=%s)", funding_link_id, pi_id)
                        return HttpResponse(status=200)

                    existing_pi = getattr(link, "payment_intent_id", "") or ""
                    if existing_pi and existing_pi != pi_id:
                        log.warning(
                            "Funding link id=%s has payment_intent_id=%s but webhook PI=%s. Skipping add to prevent double-count.",
                            funding_link_id,
                            existing_pi,
                            pi_id,
                        )
                        try:
                            link.is_active = False
                            link.save(update_fields=["is_active"])
                        except Exception:
                            pass
                        return HttpResponse(status=200)
                except Exception:
                    link = None

            try:
                ag = Agreement.objects.select_for_update().get(id=agreement_id)
            except Agreement.DoesNotExist:
                log.warning("Agreement %s not found for payment_intent %s", agreement_id, pi_id)
                if link is not None:
                    try:
                        link.is_active = False
                        link.used_at = now()
                        link.save(update_fields=["is_active", "used_at"])
                    except Exception:
                        pass
                return HttpResponse(status=200)

            total_required = Decimal("0.00")
            if Milestone is not None:
                total_required = _compute_total_required_for_agreement(Agreement, Milestone, ag)

            # If total_cost missing, backfill from milestones (best-effort)
            try:
                tc = getattr(ag, "total_cost", None)
                tc_d = Decimal(str(tc or "0.00")).quantize(Decimal("0.01"))
                if (tc is None or tc_d <= 0) and total_required > 0 and hasattr(ag, "total_cost"):
                    ag.total_cost = total_required
            except Exception:
                pass

            # Ensure escrow_funded_amount exists
            try:
                if getattr(ag, "escrow_funded_amount", None) is None:
                    ag.escrow_funded_amount = Decimal("0.00")
            except Exception:
                pass

            # Add paid amount
            try:
                ag.escrow_funded_amount = (Decimal(str(ag.escrow_funded_amount)) + paid).quantize(Decimal("0.01"))
            except Exception:
                try:
                    ag.escrow_funded_amount = paid
                except Exception:
                    pass

            if hasattr(ag, "stripe_payment_intent_id"):
                ag.stripe_payment_intent_id = pi_id
            if hasattr(ag, "escrow_funded_at"):
                ag.escrow_funded_at = now()

            # Mark funded when reaching required
            try:
                required = Decimal(str(getattr(ag, "total_cost", None) or total_required or "0.00")).quantize(Decimal("0.01"))
            except Exception:
                required = total_required

            if required > 0 and Decimal(str(getattr(ag, "escrow_funded_amount", "0.00"))) >= required:
                if hasattr(ag, "escrow_funded"):
                    ag.escrow_funded = True

            update_fields = []
            for f in ("total_cost", "escrow_funded_amount", "escrow_funded", "escrow_funded_at", "stripe_payment_intent_id"):
                if hasattr(ag, f):
                    update_fields.append(f)
            if update_fields:
                ag.save(update_fields=update_fields)
            try:
                from projects.services.activity_feed import create_activity_event

                create_activity_event(
                    contractor=getattr(ag, "contractor", None),
                    agreement=ag,
                    event_type="escrow_funded",
                    title="Escrow funded",
                    summary="Escrow funds were received for this agreement.",
                    severity="success",
                    related_label=getattr(ag, "title", "") or "Agreement",
                    icon_hint="payment",
                    navigation_target=f"/app/agreements/{ag.id}",
                    metadata={
                        "agreement_id": ag.id,
                        "stripe_payment_intent_id": pi_id,
                        "funded_amount": str(paid),
                    },
                    dedupe_key=f"escrow_funded:{pi_id}",
                )
            except Exception:
                pass

            # Upsert payments.Payment record (escrow funding)
            try:
                _upsert_payment_for_escrow_funding(ag=ag, pi_id=pi_id, paid=paid, currency=currency, stripe_charge_id=stripe_charge_id)
            except Exception:
                log.exception("Upsert Payment failed for agreement=%s pi=%s", agreement_id, pi_id)

            # ✅ KEY FIX: ALWAYS create Invoice + Receipt for every escrow payment
            try:
                _ensure_escrow_payment_invoice_and_receipt(ag=ag, pi_id=pi_id, intent=intent, paid_cents=paid_cents)
            except Exception:
                log.exception("Escrow invoice/receipt ensure failed (agreement=%s pi=%s).", agreement_id, pi_id)

            if link is not None:
                try:
                    link.used_at = now()
                    link.is_active = False
                    link.save(update_fields=["used_at", "is_active"])
                except Exception:
                    log.exception("Failed updating AgreementFundingLink used_at for id=%s", getattr(link, "id", None))

            log.info("Escrow payment recorded: agreement=%s pi=%s cents=%s", agreement_id, pi_id, paid_cents)

        return HttpResponse(status=200)

    except Exception as exc:
        log.exception("Unhandled error in stripe_webhook: %s", exc)
        return HttpResponse(status=200)
