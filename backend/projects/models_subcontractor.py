from __future__ import annotations

import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.core.validators import MinValueValidator
from django.utils import timezone


class SubcontractorInvitationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    REVOKED = "revoked", "Revoked"
    EXPIRED = "expired", "Expired"


def _default_subcontractor_invitation_expiry():
    return timezone.now() + timedelta(days=14)


def _default_subcontractor_invitation_token() -> str:
    return secrets.token_urlsafe(32)


class SubcontractorInvitation(models.Model):
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="subcontractor_invitations",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="subcontractor_invitations",
    )
    invite_email = models.EmailField(db_index=True)
    invite_name = models.CharField(max_length=255, blank=True, default="")
    token = models.CharField(
        max_length=96,
        unique=True,
        db_index=True,
        default=_default_subcontractor_invitation_token,
        editable=False,
    )
    status = models.CharField(
        max_length=16,
        choices=SubcontractorInvitationStatus.choices,
        default=SubcontractorInvitationStatus.PENDING,
        db_index=True,
    )
    invited_message = models.TextField(blank=True, default="")
    invited_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=_default_subcontractor_invitation_expiry)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_subcontractor_invitations",
    )

    class Meta:
        ordering = ["-invited_at", "-id"]
        indexes = [
            models.Index(fields=["agreement", "status"]),
            models.Index(fields=["agreement", "invite_email"]),
        ]

    def __str__(self) -> str:
        return f"SubcontractorInvitation(agreement={self.agreement_id}, email={self.invite_email}, status={self.status})"

    @property
    def is_expired(self) -> bool:
        return bool(
            self.status == SubcontractorInvitationStatus.PENDING
            and self.expires_at
            and timezone.now() >= self.expires_at
        )

    @property
    def effective_status(self) -> str:
        if self.is_expired:
            return SubcontractorInvitationStatus.EXPIRED
        return self.status

    @property
    def is_actionable(self) -> bool:
        return self.effective_status == SubcontractorInvitationStatus.PENDING

    def refresh_expired_status(self, *, save: bool = True) -> str:
        if self.is_expired:
            self.status = SubcontractorInvitationStatus.EXPIRED
            if save:
                self.save(update_fields=["status"])
        return self.status

    def mark_accepted(self, *, user) -> None:
        self.refresh_expired_status()
        self.status = SubcontractorInvitationStatus.ACCEPTED
        self.accepted_by_user = user
        self.accepted_at = timezone.now()
        self.save(update_fields=["status", "accepted_by_user", "accepted_at"])

    def mark_revoked(self) -> None:
        self.refresh_expired_status()
        self.status = SubcontractorInvitationStatus.REVOKED
        self.save(update_fields=["status"])


class SubcontractorMilestoneAgreementStatus(models.TextChoices):
    NOT_SENT = "not_sent", "Not Sent"
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"


class SubcontractorPaymentReleaseMode(models.TextChoices):
    MANUAL_RELEASE = "manual_release", "Manual Release"
    AUTO_AFTER_CUSTOMER_APPROVAL = "auto_after_customer_approval", "Auto-Release After Customer Approval"


class SubcontractorQuoteRequestStatus(models.TextChoices):
    SENT = "sent", "Sent"
    RESPONDED = "responded", "Responded"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    REVISION_REQUESTED = "revision_requested", "Revision Requested"
    CANCELLED = "cancelled", "Cancelled"


