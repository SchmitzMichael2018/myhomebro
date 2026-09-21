from __future__ import annotations

import secrets
import uuid
from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db import models
from django.utils import timezone


def referral_code_default():
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12].upper()


class ReferralParticipant(models.Model):
    ROLE_CONTRACTOR = "contractor"
    ROLE_HOMEOWNER = "homeowner"
    ROLE_PROPERTY_MANAGER = "property_manager"
    ROLE_CHOICES = [
        (ROLE_CONTRACTOR, "Contractor"),
        (ROLE_HOMEOWNER, "Homeowner / Customer"),
        (ROLE_PROPERTY_MANAGER, "Property Manager"),
    ]
    PAYOUT_NOT_STARTED = "not_started"
    PAYOUT_PENDING = "pending"
    PAYOUT_READY = "ready"
    PAYOUT_RESTRICTED = "restricted"
    PAYOUT_STATUS_CHOICES = [
        (PAYOUT_NOT_STARTED, "Not started"),
        (PAYOUT_PENDING, "Pending"),
        (PAYOUT_READY, "Ready"),
        (PAYOUT_RESTRICTED, "Restricted"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="referral_participant")
    code = models.CharField(max_length=20, unique=True, default=referral_code_default, db_index=True)
    primary_role = models.CharField(max_length=24, choices=ROLE_CHOICES, blank=True, default="", db_index=True)
    is_eligible = models.BooleanField(default=True, db_index=True)
    disqualified_at = models.DateTimeField(null=True, blank=True)
    disqualification_reason = models.TextField(blank=True, default="")
    payout_onboarding_status = models.CharField(
        max_length=20,
        choices=PAYOUT_STATUS_CHOICES,
        default=PAYOUT_NOT_STARTED,
        db_index=True,
    )
    payout_stripe_account_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    payout_details_submitted = models.BooleanField(default=False)
    payout_enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReferralInvitation(models.Model):
    CHANNEL_CHOICES = [
        ("copy", "Copied link"),
        ("text", "Text"),
        ("email", "Email"),
        ("qr", "QR download"),
        ("print", "Print"),
    ]
    participant = models.ForeignKey(ReferralParticipant, on_delete=models.CASCADE, related_name="invitations")
    channel = models.CharField(max_length=12, choices=CHANNEL_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)


class FoundingContractorAward(models.Model):
    POOL_CONTRACTOR = "contractor"
    POOL_CONSUMER = "consumer"
    POOL_CHOICES = [
        (POOL_CONTRACTOR, "Contractors"),
        (POOL_CONSUMER, "Homeowners and Property Managers"),
    ]
    STATUS_RESERVED = "reserved"
    STATUS_AWARDED = "awarded"
    STATUS_EXPIRED = "expired"
    STATUS_DISQUALIFIED = "disqualified"
    STATUS_CHOICES = [(value, value.title()) for value in (STATUS_RESERVED, STATUS_AWARDED, STATUS_EXPIRED, STATUS_DISQUALIFIED)]

    contractor = models.OneToOneField(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="founding_award",
        null=True,
        blank=True,
    )
    participant = models.ForeignKey(
        ReferralParticipant,
        on_delete=models.CASCADE,
        related_name="founding_awards",
        null=True,
        blank=True,
    )
    pool = models.CharField(max_length=20, choices=POOL_CHOICES, default=POOL_CONTRACTOR, db_index=True)
    slot_number = models.PositiveSmallIntegerField(db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_RESERVED, db_index=True)
    reserved_at = models.DateTimeField(default=timezone.now)
    qualification_deadline = models.DateTimeField()
    awarded_at = models.DateTimeField(null=True, blank=True)
    promotion_ends_at = models.DateTimeField(null=True, blank=True)
    disqualification_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pool", "slot_number"],
                condition=models.Q(status__in=["reserved", "awarded"]),
                name="unique_active_founding_slot_per_pool",
            ),
            models.UniqueConstraint(
                fields=["participant", "pool"],
                condition=models.Q(participant__isnull=False),
                name="unique_founding_award_participant_pool",
            ),
        ]

    @property
    def promotion_active(self):
        return bool(self.status == self.STATUS_AWARDED and self.promotion_ends_at and timezone.now() < self.promotion_ends_at)

    def award(self, *, at=None):
        at = at or timezone.now()
        self.status = self.STATUS_AWARDED
        self.awarded_at = at
        self.promotion_ends_at = at + relativedelta(months=12)


