# backend/projects/models_ai_artifacts.py
# v2026-01-22 — Persisted AI artifacts for dispute audit + pricing

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

from django.conf import settings
from django.db import models


class DisputeAIArtifact(models.Model):
    """
    Stores AI outputs for a dispute (summary, recommendation, etc.) so you can:
      - audit what the AI said and when
      - avoid re-calling OpenAI repeatedly
      - gate generation behind payment later
      - version results as evidence changes
    """

    ARTIFACT_SUMMARY = "summary"
    ARTIFACT_RECOMMENDATION = "recommendation"

    ARTIFACT_TYPES = (
        (ARTIFACT_SUMMARY, "Summary"),
        (ARTIFACT_RECOMMENDATION, "Recommendation"),
    )

    dispute = models.ForeignKey(
        "projects.Dispute",
        on_delete=models.CASCADE,
        related_name="ai_artifacts",
        db_index=True,
    )

    artifact_type = models.CharField(
        max_length=32,
        choices=ARTIFACT_TYPES,
        db_index=True,
    )

    # version increments as evidence changes or force=True
    version = models.PositiveIntegerField(default=1)

    # digest of evidence context payload
    input_digest = models.CharField(max_length=64, db_index=True)

    model_name = models.CharField(max_length=128, blank=True, default="")

    # persisted AI output
    payload = models.JSONField(default=dict)

    # who generated it
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dispute_ai_artifacts",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # --- future monetization fields ---
    paid = models.BooleanField(default=False)
    price_cents = models.PositiveIntegerField(null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        indexes = [
            models.Index(fields=["dispute", "artifact_type", "input_digest"]),
            models.Index(fields=["dispute", "artifact_type", "version"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"DisputeAIArtifact(dispute_id={self.dispute_id}, type={self.artifact_type}, v={self.version})"

    @staticmethod
    def compute_digest(evidence_context: Dict[str, Any]) -> str:
        """
        Deterministic hash of evidence context used for cache/version logic.
        """
        try:
            raw = json.dumps(
                evidence_context,
                sort_keys=True,
                ensure_ascii=False,
                default=str,
            )
        except Exception:
            raw = str(evidence_context)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
