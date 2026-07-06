from __future__ import annotations

from django.conf import settings
from django.db import models


class Proposal(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_SITE_VISIT = "site_visit"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_READY = "ready"
    STATUS_SENT = "sent"
    STATUS_VIEWED = "viewed"
    STATUS_ACCEPTED = "accepted"
    STATUS_DECLINED = "declined"
    STATUS_REVISION_REQUESTED = "revision_requested"
    STATUS_EXPIRED = "expired"
    STATUS_CONVERTED = "converted"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SITE_VISIT, "Site Visit"),
        (STATUS_IN_PROGRESS, "Proposal In Progress"),
        (STATUS_READY, "Proposal Ready"),
        (STATUS_SENT, "Proposal Sent"),
        (STATUS_VIEWED, "Viewed"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_REVISION_REQUESTED, "Revision Requested"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_CONVERTED, "Converted"),
    ]

    SOURCE_LEAD = "lead"
    SOURCE_INTAKE = "intake"
    SOURCE_OPPORTUNITY = "opportunity"
    SOURCE_PROPERTY_WORK_ORDER = "property_work_order"
    SOURCE_DASHBOARD = "dashboard"
    SOURCE_CHOICES = [
        (SOURCE_LEAD, "Lead"),
        (SOURCE_INTAKE, "Intake"),
        (SOURCE_OPPORTUNITY, "Opportunity"),
        (SOURCE_PROPERTY_WORK_ORDER, "Property Work Order"),
        (SOURCE_DASHBOARD, "Dashboard Estimate"),
    ]

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="proposals",
    )
    contractor_opportunity = models.ForeignKey(
        "projects.ContractorOpportunity",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="proposals",
    )
    estimate_appointment = models.ForeignKey(
        "projects.OpportunityEstimateAppointment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="proposals",
    )
    source_type = models.CharField(max_length=32, choices=SOURCE_CHOICES, db_index=True)
    source_id = models.PositiveIntegerField(db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)

    project_title = models.CharField(max_length=255, blank=True, default="")
    project_summary = models.TextField(blank=True, default="")
    project_type = models.CharField(max_length=120, blank=True, default="")
    project_subtype = models.CharField(max_length=120, blank=True, default="")

    customer_name = models.CharField(max_length=255, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    customer_phone = models.CharField(max_length=50, blank=True, default="")
    customer_preferred_contact = models.CharField(max_length=40, blank=True, default="")
    service_location = models.CharField(max_length=500, blank=True, default="")

    site_visit_notes = models.TextField(blank=True, default="")
    access_notes = models.TextField(blank=True, default="")
    risk_notes = models.TextField(blank=True, default="")
    customer_requests = models.TextField(blank=True, default="")
    site_conditions = models.TextField(blank=True, default="")
    quick_checklist = models.JSONField(default=list, blank=True)

    included_work = models.TextField(blank=True, default="")
    excluded_work = models.TextField(blank=True, default="")
    assumptions = models.TextField(blank=True, default="")
    allowances = models.TextField(blank=True, default="")
    internal_notes = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_proposals",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "status"], name="projects_prop_con_status_idx"),
            models.Index(fields=["source_type", "source_id"], name="projects_prop_source_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["contractor", "source_type", "source_id"],
                name="uniq_proposal_contractor_source",
            ),
        ]

    def __str__(self) -> str:
        return f"Proposal #{self.pk} - {self.project_title or self.source_type}"


class ProposalMeasurement(models.Model):
    proposal = models.ForeignKey(Proposal, on_delete=models.CASCADE, related_name="measurements")
    label = models.CharField(max_length=160)
    location = models.CharField(max_length=160, blank=True, default="")
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit = models.CharField(max_length=40, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.label}: {self.quantity} {self.unit}".strip()


class ProposalLineItem(models.Model):
    CATEGORY_LABOR = "labor"
    CATEGORY_MATERIALS = "materials"
    CATEGORY_EQUIPMENT = "equipment"
    CATEGORY_SUBCONTRACTOR = "subcontractor"
    CATEGORY_INCIDENTALS_RESERVE = "incidentals_reserve"
    CATEGORY_TAX = "tax"
    CATEGORY_DISCOUNT = "discount"
    CATEGORY_ALLOWANCE = "allowance"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = [
        (CATEGORY_LABOR, "Labor"),
        (CATEGORY_MATERIALS, "Materials"),
        (CATEGORY_EQUIPMENT, "Equipment"),
        (CATEGORY_SUBCONTRACTOR, "Subcontractor"),
        (CATEGORY_INCIDENTALS_RESERVE, "Incidentals Reserve"),
        (CATEGORY_TAX, "Tax"),
        (CATEGORY_DISCOUNT, "Discount"),
        (CATEGORY_ALLOWANCE, "Allowance"),
        (CATEGORY_OTHER, "Other"),
    ]

    proposal = models.ForeignKey(Proposal, on_delete=models.CASCADE, related_name="line_items")
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES, default=CATEGORY_LABOR, db_index=True)
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=1)
    unit = models.CharField(max_length=40, blank=True, default="")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["proposal", "category"], name="projects_prop_line_cat_idx"),
        ]

    def save(self, *args, **kwargs):
        self.total = (self.quantity or 0) * (self.unit_price or 0)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.get_category_display()}: {self.description}"


