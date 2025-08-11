# projects/stripe_config.py
import stripe # type: ignore
from django.conf import settings

stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", None)
