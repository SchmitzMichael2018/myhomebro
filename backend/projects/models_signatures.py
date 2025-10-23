# backend/projects/models_signatures.py
# v2025-10-18 — FIX: remove duplicate Agreement model; use string FK

from django.db import models
from django.conf import settings

class AgreementSignature(models.Model):
    ROLE_CHOICES = (
        ("contractor", "Contractor"),
        ("homeowner", "Homeowner"),
    )

    # IMPORTANT: String reference avoids importing Agreement and any circulars.
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="signatures",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    typed_name = models.CharField(max_length=255, blank=True)
    image_base64 = models.TextField(blank=True)  # data URL or plain base64
    signed_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        indexes = [
            models.Index(fields=["agreement", "role"]),
        ]
        unique_together = (("agreement", "role"),)

    def __str__(self):
        return f"{self.agreement_id} / {self.role} / {self.typed_name or '—'}"
