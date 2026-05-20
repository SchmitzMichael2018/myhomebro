from __future__ import annotations

import secrets
import uuid

from django.conf import settings
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
    manually_reviewed = models.BooleanField(default=False, db_index=True)
    manually_enriched = models.BooleanField(default=False, db_index=True)
    admin_notes = models.TextField(blank=True, default="")
    assisted_diy_friendly = models.BooleanField(default=False, db_index=True)
    escrow_friendly = models.BooleanField(default=False, db_index=True)
    inspection_capable = models.BooleanField(default=False, db_index=True)
    rescue_project_friendly = models.BooleanField(default=False, db_index=True)
    collaboration_score = models.FloatField(null=True, blank=True)
    compatibility_tags = models.JSONField(default=list, blank=True)
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


class ContractorDirectoryEntry(models.Model):
    SOURCE_GOOGLE_PLACES = "google_places"
    SOURCE_ADMIN = "admin_search"
    SOURCE_PUBLIC_INTAKE = "public_intake"
    SOURCE_MANUAL = "manual"
    SOURCE_CHOICES = [
        (SOURCE_GOOGLE_PLACES, "Google Places"),
        (SOURCE_ADMIN, "Admin Search"),
        (SOURCE_PUBLIC_INTAKE, "Public Intake"),
        (SOURCE_MANUAL, "Manual"),
    ]

    PROFILE_BASIC = "basic"
    PROFILE_REVIEWED = "reviewed"
    PROFILE_STATUS_CHOICES = [
        (PROFILE_BASIC, "Basic"),
        (PROFILE_REVIEWED, "Reviewed"),
    ]

    ENRICHMENT_NOT_STARTED = "not_started"
    ENRICHMENT_REVIEWED = "reviewed"
    ENRICHMENT_STATUS_CHOICES = [
        (ENRICHMENT_NOT_STARTED, "Not Started"),
        (ENRICHMENT_REVIEWED, "Reviewed"),
    ]
    SERVICE_NORMALIZATION_NOT_STARTED = "not_started"
    SERVICE_NORMALIZATION_AUTO = "auto"
    SERVICE_NORMALIZATION_MANUAL = "manual"
    SERVICE_NORMALIZATION_CHOICES = [
        (SERVICE_NORMALIZATION_NOT_STARTED, "Not Started"),
        (SERVICE_NORMALIZATION_AUTO, "Auto"),
        (SERVICE_NORMALIZATION_MANUAL, "Manual"),
    ]

    business_name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255, db_index=True)
    website = models.URLField(null=True, blank=True)
    website_domain = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    phone = models.CharField(max_length=40, null=True, blank=True)
    normalized_phone = models.CharField(max_length=40, null=True, blank=True, db_index=True)
    public_email = models.EmailField(null=True, blank=True)
    address_line1 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=120, null=True, blank=True, db_index=True)
    state = models.CharField(max_length=60, null=True, blank=True, db_index=True)
    zip_code = models.CharField(max_length=20, null=True, blank=True, db_index=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    service_radius_miles = models.PositiveIntegerField(default=25, db_index=True)
    service_city = models.CharField(max_length=120, null=True, blank=True, db_index=True)
    service_state = models.CharField(max_length=60, null=True, blank=True, db_index=True)
    service_zip = models.CharField(max_length=20, null=True, blank=True, db_index=True)
    primary_service = models.CharField(max_length=120, null=True, blank=True, db_index=True)
    normalized_services = models.JSONField(default=list, blank=True)
    raw_services = models.JSONField(default=list, blank=True)
    service_normalization_status = models.CharField(
        max_length=32,
        choices=SERVICE_NORMALIZATION_CHOICES,
        default=SERVICE_NORMALIZATION_NOT_STARTED,
        db_index=True,
    )
    google_place_id = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    rating = models.FloatField(null=True, blank=True)
    review_count = models.PositiveIntegerField(null=True, blank=True)
    services = models.JSONField(default=list, blank=True)
    source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default=SOURCE_GOOGLE_PLACES, db_index=True)
    claimed = models.BooleanField(default=False, db_index=True)
    claimed_by_contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="directory_entries",
    )
    profile_status = models.CharField(max_length=32, choices=PROFILE_STATUS_CHOICES, default=PROFILE_BASIC, db_index=True)
    enrichment_status = models.CharField(max_length=32, choices=ENRICHMENT_STATUS_CHOICES, default=ENRICHMENT_NOT_STARTED, db_index=True)
    email_source_url = models.URLField(null=True, blank=True)
    services_source_url = models.URLField(null=True, blank=True)
    enrichment_notes = models.TextField(null=True, blank=True)
    enriched_at = models.DateTimeField(null=True, blank=True)
    enriched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_directory_enrichments",
    )
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["business_name", "city", "state"]
        indexes = [
            models.Index(fields=["website_domain"], name="projects_co_website_f5bc68_idx"),
            models.Index(fields=["normalized_phone"], name="projects_co_normali_388298_idx"),
            models.Index(fields=["normalized_name", "zip_code"], name="projects_co_normali_22b99d_idx"),
            models.Index(fields=["normalized_name", "city", "state"], name="projects_co_normali_ee3ccb_idx"),
            models.Index(fields=["service_state", "service_zip"], name="projects_co_service_4e839f_idx"),
            models.Index(fields=["primary_service"], name="projects_co_primary_13341d_idx"),
        ]

    def __str__(self) -> str:
        return self.business_name or f"Directory Entry {self.pk}"


