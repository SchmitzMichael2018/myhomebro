# backend/projects/models_ai_usage.py
# v2026-03-04 — Agreement-level AI usage ledger (Option A)
#
# IMPORTANT:
# - NO imports from projects.models (avoids circular import)
# - NO self-imports (avoids partially initialized module errors)
#
# Implements:
# - 1 credit = 1 agreement (ledger row created once per agreement)

from __future__ import annotations

from django.db import models
from django.utils import timezone


class AIAgreementFeature(models.TextChoices):
    # Agreement-level “bundle” credit: 1 credit = 1 agreement
    AGREEMENT_BUNDLE = "agreement_bundle", "Agreement AI Bundle"


class AIAgreementUsage(models.Model):
    """
    Option A ledger:
      - Uniqueness prevents double-charging:
          (contractor, agreement_id, feature_key) unique

    We only use AGREEMENT_BUNDLE for now, which implements:
      - First AI use on an agreement consumes 1 credit
      - Regenerate is free for that agreement
    """

    contractor = models.ForeignKey(
        "projects.Contractor",  # ✅ string ref avoids importing projects.models
        on_delete=models.CASCADE,
        related_name="ai_agreement_usages",
    )

    agreement_id = models.PositiveIntegerField(db_index=True)

    feature_key = models.CharField(
        max_length=64,
        choices=AIAgreementFeature.choices,
        db_index=True,
    )

    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["contractor", "agreement_id", "feature_key"],
                name="uniq_ai_usage_contractor_agreement_feature",
            )
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return (
            f"AIAgreementUsage(contractor={self.contractor_id}, "
            f"agreement={self.agreement_id}, feature={self.feature_key})"
        )