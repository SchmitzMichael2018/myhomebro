from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectAssistantCaptureSession(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_APPROVED = "approved"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="project_assistant_capture_sessions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_capture_sessions",
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    intent = models.CharField(max_length=80, blank=True, default="", db_index=True)
    source_text = models.TextField(blank=True, default="")
    conversation_payload = models.JSONField(default=dict, blank=True)
    prepared_payload = models.JSONField(default=dict, blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_customer = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_capture_sessions",
    )
    created_opportunity = models.ForeignKey(
        "projects.ContractorOpportunity",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_capture_sessions",
    )
    created_note = models.ForeignKey(
        "projects.CustomerCommunicationLog",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_capture_sessions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        indexes = [
            models.Index(fields=["contractor", "status", "-updated_at"]),
            models.Index(fields=["contractor", "intent", "-updated_at"]),
        ]

    def mark_approved(self):
        self.status = self.STATUS_APPROVED
        self.approved_at = timezone.now()

    def mark_cancelled(self):
        self.status = self.STATUS_CANCELLED
        self.cancelled_at = timezone.now()

    def __str__(self):
        return f"ProjectAssistantCaptureSession({self.id}, {self.intent or 'unknown'})"
