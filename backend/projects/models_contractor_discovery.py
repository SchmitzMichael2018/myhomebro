from __future__ import annotations

import secrets
import uuid

from django.db import models
from django.utils import timezone
from django.utils.text import slugify


def _normalize_business_name(value: str) -> str:
    text = " ".join(str(value or "").split()).strip().lower()
    if not text:
        return ""
    text = text.replace("&", " and ")
    text = text.replace(".", " ")
    text = text.replace(",", " ")
    text = text.replace("-", " ")
    text = " ".join(part for part in text.split() if part)
    return text


class ContractorDirectoryListing(models.Model):
    SOURCE_GOOGLE_PLACES = "google_places"
    SOURCE_CACHED_DIRECTORY = "cached_directory"
    SOURCE_MYHOMEBRO = "myhomebro_verified"
    SOURCE_MANUAL = "manual"

    SOURCE_CHOICES = [
        (SOURCE_GOOGLE_PLACES, "Google Places"),
        (SOURCE_CACHED_DIRECTORY, "Cached Directory"),
        (SOURCE_MYHOMEBRO, "MyHomeBro Verified"),
        (SOURCE_MANUAL, "Manual"),
    ]

    source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default=SOURCE_GOOGLE_PLACES, db_index=True)
    google_place_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    business_name = models.CharField(max_length=255, blank=True, default="")
    normalized_business_name = models.CharField(max_length=255, blank=True, default="", db_index=True)
    phone_number = models.CharField(max_length=40, blank=True, default="", db_index=True)
    email = models.EmailField(blank=True, default="")
    website_url = models.URLField(blank=True, default="")
    google_maps_url = models.URLField(blank=True, default="")
    formatted_address = models.CharField(max_length=500, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="", db_index=True)
    state = models.CharField(max_length=60, blank=True, default="", db_index=True)
    zip_code = models.CharField(max_length=20, blank=True, default="")
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    primary_trade = models.CharField(max_length=120, blank=True, default="", db_index=True)
    trade_categories = models.JSONField(default=list, blank=True)
    google_rating = models.FloatField(null=True, blank=True)
    google_review_count = models.PositiveIntegerField(default=0)
    business_status = models.CharField(max_length=80, blank=True, default="")
    claimed_profile = models.BooleanField(default=False, db_index=True)
    claimed_contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="directory_listings",
    )
    sms_opt_out = models.BooleanField(default=False)
    email_opt_out = models.BooleanField(default=False)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-claimed_profile", "-google_review_count", "-google_rating", "business_name"]
        indexes = [
            models.Index(fields=["google_place_id"]),
            models.Index(fields=["normalized_business_name", "city"]),
            models.Index(fields=["phone_number"]),
            models.Index(fields=["source", "claimed_profile"]),
        ]

    def __str__(self) -> str:
        return self.business_name or self.normalized_business_name or f"Directory Listing {self.pk}"

    def clean_normalized_name(self) -> str:
        return _normalize_business_name(self.business_name)

    def save(self, *args, **kwargs):
        self.normalized_business_name = _normalize_business_name(self.business_name)
        super().save(*args, **kwargs)


