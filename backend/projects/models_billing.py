# backend/projects/models_billing.py
from __future__ import annotations

from django.db import models

from projects.models import Contractor


class ContractorBillingProfile(models.Model):
    """
    Deprecated historical model retained for migration compatibility.
    Runtime AI access no longer depends on billing profile state.
    """

    TIER_FREE = "free"
    TIER_AI_PRO = "ai_pro"

    TIER_CHOICES = (
        (TIER_FREE, "Free"),
        (TIER_AI_PRO, "Legacy AI Pro"),
    )

    contractor = models.OneToOneField(
        Contractor,
        on_delete=models.CASCADE,
        related_name="billing_profile",
    )

    ai_subscription_active = models.BooleanField(default=False)
    ai_subscription_tier = models.CharField(
        max_length=24,
        choices=TIER_CHOICES,
        default=TIER_FREE,
    )

    # Future-ready (add later without changing fee logic):
    stripe_customer_id = models.CharField(max_length=255, blank=True, default="")
    stripe_subscription_id = models.CharField(max_length=255, blank=True, default="")
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return (
            f"BillingProfile(contractor_id={self.contractor_id}, "
            f"ai_active={self.ai_subscription_active}, tier={self.ai_subscription_tier})"
        )