class SubcontractorMilestoneAgreement(models.Model):
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="subcontractor_milestone_agreements",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="subcontractor_milestone_agreements",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.CASCADE,
        related_name="subcontractor_milestone_agreements",
    )
    subcontractor_invitation = models.ForeignKey(
        "projects.SubcontractorInvitation",
        on_delete=models.CASCADE,
        related_name="milestone_agreements",
    )
    agreed_pay = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Contractor/subcontractor-facing pay for this milestone.",
    )
    payment_release_mode = models.CharField(
        max_length=40,
        choices=SubcontractorPaymentReleaseMode.choices,
        default=SubcontractorPaymentReleaseMode.MANUAL_RELEASE,
        db_index=True,
    )
    agreement_acceptance_status = models.CharField(
        max_length=20,
        choices=SubcontractorMilestoneAgreementStatus.choices,
        default=SubcontractorMilestoneAgreementStatus.NOT_SENT,
        db_index=True,
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_subcontractor_milestone_agreements",
    )
    agreement_version = models.PositiveIntegerField(default=1, db_index=True)
    terms_snapshot = models.JSONField(default=dict, blank=True)
    override_reason = models.TextField(blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-agreement_version", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["milestone", "subcontractor_invitation", "agreement_version"],
                name="unique_subcontractor_milestone_agreement_version",
            ),
            models.CheckConstraint(
                name="subcontractor_milestone_agreement_pay_positive",
                check=models.Q(agreed_pay__gt=0),
            ),
        ]
        indexes = [
            models.Index(fields=["milestone", "agreement_acceptance_status"]),
            models.Index(fields=["agreement", "agreement_acceptance_status"]),
            models.Index(fields=["subcontractor_invitation", "agreement_version"]),
        ]

    def __str__(self) -> str:
        return (
            "SubcontractorMilestoneAgreement("
            f"milestone={self.milestone_id}, invitation={self.subcontractor_invitation_id}, "
            f"version={self.agreement_version}, status={self.agreement_acceptance_status})"
        )

    @property
    def is_pending(self) -> bool:
        return self.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.PENDING

    @property
    def is_accepted(self) -> bool:
        return self.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.ACCEPTED

    @property
    def is_declined(self) -> bool:
        return self.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.DECLINED

    def mark_pending(self, *, save: bool = True) -> None:
        self.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.PENDING
        self.sent_at = self.sent_at or timezone.now()
        if save:
            self.save(
                update_fields=[
                    "agreement_acceptance_status",
                    "sent_at",
                    "updated_at",
                ]
            )

    def mark_accepted(self, *, user, save: bool = True) -> None:
        self.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.ACCEPTED
        self.accepted_at = timezone.now()
        self.accepted_by_user = user
        self.declined_at = None
        if save:
            self.save(
                update_fields=[
                    "agreement_acceptance_status",
                    "accepted_at",
                    "accepted_by_user",
                    "declined_at",
                    "updated_at",
                ]
            )

    def mark_declined(self, *, user=None, save: bool = True) -> None:
        self.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.DECLINED
        self.declined_at = timezone.now()
        if user is not None:
            self.accepted_by_user = user
        if save:
            update_fields = [
                "agreement_acceptance_status",
                "declined_at",
                "updated_at",
            ]
            if user is not None:
                update_fields.append("accepted_by_user")
            self.save(update_fields=update_fields)


class SubcontractorQuoteRequest(models.Model):
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="subcontractor_quote_requests",
    )
    subcontractor_invitation = models.ForeignKey(
        "projects.SubcontractorInvitation",
        on_delete=models.CASCADE,
        related_name="quote_requests",
    )
    subcontractor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subcontractor_quote_requests",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="subcontractor_quote_requests",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.CASCADE,
        related_name="subcontractor_quote_requests",
    )
    scope_snapshot = models.JSONField(default=dict, blank=True)
    contractor_message = models.TextField(blank=True, default="")
    quoted_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    subcontractor_message = models.TextField(blank=True, default="")
    estimated_start_date = models.DateField(null=True, blank=True)
    estimated_completion_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=32,
        choices=SubcontractorQuoteRequestStatus.choices,
        default=SubcontractorQuoteRequestStatus.SENT,
        db_index=True,
    )
    revision_note = models.TextField(blank=True, default="")
    override_reason = models.TextField(blank=True, default="")
    linked_subcontractor_milestone_agreement = models.ForeignKey(
        "projects.SubcontractorMilestoneAgreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quote_requests",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_subcontractor_quote_requests",
    )
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="responded_subcontractor_quote_requests",
    )
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_subcontractor_quote_requests",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    revision_requested_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["agreement", "milestone", "status"]),
            models.Index(fields=["subcontractor", "status"]),
            models.Index(fields=["contractor", "status"]),
        ]

    def __str__(self) -> str:
        return (
            "SubcontractorQuoteRequest("
            f"milestone={self.milestone_id}, subcontractor={self.subcontractor_id}, "
            f"status={self.status})"
        )
