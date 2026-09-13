from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class PlatformFeePromotionGrant(models.Model):
    """An owner-issued platform-fee waiver for one contractor and a fixed window."""

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="platform_fee_promotion_grants",
    )
    code = models.SlugField(max_length=64, db_index=True)
    waiver_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("100.00"))
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    active = models.BooleanField(default=True, db_index=True)
    reason = models.CharField(max_length=255, blank=True, default="")
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="platform_fee_promotions_granted",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["contractor", "code"], name="uniq_platform_promo_contractor_code"),
        ]

    def clean(self):
        errors = {}
        if self.ends_at and self.starts_at and self.ends_at <= self.starts_at:
            errors["ends_at"] = "End time must be after the start time."
        if self.waiver_percent is not None and not (Decimal("0.00") < self.waiver_percent <= Decimal("100.00")):
            errors["waiver_percent"] = "Waiver must be greater than 0% and no more than 100%."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = str(self.code or "").strip().upper()
        self.full_clean()
        return super().save(*args, **kwargs)

    def is_effective(self, at=None) -> bool:
        at = at or timezone.now()
        return bool(self.active and self.starts_at <= at < self.ends_at)

    def __str__(self):
        return f"{self.code} — {self.contractor} ({self.waiver_percent}% waiver)"


class PlatformFeePromotionAuditEvent(models.Model):
    ACTION_CREATED = "created"
    ACTION_UPDATED = "updated"
    ACTION_DEACTIVATED = "deactivated"
    ACTION_APPLIED = "applied"
    ACTION_CHOICES = [
        (ACTION_CREATED, "Created"),
        (ACTION_UPDATED, "Updated"),
        (ACTION_DEACTIVATED, "Deactivated"),
        (ACTION_APPLIED, "Applied"),
    ]

    grant = models.ForeignKey(
        PlatformFeePromotionGrant,
        on_delete=models.PROTECT,
        related_name="audit_events",
    )
    action = models.CharField(max_length=24, choices=ACTION_CHOICES, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="platform_fee_promotion_events",
    )
    project_id_snapshot = models.PositiveBigIntegerField(null=True, blank=True)
    context = models.CharField(max_length=64, blank=True, default="")
    original_fee_cents = models.PositiveIntegerField(default=0)
    waived_fee_cents = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

