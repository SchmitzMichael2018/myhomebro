# backend/payments/stripe_config.py
"""
Central Stripe configuration for the backend.
Use:
    from payments.stripe_config import stripe
"""
import stripe  # type: ignore
from django.conf import settings

# Prefer STRIPE_API_KEY, fallback to legacy STRIPE_SECRET_KEY
stripe.api_key = (
    getattr(settings, "STRIPE_API_KEY", None)
    or getattr(settings, "STRIPE_SECRET_KEY", None)
)

# Optional: pin an API version if you define it
api_version = getattr(settings, "STRIPE_API_VERSION", None)
if api_version:
    stripe.api_version = api_version
