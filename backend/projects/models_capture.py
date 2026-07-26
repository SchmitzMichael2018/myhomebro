from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


def capture_artifact_upload_path(instance, filename):
    safe_name = str(filename or "artifact").replace("\\", "/").split("/")[-1]
    return f"captures/{instance.capture.contractor_id}/{instance.capture_id}/{instance.id}/{safe_name}"


class Capture(models.Model):
    TYPE_QUICK_LEAD = "quick_lead"
    TYPE_QUICK_NOTE = "quick_note"
    TYPE_PHOTO = "photo"
    TYPE_RECEIPT = "receipt"
    TYPE_OPPORTUNITY = "opportunity"
    TYPE_PROJECT_UPDATE = "project_update"
    TYPE_PROGRESS_PHOTO = "progress_photo"
    TYPE_ISSUE = "issue"
    TYPE_COMMUNICATION = "communication"
    TYPE_DOCUMENT = "document"
    TYPE_EQUIPMENT = "equipment"
    TYPE_WARRANTY_DOCUMENT = "warranty_document"
    TYPE_WARRANTY_CONCERN = "warranty_concern"
    TYPE_MEASUREMENT = "measurement"
    TYPE_CHOICES = (
        (TYPE_QUICK_LEAD, "Quick Lead"),
        (TYPE_QUICK_NOTE, "Quick Note"),
        (TYPE_PHOTO, "Photo"),
        (TYPE_RECEIPT, "Receipt"),
        (TYPE_OPPORTUNITY, "Opportunity"),
        (TYPE_PROJECT_UPDATE, "Project Update"),
        (TYPE_PROGRESS_PHOTO, "Progress Photo"),
        (TYPE_ISSUE, "Issue"),
        (TYPE_COMMUNICATION, "Communication"),
        (TYPE_DOCUMENT, "Document"),
        (TYPE_EQUIPMENT, "Equipment"),
        (TYPE_WARRANTY_DOCUMENT, "Warranty Document"),
        (TYPE_WARRANTY_CONCERN, "Warranty Concern"),
        (TYPE_MEASUREMENT, "Measurement"),
    )

    STATUS_DRAFT = "draft"
    STATUS_SAVED = "saved"
    STATUS_PROCESSING = "processing"
    STATUS_READY_FOR_REVIEW = "ready_for_review"
    STATUS_NEEDS_INFORMATION = "needs_information"
    STATUS_POSSIBLE_DUPLICATE = "possible_duplicate"
    STATUS_APPROVED = "approved"
    STATUS_APPLYING = "applying"
    STATUS_APPLIED = "applied"
    STATUS_FAILED = "failed"
    STATUS_APPLY_FAILED = "apply_failed"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_SAVED, "Saved"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_READY_FOR_REVIEW, "Ready for Review"),
        (STATUS_NEEDS_INFORMATION, "Needs Information"),
        (STATUS_POSSIBLE_DUPLICATE, "Possible Duplicate"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_APPLYING, "Applying"),
        (STATUS_APPLIED, "Applied"),
        (STATUS_FAILED, "Failed"),
        (STATUS_APPLY_FAILED, "Apply Failed"),
        (STATUS_ARCHIVED, "Archived"),
    )

    METHOD_TYPED = "typed"
    METHOD_VOICE_TRANSCRIPT = "voice_transcript"
    METHOD_CAMERA = "camera"
    METHOD_FILE_UPLOAD = "file_upload"
    METHOD_PUBLIC_FORM = "public_form"
    METHOD_CHOICES = (
        (METHOD_TYPED, "Typed"),
        (METHOD_VOICE_TRANSCRIPT, "Voice Transcript"),
        (METHOD_CAMERA, "Camera"),
        (METHOD_FILE_UPLOAD, "File Upload"),
        (METHOD_PUBLIC_FORM, "Public Form"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="captures")
    captured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="captures",
    )
    capture_type = models.CharField(max_length=40, choices=TYPE_CHOICES, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    processing_engine = models.CharField(max_length=80, blank=True, default="")
    original_captured_at = models.DateTimeField(default=timezone.now, db_index=True)
    source_category = models.CharField(max_length=40, blank=True, default="", db_index=True)
    source_detail = models.CharField(max_length=80, blank=True, default="")
    capture_method = models.CharField(max_length=32, choices=METHOD_CHOICES, default=METHOD_TYPED)
    proposed_destination = models.CharField(max_length=80, blank=True, default="", db_index=True)
    customer = models.ForeignKey(
        "projects.Homeowner", on_delete=models.SET_NULL, null=True, blank=True, related_name="captures"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="captures"
    )
    agreement = models.ForeignKey(
        "projects.Agreement", on_delete=models.SET_NULL, null=True, blank=True, related_name="captures"
    )
    milestone = models.ForeignKey(
        "projects.Milestone", on_delete=models.SET_NULL, null=True, blank=True, related_name="captures"
    )
    qr_asset = models.ForeignKey(
        "projects.CaptureQrAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="captures",
    )
    raw_text_payload = models.JSONField(default=dict, blank=True)
    structured_draft = models.JSONField(default=dict, blank=True)
    review_decisions = models.JSONField(default=dict, blank=True)
    approved_snapshot = models.JSONField(default=dict, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_captures",
    )
    confidence = models.JSONField(default=dict, blank=True)
    duplicate_candidates = models.JSONField(default=list, blank=True)
    failure_details = models.JSONField(default=dict, blank=True)
    attribution_metadata = models.JSONField(default=dict, blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)
    retry_count = models.PositiveIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-original_captured_at", "-created_at"]
        indexes = [
            models.Index(fields=["contractor", "status", "-original_captured_at"], name="capture_inbox_status_idx"),
            models.Index(fields=["contractor", "capture_type", "-created_at"], name="capture_inbox_type_idx"),
            models.Index(fields=["contractor", "captured_by", "-created_at"], name="capture_actor_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            existing = Capture.objects.filter(pk=self.pk).only(
                "approved_snapshot", "approved_at", "approved_by_id"
            ).first()
            if existing and existing.approved_snapshot and (
                existing.approved_snapshot != self.approved_snapshot
                or existing.approved_at != self.approved_at
                or existing.approved_by_id != self.approved_by_id
            ):
                raise ValidationError("Approved Capture snapshots are immutable.")
        return super().save(*args, **kwargs)


class CaptureArtifact(models.Model):
    TYPE_AUDIO = "audio"
    TYPE_PHOTO = "photo"
    TYPE_DOCUMENT = "document"
    TYPE_OTHER = "other"
    TYPE_CHOICES = (
        (TYPE_AUDIO, "Audio"),
        (TYPE_PHOTO, "Photo"),
        (TYPE_DOCUMENT, "Document"),
        (TYPE_OTHER, "Other"),
    )

    RETENTION_ACTIVE = "active"
    RETENTION_DELETED = "deleted"
    RETENTION_CHOICES = (
        (RETENTION_ACTIVE, "Active"),
        (RETENTION_DELETED, "Deleted"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capture = models.ForeignKey(Capture, on_delete=models.CASCADE, related_name="artifacts")
    artifact_type = models.CharField(max_length=24, choices=TYPE_CHOICES)
    file = models.FileField(upload_to=capture_artifact_upload_path)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    mime_type = models.CharField(max_length=120, blank=True, default="")
    file_size = models.PositiveIntegerField(default=0)
    file_sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)
    captured_at = models.DateTimeField(default=timezone.now)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_artifacts",
    )
    retention_state = models.CharField(
        max_length=20, choices=RETENTION_CHOICES, default=RETENTION_ACTIVE, db_index=True
    )
    sanitization_metadata = models.JSONField(default=dict, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["capture", "retention_state"], name="capture_artifact_state_idx")]


class CaptureEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capture = models.ForeignKey(Capture, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=64, db_index=True)
    from_status = models.CharField(max_length=32, blank=True, default="")
    to_status = models.CharField(max_length=32, blank=True, default="")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_events",
    )
    reason = models.CharField(max_length=255, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["capture", "created_at"], name="capture_event_time_idx")]

    def save(self, *args, **kwargs):
        if self.pk and CaptureEvent.objects.filter(pk=self.pk).exists():
            raise ValidationError("Capture events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Capture events are append-only.")


