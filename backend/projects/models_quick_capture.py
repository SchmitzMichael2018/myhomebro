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


class ProjectAssistantPreparedAction(models.Model):
    ACTION_SCHEDULE_ESTIMATE = "schedule_estimate"
    ACTION_SEND_EMAIL = "send_email"
    ACTION_SEND_SMS = "send_sms"
    ACTION_CREATE_REMINDER = "create_reminder"
    ACTION_NAVIGATE = "navigate"
    ACTION_SAVE_DRAFT = "save_draft"
    ACTION_TYPE_CHOICES = [
        (ACTION_SCHEDULE_ESTIMATE, "Schedule Estimate"),
        (ACTION_SEND_EMAIL, "Send Email"),
        (ACTION_SEND_SMS, "Send SMS"),
        (ACTION_CREATE_REMINDER, "Create Reminder"),
        (ACTION_NAVIGATE, "Navigate"),
        (ACTION_SAVE_DRAFT, "Save Draft"),
    ]

    STATUS_SUGGESTED = "suggested"
    STATUS_DRAFTED = "drafted"
    STATUS_READY_TO_REVIEW = "ready_to_review"
    STATUS_REQUIRES_APPROVAL = "requires_approval"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_SUGGESTED, "Suggested"),
        (STATUS_DRAFTED, "Drafted"),
        (STATUS_READY_TO_REVIEW, "Ready To Review"),
        (STATUS_REQUIRES_APPROVAL, "Requires Approval"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capture_session = models.ForeignKey(
        ProjectAssistantCaptureSession,
        on_delete=models.CASCADE,
        related_name="prepared_actions",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="project_assistant_prepared_actions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_prepared_actions",
    )
    action_type = models.CharField(max_length=40, choices=ACTION_TYPE_CHOICES, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_DRAFTED, db_index=True)
    title = models.CharField(max_length=255)
    summary = models.TextField(blank=True, default="")
    prepared_payload = models.JSONField(default=dict, blank=True)
    validation_errors = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    source_records = models.JSONField(default=list, blank=True)
    requires_approval = models.BooleanField(default=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_project_assistant_prepared_actions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    execution_result = models.JSONField(default=dict, blank=True)
    failure_reason = models.TextField(blank=True, default="")
    audit_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        indexes = [
            models.Index(fields=["contractor", "status", "-updated_at"], name="pa_action_status_idx"),
            models.Index(fields=["capture_session", "action_type"], name="pa_action_session_type_idx"),
        ]

    @property
    def action_id(self):
        return self.id

    def mark_approved(self, actor):
        self.approved_by = actor
        self.approved_at = timezone.now()

    def __str__(self):
        return f"ProjectAssistantPreparedAction({self.id}, {self.action_type})"