class ContractorDirectoryClaimToken(models.Model):
    STATUS_PENDING = "pending"
    STATUS_CLAIMED = "claimed"
    STATUS_REVOKED = "revoked"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_CLAIMED, "Claimed"),
        (STATUS_REVOKED, "Revoked"),
    ]

    directory_entry = models.ForeignKey(
        "projects.ContractorDirectoryEntry",
        on_delete=models.CASCADE,
        related_name="claim_tokens",
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_directory_claim_tokens_generated",
    )
    claimed_by_contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="directory_claim_tokens",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["directory_entry", "status"], name="projects_co_directo_f1a1be_idx"),
            models.Index(fields=["status", "created_at"], name="projects_co_status_f69e71_idx"),
        ]

    def __str__(self) -> str:
        return f"Claim token {self.pk} for entry {self.directory_entry_id}"

    @property
    def claim_url_path(self) -> str:
        return f"/contractors/directory-claim/{self.token}"


class ContractorDirectoryDiscovery(models.Model):
    SOURCE_PUBLIC_INTAKE = "public_intake"
    SOURCE_ADMIN_SEARCH = "admin_search"
    SOURCE_UNKNOWN = "unknown"
    SOURCE_TYPE_CHOICES = [
        (SOURCE_PUBLIC_INTAKE, "Public Intake"),
        (SOURCE_ADMIN_SEARCH, "Admin Search"),
        (SOURCE_UNKNOWN, "Unknown"),
    ]

    directory_entry = models.ForeignKey(
        "projects.ContractorDirectoryEntry",
        on_delete=models.CASCADE,
        related_name="discoveries",
    )
    source_type = models.CharField(max_length=32, choices=SOURCE_TYPE_CHOICES, default=SOURCE_UNKNOWN, db_index=True)
    search_term = models.CharField(max_length=255, null=True, blank=True)
    project_type = models.CharField(max_length=120, null=True, blank=True)
    project_subtype = models.CharField(max_length=120, null=True, blank=True)
    search_city = models.CharField(max_length=120, null=True, blank=True)
    search_state = models.CharField(max_length=60, null=True, blank=True)
    search_zip = models.CharField(max_length=20, null=True, blank=True)
    radius_miles = models.PositiveIntegerField(null=True, blank=True)
    intake_request = models.ForeignKey(
        "projects.ProjectIntake",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="directory_discoveries",
    )
    admin_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_directory_discoveries",
    )
    selected_by_homeowner = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["source_type", "created_at"], name="projects_co_source__880eb0_idx"),
            models.Index(fields=["search_city", "search_state", "search_zip"], name="projects_co_search__073e43_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.source_type} discovery for {self.directory_entry_id}"


class ContractorOpportunity(models.Model):
    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_DECLINED = "declined"
    STATUS_EXPIRED = "expired"
    STATUS_CONVERTED = "converted"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_CONVERTED, "Converted"),
    ]

    directory_entry = models.ForeignKey(
        "projects.ContractorDirectoryEntry",
        on_delete=models.CASCADE,
        related_name="opportunities",
    )
    intake_request = models.ForeignKey(
        "projects.ProjectIntake",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_opportunities",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_opportunities",
    )
    homeowner_name = models.CharField(max_length=255, null=True, blank=True)
    homeowner_email = models.EmailField(null=True, blank=True)
    homeowner_phone = models.CharField(max_length=50, null=True, blank=True)
    project_address = models.CharField(max_length=255, null=True, blank=True)
    project_city = models.CharField(max_length=120, null=True, blank=True)
    project_state = models.CharField(max_length=60, null=True, blank=True)
    project_zip = models.CharField(max_length=20, null=True, blank=True)
    project_type = models.CharField(max_length=120, null=True, blank=True)
    project_subtype = models.CharField(max_length=120, null=True, blank=True)
    project_title = models.CharField(max_length=255, null=True, blank=True)
    project_description = models.TextField(null=True, blank=True)
    refined_description = models.TextField(null=True, blank=True)
    budget_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    budget_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    timeline = models.CharField(max_length=120, null=True, blank=True)
    measurements = models.JSONField(default=list, blank=True)
    photos = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    selected_by_homeowner = models.BooleanField(default=True, db_index=True)
    selected_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by_contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_opportunities",
    )
    converted_customer = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_opportunities",
    )
    converted_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_opportunities",
    )
    conversion_notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-selected_at", "-id"]
        indexes = [
            models.Index(fields=["directory_entry", "status"], name="projects_co_directo_6c6181_idx"),
            models.Index(fields=["intake_request", "status"], name="projects_co_intake__6af8e5_idx"),
            models.Index(fields=["project", "status"], name="projects_co_project_c3ba09_idx"),
            models.Index(fields=["status", "created_at"], name="projects_co_status_05f037_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["directory_entry", "intake_request"],
                condition=models.Q(intake_request__isnull=False),
                name="uniq_opportunity_directory_entry_intake",
            )
        ]

    def __str__(self) -> str:
        return f"Opportunity #{self.pk} for {self.directory_entry_id}"


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
    response_at = models.DateTimeField(null=True, blank=True)
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
        if self.response_at is None:
            self.response_at = self.claimed_at
        self.status = self.STATUS_CLAIMED
        if save:
            self.save(update_fields=["claimed_at", "response_at", "status", "updated_at"])

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
