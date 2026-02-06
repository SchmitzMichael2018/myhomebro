# backend/projects/models_ai_purchases.py
# v2026-01-22 — Stripe Checkout purchases for AI (no webhook required)

from __future__ import annotations

from django.conf import settings
from django.db import models


class DisputeAIPurchase(models.Model):
    """
    Records Stripe Checkout purchases for AI generation tied to:
      - dispute_id
      - artifact_type
      - evidence digest (input_digest)

    We avoid webhooks for Step B by verifying checkout sessions on demand.
    """

    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_CANCELED = "canceled"

    STATUS_CHOICES = (
        (STATUS_PENDING, "Pending"),
        (STATUS_PAID, "Paid"),
        (STATUS_CANCELED, "Canceled"),
    )

    artifact_type = models.CharField(max_length=32, db_index=True)  # e.g. "recommendation"
    dispute = models.ForeignKey(
        "projects.Dispute",
        on_delete=models.CASCADE,
        related_name="ai_purchases",
        db_index=True,
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="ai_purchases",
        db_index=True,
    )

    input_digest = models.CharField(max_length=64, db_index=True)

    price_cents = models.PositiveIntegerField(default=2900)
    currency = models.CharField(max_length=8, default="usd")

    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )

    stripe_session_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stripe_payment_intent_id = models.CharField(max_length=255, blank=True, default="", db_index=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ai_purchases_created",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["dispute", "artifact_type", "input_digest", "status"]),
            models.Index(fields=["stripe_session_id"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return (
            f"DisputeAIPurchase(dispute_id={self.dispute_id}, "
            f"type={self.artifact_type}, status={self.status}, cents={self.price_cents})"
        )
