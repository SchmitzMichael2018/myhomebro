# ~/backend/backend/payments/models.py
from __future__ import annotations

from django.conf import settings
from django.db import models


class ConnectedAccount(models.Model):
    """
    One Stripe Connect account per authenticated user.
    We cache Stripe flags locally for quick UI reads, but Stripe remains SoT.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connected_account",
        unique=True,
    )
    # Allow null so multiple "no account yet" rows don't violate uniqueness.
    stripe_account_id = models.CharField(max_length=255, unique=True, null=True, blank=True)

    charges_enabled = models.BooleanField(default=False)
    payouts_enabled = models.BooleanField(default=False)
    details_submitted = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def link(self, acct_id: str) -> None:
        """Link this profile to a Stripe acct id if not already the same."""
        if acct_id and self.stripe_account_id != acct_id:
            self.stripe_account_id = acct_id
            self.save(update_fields=["stripe_account_id", "updated_at"])

    def set_flags(self, *, charges: bool, payouts: bool, submitted: bool) -> None:
        changed = (
            self.charges_enabled != charges
            or self.payouts_enabled != payouts
            or self.details_submitted != submitted
        )
        if changed:
            self.charges_enabled = charges
            self.payouts_enabled = payouts
            self.details_submitted = submitted
            self.save(update_fields=["charges_enabled", "payouts_enabled", "details_submitted", "updated_at"])

    def __str__(self) -> str:  # pragma: no cover
        acct = self.stripe_account_id or "unlinked"
        return f"ConnectedAccount(user={self.user_id}, acct={acct})"
class Payment(models.Model):
    """
    Stores the funding payment for an Agreement (escrow deposit).
    """
    STATUS_CHOICES = [
        ("requires_payment_method", "Requires Payment Method"),
        ("requires_confirmation", "Requires Confirmation"),
        ("requires_action", "Requires Action"),
        ("processing", "Processing"),
        ("succeeded", "Succeeded"),
        ("canceled", "Canceled"),
        ("failed", "Failed"),
    ]

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="payments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    stripe_payment_intent_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    stripe_charge_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)

    amount_cents = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=10, default="usd")

    status = models.CharField(max_length=64, choices=STATUS_CHOICES, default="processing")

    # If payout happened, set this; for your “refund escrow only” case it should be NULL/blank
    stripe_transfer_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)

    def __str__(self):
        return f"Payment {self.id} (Agreement {self.agreement_id})"


class Refund(models.Model):
    """
    Logs Stripe refunds issued against a Payment.
    """
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
    ]

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="refunds")
    created_at = models.DateTimeField(auto_now_add=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_refunds",
    )

    amount_cents = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=10, default="usd")

    reason = models.CharField(max_length=255, blank=True, default="")
    note = models.TextField(blank=True, default="")

    stripe_refund_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default="pending")
    error_message = models.TextField(blank=True, default="")

    def __str__(self):
        return f"Refund {self.id} (Payment {self.payment_id})"