class ContractorReferral(models.Model):
    STATUS_REGISTERED = "registered"
    STATUS_VERIFIED = "verified"
    STATUS_ACTIVATED = "activated"
    STATUS_EARNING = "earning"
    STATUS_COMPLETED = "completed"
    STATUS_EXPIRED = "expired"
    STATUS_DISQUALIFIED = "disqualified"
    STATUS_CHOICES = [(value, value.title()) for value in (
        STATUS_REGISTERED, STATUS_VERIFIED, STATUS_ACTIVATED, STATUS_EARNING,
        STATUS_COMPLETED, STATUS_EXPIRED, STATUS_DISQUALIFIED,
    )]
    PROGRAM_FOUNDING = "founding_50_6"
    PROGRAM_STANDARD = "standard_25_3"

    ROLE_CHOICES = ReferralParticipant.ROLE_CHOICES

    referrer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="contractor_referrals")
    participant = models.ForeignKey(ReferralParticipant, on_delete=models.PROTECT, related_name="referrals")
    referred_user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="referral_attribution",
        null=True,
        blank=True,
    )
    referred_contractor = models.OneToOneField(
        "projects.Contractor",
        on_delete=models.PROTECT,
        related_name="referral_attribution",
        null=True,
        blank=True,
    )
    referred_homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.PROTECT,
        related_name="referral_attributions",
        null=True,
        blank=True,
    )
    referrer_role = models.CharField(max_length=24, choices=ROLE_CHOICES, blank=True, default="")
    referred_role = models.CharField(max_length=24, choices=ROLE_CHOICES, default=ReferralParticipant.ROLE_CONTRACTOR, db_index=True)
    attributed_code = models.CharField(max_length=20)
    acquisition_channel = models.CharField(max_length=24, default="referral")
    medium = models.CharField(max_length=24, blank=True, default="link")
    landing_page = models.CharField(max_length=255, blank=True, default="")
    first_touch_at = models.DateTimeField(null=True, blank=True)
    attribution_locked_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_REGISTERED, db_index=True)
    program_code = models.CharField(max_length=24, blank=True, default="")
    reward_rate_bps = models.PositiveSmallIntegerField(default=0)
    earning_months = models.PositiveSmallIntegerField(default=0)
    registered_at = models.DateTimeField(default=timezone.now)
    activation_deadline = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    earning_starts_at = models.DateTimeField(null=True, blank=True)
    earning_ends_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    disqualified_at = models.DateTimeField(null=True, blank=True)
    disqualification_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReferralEarning(models.Model):
    STATUS_PENDING = "pending"
    STATUS_AVAILABLE = "available"
    STATUS_PAID = "paid"
    STATUS_RESERVED = "reserved"
    STATUS_REDEEMED = "redeemed"
    STATUS_REVERSED = "reversed"
    STATUS_CHOICES = [(value, value.title()) for value in (
        STATUS_PENDING,
        STATUS_AVAILABLE,
        STATUS_RESERVED,
        STATUS_PAID,
        STATUS_REDEEMED,
        STATUS_REVERSED,
    )]

    referral = models.ForeignKey(ContractorReferral, on_delete=models.PROTECT, related_name="earnings")
    receipt = models.ForeignKey("receipts.Receipt", on_delete=models.PROTECT, related_name="referral_earnings")
    allocation_side = models.CharField(
        max_length=24,
        choices=ContractorReferral.ROLE_CHOICES,
        default=ReferralParticipant.ROLE_CONTRACTOR,
        db_index=True,
    )
    qualifying_platform_fee_cents = models.PositiveIntegerField()
    maximum_reward_pool_cents = models.PositiveIntegerField(default=0)
    reward_rate_bps = models.PositiveSmallIntegerField()
    reward_cents = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    available_at = models.DateTimeField()
    paid_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["referral", "receipt"], name="unique_referral_earning_per_receipt"),
            models.CheckConstraint(
                condition=models.Q(reward_cents__lte=models.F("maximum_reward_pool_cents")),
                name="referral_earning_within_fee_pool",
            ),
        ]


