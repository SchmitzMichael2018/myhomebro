# backend/payments/webhooks.py
# Unified Stripe webhook (Connect + escrow funding with amendment support)
#
# v2025-12-13: funding state hardening
# - verifies webhook signature
# - handles account.updated / account.application.deauthorized
# - handles payment_intent.succeeded for escrow funding
#   - idempotent (won't double-add on Stripe retries)
#   - persists: escrow_funded_amount, escrow_funded, escrow_funded_at, stripe_payment_intent_id
#   - backfills total_cost from milestones if missing/zero
#   - marks AgreementFundingLink used_at + inactive

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


@csrf_exempt
def stripe_webhook(request):
    """
    Stripe webhook handler.

    Handles:
    - account.updated
    - account.application.deauthorized
    - payment_intent.succeeded (escrow funding, supports amendments / top-ups)

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
        # Escrow funding (payment_intent.succeeded)
        # ─────────────────────────────────────────────
        elif event_type == "payment_intent.succeeded":
            Agreement = _get_model("projects", "Agreement")
            Milestone = _get_model("projects", "Milestone")
            AgreementFundingLink = _get_model("projects", "AgreementFundingLink")

            if Agreement is None:
                log.error("Agreement model not available in webhook.")
                return HttpResponse(status=200)

            intent = data_obj
            metadata = intent.get("metadata") or {}

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
                # Stripe retries webhook events; without a guard you will add 'paid' again.
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
                    # if field doesn't exist we can't persist amounts (but your model has it)
                    pass

                # Add payment amount
                try:
                    ag.escrow_funded_amount = (Decimal(str(ag.escrow_funded_amount)) + paid).quantize(Decimal("0.01"))
                except Exception:
                    # last-resort
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
                    required = Decimal(str(getattr(ag, "total_cost", None) or total_required or "0.00")).quantize(Decimal("0.01"))
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
