from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


def smart_capture_upload_path(instance, filename):
    safe_name = str(filename or "source").replace("\\", "/").split("/")[-1]
    owner = instance.contractor_id or instance.property_profile_id or "customer"
    return f"project_assistant/smart_capture/{owner}/{instance.id}/{safe_name}"


class ProjectAssistantSmartCaptureSession(models.Model):
    CAPTURE_RECEIPT = "receipt"
    CAPTURE_EQUIPMENT_LABEL = "equipment_label"
    CAPTURE_PRODUCT_LABEL = "product_label"
    CAPTURE_HOME_SYSTEM_LABEL = "home_system_label"
    CAPTURE_APPLIANCE_LABEL = "appliance_label"
    CAPTURE_INSTALLED_PRODUCT_LABEL = "installed_product_label"
    CAPTURE_PROPERTY_RECEIPT = "property_receipt"
    CAPTURE_WARRANTY_DOCUMENT = "warranty_document"
    CAPTURE_MANUAL_DOCUMENT = "manual_document"
    CAPTURE_PAINT_FINISH_LABEL = "paint_or_finish_label"
    CAPTURE_FLOORING_MATERIAL_LABEL = "flooring_or_material_label"
    CAPTURE_PROPERTY_PHOTO = "property_photo"
    CAPTURE_TYPE_CHOICES = [
        (CAPTURE_RECEIPT, "Receipt"),
        (CAPTURE_EQUIPMENT_LABEL, "Equipment Label"),
        (CAPTURE_PRODUCT_LABEL, "Product Label"),
        (CAPTURE_HOME_SYSTEM_LABEL, "Home System Label"),
        (CAPTURE_APPLIANCE_LABEL, "Appliance Label"),
        (CAPTURE_INSTALLED_PRODUCT_LABEL, "Installed Product Label"),
        (CAPTURE_PROPERTY_RECEIPT, "Property Receipt"),
        (CAPTURE_WARRANTY_DOCUMENT, "Warranty Document"),
        (CAPTURE_MANUAL_DOCUMENT, "Manual Document"),
        (CAPTURE_PAINT_FINISH_LABEL, "Paint or Finish Label"),
        (CAPTURE_FLOORING_MATERIAL_LABEL, "Flooring or Material Label"),
        (CAPTURE_PROPERTY_PHOTO, "Property Photo"),
    ]

    STATUS_UPLOADED = "uploaded"
    STATUS_PROCESSING = "processing"
    STATUS_REVIEW_READY = "review_ready"
    STATUS_NEEDS_INFORMATION = "needs_information"
    STATUS_APPROVED = "approved"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_UPLOADED, "Uploaded"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_REVIEW_READY, "Review Ready"),
        (STATUS_NEEDS_INFORMATION, "Needs Information"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, null=True, blank=True, related_name="smart_capture_sessions")
    property_profile = models.ForeignKey(
        "projects.PropertyProfile",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="smart_capture_sessions",
    )
    customer_email = models.EmailField(blank=True, default="", db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_assistant_smart_capture_sessions",
    )
    capture_type = models.CharField(max_length=40, choices=CAPTURE_TYPE_CHOICES, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_UPLOADED, db_index=True)
    original_file = models.FileField(upload_to=smart_capture_upload_path)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    mime_type = models.CharField(max_length=120, blank=True, default="")
    file_size = models.PositiveIntegerField(default=0)
    file_sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)
    extraction_provider = models.CharField(max_length=40, blank=True, default="", db_index=True)
    extraction_model = models.CharField(max_length=120, blank=True, default="", db_index=True)
    extraction_prompt_version = models.CharField(max_length=40, blank=True, default="")
    extraction_cache_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    source_metadata = models.JSONField(default=dict, blank=True)
    raw_extracted_text = models.TextField(blank=True, default="")
    structured_payload = models.JSONField(default=dict, blank=True)
    field_confidence = models.JSONField(default=dict, blank=True)
    missing_fields = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    possible_matches = models.JSONField(default=list, blank=True)
    approved_payload = models.JSONField(default=dict, blank=True)
    created_expense = models.ForeignKey(
        "projects.ExpenseRequest",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_capture_sessions",
    )
    created_asset = models.ForeignKey(
        "projects.ContractorAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_capture_sessions",
    )
    created_property_record = models.ForeignKey(
        "projects.PropertyHomeSystem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_capture_sessions",
    )
    created_property_intelligence_record = models.ForeignKey(
        "projects.PropertyIntelligenceRecord",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_capture_sessions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        indexes = [
            models.Index(fields=["contractor", "capture_type", "status"], name="pa_smart_capture_idx"),
            models.Index(fields=["contractor", "file_sha256"], name="pa_smart_hash_idx"),
            models.Index(fields=["contractor", "extraction_cache_key"], name="pa_smart_cache_idx"),
            models.Index(fields=["property_profile", "capture_type", "status"], name="pa_smart_property_idx"),
            models.Index(fields=["customer_email", "updated_at"], name="pa_smart_customer_idx"),
        ]

    def mark_completed(self, actor, payload):
        self.status = self.STATUS_COMPLETED
        self.approved_at = timezone.now()
        self.approved_payload = payload
        self.audit_metadata = {
            **(self.audit_metadata or {}),
            "approved_by": getattr(actor, "id", None),
            "approved_at": self.approved_at.isoformat(),
            "human_approval_required": True,
        }

    def mark_cancelled(self, actor):
        self.status = self.STATUS_CANCELLED
        self.cancelled_at = timezone.now()
        self.audit_metadata = {
            **(self.audit_metadata or {}),
            "cancelled_by": getattr(actor, "id", None),
            "cancelled_at": self.cancelled_at.isoformat(),
        }


class ContractorAsset(models.Model):
    OWNER_CONTRACTOR = "contractor_equipment"
    OWNER_PROJECT_MATERIAL = "project_material"
    OWNER_CUSTOMER_PROPERTY = "customer_property_record"
    OWNER_DRAFT = "draft_only"
    OWNER_TYPE_CHOICES = [
        (OWNER_CONTRACTOR, "Contractor Equipment"),
        (OWNER_PROJECT_MATERIAL, "Project Material / Installed Product"),
        (OWNER_CUSTOMER_PROPERTY, "Customer Property Record"),
        (OWNER_DRAFT, "Draft Only"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_DRAFT = "draft"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_DRAFT, "Draft"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="assets")
    owner_type = models.CharField(max_length=40, choices=OWNER_TYPE_CHOICES, default=OWNER_CONTRACTOR, db_index=True)
    customer = models.ForeignKey("projects.Homeowner", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_assets")
    property = models.ForeignKey("projects.PropertyProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_assets")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_assets")
    agreement = models.ForeignKey("projects.Agreement", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_assets")
    milestone = models.ForeignKey("projects.Milestone", on_delete=models.SET_NULL, null=True, blank=True, related_name="contractor_assets")
    asset_type = models.CharField(max_length=80, blank=True, default="")
    name = models.CharField(max_length=255)
    manufacturer = models.CharField(max_length=200, blank=True, default="")
    model_number = models.CharField(max_length=200, blank=True, default="")
    serial_number = models.CharField(max_length=200, blank=True, default="", db_index=True)
    sku = models.CharField(max_length=120, blank=True, default="")
    purchase_date = models.DateField(null=True, blank=True)
    installation_date = models.DateField(null=True, blank=True)
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    warranty_start = models.DateField(null=True, blank=True)
    warranty_expiration = models.DateField(null=True, blank=True)
    current_location = models.CharField(max_length=255, blank=True, default="")
    assigned_team_member = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_assets",
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True)
    notes = models.TextField(blank=True, default="")
    source_capture = models.ForeignKey(
        ProjectAssistantSmartCaptureSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="asset_records",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_contractor_assets")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "owner_type", "status"], name="contractor_asset_owner_idx"),
            models.Index(fields=["contractor", "serial_number"], name="contractor_asset_serial_idx"),
        ]

    def __str__(self):
        return self.name


class AIUsageLedger(models.Model):
    FEATURE_SMART_CAPTURE_RECEIPT = "smart_capture_receipt"
    FEATURE_SMART_CAPTURE_EQUIPMENT = "smart_capture_equipment"
    FEATURE_SMART_CAPTURE_PRODUCT_LABEL = "smart_capture_product_label"
    FEATURE_SMART_CAPTURE_HOME_SYSTEM = "smart_capture_home_system"
    FEATURE_SMART_CAPTURE_APPLIANCE = "smart_capture_appliance"
    FEATURE_SMART_CAPTURE_PROPERTY_RECEIPT = "smart_capture_property_receipt"
    FEATURE_SMART_CAPTURE_WARRANTY = "smart_capture_warranty"
    FEATURE_SMART_CAPTURE_MANUAL = "smart_capture_manual"
    FEATURE_SMART_CAPTURE_PAINT_FINISH = "smart_capture_paint_finish"
    FEATURE_SMART_CAPTURE_FLOORING_MATERIAL = "smart_capture_flooring_material"
    FEATURE_SMART_CAPTURE_PROPERTY_PHOTO = "smart_capture_property_photo"
    FEATURE_CHOICES = [
        (FEATURE_SMART_CAPTURE_RECEIPT, "Smart Capture Receipt"),
        (FEATURE_SMART_CAPTURE_EQUIPMENT, "Smart Capture Equipment"),
        (FEATURE_SMART_CAPTURE_PRODUCT_LABEL, "Smart Capture Product Label"),
        (FEATURE_SMART_CAPTURE_HOME_SYSTEM, "Smart Capture Home System"),
        (FEATURE_SMART_CAPTURE_APPLIANCE, "Smart Capture Appliance"),
        (FEATURE_SMART_CAPTURE_PROPERTY_RECEIPT, "Smart Capture Property Receipt"),
        (FEATURE_SMART_CAPTURE_WARRANTY, "Smart Capture Warranty"),
        (FEATURE_SMART_CAPTURE_MANUAL, "Smart Capture Manual"),
        (FEATURE_SMART_CAPTURE_PAINT_FINISH, "Smart Capture Paint Finish"),
        (FEATURE_SMART_CAPTURE_FLOORING_MATERIAL, "Smart Capture Flooring Material"),
        (FEATURE_SMART_CAPTURE_PROPERTY_PHOTO, "Smart Capture Property Photo"),
    ]

    BILLING_UNBILLED = "unbilled"
    BILLING_NOT_BILLABLE = "not_billable"
    BILLING_CHOICES = [
        (BILLING_UNBILLED, "Unbilled"),
        (BILLING_NOT_BILLABLE, "Not Billable"),
    ]

    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, null=True, blank=True, related_name="ai_usage_ledger_entries")
    property_profile = models.ForeignKey(
        "projects.PropertyProfile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_usage_ledger_entries",
    )
    customer_email = models.EmailField(blank=True, default="", db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_usage_ledger_entries",
    )
    feature = models.CharField(max_length=80, choices=FEATURE_CHOICES, db_index=True)
    provider = models.CharField(max_length=40, db_index=True)
    model = models.CharField(max_length=120, blank=True, default="", db_index=True)
    source_type = models.CharField(max_length=80, blank=True, default="")
    source_id = models.CharField(max_length=120, blank=True, default="")
    capture_session = models.ForeignKey(
        ProjectAssistantSmartCaptureSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="usage_ledger_entries",
    )
    input_units = models.PositiveIntegerField(default=0)
    output_units = models.PositiveIntegerField(default=0)
    internal_cost = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    billable_amount = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    currency = models.CharField(max_length=8, default="USD")
    billing_status = models.CharField(max_length=32, choices=BILLING_CHOICES, default=BILLING_NOT_BILLABLE, db_index=True)
    provider_request_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    success = models.BooleanField(default=False, db_index=True)
    failure_code = models.CharField(max_length=80, blank=True, default="")
    cache_hit = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "feature", "-created_at"], name="ai_usage_feature_idx"),
            models.Index(fields=["provider", "model", "success"], name="ai_usage_provider_idx"),
        ]

    def __str__(self):
        return f"AIUsageLedger({self.provider}/{self.feature}, success={self.success})"
