# backend/payments/webhooks.py
# Unified Stripe webhook (Connect account events + escrow funding)
# Hardened: no risky imports at module import time; lazy imports inside handler.

import logging
import os

from django.apps import apps
from django.conf import settings
from django.db import transaction
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
        log.warning("Contractor model unavailable in webhook.")
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
        updated = (
            Contractor.objects.filter(stripe_account_id=acct_id)
            .update(
                **({"charges_enabled": charges_enabled} if hasattr(Contractor, "charges_enabled") else {}),
                **({"payouts_enabled": payouts_enabled} if hasattr(Contractor, "payouts_enabled") else {}),
                **({"details_submitted": details_submitted} if hasattr(Contractor, "details_submitted") else {}),
                **({"requirements_due_count": requirements_due_count} if hasattr(Contractor, "requirements_due_count") else {}),
                **({"stripe_status_updated_at": now()} if hasattr(Contractor, "stripe_status_updated_at") else {}),
            )
        )
    return updated


@csrf_exempt
def stripe_webhook(request):
    """
    - HEAD/GET: 200 OK with brief text (probes)
    - POST: verify signature and process events:
        * account.updated / account.application.deauthorized / account.external_account.*
        * payment_intent.succeeded (escrow funded) with metadata.agreement_id
    Never 500s: unexpected exceptions are logged and we still return 200 to avoid Stripe retry storms.
    """
    try:
        # Friendly probes
        if request.method in ("GET", "HEAD"):
            return HttpResponse("Stripe webhook endpoint is live.", status=200, content_type="text/plain")

        if request.method != "POST":
            return HttpResponseBadRequest("Invalid method")

        secret = _webhook_secret()
        if not secret:
            log.warning("Stripe webhook called but STRIPE_WEBHOOK_SECRET not configured.")
            return HttpResponseBadRequest("Webhook secret not configured")

        # Lazy import stripe SDK only when needed
        try:
            import stripe  # type: ignore
        except Exception as exc:
            log.exception("Stripe SDK import failed: %s", exc)
            return HttpResponse("ok", status=200, content_type="text/plain")

        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

        try:
            event = stripe.Webhook.construct_event(payload=payload, sig_header=sig_header, secret=secret)
        except Exception as exc:
            log.warning("Stripe webhook signature verification failed: %s", exc)
            return HttpResponseBadRequest(f"Webhook signature verification failed: {exc}")

        event_type = event.get("type")
        data_obj = (event.get("data") or {}).get("object") or {}

        # ---- Connect account events ----
        if event_type == "account.updated":
            updated = _update_contractor_from_account_obj(data_obj)
            if updated == 0:
                log.info("account.updated for unknown acct=%s (no matching Contractor)", data_obj.get("id"))

        elif event_type == "account.application.deauthorized":
            Contractor = _get_model("projects", "Contractor")
            acct_id = data_obj.get("id")
            if Contractor and acct_id:
                with transaction.atomic():
                    q = Contractor.objects.filter(stripe_account_id=acct_id)
                    fields = {}
                    if hasattr(Contractor, "charges_enabled"):
                        fields["charges_enabled"] = False
                    if hasattr(Contractor, "payouts_enabled"):
                        fields["payouts_enabled"] = False
                    if hasattr(Contractor, "requirements_due_count"):
                        fields["requirements_due_count"] = 0
                    if hasattr(Contractor, "stripe_status_updated_at"):
                        fields["stripe_status_updated_at"] = now()
                    if hasattr(Contractor, "stripe_deauthorized_at"):
                        fields["stripe_deauthorized_at"] = now()
                    if fields:
                        q.update(**fields)
            else:
                log.info("account.application.deauthorized with no account id or Contractor missing")

        elif event_type in {
            "account.external_account.created",
            "account.external_account.updated",
            "account.external_account.deleted",
        }:
            acct_id = data_obj.get("account") or data_obj.get("id")
            log.debug("external_account event=%s for acct=%s", event_type, acct_id)

        # ---- Escrow funding via PaymentIntent success ----
        elif event_type == "payment_intent.succeeded":
            Agreement = _get_model("projects", "Agreement")
            if Agreement is None:
                log.warning("Agreement model unavailable in webhook.")
            else:
                intent = event["data"]["object"]
                agreement_id = (intent.get("metadata") or {}).get("agreement_id")
                if agreement_id:
                    try:
                        with transaction.atomic():
                            agr = Agreement.objects.select_for_update().get(id=agreement_id)
                            if not agr.escrow_funded:
                                agr.escrow_funded = True
                                agr.save(update_fields=["escrow_funded"])
                                log.info("Escrow funded for Agreement ID=%s", agreement_id)
                    except Agreement.DoesNotExist:
                        log.warning("Webhook received for non-existent Agreement ID=%s", agreement_id)

        # Always 200 for handled events
        return HttpResponse(status=200)

    except Exception as exc:
        log.exception("Unhandled error in stripe_webhook: %s", exc)
        # Return 200 so Stripe does not retry-bomb; we're logging the exception for follow-up.
        return HttpResponse("ok", status=200, content_type="text/plain")
