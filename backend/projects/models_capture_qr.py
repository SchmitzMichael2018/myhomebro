from __future__ import annotations

import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class CaptureQrAsset(models.Model):
    TYPE_BUSINESS_CARD = "business_card"
    TYPE_CHOICES = tuple(
        (value, value.replace("_", " ").title())
        for value in (
            TYPE_BUSINESS_CARD, "truck", "trailer", "yard_sign", "flyer",
            "door_hanger", "home_show", "referral_partner", "social_media",
            "website", "custom",
        )
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="capture_qr_assets")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_capture_qr_assets")
    profile = models.ForeignKey("projects.ContractorPublicProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="capture_qr_assets")
    label = models.CharField(max_length=120)
    asset_type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_BUSINESS_CARD)
    campaign_key = models.SlugField(max_length=80, blank=True, default="")
    source_detail = models.CharField(max_length=80, blank=True, default=TYPE_BUSINESS_CARD)
    token_key = models.CharField(max_length=96, editable=False)
    token_hash = models.CharField(max_length=64, unique=True, db_index=True, editable=False)
    active = models.BooleanField(default=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    rotated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def rotate_key(self):
        self.token_key = secrets.token_urlsafe(32)
        self.token_hash = hashlib.sha256(self.token_key.encode()).hexdigest()
        self.rotated_at = timezone.now()

    @property
    def available(self):
        return bool(
            self.active
            and not self.revoked_at
            and (not self.expires_at or self.expires_at > timezone.now())
        )

    def save(self, *args, **kwargs):
        if not self.token_key:
            self.rotate_key()
        if not self.source_detail:
            self.source_detail = self.asset_type
        super().save(*args, **kwargs)


class CaptureQrEvent(models.Model):
    EVENT_VIEWED = "viewed"
    EVENT_FORM_STARTED = "form_started"
    EVENT_SUBMITTED = "submitted"
    EVENT_DEACTIVATED = "deactivated"
    EVENT_ACTIVATED = "activated"
    EVENT_ROTATED = "rotated"
    EVENT_REVOKED = "revoked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(CaptureQrAsset, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=32, db_index=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    capture = models.ForeignKey("projects.Capture", on_delete=models.SET_NULL, null=True, blank=True, related_name="qr_events")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


class CaptureQrSubmission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(CaptureQrAsset, on_delete=models.CASCADE, related_name="submissions")
    form_token_hash = models.CharField(max_length=64)
    payload_hash = models.CharField(max_length=64)
    capture = models.OneToOneField("projects.Capture", on_delete=models.PROTECT, related_name="qr_submission")
    public_lead = models.OneToOneField("projects.PublicContractorLead", on_delete=models.PROTECT, related_name="qr_submission")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "form_token_hash"], name="uniq_capture_qr_form_token")
        ]
