from __future__ import annotations

import secrets
from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db import models
from django.utils import timezone


def referral_code_default():
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12].upper()


class ReferralParticipant(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="referral_participant")
    code = models.CharField(max_length=20, unique=True, default=referral_code_default, db_index=True)
    is_eligible = models.BooleanField(default=True, db_index=True)
    disqualified_at = models.DateTimeField(null=True, blank=True)
    disqualification_reason = models.TextField(blank=True, default="")
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
    STATUS_RESERVED = "reserved"
    STATUS_AWARDED = "awarded"
    STATUS_EXPIRED = "expired"
    STATUS_DISQUALIFIED = "disqualified"
    STATUS_CHOICES = [(value, value.title()) for value in (STATUS_RESERVED, STATUS_AWARDED, STATUS_EXPIRED, STATUS_DISQUALIFIED)]

    contractor = models.OneToOneField("projects.Contractor", on_delete=models.CASCADE, related_name="founding_award")
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
                fields=["slot_number"],
                condition=models.Q(status__in=["reserved", "awarded"]),
                name="unique_active_founding_slot",
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

    referrer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="contractor_referrals")
    participant = models.ForeignKey(ReferralParticipant, on_delete=models.PROTECT, related_name="referrals")
    referred_contractor = models.OneToOneField("projects.Contractor", on_delete=models.PROTECT, related_name="referral_attribution")
    attributed_code = models.CharField(max_length=20)
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
    STATUS_REVERSED = "reversed"
    STATUS_CHOICES = [(value, value.title()) for value in (STATUS_PENDING, STATUS_AVAILABLE, STATUS_PAID, STATUS_REVERSED)]

    referral = models.ForeignKey(ContractorReferral, on_delete=models.PROTECT, related_name="earnings")
    receipt = models.OneToOneField("receipts.Receipt", on_delete=models.PROTECT, related_name="referral_earning")
    qualifying_platform_fee_cents = models.PositiveIntegerField()
    reward_rate_bps = models.PositiveSmallIntegerField()
    reward_cents = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    available_at = models.DateTimeField()
    paid_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReferralPayout(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_PAID = "paid"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [(value, value.title()) for value in (STATUS_PENDING, STATUS_PROCESSING, STATUS_PAID, STATUS_FAILED)]
    METHOD_CONTRACTOR_STRIPE = "contractor_stripe"
    METHOD_CUSTOMER_CREDIT = "customer_credit"
    METHOD_CUSTOMER_DIRECT_DEPOSIT = "customer_direct_deposit"
    METHOD_CHOICES = [
        (METHOD_CONTRACTOR_STRIPE, "Contractor Stripe Connect"),
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