def proposal_attachment_upload_to(instance, filename: str) -> str:
    return f"proposal_attachments/{instance.proposal_id}/{filename}"


class ProposalAttachment(models.Model):
    TYPE_PHOTO = "photo"
    TYPE_DOCUMENT = "document"
    TYPE_CHOICES = [
        (TYPE_PHOTO, "Photo"),
        (TYPE_DOCUMENT, "Document"),
    ]
    CATEGORY_BEFORE = "before"
    CATEGORY_REFERENCE = "reference"
    CATEGORY_PLAN = "plan"
    CATEGORY_HOA = "hoa"
    CATEGORY_CUSTOMER_FILE = "customer_file"
    CATEGORY_VENDOR_QUOTE = "vendor_quote"
    CATEGORY_INSPECTION = "inspection"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = [
        (CATEGORY_BEFORE, "Before Photo"),
        (CATEGORY_REFERENCE, "Reference Photo"),
        (CATEGORY_PLAN, "Plan"),
        (CATEGORY_HOA, "HOA Document"),
        (CATEGORY_CUSTOMER_FILE, "Customer File"),
        (CATEGORY_VENDOR_QUOTE, "Vendor Quote"),
        (CATEGORY_INSPECTION, "Inspection Document"),
        (CATEGORY_OTHER, "Other"),
    ]

    proposal = models.ForeignKey(Proposal, on_delete=models.CASCADE, related_name="attachments")
    attachment_type = models.CharField(max_length=24, choices=TYPE_CHOICES, default=TYPE_DOCUMENT, db_index=True)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES, default=CATEGORY_OTHER, db_index=True)
    file = models.FileField(upload_to=proposal_attachment_upload_to)
    original_name = models.CharField(max_length=255, blank=True, default="")
    caption = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_proposal_attachments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.original_name or f"Proposal attachment #{self.pk}"


class ProposalActivity(models.Model):
    EVENT_CREATED = "created"
    EVENT_APPOINTMENT_LINKED = "appointment_linked"
    EVENT_STATUS_UPDATED = "status_updated"
    EVENT_SITE_VISIT_UPDATED = "site_visit_updated"
    EVENT_MEASUREMENT_ADDED = "measurement_added"
    EVENT_MEASUREMENT_UPDATED = "measurement_updated"
    EVENT_MEASUREMENT_REMOVED = "measurement_removed"
    EVENT_ATTACHMENT_UPLOADED = "attachment_uploaded"
    EVENT_ATTACHMENT_UPDATED = "attachment_updated"
    EVENT_ATTACHMENT_REMOVED = "attachment_removed"
    EVENT_SCOPE_EDITED = "scope_edited"
    EVENT_NOTES_EDITED = "notes_edited"
    EVENT_LINE_ITEM_ADDED = "line_item_added"
    EVENT_LINE_ITEM_UPDATED = "line_item_updated"
    EVENT_LINE_ITEM_REMOVED = "line_item_removed"
    EVENT_CHOICES = [
        (EVENT_CREATED, "Proposal Created"),
        (EVENT_APPOINTMENT_LINKED, "Appointment Linked"),
        (EVENT_STATUS_UPDATED, "Status Updated"),
        (EVENT_SITE_VISIT_UPDATED, "Site Visit Updated"),
        (EVENT_MEASUREMENT_ADDED, "Measurement Added"),
        (EVENT_MEASUREMENT_UPDATED, "Measurement Updated"),
        (EVENT_MEASUREMENT_REMOVED, "Measurement Removed"),
        (EVENT_ATTACHMENT_UPLOADED, "Attachment Uploaded"),
        (EVENT_ATTACHMENT_UPDATED, "Attachment Updated"),
        (EVENT_ATTACHMENT_REMOVED, "Attachment Removed"),
        (EVENT_SCOPE_EDITED, "Scope Edited"),
        (EVENT_NOTES_EDITED, "Notes Edited"),
        (EVENT_LINE_ITEM_ADDED, "Line Item Added"),
        (EVENT_LINE_ITEM_UPDATED, "Line Item Updated"),
        (EVENT_LINE_ITEM_REMOVED, "Line Item Removed"),
    ]

    proposal = models.ForeignKey(Proposal, on_delete=models.CASCADE, related_name="activity")
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    message = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="proposal_activity_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.message
