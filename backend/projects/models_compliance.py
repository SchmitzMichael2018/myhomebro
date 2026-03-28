from __future__ import annotations

from datetime import date

from django.db import models
from django.utils import timezone


def contractor_compliance_upload_to(instance, filename: str) -> str:
    contractor_id = getattr(instance, "contractor_id", None) or "unknown"
    ts = timezone.now().strftime("%Y%m%d-%H%M%S")
    return f"contractor_compliance/{contractor_id}/{ts}_{filename}"


class StateTradeLicenseRequirement(models.Model):
    class SourceType(models.TextChoices):
        MANUAL = "manual", "Manual"
        PORTAL = "portal", "Portal"
        DATASET = "dataset", "Dataset"
        API = "api", "API"
        UNKNOWN = "unknown", "Unknown"

    state_code = models.CharField(max_length=2, db_index=True)
    state_name = models.CharField(max_length=64, blank=True, default="")
    trade_key = models.CharField(max_length=64, db_index=True)
    trade_label = models.CharField(max_length=120, blank=True, default="")
    license_required = models.BooleanField(default=False)
    insurance_required = models.BooleanField(default=False)
    issuing_authority_name = models.CharField(max_length=255, blank=True, default="")
    authority_short_name = models.CharField(max_length=120, blank=True, default="")
    official_lookup_url = models.URLField(blank=True, default="")
    source_type = models.CharField(
        max_length=16,
        choices=SourceType.choices,
        default=SourceType.MANUAL,
    )
    rule_notes = models.TextField(blank=True, default="")
    exemption_threshold = models.CharField(max_length=120, blank=True, default="")
    exemption_notes = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True, db_index=True)
    last_reviewed_at = models.DateField(null=True, blank=True)
    source_reference = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["state_code", "trade_key"]
        constraints = [
            models.UniqueConstraint(
                fields=["state_code", "trade_key"],
                name="uniq_state_trade_license_requirement",
            )
        ]
        indexes = [
            models.Index(fields=["state_code", "trade_key", "active"]),
        ]

    def __str__(self) -> str:
        return f"{self.state_code} {self.trade_key}"


class ContractorComplianceRecord(models.Model):
    class RecordType(models.TextChoices):
        LICENSE = "license", "License"
        INSURANCE = "insurance", "Insurance"

    class Status(models.TextChoices):
        ON_FILE = "on_file", "On File"
        EXPIRED = "expired", "Expired"
        PENDING_REVIEW = "pending_review", "Pending Review"
        VERIFIED = "verified", "Verified"

    class Source(models.TextChoices):
        LEGACY_PROFILE = "legacy_profile", "Legacy Profile"
        MANUAL_UPLOAD = "manual_upload", "Manual Upload"

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="compliance_records",
    )
    record_type = models.CharField(max_length=16, choices=RecordType.choices, db_index=True)
    trade_key = models.CharField(max_length=64, blank=True, default="", db_index=True)
    trade_label = models.CharField(max_length=120, blank=True, default="")
    state_code = models.CharField(max_length=2, blank=True, default="", db_index=True)
    identifier = models.CharField(max_length=120, blank=True, default="")
    expiration_date = models.DateField(null=True, blank=True)
    file = models.FileField(upload_to=contractor_compliance_upload_to, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ON_FILE, db_index=True)
    source = models.CharField(max_length=24, choices=Source.choices, default=Source.MANUAL_UPLOAD)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["record_type", "trade_key", "-updated_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "record_type", "state_code"]),
            models.Index(fields=["contractor", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.contractor_id} {self.record_type} {self.trade_key or 'generic'}"

    @property
    def is_expired(self) -> bool:
        return bool(self.expiration_date and self.expiration_date < date.today())
