from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify


class SupportTicketCategory(models.TextChoices):
    ACCOUNT_LOGIN = "account_login", "Account / Login"
    AGREEMENT_HELP = "agreement_help", "Agreement Help"
    PAYMENT_ESCROW = "payment_escrow", "Payment / Escrow"
    INVOICE_ISSUE = "invoice_issue", "Invoice Issue"
    DISPUTE_REVIEW = "dispute_review", "Dispute / Review"
    CONTRACTOR_PROFILE = "contractor_profile", "Contractor Profile"
    CUSTOMER_INTAKE = "customer_intake", "Customer Intake"
    TECHNICAL_PROBLEM = "technical_problem", "Technical Problem"
    GENERAL_QUESTION = "general_question", "General Question"


class SupportTicketPriority(models.TextChoices):
    LOW = "low", "Low"
    NORMAL = "normal", "Normal"
    HIGH = "high", "High"
    URGENT = "urgent", "Urgent"


class SupportTicketStatus(models.TextChoices):
    OPEN = "open", "Open"
    IN_REVIEW = "in_review", "In Review"
    WAITING_ON_USER = "waiting_on_user", "Waiting on User"
    RESOLVED = "resolved", "Resolved"
    CLOSED = "closed", "Closed"


class SupportTicketMessageSenderType(models.TextChoices):
    USER = "user", "User"
    SUPPORT = "support", "Support"
    SYSTEM = "system", "System"


SupportMessageSenderRole = SupportTicketMessageSenderType


def support_ticket_attachment_upload_to(instance, filename: str) -> str:
    base, dot, ext = filename.rpartition(".")
    ext = (ext or "").lower()
    safe = slugify(base or "support-attachment")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    ticket_part = getattr(instance, "ticket_number", None) or f"ticket-{getattr(instance, 'pk', 'new')}"
    prefix = f"support_tickets/{ticket_part}/attachments/{ts}_{safe}"
    return f"{prefix}.{ext}" if ext else prefix


class SupportTicket(models.Model):
    ticket_number = models.CharField(
        max_length=16,
        unique=True,
        db_index=True,
        null=True,
        blank=True,
        editable=False,
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="support_tickets",
    )
    email = models.EmailField(db_index=True)
    user_role = models.CharField(max_length=64, blank=True, default="")

    subject = models.CharField(max_length=255)
    category = models.CharField(
        max_length=32,
        choices=SupportTicketCategory.choices,
        default=SupportTicketCategory.GENERAL_QUESTION,
        db_index=True,
    )
    priority = models.CharField(
        max_length=16,
        choices=SupportTicketPriority.choices,
        default=SupportTicketPriority.NORMAL,
        db_index=True,
    )
    message = models.TextField()
    status = models.CharField(
        max_length=24,
        choices=SupportTicketStatus.choices,
        default=SupportTicketStatus.OPEN,
        db_index=True,
    )

    related_object_type = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_object_id = models.CharField(max_length=64, blank=True, default="", db_index=True)

    attachment = models.FileField(upload_to=support_ticket_attachment_upload_to, null=True, blank=True)

    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_support_tickets",
    )

    internal_notes = models.TextField(blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.ticket_number or f"SupportTicket#{self.pk or 'new'}"

    def save(self, *args, **kwargs):
        new_object = self.pk is None
        super().save(*args, **kwargs)

        if new_object and not self.ticket_number:
            self.ticket_number = f"MHB-{self.pk:06d}"
            super().save(update_fields=["ticket_number"])


class SupportTicketMessage(models.Model):
    ticket = models.ForeignKey(
        SupportTicket,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="support_messages_sent",
    )
    sender_type = models.CharField(
        max_length=16,
        choices=SupportTicketMessageSenderType.choices,
        default=SupportTicketMessageSenderType.USER,
        db_index=True,
        db_column="sender_role",
    )
    sender_email = models.EmailField(blank=True, default="")
    message = models.TextField(db_column="message_text")
    gmail_message_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    gmail_thread_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_internal = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "projects_supportticketmessage"
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["gmail_message_id"], name="uniq_support_message_gmail_message_id")
        ]

    def __str__(self) -> str:
        ticket_number = getattr(self.ticket, "ticket_number", "") or f"SupportTicket#{getattr(self.ticket, 'pk', 'new')}"
        return f"{ticket_number} message #{self.pk or 'new'}"

    @property
    def sender_role(self) -> str:
        return self.sender_type

    @sender_role.setter
    def sender_role(self, value: str) -> None:
        self.sender_type = value

    @property
    def message_text(self) -> str:
        return self.message

    @message_text.setter
    def message_text(self, value: str) -> None:
        self.message = value


SupportMessage = SupportTicketMessage
