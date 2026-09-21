import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class MarketingCampaign(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    public_code = models.SlugField(max_length=80, unique=True)
    source = models.CharField(max_length=64)
    medium = models.CharField(max_length=64)
    campaign_name = models.CharField(max_length=100)
    content = models.CharField(max_length=100, blank=True, default="")
    destination = models.CharField(max_length=500, default="/")
    partner_type = models.CharField(max_length=40, blank=True, default="")
    partner_code = models.CharField(max_length=80, blank=True, default="", db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("public_code",)

    def __str__(self):
        return f"{self.name} ({self.public_code})"

    def is_available(self, at=None):
        at = at or timezone.now()
        return self.is_active and self.starts_at <= at and (self.ends_at is None or at < self.ends_at)


class AccountAcquisition(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="acquisition")
    first_visit = models.ForeignKey("projects.ReferralVisit", on_delete=models.SET_NULL, null=True, blank=True, related_name="first_touch_accounts")
    last_visit = models.ForeignKey("projects.ReferralVisit", on_delete=models.SET_NULL, null=True, blank=True, related_name="last_touch_accounts")
    referral = models.ForeignKey("projects.ContractorReferral", on_delete=models.SET_NULL, null=True, blank=True, related_name="account_acquisitions")
    roles = models.JSONField(default=list, blank=True)
    first_touch = models.JSONField(default=dict, blank=True)
    last_touch = models.JSONField(default=dict, blank=True)
    first_touch_at = models.DateTimeField(null=True, blank=True)
    last_touch_at = models.DateTimeField(null=True, blank=True)
    account_created_at = models.DateTimeField(null=True, blank=True)
    profile_completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class AttributionEvent(models.Model):
    EVENT_TYPES = (
        "landing_view", "improvement_template_view", "guide_view",
        "signup_started", "role_selected", "diy_project_started", "hire_pro_clicked",
        "contractor_profile_viewed", "contractor_invite_started",
        "account_created", "profile_completed", "project_created", "contractor_invited",
        "estimate_created", "estimate_accepted", "agreement_created", "agreement_signed", "project_funded",
        "platform_fee_generated", "milestone_approved", "project_completed",
        "referral_reward_generated", "referral_reward_redeemed",
    )
    EVENT_CHOICES = tuple((value, value.replace("_", " ").title()) for value in EVENT_TYPES)

    event_type = models.CharField(max_length=64, choices=EVENT_CHOICES, db_index=True)
    visitor = models.ForeignKey("projects.ReferralVisit", on_delete=models.SET_NULL, null=True, blank=True, related_name="attribution_events")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="attribution_events")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="attribution_events")
    campaign = models.ForeignKey(MarketingCampaign, on_delete=models.SET_NULL, null=True, blank=True, related_name="events")
    role = models.CharField(max_length=32, blank=True, default="", db_index=True)
    source = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    medium = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    campaign_name = models.CharField(max_length=100, blank=True, default="", db_index=True)
    content = models.CharField(max_length=100, blank=True, default="")
    landing_page = models.CharField(max_length=255, blank=True, default="")
    object_type = models.CharField(max_length=64, blank=True, default="")
    object_id = models.CharField(max_length=80, blank=True, default="")
    idempotency_key = models.CharField(max_length=190, null=True, blank=True, unique=True)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=("event_type", "occurred_at"), name="attrib_event_time_idx"),
            models.Index(fields=("source", "medium"), name="attrib_source_medium_idx"),
        ]


class ProjectAttributionSnapshot(models.Model):
    project = models.OneToOneField("projects.Project", on_delete=models.CASCADE, related_name="attribution_snapshot")
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_project_attribution_snapshots")
    customer_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_project_attribution_snapshots")
    contractor_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_project_attribution_snapshots")
    customer_attribution = models.JSONField(default=dict, blank=True)
    contractor_attribution = models.JSONField(default=dict, blank=True)
    customer_referral = models.ForeignKey("projects.ContractorReferral", on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_project_snapshots")
    contractor_referral = models.ForeignKey("projects.ContractorReferral", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_project_snapshots")
    snapshotted_at = models.DateTimeField(default=timezone.now)


class RevenueAttributionSnapshot(models.Model):
    receipt = models.OneToOneField("receipts.Receipt", on_delete=models.PROTECT, related_name="attribution_snapshot")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="revenue_attribution_snapshots")
    customer_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_revenue_attribution_snapshots")
    contractor_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_revenue_attribution_snapshots")
    customer_attribution = models.JSONField(default=dict, blank=True)
    contractor_attribution = models.JSONField(default=dict, blank=True)
    eligible_platform_fee_cents = models.PositiveIntegerField(default=0)
    maximum_reward_pool_cents = models.PositiveIntegerField(default=0)
    customer_reward_cents = models.PositiveIntegerField(default=0)
    contractor_reward_cents = models.PositiveIntegerField(default=0)
    total_referral_reward_cents = models.PositiveIntegerField(default=0)
    retained_platform_fee_cents = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