class ContractorDiscoveryInvite(models.Model):
    CHANNEL_SMS = "sms"
    CHANNEL_EMAIL = "email"
    CHANNEL_IN_APP = "in_app"
    CHANNEL_MANUAL = "manual"
    CHANNEL_CONTACT_FORM = "contact_form"
    CHANNEL_CHOICES = [
        (CHANNEL_SMS, "SMS"),
        (CHANNEL_EMAIL, "Email"),
        (CHANNEL_IN_APP, "In App"),
        (CHANNEL_MANUAL, "Manual"),
        (CHANNEL_CONTACT_FORM, "Contact Form"),
    ]

    STATUS_PENDING = "pending"
    STATUS_SENT = "sent"
    STATUS_DELIVERED = "delivered"
    STATUS_FAILED = "failed"
    STATUS_CLICKED = "clicked"
    STATUS_CLAIMED = "claimed"
    STATUS_RESPONDED = "responded"
    STATUS_DECLINED = "declined"
    STATUS_EXPIRED = "expired"
    STATUS_OPTED_OUT = "opted_out"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CLICKED, "Clicked"),
        (STATUS_CLAIMED, "Claimed"),
        (STATUS_RESPONDED, "Responded"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_OPTED_OUT, "Opted Out"),
    ]

    public_intake = models.ForeignKey(
        "projects.ProjectIntake",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="discovery_invites",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="discovery_invites",
    )
    directory_listing = models.ForeignKey(
        "projects.ContractorDirectoryListing",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="discovery_invites",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="discovery_invites",
    )
    invite_token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    channel = models.CharField(max_length=24, choices=CHANNEL_CHOICES, default=CHANNEL_SMS, db_index=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    destination_phone = models.CharField(max_length=40, blank=True, default="")
    destination_email = models.EmailField(blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    clicked_at = models.DateTimeField(null=True, blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["invite_token"]),
            models.Index(fields=["status", "channel"]),
            models.Index(fields=["contractor", "status"]),
        ]

    def __str__(self) -> str:
        target = self.contractor_id or self.directory_listing_id or "unknown"
        return f"Discovery invite {self.pk} -> {target}"

    @property
    def is_opened(self) -> bool:
        return bool(self.clicked_at)

    @property
    def invite_url_path(self) -> str:
        return f"/contractors/claim/{self.invite_token}"

    def touch_clicked(self, *, save: bool = True):
        if not self.clicked_at:
            self.clicked_at = timezone.now()
        if self.status in {self.STATUS_PENDING, self.STATUS_SENT, self.STATUS_DELIVERED}:
            self.status = self.STATUS_CLICKED
        if save:
            self.save(update_fields=["clicked_at", "status", "updated_at"])

    def touch_claimed(self, *, save: bool = True):
        self.claimed_at = timezone.now()
        self.status = self.STATUS_CLAIMED
        if save:
            self.save(update_fields=["claimed_at", "status", "updated_at"])

    def touch_sent(self, *, status_value: str | None = None, save: bool = True):
        self.sent_at = timezone.now()
        self.status = status_value or self.STATUS_SENT
        if save:
            self.save(update_fields=["sent_at", "status", "updated_at"])

    @classmethod
    def analytics(cls, queryset=None) -> dict[str, float | int]:
        qs = queryset if queryset is not None else cls.objects.all()
        total = qs.count()
        sent = qs.filter(status__in=[cls.STATUS_SENT, cls.STATUS_DELIVERED, cls.STATUS_CLICKED, cls.STATUS_CLAIMED, cls.STATUS_RESPONDED, cls.STATUS_DECLINED]).count()
        clicked = qs.filter(clicked_at__isnull=False).count()
        claimed = qs.filter(status=cls.STATUS_CLAIMED).count()
        responded = qs.filter(status__in=[cls.STATUS_RESPONDED, cls.STATUS_CLAIMED]).count()
        agreements = qs.filter(agreement__isnull=False).count()
        escrow_agreements = qs.filter(agreement__payment_mode="escrow").count()

        def pct(numerator: int, denominator: int) -> float:
            if not denominator:
                return 0.0
            return round((numerator / denominator) * 100.0, 2)

        return {
            "total": total,
            "sent": sent,
            "clicked": clicked,
            "claimed": claimed,
            "responded": responded,
            "agreements": agreements,
            "escrow_agreements": escrow_agreements,
            "open_rate": pct(clicked, sent),
            "claim_rate": pct(claimed, sent),
            "response_rate": pct(responded, sent),
            "agreement_conversion": pct(agreements, sent),
            "escrow_conversion": pct(escrow_agreements, sent),
        }
