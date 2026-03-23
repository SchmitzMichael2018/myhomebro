from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
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
