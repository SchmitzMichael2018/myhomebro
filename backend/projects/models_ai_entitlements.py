# backend/projects/models_ai_entitlements.py
# v2026-01-22 — Contractor AI Entitlements (Step A)

from __future__ import annotations

from django.db import models
from django.utils import timezone


class ContractorAIEntitlement(models.Model):
    """
    Step A: Track who is entitled to generate which AI artifacts,
    how many free uses remain, and the current tier.

    Stripe fields are included for Step C but not required yet.
    """

    TIER_FREE = "free"
    TIER_STARTER = "starter"
    TIER_PRO = "pro"
    TIER_BUSINESS = "business"

    TIER_CHOICES = (
        (TIER_FREE, "Free"),
        (TIER_STARTER, "Starter"),
        (TIER_PRO, "Pro"),
        (TIER_BUSINESS, "Business"),
    )

    contractor = models.OneToOneField(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="ai_entitlement",
    )

    # Core tier
    tier = models.CharField(
        max_length=24,
        choices=TIER_CHOICES,
        default=TIER_FREE,
        db_index=True,
    )

    # ---------
    # Free / quota buckets (Step A)
    # ---------
    # One-time free uses to let contractors experience value before paying
    free_recommendations_remaining = models.PositiveIntegerField(default=1)

    # Monthly quotas for Starter (optional now; used in Step C)
    monthly_recommendations_included = models.PositiveIntegerField(default=2)
    monthly_recommendations_used = models.PositiveIntegerField(default=0)
    quota_period_start = models.DateTimeField(null=True, blank=True)
    quota_period_end = models.DateTimeField(null=True, blank=True)

    # Feature toggles (keep it simple + explicit)
    allow_ai_summaries = models.BooleanField(default=True)          # recommended to keep True for all
    allow_ai_recommendations = models.BooleanField(default=True)    # entitlements still gate the actual generation
    allow_scope_assistant = models.BooleanField(default=False)      # future service
    allow_resolution_agreement = models.BooleanField(default=False) # future service
    allow_business_insights = models.BooleanField(default=False)    # future service

    # ----------
    # Subscription placeholders (Step C)
    # ----------
    subscription_active = models.BooleanField(default=False)
    stripe_customer_id = models.CharField(max_length=128, blank=True, default="")
    stripe_subscription_id = models.CharField(max_length=128, blank=True, default="")
    current_period_end = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self) -> str:
        return f"ContractorAIEntitlement(contractor_id={self.contractor_id}, tier={self.tier})"

    # -----------------------
    # Tier logic
    # -----------------------
    def is_unlimited_recommendations(self) -> bool:
        # Pro/Business: unlimited recommendations once subscription is active OR tier itself implies it.
        # For Step A: we treat tier=pro/business as unlimited (you can flip to require subscription_active later).
        return self.tier in (self.TIER_PRO, self.TIER_BUSINESS)

    def can_generate_recommendation(self) -> bool:
        if not self.allow_ai_recommendations:
            return False
        if self.is_unlimited_recommendations():
            return True
        if self.free_recommendations_remaining > 0:
            return True
        # Starter monthly quota (optional now; becomes important in Step C)
        if self.tier == self.TIER_STARTER and self.monthly_recommendations_used < self.monthly_recommendations_included:
            return True
        return False

    def consume_recommendation_quota(self) -> None:
        """
        Call this only when we actually generate a NEW recommendation (not when returning cached/stored).
        """
        if self.is_unlimited_recommendations():
            return

        if self.free_recommendations_remaining > 0:
            self.free_recommendations_remaining -= 1
            self.save(update_fields=["free_recommendations_remaining", "updated_at"])
            return

        if self.tier == self.TIER_STARTER:
            # initialize a quota period if not present
            now = timezone.now()
            if not self.quota_period_start or not self.quota_period_end:
                self.quota_period_start = now
                self.quota_period_end = now + timezone.timedelta(days=30)
                self.monthly_recommendations_used = 0

            # If period expired, reset
            if self.quota_period_end and now > self.quota_period_end:
                self.quota_period_start = now
                self.quota_period_end = now + timezone.timedelta(days=30)
                self.monthly_recommendations_used = 0

            if self.monthly_recommendations_used < self.monthly_recommendations_included:
                self.monthly_recommendations_used += 1
                self.save(
                    update_fields=[
                        "monthly_recommendations_used",
                        "quota_period_start",
                        "quota_period_end",
                        "updated_at",
                    ]
                )
                return
