from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


def warranty_evidence_upload_path(instance, filename):
    base, _dot, ext = str(filename or "evidence").rpartition(".")
    safe = slugify(base or "evidence")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    request_id = instance.warranty_request_id or "pending"
    return f"warranty_requests/{request_id}/evidence/{ts}_{safe}.{ext.lower()}" if ext else f"warranty_requests/{request_id}/evidence/{ts}_{safe}"


class WarrantyRequest(models.Model):
    STATUS_SUBMITTED = "submitted"
    STATUS_UNDER_REVIEW = "under_review"
    STATUS_MORE_INFORMATION_REQUESTED = "more_information_requested"
    STATUS_INSPECTION_SCHEDULED = "inspection_scheduled"
    STATUS_INSPECTION_COMPLETE = "inspection_complete"
    STATUS_COVERED = "covered"
    STATUS_PARTIALLY_COVERED = "partially_covered"
    STATUS_NOT_COVERED = "not_covered"
    STATUS_REPAIR_SCHEDULED = "repair_scheduled"
    STATUS_REPAIR_IN_PROGRESS = "repair_in_progress"
    STATUS_WAITING_ON_CUSTOMER = "waiting_on_customer"
    STATUS_WAITING_ON_MATERIALS = "waiting_on_materials"
    STATUS_ACKNOWLEDGMENT_REQUESTED = "acknowledgment_requested"
    STATUS_FOLLOW_UP_NEEDED = "follow_up_needed"
    STATUS_COMPLETED = "completed"
    STATUS_DENIED = "denied"
    STATUS_ESCALATED_TO_RESOLUTION = "escalated_to_resolution"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = (
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_UNDER_REVIEW, "Under Review"),
        (STATUS_MORE_INFORMATION_REQUESTED, "More Information Requested"),
        (STATUS_INSPECTION_SCHEDULED, "Inspection Scheduled"),
        (STATUS_INSPECTION_COMPLETE, "Inspection Complete"),
        (STATUS_COVERED, "Covered"),
        (STATUS_PARTIALLY_COVERED, "Partially Covered"),
        (STATUS_NOT_COVERED, "Not Covered"),
        (STATUS_REPAIR_SCHEDULED, "Repair Scheduled"),
        (STATUS_REPAIR_IN_PROGRESS, "Repair In Progress"),
        (STATUS_WAITING_ON_CUSTOMER, "Waiting On Customer"),
        (STATUS_WAITING_ON_MATERIALS, "Waiting On Materials"),
        (STATUS_ACKNOWLEDGMENT_REQUESTED, "Acknowledgment Requested"),
        (STATUS_FOLLOW_UP_NEEDED, "Follow-Up Needed"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_DENIED, "Denied"),
        (STATUS_ESCALATED_TO_RESOLUTION, "Escalated To Resolution"),
        (STATUS_CLOSED, "Closed"),
    )

    SEVERITY_LOW = "low"
    SEVERITY_NORMAL = "normal"
    SEVERITY_HIGH = "high"
    SEVERITY_CRITICAL = "critical"
    SEVERITY_CHOICES = (
        (SEVERITY_LOW, "Low"),
        (SEVERITY_NORMAL, "Normal"),
        (SEVERITY_HIGH, "High"),
        (SEVERITY_CRITICAL, "Critical"),
    )

    warranty = models.ForeignKey("projects.AgreementWarranty", on_delete=models.CASCADE, related_name="requests")
    agreement = models.ForeignKey("projects.Agreement", on_delete=models.CASCADE, related_name="warranty_requests")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_requests")
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="warranty_requests")
    homeowner = models.ForeignKey("projects.Homeowner", on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_requests")
    property_profile = models.ForeignKey("projects.PropertyProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_requests")
    title = models.CharField(max_length=255)
    description = models.TextField()
    date_noticed = models.DateField(null=True, blank=True)
    area_affected = models.CharField(max_length=255, blank=True, default="")
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default=SEVERITY_NORMAL, db_index=True)
    urgency = models.CharField(max_length=40, blank=True, default="")
    other_contractor_worked = models.BooleanField(default=False)
    preferred_scheduling = models.TextField(blank=True, default="")
    status = models.CharField(max_length=40, choices=STATUS_CHOICES, default=STATUS_SUBMITTED, db_index=True)
    coverage_decision = models.CharField(max_length=40, blank=True, default="")
    contractor_response = models.TextField(blank=True, default="")
    customer_notes = models.TextField(blank=True, default="")
    ai_review = models.JSONField(default=dict, blank=True)
    response_due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    next_expected_action = models.CharField(max_length=255, blank=True, default="")
    customer_acknowledged_at = models.DateTimeField(null=True, blank=True)
    customer_acknowledgment_response = models.CharField(max_length=40, blank=True, default="")
    unresolved_reason = models.TextField(blank=True, default="")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="submitted_warranty_requests")
    submitted_by_email = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    escalated_dispute_id = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    source_context = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "status"]),
            models.Index(fields=["agreement", "status"]),
            models.Index(fields=["warranty", "status"]),
            models.Index(fields=["property_profile", "status"]),
        ]

    def save(self, *args, **kwargs):
        if self.agreement_id:
            if not self.project_id:
                self.project_id = getattr(self.agreement, "project_id", None)
            if not self.contractor_id:
                self.contractor_id = getattr(self.agreement, "contractor_id", None)
            if not self.homeowner_id:
                self.homeowner_id = getattr(self.agreement, "homeowner_id", None)
        if self.status in {self.STATUS_CLOSED, self.STATUS_COMPLETED, self.STATUS_DENIED} and not self.closed_at:
            self.closed_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"WarrantyRequest({self.id}, {self.status})"


