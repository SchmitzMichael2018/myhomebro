from __future__ import annotations

import uuid

from django.db import models


class DIYProject(models.Model):
    class Status(models.TextChoices):
        PLANNING = "planning", "Planning"
        READY = "ready", "Ready to Start"
        IN_PROGRESS = "in_progress", "In Progress"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner_email = models.EmailField(db_index=True)
    property_profile = models.ForeignKey(
        "projects.PropertyProfile", null=True, blank=True, on_delete=models.SET_NULL, related_name="diy_projects"
    )
    title = models.CharField(max_length=200)
    desired_outcome = models.TextField()
    category = models.CharField(max_length=120, blank=True, default="")
    area = models.CharField(max_length=120, blank=True, default="")
    existing_conditions = models.TextField(blank=True, default="")
    work_completed = models.TextField(blank=True, default="")
    target_budget_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target_budget_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target_completion_date = models.DateField(null=True, blank=True)
    confidence_notes = models.TextField(blank=True, default="")
    design_notes = models.TextField(blank=True, default="")
    additional_context = models.TextField(blank=True, default="")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PLANNING, db_index=True)
    ai_summary = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["owner_email", "status"])]

    def save(self, *args, **kwargs):
        self.owner_email = str(self.owner_email or "").strip().lower()
        return super().save(*args, **kwargs)


class DIYProjectPhase(models.Model):
    project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="phases")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]


class DIYProjectTask(models.Model):
    class Participation(models.TextChoices):
        DO_IT_MYSELF = "DO_IT_MYSELF", "Doing Myself"
        NEED_GUIDANCE = "NEED_GUIDANCE", "Need Expert Guidance"
        NEED_HELP = "NEED_HELP", "Need Hands-On Help"
        NEED_PROFESSIONAL = "NEED_PROFESSIONAL", "Need a Professional"
        UNDECIDED = "UNDECIDED", "Undecided"

    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "Not Started"
        IN_PROGRESS = "in_progress", "In Progress"
        BLOCKED = "blocked", "Blocked"
        COMPLETED = "completed", "Completed"
        SKIPPED = "skipped", "Skipped"

    class Source(models.TextChoices):
        HOMEOWNER = "homeowner", "Homeowner-created"
        AI = "ai", "AI-suggested"

    phase = models.ForeignKey(DIYProjectPhase, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    participation_type = models.CharField(max_length=32, choices=Participation.choices, default=Participation.UNDECIDED)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NOT_STARTED)
    sort_order = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    estimated_duration = models.CharField(max_length=120, blank=True, default="")
    estimated_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    prerequisite_notes = models.TextField(blank=True, default="")
    professional_review_recommended = models.BooleanField(default=False)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.HOMEOWNER)
    ai_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]


class DIYProjectMeasurement(models.Model):
    class Verification(models.TextChoices):
        HOMEOWNER = "homeowner_provided", "Homeowner Provided"
        PROFESSIONAL = "professionally_verified", "Professionally Verified"

    project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="measurements")
    label = models.CharField(max_length=160)
    value = models.DecimalField(max_digits=14, decimal_places=4)
    unit = models.CharField(max_length=40)
    notes = models.TextField(blank=True, default="")
    verification_status = models.CharField(
        max_length=32, choices=Verification.choices, default=Verification.HOMEOWNER
    )
    verified_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL)
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


def diy_asset_upload_path(instance, filename):
    return f"diy_projects/{instance.project_id}/{uuid.uuid4().hex}_{filename}"


class DIYProjectAsset(models.Model):
    class Type(models.TextChoices):
        PROJECT = "project_photo", "Project Photo"
        INSPIRATION = "inspiration", "Inspiration / Reference"
        PROGRESS = "progress", "Progress / Completion"
        FILE = "file", "File"

    project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="assets")
    task = models.ForeignKey(DIYProjectTask, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    asset_type = models.CharField(max_length=24, choices=Type.choices, default=Type.PROJECT)
    file = models.FileField(upload_to=diy_asset_upload_path)
    caption = models.CharField(max_length=255, blank=True, default="")
    uploaded_by_email = models.EmailField()
    created_at = models.DateTimeField(auto_now_add=True)


class DIYProjectProgressEntry(models.Model):
    project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="progress_entries")
    task = models.ForeignKey(DIYProjectTask, null=True, blank=True, on_delete=models.SET_NULL, related_name="progress_entries")
    note = models.TextField(blank=True, default="")
    from_status = models.CharField(max_length=24, blank=True, default="")
    to_status = models.CharField(max_length=24, blank=True, default="")
    created_by_email = models.EmailField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class DIYProjectAIProposal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="ai_proposals")
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default="proposed")
    applied_keys = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)


class DIYProjectRequestLink(models.Model):
    idempotency_key = models.CharField(max_length=100)
    diy_project = models.ForeignKey(DIYProject, on_delete=models.CASCADE, related_name="request_links")
    customer_request = models.ForeignKey(
        "projects.CustomerRequest", null=True, blank=True, on_delete=models.SET_NULL, related_name="diy_project_links"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["diy_project", "idempotency_key"], name="uniq_diy_request_link_key")
        ]
