# backend/projects/models_ai_entitlements.py
# Deprecated historical model retained only so old migrations and stored rows
# remain readable. Active runtime AI access no longer depends on entitlements,
# credits, tiers, subscriptions, or purchases.

from __future__ import annotations

from datetime import timedelta

from django.db import models
from django.utils import timezone


def _now():
    return timezone.now()


def _default_period(days: int = 30):
    start = _now()
    end = start + timedelta(days=days)
    return start, end


class ContractorAIEntitlement(models.Model):
    TIER_FREE = "free"
    TIER_STARTER = "starter"
    TIER_PRO = "pro"
    TIER_BUSINESS = "business"

    # --- existing / core identity ---
    contractor_id = models.IntegerField(null=True, blank=True, db_index=True)

    # --- existing tier/subscription fields (keep) ---
    tier = models.CharField(max_length=64, default=TIER_FREE)
    subscription_active = models.BooleanField(default=False)

    # --- existing recommendation quota fields (keep) ---
    free_recommendations_remaining = models.IntegerField(default=0)
    monthly_recommendations_included = models.IntegerField(default=0)
    monthly_recommendations_used = models.IntegerField(default=0)
    quota_period_start = models.DateTimeField(null=True, blank=True)
    quota_period_end = models.DateTimeField(null=True, blank=True)

    # --- existing flags (keep) ---
    allow_ai_summaries = models.BooleanField(default=False)
    allow_ai_recommendations = models.BooleanField(default=False)
    allow_scope_assistant = models.BooleanField(default=False)
    allow_resolution_agreement = models.BooleanField(default=False)
    allow_business_insights = models.BooleanField(default=False)

    # ------------------------------------------------------------
    # NEW: Scope Assistant Credits / Quota
    # ------------------------------------------------------------

    # Unlimited flag for scope assistant (Pro)
    scope_unlimited = models.BooleanField(default=False)

    # Free / intro credits (one-time bucket)
    free_scope_credits_remaining = models.IntegerField(default=0)

    # Monthly included scope credits (paid tiers)
    monthly_scope_credits_included = models.IntegerField(default=0)
    monthly_scope_credits_used = models.IntegerField(default=0)

    # Separate quota window for scope (lets you reset scope monthly independently)
    scope_quota_period_start = models.DateTimeField(null=True, blank=True)
    scope_quota_period_end = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ---------------- Existing method (keep your API compatibility) ----------------

    def can_generate_recommendation(self) -> bool:
        """
        Existing method used by ai_entitlements_views.py.
        Leave behavior as-is, but make it robust to missing period.
        """
        if not self.allow_ai_recommendations:
            return False

        # If you have free recommendations, allow.
        if int(self.free_recommendations_remaining or 0) > 0:
            return True

        # If subscription is active and monthly quota exists, allow if not exhausted.
        if bool(self.subscription_active) and int(self.monthly_recommendations_included or 0) > 0:
            self._ensure_reco_quota_window()
            remaining = int(self.monthly_recommendations_included or 0) - int(self.monthly_recommendations_used or 0)
            return remaining > 0

        return False

    def _ensure_reco_quota_window(self):
        """
        Ensure recommendation quota window exists and resets if expired.
        """
        if not self.quota_period_start or not self.quota_period_end:
            s, e = _default_period()
            self.quota_period_start = s
            self.quota_period_end = e
            self.save(update_fields=["quota_period_start", "quota_period_end", "updated_at"])
            return

        if _now() >= self.quota_period_end:
            # reset usage for new period
            s, e = _default_period()
            self.quota_period_start = s
            self.quota_period_end = e
            self.monthly_recommendations_used = 0
            self.save(update_fields=["quota_period_start", "quota_period_end", "monthly_recommendations_used", "updated_at"])

    # ---------------- NEW: Scope assistant helpers ----------------

    def _ensure_scope_quota_window(self):
        """
        Ensure scope quota window exists and resets if expired.
        """
        if not self.scope_quota_period_start or not self.scope_quota_period_end:
            s, e = _default_period()
            self.scope_quota_period_start = s
            self.scope_quota_period_end = e
            self.save(update_fields=["scope_quota_period_start", "scope_quota_period_end", "updated_at"])
            return

        if _now() >= self.scope_quota_period_end:
            s, e = _default_period()
            self.scope_quota_period_start = s
            self.scope_quota_period_end = e
            self.monthly_scope_credits_used = 0
            self.save(update_fields=["scope_quota_period_start", "scope_quota_period_end", "monthly_scope_credits_used", "updated_at"])

    def scope_credits_remaining(self) -> int:
        """
        Returns total remaining credits available for scope assistant:
          - Unlimited -> large sentinel (but UI should use scope_unlimited)
          - Monthly bucket (included - used) if subscription active
          - Plus free bucket (intro)
        """
        if bool(self.scope_unlimited):
            return 10**9  # sentinel; UI should check scope_unlimited

        remaining = 0

        # Monthly bucket first (paid plans)
        if bool(self.subscription_active) and int(self.monthly_scope_credits_included or 0) > 0:
            self._ensure_scope_quota_window()
            monthly_left = int(self.monthly_scope_credits_included or 0) - int(self.monthly_scope_credits_used or 0)
            remaining += max(monthly_left, 0)

        # Free bucket (intro / grants)
        remaining += max(int(self.free_scope_credits_remaining or 0), 0)
        return remaining

    def can_generate_scope(self) -> bool:
        """
        SINGLE SOURCE OF TRUTH for Step 1/2 AI Scope Assistant:
          - If unlimited -> allow
          - If any credits remain -> allow (this fixes Ben)
          - Otherwise deny
        NOTE: allow_scope_assistant can remain as a "feature present" flag for plans,
        but credits remaining is what actually enables usage in intro/free tiers.
        """
        if bool(self.scope_unlimited):
            return True

        # If a plan explicitly enables the feature, still require credits unless unlimited.
        # BUT intro can still work even if allow_scope_assistant is False as long as credits exist.
        return self.scope_credits_remaining() > 0

    def consume_scope_credit(self, cost: int = 1) -> bool:
        """
        Consume credits for a scope action.
        Returns True if consumed or unlimited, False if not enough credits.
        Consumption order:
          1) monthly included credits (if subscription active)
          2) free bucket
        """
        cost = int(cost or 1)
        if cost <= 0:
            cost = 1

        if bool(self.scope_unlimited):
            return True

        # Keep quota windows fresh
        if bool(self.subscription_active) and int(self.monthly_scope_credits_included or 0) > 0:
            self._ensure_scope_quota_window()

        # Check total available
        if self.scope_credits_remaining() < cost:
            return False

        # Spend from monthly first
        if bool(self.subscription_active) and int(self.monthly_scope_credits_included or 0) > 0:
            monthly_left = int(self.monthly_scope_credits_included or 0) - int(self.monthly_scope_credits_used or 0)
            if monthly_left > 0:
                take = min(monthly_left, cost)
                self.monthly_scope_credits_used = int(self.monthly_scope_credits_used or 0) + take
                cost -= take

        # Then spend from free bucket
        if cost > 0:
            self.free_scope_credits_remaining = max(int(self.free_scope_credits_remaining or 0) - cost, 0)

        self.save(update_fields=["monthly_scope_credits_used", "free_scope_credits_remaining", "updated_at"])
        return True