class ReferralPayout(models.Model):
    STATUS_NEEDS_ONBOARDING = "needs_onboarding"
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_PAID = "paid"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [(value, value.title()) for value in (
        STATUS_PENDING,
        STATUS_NEEDS_ONBOARDING,
        STATUS_PROCESSING,
        STATUS_PAID,
        STATUS_FAILED,
    )]
    METHOD_CONTRACTOR_STRIPE = "contractor_stripe"
    METHOD_PARTICIPANT_STRIPE = "participant_stripe"
    METHOD_CUSTOMER_CREDIT = "customer_credit"
    METHOD_CUSTOMER_DIRECT_DEPOSIT = "customer_direct_deposit"
    METHOD_CHOICES = [
        (METHOD_CONTRACTOR_STRIPE, "Contractor Stripe Connect"),
        (METHOD_PARTICIPANT_STRIPE, "Participant Stripe Connect"),
        (METHOD_CUSTOMER_CREDIT, "Customer project credit"),
        (METHOD_CUSTOMER_DIRECT_DEPOSIT, "Customer direct deposit"),
    ]

    participant = models.ForeignKey(ReferralParticipant, on_delete=models.PROTECT, related_name="payouts")
    earnings = models.ManyToManyField(ReferralEarning, related_name="payouts", blank=True)
    amount_cents = models.PositiveIntegerField(default=0)
    payout_method = models.CharField(max_length=32, choices=METHOD_CHOICES, default=METHOD_CONTRACTOR_STRIPE)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    stripe_transfer_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    external_reference = models.CharField(max_length=255, blank=True, default="")
    failure_reason = models.TextField(blank=True, default="")
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_referral_payouts",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReferralProjectCredit(models.Model):
    STATUS_PENDING_INTEGRATION = "pending_integration"
    STATUS_APPLIED = "applied"
    STATUS_CANCELLED = "cancelled"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [(value, value.replace("_", " ").title()) for value in (
        STATUS_PENDING_INTEGRATION,
        STATUS_APPLIED,
        STATUS_CANCELLED,
        STATUS_FAILED,
    )]

    participant = models.ForeignKey(ReferralParticipant, on_delete=models.PROTECT, related_name="project_credits")
    earnings = models.ManyToManyField(ReferralEarning, related_name="project_credits")
    project = models.ForeignKey("projects.Project", on_delete=models.PROTECT, related_name="referral_credits")
    agreement = models.ForeignKey("projects.Agreement", on_delete=models.PROTECT, related_name="referral_credits", null=True, blank=True)
    invoice = models.ForeignKey("projects.Invoice", on_delete=models.PROTECT, related_name="referral_credits", null=True, blank=True)
    amount_cents = models.PositiveIntegerField()
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING_INTEGRATION, db_index=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="requested_referral_credits")
    applied_at = models.DateTimeField(null=True, blank=True)
    external_reference = models.CharField(max_length=255, blank=True, default="")
    failure_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReferralVisit(models.Model):
    participant = models.ForeignKey(
        ReferralParticipant,
        on_delete=models.PROTECT,
        related_name="visits",
        null=True,
        blank=True,
    )
    referral_code = models.CharField(max_length=20, blank=True, default="", db_index=True)
    visitor_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    medium = models.CharField(max_length=24, blank=True, default="link")
    landing_page = models.CharField(max_length=255, blank=True, default="")
    referrer_url = models.CharField(max_length=500, blank=True, default="")
    referrer_domain = models.CharField(max_length=255, blank=True, default="")
    first_source = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    first_medium = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    first_campaign = models.CharField(max_length=100, blank=True, default="")
    first_content = models.CharField(max_length=100, blank=True, default="")
    first_term = models.CharField(max_length=100, blank=True, default="")
    last_source = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    last_medium = models.CharField(max_length=64, blank=True, default="unknown", db_index=True)
    last_campaign = models.CharField(max_length=100, blank=True, default="")
    last_content = models.CharField(max_length=100, blank=True, default="")
    last_term = models.CharField(max_length=100, blank=True, default="")
    last_landing_page = models.CharField(max_length=255, blank=True, default="")
    last_referrer_url = models.CharField(max_length=500, blank=True, default="")
    last_referrer_domain = models.CharField(max_length=255, blank=True, default="")
    last_touch_at = models.DateTimeField(null=True, blank=True, db_index=True)
    campaign = models.ForeignKey(
        "projects.MarketingCampaign",
        on_delete=models.SET_NULL,
        related_name="visits",
        null=True,
        blank=True,
    )
    known_roles = models.JSONField(default=list, blank=True)
    excluded_from_reporting = models.BooleanField(default=False, db_index=True)
    exclusion_reason = models.CharField(max_length=64, blank=True, default="")
    session_key = models.CharField(max_length=64, blank=True, default="", db_index=True)
    first_touch_at = models.DateTimeField(default=timezone.now, db_index=True)
    registered_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="referral_visits",
    )
    registration_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