class WarrantyRequestStatusHistory(models.Model):
    warranty_request = models.ForeignKey(WarrantyRequest, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=40, blank=True, default="")
    to_status = models.CharField(max_length=40, db_index=True)
    note = models.TextField(blank=True, default="")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_status_events")
    actor_email = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["created_at", "id"]


class WarrantyRequestEvidence(models.Model):
    TYPE_PHOTO = "photo"
    TYPE_VIDEO = "video"
    TYPE_DOCUMENT = "document"
    TYPE_OTHER = "other"
    TYPE_CHOICES = (
        (TYPE_PHOTO, "Photo"),
        (TYPE_VIDEO, "Video"),
        (TYPE_DOCUMENT, "Document"),
        (TYPE_OTHER, "Other"),
    )

    warranty_request = models.ForeignKey(WarrantyRequest, on_delete=models.CASCADE, related_name="evidence")
    file = models.FileField(upload_to=warranty_evidence_upload_path)
    evidence_type = models.CharField(max_length=24, choices=TYPE_CHOICES, default=TYPE_OTHER, db_index=True)
    description = models.TextField(blank=True, default="")
    original_filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=120, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_evidence")
    uploaded_by_email = models.EmailField(blank=True, default="")
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["uploaded_at", "id"]


class WarrantyWorkOrder(models.Model):
    STATUS_OPEN = "open"
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_COMPLETED = "completed"
    STATUS_CLOSED = "closed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = (
        (STATUS_OPEN, "Open"),
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_CANCELLED, "Cancelled"),
    )

    warranty_request = models.OneToOneField(WarrantyRequest, on_delete=models.CASCADE, related_name="work_order")
    warranty = models.ForeignKey("projects.AgreementWarranty", on_delete=models.CASCADE, related_name="work_orders")
    agreement = models.ForeignKey("projects.Agreement", on_delete=models.CASCADE, related_name="warranty_work_orders")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_work_orders")
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="warranty_work_orders")
    title = models.CharField(max_length=255)
    scope = models.TextField()
    assigned_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_warranty_work_orders")
    assigned_team_notes = models.TextField(blank=True, default="")
    materials = models.TextField(blank=True, default="")
    scheduled_for = models.DateTimeField(null=True, blank=True, db_index=True)
    labor_estimate_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    estimated_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    customer_notes = models.TextField(blank=True, default="")
    completion_checklist = models.JSONField(default=list, blank=True)
    completion_notes = models.TextField(blank=True, default="")
    repair_outcome = models.TextField(blank=True, default="")
    customer_acknowledged_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True)
    linked_property_work_order = models.ForeignKey("projects.PropertyWorkOrder", on_delete=models.SET_NULL, null=True, blank=True, related_name="warranty_work_orders")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "status"]),
            models.Index(fields=["scheduled_for", "status"]),
        ]

    def save(self, *args, **kwargs):
        if self.agreement_id:
            if not self.project_id:
                self.project_id = getattr(self.agreement, "project_id", None)
            if not self.contractor_id:
                self.contractor_id = getattr(self.agreement, "contractor_id", None)
        if self.status == self.STATUS_COMPLETED and not self.completed_at:
            self.completed_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"WarrantyWorkOrder({self.id}, {self.status})"
