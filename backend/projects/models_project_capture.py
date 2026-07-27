from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectCaptureNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="capture_notes"
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_notes",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="project_capture_notes",
    )
    origin_capture = models.OneToOneField(
        "projects.Capture",
        on_delete=models.PROTECT,
        related_name="created_project_note",
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["project", "-created_at"])]


class ProjectCaptureActivity(models.Model):
    TYPE_UPDATE = "project_update"
    TYPE_PROGRESS_PHOTO = "progress_photo"
    TYPE_ISSUE = "issue"
    TYPE_COMMUNICATION = "communication"
    TYPE_DOCUMENT = "document"
    TYPE_CHOICES = (
        (TYPE_UPDATE, "Project update"),
        (TYPE_PROGRESS_PHOTO, "Progress photo"),
        (TYPE_ISSUE, "Issue"),
        (TYPE_COMMUNICATION, "Communication"),
        (TYPE_DOCUMENT, "Document"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="capture_activities"
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_activities",
    )
    activity_type = models.CharField(max_length=32, choices=TYPE_CHOICES, db_index=True)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True, default="")
    customer_visible = models.BooleanField(default=False, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="project_capture_activities",
    )
    origin_capture = models.OneToOneField(
        "projects.Capture",
        on_delete=models.PROTECT,
        related_name="created_project_activity",
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["project", "customer_visible", "-created_at"]),
        ]


class ProjectCaptureAttachment(models.Model):
    KIND_PHOTO = "photo"
    KIND_DOCUMENT = "document"
    KIND_CHOICES = ((KIND_PHOTO, "Photo"), (KIND_DOCUMENT, "Document"))

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="capture_attachments"
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_attachments",
    )
    artifact = models.OneToOneField(
        "projects.CaptureArtifact",
        on_delete=models.PROTECT,
        related_name="project_attachment",
    )
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    customer_visible = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="project_capture_attachments",
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["project", "customer_visible", "-created_at"]),
        ]


class ProjectCaptureIssue(models.Model):
    CLASS_PROJECT_ISSUE = "project_issue"
    CLASS_PUNCH_ITEM = "punch_item"
    CLASS_CUSTOMER_CONCERN = "customer_concern"
    CLASS_POTENTIAL_WARRANTY = "potential_warranty"
    CLASS_POTENTIAL_CHANGE_REQUEST = "potential_change_request"
    CLASS_INTERNAL_NOTE = "internal_note"
    CLASS_SITE_CONDITION = "site_condition"
    CLASSIFICATION_CHOICES = (
        (CLASS_PROJECT_ISSUE, "Project issue"),
        (CLASS_PUNCH_ITEM, "Punch item"),
        (CLASS_CUSTOMER_CONCERN, "Customer concern"),
        (CLASS_POTENTIAL_WARRANTY, "Potential warranty"),
        (CLASS_POTENTIAL_CHANGE_REQUEST, "Potential change request"),
        (CLASS_INTERNAL_NOTE, "Internal note"),
        (CLASS_SITE_CONDITION, "Site condition"),
    )
    STATUS_OPEN = "open"
    STATUS_RESOLVED = "resolved"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="capture_issues"
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_issues",
    )
    classification = models.CharField(
        max_length=40, choices=CLASSIFICATION_CHOICES, db_index=True
    )
    title = models.CharField(max_length=255)
    description = models.TextField()
    status = models.CharField(max_length=20, default=STATUS_OPEN, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="project_capture_issues",
    )
    origin_capture = models.ForeignKey(
        "projects.Capture", on_delete=models.PROTECT, related_name="created_project_issues"
    )
    child_key = models.CharField(max_length=80, default="legacy", db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["project", "status", "-created_at"]),
            models.Index(fields=["project", "classification"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["origin_capture", "child_key"],
                name="uniq_capture_issue_child_key",
            )
        ]
