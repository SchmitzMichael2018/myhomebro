# backend/backend/projects/views/stripe_webhook.py
import logging
import stripe  # Stripe official SDK
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt

from ..models import Agreement

# Configure Stripe
stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", "")

@csrf_exempt
def stripe_webhook(request):
    """
    Handle Stripe webhooks.
    We mark Agreement.escrow_funded=True when a payment_intent.succeeded includes agreement_id in metadata.
    """
    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    endpoint_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", None)

    if not endpoint_secret:
        logging.error("Stripe webhook secret is not configured in settings.")
        return HttpResponse("Webhook secret not configured.", status=500)

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        return HttpResponseBadRequest("Invalid payload")
    except stripe.error.SignatureVerificationError:
        return HttpResponseForbidden("Invalid signature")

    if event.get("type") == "payment_intent.succeeded":
        intent = event["data"]["object"]
        agreement_id = intent.get("metadata", {}).get("agreement_id")

        if agreement_id:
            try:
                with transaction.atomic():
                    agr = Agreement.objects.select_for_update().get(id=agreement_id)
                    if not agr.escrow_funded:
                        agr.escrow_funded = True
                        agr.save(update_fields=["escrow_funded"])
                        logging.info("Escrow funded for Agreement ID=%s", agreement_id)
            except Agreement.DoesNotExist:
                logging.warning("Webhook received for non-existent Agreement ID=%s", agreement_id)

    return HttpResponse(status=200)
