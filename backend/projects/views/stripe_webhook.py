import logging
import stripe # type: ignore
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from projects.stripe_config import stripe

from ..models import Agreement

# Initialize Stripe API key
stripe.api_key = settings.STRIPE_SECRET_KEY

@csrf_exempt
def stripe_webhook(request):
    """
    Handles incoming Stripe webhooks, specifically payment_intent.succeeded,
    to mark Agreements as escrow funded.
    """
    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    endpoint_secret = getattr(settings, 'STRIPE_WEBHOOK_SECRET', None)

    if not endpoint_secret:
        logging.error("Stripe webhook secret is not configured in settings.")
        return HttpResponse("Webhook secret not configured.", status=500)

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, endpoint_secret
        )
    except ValueError:
        return HttpResponseBadRequest("Invalid payload")
    except stripe.error.SignatureVerificationError:
        return HttpResponseForbidden("Invalid signature")

    # Only handle successful payment intents
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
                        logging.info(f"Escrow successfully funded for Agreement ID: {agreement_id}")
            except Agreement.DoesNotExist:
                logging.warning(f"Webhook received for non-existent Agreement ID: {agreement_id}")

    return HttpResponse(status=200)
