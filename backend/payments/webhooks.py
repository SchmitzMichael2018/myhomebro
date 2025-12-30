# backend/payments/webhooks.py
# Unified Stripe webhook (Connect + escrow funding with amendment support + invoice payment support)
#
# v2025-12-26b:
# - invoice branch: robust card brand/last4 capture
#   - If webhook PI payload lacks expanded charges/payment_method_details:
#     -> retrieve PaymentIntent with expand=["charges.data.payment_method_details"]
#     -> backfill stripe_charge_id, card_brand, card_last4 before creating Receipt
# - keeps existing escrow funding logic intact (agreement_id path)
# - never returns 500 to Stripe to avoid retry storms

from __future__ import annotations

import logging
import os
from decimal import Decimal

from django.apps import apps
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse, HttpResponseBadRequest
from django.utils.timezone import now
from django.views.decorators.csrf import csrf_exempt

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

    # Fallback: sum milestones
    try:
        total = (
            Milestone.objects.filter(agreement=ag).aggregate(total=Sum("amount")).get("total")
            or Decimal("0.00")
        )
        return Decimal(str(total)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _receipt_number(prefix: str, obj_id: int) -> str:
    # Example: RCT-20251225-000123
    return f"{prefix}-{now().strftime('%Y%m%d')}-{int(obj_id):06d}"


def _extract_charge_card_details(intent: dict):
    """
    Best-effort extraction of charge id + card details from PI payload.
    Not guaranteed unless charges are expanded.
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
            card = pm.get("card") or {}
            card_brand = card.get("brand")
            card_last4 = card.get("last4")
    except Exception:
        pass

    return stripe_charge_id, card_brand, card_last4


def _fetch_pi_with_expanded_charges(pi_id: str):
    """
    Retrieve PaymentIntent from Stripe with expanded charge/payment_method_details.
    Only used as fallback when webhook payload lacks card/charge details.
    """
    try:
        import stripe  # type: ignore

        api_key = _stripe_api_key()
        if api_key:
            stripe.api_key = api_key

        # Expand charge payment method details so we can get card brand/last4
        return stripe.PaymentIntent.retrieve(
            pi_id,
            expand=["charges.data.payment_method_details"],
        )
    except Exception:
        return None


def _backfill_card_details_from_stripe(pi_id: str):
    """
    Fallback: if webhook payload is missing card details, fetch PI with expand and extract.
    Returns (stripe_charge_id, card_brand, card_last4) or (None, None, None).
    """
    pi = _fetch_pi_with_expanded_charges(pi_id)
    if not pi:
        return None, None, None

    try:
        # Stripe objects behave like dicts for .get(), but be defensive
        intent = pi if isinstance(pi, dict) else dict(pi)
    except Exception:
        try:
            intent = dict(pi)
        except Exception:
            return None, None, None

    return _extract_charge_card_details(intent)


def _mark_invoice_paid(inv, pi_id: str, stripe_charge_id: str | None):
    """
    Mark invoice as PAID in a defensive way (works even if enums differ).
    """
    # Idempotency: if already paid/released, do nothing
    current_status = str(getattr(inv, "status", "") or "").lower()
    if "paid" in current_status or "released" in current_status:
        return False

    # Try to set a proper enum if available; fallback to string.
    try:
        from projects.models import InvoiceStatus  # type: ignore
        if hasattr(InvoiceStatus, "PAID"):
            inv.status = InvoiceStatus.PAID
        else:
            inv.status = "paid"
    except Exception:
        inv.status = "paid"

    if hasattr(inv, "paid_at"):
        inv.paid_at = now()

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
        # best-effort fallback
        inv.save()

    return True


def _handle_invoice_payment_succeeded(intent: dict) -> None:
    """
    For invoice payments: mark invoice paid + (optional) create receipt, PDF, email.

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
        log.warning("Invoice payment handler skipped: missing payment_intent id for invoice_id=%s", invoice_id)
        return

    amount_received_cents = _to_int_cents(intent.get("amount_received", 0) or intent.get("amount", 0))
    if amount_received_cents <= 0:
        log.warning("Invoice payment handler skipped: amount_received_cents<=0 for pi=%s invoice_id=%s", pi_id, invoice_id)
        return

    # First attempt from webhook payload
    stripe_charge_id, card_brand, card_last4 = _extract_charge_card_details(intent)

    # Fallback: retrieve PI with expanded charges if missing
    if not stripe_charge_id or not card_brand or not card_last4:
        f_charge_id, f_brand, f_last4 = _backfill_card_details_from_stripe(pi_id)
        stripe_charge_id = stripe_charge_id or f_charge_id
        card_brand = card_brand or f_brand
        card_last4 = card_last4 or f_last4

    # Receipts app is optional
    Receipt = _get_model("receipts", "Receipt")

    # Optional helpers (best-effort)
    generate_receipt_pdf = None
    send_receipt_email = None
    try:
        from receipts.pdf import generate_receipt_pdf as _gen  # type: ignore
        generate_receipt_pdf = _gen
    except Exception:
        generate_receipt_pdf = None

    try:
        from receipts.emails import send_receipt_email as _send  # type: ignore
        send_receipt_email = _send
    except Exception:
        send_receipt_email = None

    platform_fee_cents = _safe_int(metadata.get("platform_fee_cents"), default=0)

    with transaction.atomic():
        # Lock invoice
        try:
            inv = Invoice.objects.select_for_update().get(id=invoice_id_int)
        except Exception:
            log.warning("Invoice payment handler skipped: invoice not found id=%s (pi=%s)", invoice_id, pi_id)
            return

        # Mark invoice paid (idempotent)
        changed = _mark_invoice_paid(inv, pi_id=pi_id, stripe_charge_id=stripe_charge_id)

        # Backfill platform_fee_cents if not present in metadata
        if platform_fee_cents <= 0 and hasattr(inv, "platform_fee_cents"):
            try:
                platform_fee_cents = int(getattr(inv, "platform_fee_cents") or 0)
            except Exception:
                platform_fee_cents = 0

        # Receipt creation is optional
        if Receipt is not None:
            try:
                existing = Receipt.objects.filter(invoice_id=inv.id).first()
                if existing:
                    log.info("Receipt already exists for invoice=%s (pi=%s). Skipping receipt create.", inv.id, pi_id)
                else:
                    receipt = Receipt.objects.create(
                        invoice=inv,
                        receipt_number=_receipt_number("RCT", inv.id),
                        stripe_payment_intent_id=pi_id,
                        stripe_charge_id=stripe_charge_id,
                        amount_paid_cents=amount_received_cents,
                        platform_fee_cents=max(platform_fee_cents, 0),
                        card_brand=card_brand,
                        card_last4=card_last4,
                    )

                    # PDF + Email (best-effort)
                    try:
                        if generate_receipt_pdf:
                            generate_receipt_pdf(receipt)
                    except Exception:
                        log.exception("Receipt PDF generation failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)

                    try:
                        if send_receipt_email:
                            send_receipt_email(receipt)
                    except Exception:
                        log.exception("Receipt email failed (receipt_id=%s, pi=%s).", getattr(receipt, "id", None), pi_id)

                    log.info(
                        "Receipt created for invoice=%s receipt=%s pi=%s amount_cents=%s platform_fee_cents=%s card=%s****%s",
                        inv.id,
                        getattr(receipt, "receipt_number", None),
                        pi_id,
                        amount_received_cents,
                        platform_fee_cents,
                        (card_brand or ""),
                        (card_last4 or ""),
                    )
            except Exception:
                log.exception("Receipt flow failed for invoice=%s (pi=%s).", inv.id, pi_id)
        else:
            log.info("Receipts app not installed; skipping receipt create for invoice=%s (pi=%s).", inv.id, pi_id)

        if changed:
            log.info("Invoice marked PAID invoice=%s pi=%s cents=%s", inv.id, pi_id, amount_received_cents)
        else:
            log.info("Invoice already paid/released invoice=%s pi=%s", inv.id, pi_id)


@csrf_exempt
def stripe_webhook(request):
    """
    Stripe webhook handler.

    Handles:
    - account.updated
    - account.application.deauthorized
    - payment_intent.succeeded
      - If metadata.invoice_id exists: mark invoice paid + generate receipt (optional)
      - Else if metadata.agreement_id exists: escrow funding (supports amendments / top-ups)

    Never returns 500 to Stripe to avoid retry storms.
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
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=sig_header,
                secret=secret,
            )
        except Exception as exc:
            log.warning("Stripe webhook signature verification failed: %s", exc)
            return HttpResponseBadRequest("Invalid signature")

        event_type = event.get("type")
        data_obj = (event.get("data") or {}).get("object") or {}

        # ─────────────────────────────────────────────
        # Connect account events
        # ─────────────────────────────────────────────
        if event_type == "account.updated":
            _update_contractor_from_account_obj(data_obj)

        elif event_type == "account.application.deauthorized":
            Contractor = _get_model("projects", "Contractor")
            acct_id = data_obj.get("id")
            if Contractor and acct_id:
                with transaction.atomic():
                    Contractor.objects.filter(stripe_account_id=acct_id).update(
                        charges_enabled=False,
                        payouts_enabled=False,
                        stripe_status_updated_at=now(),
                    )

        # ─────────────────────────────────────────────
        # Payments
        # ─────────────────────────────────────────────
        elif event_type == "payment_intent.succeeded":
            intent = data_obj
            metadata = intent.get("metadata") or {}

            # ✅ Invoice payments (magic invoice)
            if metadata.get("invoice_id"):
                try:
                    _handle_invoice_payment_succeeded(intent)
                except Exception:
                    log.exception("Invoice payment handler failed (pi=%s).", intent.get("id"))
                return HttpResponse(status=200)

            # ─────────────────────────────────────────────
            # Existing escrow funding (agreement_id) logic
            # ─────────────────────────────────────────────
            Agreement = _get_model("projects", "Agreement")
            Milestone = _get_model("projects", "Milestone")
            AgreementFundingLink = _get_model("projects", "AgreementFundingLink")

            if Agreement is None:
                log.error("Agreement model not available in webhook.")
                return HttpResponse(status=200)

            agreement_id = metadata.get("agreement_id")
            funding_link_id = metadata.get("funding_link_id")  # from CreateFundingPaymentIntentView

            if not agreement_id:
                log.warning("payment_intent.succeeded without agreement_id metadata")
                return HttpResponse(status=200)

            pi_id = intent.get("id") or ""
            paid = _to_decimal_cents(intent.get("amount_received", 0))
            currency = (intent.get("currency") or "usd").upper()

            # If we cannot read a PI id or payment amount, bail safely
            if not pi_id or paid <= 0:
                log.warning(
                    "payment_intent.succeeded missing pi_id or paid amount (pi_id=%s paid=%s)",
                    pi_id,
                    paid,
                )
                return HttpResponse(status=200)

            with transaction.atomic():
                # Idempotency should prefer the funding link record if present:
                link = None
                if funding_link_id and AgreementFundingLink is not None:
                    try:
                        link = AgreementFundingLink.objects.select_for_update().get(id=funding_link_id)
                        # If this link was already marked used, do NOT add funds again.
                        if getattr(link, "used_at", None):
                            log.info(
                                "payment_intent.succeeded already processed via funding link id=%s (pi=%s)",
                                funding_link_id,
                                pi_id,
                            )
                            return HttpResponse(status=200)
                        # If the link has a different PI recorded, treat as suspicious but avoid double-add.
                        existing_pi = getattr(link, "payment_intent_id", "") or ""
                        if existing_pi and existing_pi != pi_id:
                            log.warning(
                                "Funding link id=%s has payment_intent_id=%s but webhook PI=%s. Skipping add to prevent double-count.",
                                funding_link_id,
                                existing_pi,
                                pi_id,
                            )
                            # We still mark link inactive to prevent reuse
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
                    # If link exists, deactivate so it can't be reused
                    if link is not None:
                        try:
                            link.is_active = False
                            link.used_at = now()
                            link.save(update_fields=["is_active", "used_at"])
                        except Exception:
                            pass
                    return HttpResponse(status=200)

                # Backfill/repair missing totals at the time of funding.
                total_required = Decimal("0.00")
                if Milestone is not None:
                    total_required = _compute_total_required_for_agreement(Agreement, Milestone, ag)

                # If agreement.total_cost is missing/zero but milestone sum exists, persist it.
                try:
                    tc = getattr(ag, "total_cost", None)
                    tc_d = Decimal(str(tc or "0.00")).quantize(Decimal("0.01"))
                    if (tc is None or tc_d <= 0) and total_required > 0 and hasattr(ag, "total_cost"):
                        ag.total_cost = total_required
                except Exception:
                    pass

                # Ensure escrow_funded_amount exists
                try:
                    efa = getattr(ag, "escrow_funded_amount", None)
                    if efa is None:
                        ag.escrow_funded_amount = Decimal("0.00")
                except Exception:
                    pass

                # Add payment amount
                try:
                    ag.escrow_funded_amount = (Decimal(str(ag.escrow_funded_amount)) + paid).quantize(Decimal("0.01"))
                except Exception:
                    try:
                        ag.escrow_funded_amount = paid
                    except Exception:
                        pass

                # Persist PI id + funded_at as last-success record (useful for debugging)
                if hasattr(ag, "stripe_payment_intent_id"):
                    ag.stripe_payment_intent_id = pi_id
                if hasattr(ag, "escrow_funded_at"):
                    ag.escrow_funded_at = now()

                # Determine if fully funded
                try:
                    required = Decimal(
                        str(getattr(ag, "total_cost", None) or total_required or "0.00")
                    ).quantize(Decimal("0.01"))
                except Exception:
                    required = total_required

                if required > 0 and Decimal(str(getattr(ag, "escrow_funded_amount", "0.00"))) >= required:
                    if hasattr(ag, "escrow_funded"):
                        ag.escrow_funded = True

                # Save agreement fields
                update_fields = []
                for f in ("total_cost", "escrow_funded_amount", "escrow_funded", "escrow_funded_at", "stripe_payment_intent_id"):
                    if hasattr(ag, f):
                        update_fields.append(f)
                if update_fields:
                    ag.save(update_fields=update_fields)

                # Mark funding link used/inactive
                if link is not None:
                    try:
                        link.used_at = now()
                        link.is_active = False
                        link.save(update_fields=["used_at", "is_active"])
                    except Exception:
                        log.exception("Failed updating AgreementFundingLink used_at for id=%s", getattr(link, "id", None))

                log.info(
                    "Escrow payment recorded: agreement=%s paid=%s %s funded_total=%s required=%s pi=%s link_id=%s",
                    agreement_id,
                    paid,
                    currency,
                    getattr(ag, "escrow_funded_amount", None),
                    required,
                    pi_id,
                    funding_link_id,
                )

        return HttpResponse(status=200)

    except Exception as exc:
        log.exception("Unhandled error in stripe_webhook: %s", exc)
        return HttpResponse(status=200)
