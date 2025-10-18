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