class CaptureApplication(models.Model):
    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = (
        (STATUS_PENDING, "Pending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capture = models.ForeignKey(Capture, on_delete=models.CASCADE, related_name="applications")
    adapter = models.CharField(max_length=80, db_index=True)
    adapter_version = models.CharField(max_length=32, default="1")
    idempotency_key = models.CharField(max_length=120)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="capture_applications",
    )
    capture_version = models.PositiveIntegerField()
    request_snapshot = models.JSONField(default=dict, blank=True)
    created_records = models.JSONField(default=list, blank=True)
    receipt_payload = models.JSONField(default=dict, blank=True)
    failure_code = models.CharField(max_length=80, blank=True, default="")
    executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["capture", "idempotency_key"], name="uniq_capture_application_key")
        ]

    def build_receipt(self):
        if self.status != self.STATUS_COMPLETED or not self.executed_at:
            raise ValidationError("Only completed applications can produce a receipt.")
        return {
            "application_id": str(self.id),
            "capture_id": str(self.capture_id),
            "capture_version": self.capture_version,
            "adapter": self.adapter,
            "adapter_version": self.adapter_version,
            "actor_id": self.actor_id,
            "status": self.status,
            "created_records": self.created_records or [],
            "executed_at": self.executed_at.isoformat(),
        }

    def finalize_receipt(self):
        if self.receipt_payload:
            raise ValidationError("Capture application receipts are immutable.")
        self.receipt_payload = self.build_receipt()
        self.save(
            update_fields=[
                "status",
                "created_records",
                "executed_at",
                "receipt_payload",
                "failure_code",
            ]
        )
        return self.receipt_payload

    def save(self, *args, **kwargs):
        if self.pk:
            existing = CaptureApplication.objects.filter(pk=self.pk).first()
            if existing and existing.receipt_payload and (
                existing.receipt_payload != self.receipt_payload
                or existing.created_records != self.created_records
                or existing.executed_at != self.executed_at
                or existing.adapter != self.adapter
                or existing.actor_id != self.actor_id
                or existing.capture_version != self.capture_version
                or existing.status != self.status
            ):
                raise ValidationError("Capture application receipts are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.receipt_payload:
            raise ValidationError("Capture application receipts are immutable.")
        return super().delete(*args, **kwargs)
