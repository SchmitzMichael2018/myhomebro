from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class PropertyProfile(models.Model):
    PROPERTY_TYPE_SINGLE_FAMILY = "single_family"
    PROPERTY_TYPE_TOWNHOME = "townhome"
    PROPERTY_TYPE_CONDO = "condo"
    PROPERTY_TYPE_MULTI_FAMILY = "multi_family"
    PROPERTY_TYPE_COMMERCIAL = "commercial"
    PROPERTY_TYPE_OTHER = "other"
    PROPERTY_TYPE_CHOICES = [
        (PROPERTY_TYPE_SINGLE_FAMILY, "Single Family"),
        (PROPERTY_TYPE_TOWNHOME, "Townhome"),
        (PROPERTY_TYPE_CONDO, "Condo"),
        (PROPERTY_TYPE_MULTI_FAMILY, "Multi-Family"),
        (PROPERTY_TYPE_COMMERCIAL, "Commercial"),
        (PROPERTY_TYPE_OTHER, "Other"),
    ]

    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_profiles",
    )
    customer_email = models.EmailField(db_index=True)
    display_name = models.CharField(max_length=200, blank=True, default="")
    property_type = models.CharField(
        max_length=32,
        choices=PROPERTY_TYPE_CHOICES,
        default=PROPERTY_TYPE_SINGLE_FAMILY,
    )
    address_line1 = models.CharField(max_length=255, blank=True, default="")
    address_line2 = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=60, blank=True, default="")
    postal_code = models.CharField(max_length=24, blank=True, default="")
    year_built = models.PositiveIntegerField(null=True, blank=True)
    square_feet = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["customer_email", "display_name", "id"]
        indexes = [
            models.Index(fields=["customer_email", "updated_at"]),
        ]

    def __str__(self):
        label = (self.display_name or self.address_line1 or self.customer_email or "").strip()
        return label or f"PropertyProfile #{self.pk}"


def property_document_upload_path(instance, filename):
    base, _dot, ext = filename.rpartition(".")
    safe = slugify(base or "document")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    return (
        f"property_profiles/{instance.property_profile_id}/documents/{ts}_{safe}.{ext.lower()}"
        if ext
        else f"property_profiles/{instance.property_profile_id}/documents/{ts}_{safe}"
    )


class PropertyDocument(models.Model):
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    title = models.CharField(max_length=200)
    document_type = models.CharField(max_length=64, blank=True, default="")
    file = models.FileField(upload_to=property_document_upload_path)
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self):
        return f"{self.property_profile_id} - {self.title}"


def property_photo_upload_path(instance, filename):
    base, _dot, ext = filename.rpartition(".")
    safe = slugify(base or "photo")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    return (
        f"property_profiles/{instance.property_profile_id}/photos/{ts}_{safe}.{ext.lower()}"
        if ext
        else f"property_profiles/{instance.property_profile_id}/photos/{ts}_{safe}"
    )


class PropertyPhoto(models.Model):
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="photos",
    )
    title = models.CharField(max_length=200, blank=True, default="")
    photo = models.FileField(upload_to=property_photo_upload_path)
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self):
        return f"{self.property_profile_id} - {self.title or 'Photo'}"


class CustomerRequest(models.Model):
    TYPE_REPAIR = "repair"
    TYPE_MAINTENANCE = "maintenance"
    TYPE_NEW_PROJECT = "new_project"
    TYPE_DIY_ASSISTANCE = "diy_assistance"
    TYPE_INSPECTION = "inspection"
    TYPE_EMERGENCY = "emergency"
    REQUEST_TYPE_CHOICES = [
        (TYPE_REPAIR, "Repair"),
        (TYPE_MAINTENANCE, "Maintenance"),
        (TYPE_NEW_PROJECT, "New Project"),
        (TYPE_DIY_ASSISTANCE, "DIY Assistance"),
        (TYPE_INSPECTION, "Inspection"),
        (TYPE_EMERGENCY, "Emergency"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_ROUTED = "routed"
    STATUS_MARKETPLACE_READY = "marketplace_ready"
    STATUS_MATCHED = "matched"
    STATUS_CONVERTED_TO_PROJECT = "converted_to_project"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_ROUTED, "Routed"),
        (STATUS_MARKETPLACE_READY, "Marketplace Ready"),
        (STATUS_MATCHED, "Matched"),
        (STATUS_CONVERTED_TO_PROJECT, "Converted to Project"),
        (STATUS_CLOSED, "Closed"),
    ]

    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_requests",
    )
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_requests",
    )
    customer_email = models.EmailField(db_index=True)
    request_type = models.CharField(max_length=32, choices=REQUEST_TYPE_CHOICES)
    status = models.CharField(
        max_length=32,
        choices=STATUS_CHOICES,
        default=STATUS_SUBMITTED,
        db_index=True,
    )
    title = models.CharField(max_length=200)
    description = models.TextField()
    urgency = models.CharField(max_length=32, blank=True, default="")
    preferred_timeline = models.CharField(max_length=120, blank=True, default="")
    address_line1 = models.CharField(max_length=255, blank=True, default="")
    address_line2 = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=60, blank=True, default="")
    postal_code = models.CharField(max_length=24, blank=True, default="")
    converted_project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_customer_requests",
    )
    internal_notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["customer_email", "status"]),
            models.Index(fields=["request_type", "status"]),
        ]

    def __str__(self):
        return f"{self.customer_email} - {self.title}"
