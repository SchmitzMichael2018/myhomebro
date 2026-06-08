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
    is_primary = models.BooleanField(default=False, db_index=True)
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


class SmartNotificationEvent(models.TextChoices):
    CUSTOMER_REQUEST_SUBMITTED = "customer_request_submitted", "Customer Request Submitted"
    PROPERTY_PROFILE_UPDATED = "property_profile_updated", "Property Profile Updated"
    MARKETPLACE_REQUEST_ROUTED = "marketplace_request_routed", "Marketplace Request Routed"
    CUSTOMER_BID_RECEIVED = "customer_bid_received", "Customer Bid Received"
    BID_AWARDED = "bid_awarded", "Bid Awarded"
    AGREEMENT_NEEDS_SIGNATURE = "agreement_needs_signature", "Agreement Needs Signature"
    AGREEMENT_SIGNED = "agreement_signed", "Agreement Signed"
    ESCROW_NEEDS_FUNDING = "escrow_needs_funding", "Escrow Needs Funding"
    ESCROW_FUNDED = "escrow_funded", "Escrow Funded"
    MILESTONE_NEEDS_APPROVAL = "milestone_needs_approval", "Milestone Needs Approval"
    PAYMENT_RECEIVED = "payment_received", "Payment Received"
    REIMBURSEMENT_SUBMITTED = "reimbursement_submitted", "Reimbursement Submitted"
    REIMBURSEMENT_APPROVED = "reimbursement_approved", "Reimbursement Approved"
    REIMBURSEMENT_DENIED = "reimbursement_denied", "Reimbursement Denied"
    REIMBURSEMENT_RELEASED = "reimbursement_released", "Reimbursement Released"
    REIMBURSEMENT_HELD = "reimbursement_held", "Reimbursement Held"
    DISPUTE_OPENED = "dispute_opened", "Dispute Opened"
    DISPUTE_UPDATED = "dispute_updated", "Dispute Updated"
    DISPUTE_RESOLVED = "dispute_resolved", "Dispute Resolved"
    REQUEST_MARKETPLACE_READY = "request_marketplace_ready", "Request Marketplace Ready"


class NotificationRule(models.Model):
    CHANNEL_IN_APP = "in_app"
    CHANNEL_EMAIL_STUB = "email_stub"
    CHANNEL_SMS_STUB = "sms_stub"
    CHANNEL_CHOICES = [
        (CHANNEL_IN_APP, "In App"),
        (CHANNEL_EMAIL_STUB, "Email Stub"),
        (CHANNEL_SMS_STUB, "SMS Stub"),
    ]

    AUDIENCE_CUSTOMER = "customer"
    AUDIENCE_CONTRACTOR = "contractor"
    AUDIENCE_INTERNAL = "internal"
    AUDIENCE_CHOICES = [
        (AUDIENCE_CUSTOMER, "Customer"),
        (AUDIENCE_CONTRACTOR, "Contractor"),
        (AUDIENCE_INTERNAL, "Internal"),
    ]

    name = models.CharField(max_length=160)
    event_type = models.CharField(max_length=64, choices=SmartNotificationEvent.choices, db_index=True)
    channel = models.CharField(max_length=24, choices=CHANNEL_CHOICES, default=CHANNEL_IN_APP, db_index=True)
    audience = models.CharField(max_length=24, choices=AUDIENCE_CHOICES, default=AUDIENCE_CUSTOMER, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    title_template = models.CharField(max_length=255)
    message_template = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["event_type", "channel", "name"]
        unique_together = [("event_type", "channel", "audience")]

    def __str__(self):
        return f"{self.event_type}:{self.channel}:{self.audience}"


class SmartNotification(models.Model):
    STATUS_UNREAD = "unread"
    STATUS_READ = "read"
    STATUS_DISMISSED = "dismissed"
    STATUS_CHOICES = [
        (STATUS_UNREAD, "Unread"),
        (STATUS_READ, "Read"),
        (STATUS_DISMISSED, "Dismissed"),
    ]

    event_type = models.CharField(max_length=64, choices=SmartNotificationEvent.choices, db_index=True)
    channel = models.CharField(max_length=24, choices=NotificationRule.CHANNEL_CHOICES, default=NotificationRule.CHANNEL_IN_APP, db_index=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_UNREAD, db_index=True)
    recipient_email = models.EmailField(db_index=True)
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    invoice = models.ForeignKey(
        "projects.Invoice",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    draw_request = models.ForeignKey(
        "projects.DrawRequest",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    customer_request = models.ForeignKey(
        CustomerRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="smart_notifications",
    )
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True, default="")
    action_url = models.CharField(max_length=500, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["recipient_email", "status"]),
            models.Index(fields=["event_type", "created_at"]),
        ]

    def __str__(self):
        return f"{self.recipient_email}:{self.event_type}:{self.title}"


class NotificationLog(models.Model):
    STATUS_CREATED = "created"
    STATUS_SKIPPED = "skipped"
    STATUS_STUBBED = "stubbed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_CREATED, "Created"),
        (STATUS_SKIPPED, "Skipped"),
        (STATUS_STUBBED, "Stubbed"),
        (STATUS_FAILED, "Failed"),
    ]

    smart_notification = models.ForeignKey(
        SmartNotification,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="logs",
    )
    notification_rule = models.ForeignKey(
        NotificationRule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="logs",
    )
    event_type = models.CharField(max_length=64, choices=SmartNotificationEvent.choices, db_index=True)
    channel = models.CharField(max_length=24, choices=NotificationRule.CHANNEL_CHOICES, default=NotificationRule.CHANNEL_IN_APP, db_index=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_CREATED, db_index=True)
    recipient_email = models.EmailField(blank=True, default="", db_index=True)
    message = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["event_type", "status"]),
            models.Index(fields=["recipient_email", "created_at"]),
        ]

    def __str__(self):
        return f"{self.event_type}:{self.channel}:{self.status}"
