# backend/projects/models_invite.py
import uuid
from django.db import models
from django.utils import timezone


class ContractorInvite(models.Model):
    """
    A homeowner can invite a contractor without having an account.
    Contractor accepts the invite after logging in, and the homeowner
    is imported into the contractor's client list (Homeowner model).

    NEW (2026-02-09):
    - resend_token: secure token for homeowner "Resend Invite" link (no homeowner auth)
    - send_count/last_sent_at: track delivery attempts (email/SMS) and support rate limiting
    """

    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)

    # ✅ Secure token used ONLY for homeowner resend link
    resend_token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)

    # Homeowner (inviter) details
    homeowner_name = models.CharField(max_length=255)
    homeowner_email = models.EmailField(db_index=True)
    homeowner_phone = models.CharField(max_length=20, blank=True)

    # Contractor (invitee) contact details (at least one required)
    contractor_email = models.EmailField(blank=True)
    contractor_phone = models.CharField(max_length=20, blank=True)

    # Optional message from homeowner
    message = models.TextField(blank=True)

    # Acceptance tracking
    accepted_at = models.DateTimeField(null=True, blank=True)

    # Who accepted it (set on accept)
    accepted_by_contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_invites",
    )

    # ✅ Delivery tracking (email/SMS sends)
    send_count = models.PositiveIntegerField(default=0)
    last_sent_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_accepted(self) -> bool:
        return bool(self.accepted_at and self.accepted_by_contractor_id)

    def mark_accepted(self, contractor):
        self.accepted_by_contractor = contractor
        self.accepted_at = timezone.now()
        self.save(update_fields=["accepted_by_contractor", "accepted_at"])

    def mark_sent(self):
        """
        Call this after a successful delivery send (email or SMS).
        """
        self.send_count = (self.send_count or 0) + 1
        self.last_sent_at = timezone.now()
        self.save(update_fields=["send_count", "last_sent_at"])
