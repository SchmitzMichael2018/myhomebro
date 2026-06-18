from django.conf import settings
from django.db import models
from django.db.models import Q
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
    managed_by_company = models.ForeignKey(
        "projects.PropertyManagementCompany",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_properties",
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
    bedrooms = models.PositiveSmallIntegerField(null=True, blank=True)
    bathrooms = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_primary = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["customer_email", "display_name", "id"]
        indexes = [
            models.Index(fields=["customer_email", "updated_at"]),
            models.Index(fields=["managed_by_company", "updated_at"]),
        ]

    def __str__(self):
        label = (self.display_name or self.address_line1 or self.customer_email or "").strip()
        return label or f"PropertyProfile #{self.pk}"


class PropertyManagementCompany(models.Model):
    homeowner = models.OneToOneField(
        "projects.Homeowner",
        on_delete=models.CASCADE,
        related_name="property_management_company",
    )
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    website = models.CharField(max_length=255, blank=True, default="")
    address_line1 = models.CharField(max_length=255, blank=True, default="")
    address_line2 = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=100, blank=True, default="")
    state = models.CharField(max_length=50, blank=True, default="")
    postal_code = models.CharField(max_length=20, blank=True, default="")
    license_number = models.CharField(max_length=120, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["name"]),
            models.Index(fields=["email"]),
            models.Index(fields=["is_active", "updated_at"]),
        ]

    def __str__(self):
        return self.name or f"Property Management Company #{self.pk}"


class PropertyManagementStaffMembership(models.Model):
    ROLE_ADMIN = "admin"
    ROLE_MANAGER = "manager"
    ROLE_MAINTENANCE_COORDINATOR = "maintenance_coordinator"
    ROLE_ACCOUNTING = "accounting"
    ROLE_VIEWER = "viewer"
    ROLE_CHOICES = [
        (ROLE_ADMIN, "Admin"),
        (ROLE_MANAGER, "Manager"),
        (ROLE_MAINTENANCE_COORDINATOR, "Maintenance Coordinator"),
        (ROLE_ACCOUNTING, "Accounting"),
        (ROLE_VIEWER, "Viewer"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_INVITED = "invited"
    STATUS_DISABLED = "disabled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INVITED, "Invited"),
        (STATUS_DISABLED, "Disabled"),
    ]

    company = models.ForeignKey(
        PropertyManagementCompany,
        on_delete=models.CASCADE,
        related_name="staff_memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_management_staff_memberships",
    )
    email = models.EmailField(db_index=True)
    name = models.CharField(max_length=255, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    role = models.CharField(max_length=32, choices=ROLE_CHOICES, default=ROLE_VIEWER, db_index=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_INVITED, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["company", "name", "email"]
        constraints = [
            models.UniqueConstraint(fields=["company", "email"], name="uniq_pm_staff_email_per_company"),
        ]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "role"]),
        ]

    def __str__(self):
        return f"{self.name or self.email} ({self.get_role_display()})"


class PropertyOwnerContact(models.Model):
    company = models.ForeignKey(
        PropertyManagementCompany,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owner_contacts",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_owner_contacts",
    )
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    mailing_address = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["company", "name"]),
            models.Index(fields=["email"]),
        ]

    def __str__(self):
        return self.name or self.email or f"Owner Contact #{self.pk}"


class PropertyOwnership(models.Model):
    OWNERSHIP_SOLE_OWNER = "sole_owner"
    OWNERSHIP_CO_OWNER = "co_owner"
    OWNERSHIP_ENTITY = "entity"
    OWNERSHIP_TRUST = "trust"
    OWNERSHIP_OTHER = "other"
    OWNERSHIP_TYPE_CHOICES = [
        (OWNERSHIP_SOLE_OWNER, "Sole Owner"),
        (OWNERSHIP_CO_OWNER, "Co-Owner"),
        (OWNERSHIP_ENTITY, "Entity"),
        (OWNERSHIP_TRUST, "Trust"),
        (OWNERSHIP_OTHER, "Other"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="ownerships",
    )
    owner_contact = models.ForeignKey(
        PropertyOwnerContact,
        on_delete=models.CASCADE,
        related_name="property_ownerships",
    )
    ownership_type = models.CharField(max_length=32, choices=OWNERSHIP_TYPE_CHOICES, default=OWNERSHIP_SOLE_OWNER)
    is_primary = models.BooleanField(default=False, db_index=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["property_profile", "-is_primary", "owner_contact__name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["property_profile", "owner_contact"], name="uniq_property_owner_contact"),
        ]
        indexes = [
            models.Index(fields=["property_profile", "is_primary"]),
            models.Index(fields=["owner_contact", "ownership_type"]),
        ]

    def __str__(self):
        return f"{self.owner_contact} owns {self.property_profile}"


class PropertyUnit(models.Model):
    UNIT_WHOLE_PROPERTY = "whole_property"
    UNIT_APARTMENT = "apartment"
    UNIT_CONDO = "condo"
    UNIT_SUITE = "suite"
    UNIT_ROOM = "room"
    UNIT_OTHER = "other"
    UNIT_TYPE_CHOICES = [
        (UNIT_WHOLE_PROPERTY, "Whole Property"),
        (UNIT_APARTMENT, "Apartment"),
        (UNIT_CONDO, "Condo"),
        (UNIT_SUITE, "Suite"),
        (UNIT_ROOM, "Room"),
        (UNIT_OTHER, "Other"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_VACANT = "vacant"
    STATUS_INACTIVE = "inactive"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_VACANT, "Vacant"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="units",
    )
    unit_label = models.CharField(max_length=120)
    unit_type = models.CharField(max_length=32, choices=UNIT_TYPE_CHOICES, default=UNIT_WHOLE_PROPERTY)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True)
    access_notes = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["property_profile", "unit_label", "id"]
        constraints = [
            models.UniqueConstraint(fields=["property_profile", "unit_label"], name="uniq_property_unit_label"),
        ]
        indexes = [
            models.Index(fields=["property_profile", "status"]),
            models.Index(fields=["unit_type", "status"]),
        ]

    def __str__(self):
        return f"{self.property_profile}: {self.unit_label}"


class Tenant(models.Model):
    STATUS_PENDING = "pending"
    STATUS_ACTIVE = "active"
    STATUS_FORMER = "former"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_ACTIVE, "Active"),
        (STATUS_FORMER, "Former"),
    ]

    company = models.ForeignKey(
        PropertyManagementCompany,
        on_delete=models.CASCADE,
        related_name="tenants",
    )
    first_name = models.CharField(max_length=120, blank=True, default="")
    last_name = models.CharField(max_length=120, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    emergency_contact_name = models.CharField(max_length=255, blank=True, default="")
    emergency_contact_phone = models.CharField(max_length=40, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    maintenance_access_enabled = models.BooleanField(default=False)
    portal_enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name", "email", "id"]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "email"]),
        ]

    @property
    def display_name(self):
        name = " ".join(part for part in [self.first_name, self.last_name] if part).strip()
        return name or self.email or f"Tenant #{self.pk}"

    def __str__(self):
        return self.display_name


class Tenancy(models.Model):
    STATUS_PENDING = "pending"
    STATUS_ACTIVE = "active"
    STATUS_FORMER = "former"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_ACTIVE, "Active"),
        (STATUS_FORMER, "Former"),
    ]

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="tenancies",
    )
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="tenancies",
    )
    unit = models.ForeignKey(
        PropertyUnit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tenancies",
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    move_in_date = models.DateField(null=True, blank=True)
    move_out_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["property_profile", "unit__unit_label", "tenant__last_name", "tenant__first_name", "id"]
        indexes = [
            models.Index(fields=["property_profile", "status"]),
            models.Index(fields=["unit", "status"]),
            models.Index(fields=["tenant", "status"]),
        ]

    def __str__(self):
        unit_label = self.unit.unit_label if self.unit else "No unit"
        return f"{self.tenant} at {self.property_profile} ({unit_label})"


class TenantMaintenanceRequest(models.Model):
    CATEGORY_PLUMBING = "plumbing"
    CATEGORY_ELECTRICAL = "electrical"
    CATEGORY_HVAC = "hvac"
    CATEGORY_APPLIANCE = "appliance"
    CATEGORY_PEST = "pest"
    CATEGORY_ACCESS_LOCK = "access_lock"
    CATEGORY_SAFETY = "safety"
    CATEGORY_GENERAL_REPAIR = "general_repair"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = [
        (CATEGORY_PLUMBING, "Plumbing"),
        (CATEGORY_ELECTRICAL, "Electrical"),
        (CATEGORY_HVAC, "HVAC"),
        (CATEGORY_APPLIANCE, "Appliance"),
        (CATEGORY_PEST, "Pest"),
        (CATEGORY_ACCESS_LOCK, "Access / Lock"),
        (CATEGORY_SAFETY, "Safety"),
        (CATEGORY_GENERAL_REPAIR, "General Repair"),
        (CATEGORY_OTHER, "Other"),
    ]

    URGENCY_EMERGENCY = "emergency"
    URGENCY_URGENT = "urgent"
    URGENCY_NORMAL = "normal"
    URGENCY_LOW = "low"
    URGENCY_CHOICES = [
        (URGENCY_EMERGENCY, "Emergency"),
        (URGENCY_URGENT, "Urgent"),
        (URGENCY_NORMAL, "Normal"),
        (URGENCY_LOW, "Low"),
    ]

    STATUS_SUBMITTED = "submitted"
    STATUS_UNDER_REVIEW = "under_review"
    STATUS_MORE_INFO_REQUESTED = "more_info_requested"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_UNDER_REVIEW, "Under Review"),
        (STATUS_MORE_INFO_REQUESTED, "More Info Requested"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_CLOSED, "Closed"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="tenant_maintenance_requests",
    )
    unit = models.ForeignKey(
        PropertyUnit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tenant_maintenance_requests",
    )
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_requests",
    )
    submitted_by_name = models.CharField(max_length=255, blank=True, default="")
    submitted_by_email = models.EmailField(blank=True, default="")
    submitted_by_phone = models.CharField(max_length=40, blank=True, default="")
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES, default=CATEGORY_GENERAL_REPAIR)
    urgency = models.CharField(max_length=24, choices=URGENCY_CHOICES, default=URGENCY_NORMAL)
    title = models.CharField(max_length=200)
    description = models.TextField()
    permission_to_enter = models.BooleanField(default=False)
    pets_present = models.BooleanField(default=False)
    preferred_access_times = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_SUBMITTED, db_index=True)
    manager_notes = models.TextField(blank=True, default="")
    reviewed_by = models.EmailField(blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["property_profile", "status"]),
            models.Index(fields=["unit", "status"]),
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["submitted_by_email", "created_at"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"


def tenant_maintenance_request_attachment_upload_path(instance, filename):
    base, _dot, ext = filename.rpartition(".")
    ext = (ext or "").lower()
    safe = slugify(base or "attachment")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    request_id = instance.tenant_request_id or "pending"
    return (
        f"tenant_maintenance_requests/{request_id}/attachments/{ts}_{safe}.{ext}"
        if ext
        else f"tenant_maintenance_requests/{request_id}/attachments/{ts}_{safe}"
    )


class TenantMaintenanceRequestAttachment(models.Model):
    tenant_request = models.ForeignKey(
        TenantMaintenanceRequest,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=tenant_maintenance_request_attachment_upload_path)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=120, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by_name = models.CharField(max_length=255, blank=True, default="")
    uploaded_by_email = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["tenant_request", "created_at"]),
        ]

    def __str__(self):
        return f"{self.tenant_request_id}: {self.original_filename or 'Attachment'}"


class PropertyVendor(models.Model):
    SOURCE_MANUAL = "manual"
    SOURCE_MYHOMEBRO_CONTRACTOR = "myhomebro_contractor"
    SOURCE_LOCAL_BUSINESS = "local_business"
    SOURCE_CHOICES = [
        (SOURCE_MYHOMEBRO_CONTRACTOR, "MyHomeBro Contractor"),
        (SOURCE_LOCAL_BUSINESS, "Local Business"),
        (SOURCE_MANUAL, "Manual Vendor"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    property_management_company = models.ForeignKey(
        PropertyManagementCompany,
        on_delete=models.CASCADE,
        related_name="vendors",
    )
    name = models.CharField(max_length=255)
    trade_category = models.CharField(max_length=120, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    website = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    vendor_source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default=SOURCE_MANUAL, db_index=True)
    linked_contractor = models.ForeignKey(
        "Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_vendor_links",
    )
    source_metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["property_management_company", "status"]),
            models.Index(fields=["property_management_company", "vendor_source"]),
            models.Index(fields=["trade_category", "status"]),
        ]

    def __str__(self):
        return self.name


class PropertyWorkOrder(models.Model):
    CATEGORY_PLUMBING = "plumbing"
    CATEGORY_ELECTRICAL = "electrical"
    CATEGORY_HVAC = "hvac"
    CATEGORY_APPLIANCE = "appliance"
    CATEGORY_PEST = "pest"
    CATEGORY_ACCESS_LOCK = "access_lock"
    CATEGORY_SAFETY = "safety"
    CATEGORY_GENERAL_REPAIR = "general_repair"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = TenantMaintenanceRequest.CATEGORY_CHOICES

    PRIORITY_EMERGENCY = "emergency"
    PRIORITY_URGENT = "urgent"
    PRIORITY_NORMAL = "normal"
    PRIORITY_LOW = "low"
    PRIORITY_CHOICES = [
        (PRIORITY_EMERGENCY, "Emergency"),
        (PRIORITY_URGENT, "Urgent"),
        (PRIORITY_NORMAL, "Normal"),
        (PRIORITY_LOW, "Low"),
    ]

    STATUS_OPEN = "open"
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_WAITING = "waiting"
    STATUS_COMPLETED = "completed"
    STATUS_CLOSED = "closed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_WAITING, "Waiting"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]
    ACTIVE_STATUSES = [STATUS_OPEN, STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_WAITING, STATUS_COMPLETED]

    MARKETPLACE_NOT_SENT = "not_sent"
    MARKETPLACE_SENT = "sent"
    MARKETPLACE_ACCEPTED = "accepted"
    MARKETPLACE_DECLINED = "declined"
    MARKETPLACE_WITHDRAWN = "withdrawn"
    MARKETPLACE_STATUS_CHOICES = [
        (MARKETPLACE_NOT_SENT, "Not Sent"),
        (MARKETPLACE_SENT, "Sent"),
        (MARKETPLACE_ACCEPTED, "Accepted"),
        (MARKETPLACE_DECLINED, "Declined"),
        (MARKETPLACE_WITHDRAWN, "Withdrawn"),
    ]

    ASSIGNMENT_INTERNAL_STAFF = "internal_staff"
    ASSIGNMENT_VENDOR = "vendor"
    ASSIGNMENT_MARKETPLACE_CONTRACTOR = "marketplace_contractor"
    ASSIGNMENT_TYPE_CHOICES = [
        (ASSIGNMENT_INTERNAL_STAFF, "Internal Staff"),
        (ASSIGNMENT_VENDOR, "Vendor"),
        (ASSIGNMENT_MARKETPLACE_CONTRACTOR, "Marketplace Contractor"),
    ]

    property_management_company = models.ForeignKey(
        PropertyManagementCompany,
        on_delete=models.CASCADE,
        related_name="property_work_orders",
    )
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="property_work_orders",
    )
    unit = models.ForeignKey(
        PropertyUnit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_work_orders",
    )
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_work_orders",
    )
    source_tenant_request = models.ForeignKey(
        TenantMaintenanceRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_work_orders",
    )
    work_order_number = models.CharField(max_length=32, unique=True, blank=True, default="")
    title = models.CharField(max_length=200)
    description = models.TextField()
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES, default=CATEGORY_GENERAL_REPAIR)
    priority = models.CharField(max_length=24, choices=PRIORITY_CHOICES, default=PRIORITY_NORMAL)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True)
    assigned_staff_member = models.ForeignKey(
        PropertyManagementStaffMembership,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_property_work_orders",
    )
    assigned_vendor = models.ForeignKey(
        PropertyVendor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_property_work_orders",
    )
    assigned_contractor = models.ForeignKey(
        "Contractor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_property_work_orders",
    )
    linked_project = models.ForeignKey(
        "Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_property_work_orders",
    )
    linked_agreement = models.ForeignKey(
        "Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_property_work_orders",
    )
    assignment_type = models.CharField(
        max_length=32,
        choices=ASSIGNMENT_TYPE_CHOICES,
        default=ASSIGNMENT_INTERNAL_STAFF,
        db_index=True,
    )
    marketplace_status = models.CharField(
        max_length=24,
        choices=MARKETPLACE_STATUS_CHOICES,
        default=MARKETPLACE_NOT_SENT,
        db_index=True,
    )
    marketplace_sent_at = models.DateTimeField(null=True, blank=True)
    marketplace_response_at = models.DateTimeField(null=True, blank=True)
    scheduled_for = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    internal_notes = models.TextField(blank=True, default="")
    completion_notes = models.TextField(blank=True, default="")
    created_by = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["property_management_company", "status"]),
            models.Index(fields=["property_profile", "status"]),
            models.Index(fields=["unit", "status"]),
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["source_tenant_request", "status"]),
            models.Index(fields=["assignment_type", "status"]),
            models.Index(fields=["marketplace_status", "created_at"]),
            models.Index(fields=["assigned_vendor", "status"]),
            models.Index(fields=["assigned_contractor", "status"]),
            models.Index(fields=["linked_agreement", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source_tenant_request"],
                condition=Q(source_tenant_request__isnull=False, status__in=["open", "scheduled", "in_progress", "waiting", "completed"]),
                name="unique_active_property_work_order_per_tenant_request",
            )
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.work_order_number:
            number = f"PWO-{self.pk:06d}"
            type(self).objects.filter(pk=self.pk, work_order_number="").update(work_order_number=number)
            self.work_order_number = number

    def assign(self, staff_member):
        self.assigned_staff_member = staff_member
        self.assigned_vendor = None
        self.assigned_contractor = None
        self.assignment_type = self.ASSIGNMENT_INTERNAL_STAFF

    def assign_vendor(self, vendor):
        self.assigned_vendor = vendor
        self.assigned_staff_member = None
        self.assigned_contractor = None
        self.assignment_type = self.ASSIGNMENT_VENDOR

    def assign_marketplace(self, contractor=None):
        self.assigned_contractor = contractor
        self.assigned_staff_member = None
        self.assigned_vendor = None
        self.assignment_type = self.ASSIGNMENT_MARKETPLACE_CONTRACTOR

    def schedule(self, scheduled_for):
        self.scheduled_for = scheduled_for
        self.status = self.STATUS_SCHEDULED

    def start_work(self, started_at=None):
        self.started_at = started_at or timezone.now()
        self.status = self.STATUS_IN_PROGRESS

    def complete_work(self, completion_notes="", completed_at=None):
        self.completion_notes = completion_notes
        self.completed_at = completed_at or timezone.now()
        self.status = self.STATUS_COMPLETED

    def close_work(self, closed_at=None):
        self.closed_at = closed_at or timezone.now()
        self.status = self.STATUS_CLOSED

    def __str__(self):
        return f"{self.work_order_number or 'PWO'} - {self.title}"


class PropertyWorkOrderActivity(models.Model):
    TYPE_CREATED = "created"
    TYPE_ASSIGNED = "assigned"
    TYPE_SCHEDULED = "scheduled"
    TYPE_STARTED = "started"
    TYPE_COMPLETED = "completed"
    TYPE_CLOSED = "closed"
    TYPE_STATUS_CHANGED = "status_changed"
    TYPE_NOTE_ADDED = "note_added"
    TYPE_ATTACHMENT_ADDED = "attachment_added"
    TYPE_MARKETPLACE_SENT = "marketplace_sent"
    TYPE_MARKETPLACE_ACCEPTED = "marketplace_accepted"
    TYPE_MARKETPLACE_DECLINED = "marketplace_declined"
    TYPE_MARKETPLACE_WITHDRAWN = "marketplace_withdrawn"
    TYPE_AGREEMENT_DRAFT_CREATED = "agreement_draft_created"
    TYPE_CHOICES = [
        (TYPE_CREATED, "Created"),
        (TYPE_ASSIGNED, "Assigned"),
        (TYPE_SCHEDULED, "Scheduled"),
        (TYPE_STARTED, "Started"),
        (TYPE_COMPLETED, "Completed"),
        (TYPE_CLOSED, "Closed"),
        (TYPE_STATUS_CHANGED, "Status Changed"),
        (TYPE_NOTE_ADDED, "Note Added"),
        (TYPE_ATTACHMENT_ADDED, "Attachment Added"),
        (TYPE_MARKETPLACE_SENT, "Marketplace Sent"),
        (TYPE_MARKETPLACE_ACCEPTED, "Marketplace Accepted"),
        (TYPE_MARKETPLACE_DECLINED, "Marketplace Declined"),
        (TYPE_MARKETPLACE_WITHDRAWN, "Marketplace Withdrawn"),
        (TYPE_AGREEMENT_DRAFT_CREATED, "Agreement Draft Created"),
    ]

    work_order = models.ForeignKey(
        PropertyWorkOrder,
        on_delete=models.CASCADE,
        related_name="activities",
    )
    activity_type = models.CharField(max_length=32, choices=TYPE_CHOICES, db_index=True)
    message = models.TextField(blank=True, default="")
    actor = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["work_order", "created_at"]),
            models.Index(fields=["activity_type", "created_at"]),
        ]

    def __str__(self):
        return f"{self.work_order_id}: {self.get_activity_type_display()}"


def property_work_order_attachment_upload_path(instance, filename):
    base, _dot, ext = filename.rpartition(".")
    ext = (ext or "").lower()
    safe = slugify(base or "attachment")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    work_order_id = instance.work_order_id or "pending"
    return (
        f"property_work_orders/{work_order_id}/attachments/{ts}_{safe}.{ext}"
        if ext
        else f"property_work_orders/{work_order_id}/attachments/{ts}_{safe}"
    )


class PropertyWorkOrderAttachment(models.Model):
    TYPE_GENERAL = "general"
    TYPE_COMPLETION_PHOTO = "completion_photo"
    TYPE_COMPLETION_DOCUMENT = "completion_document"
    TYPE_CHOICES = [
        (TYPE_GENERAL, "General"),
        (TYPE_COMPLETION_PHOTO, "Completion Photo"),
        (TYPE_COMPLETION_DOCUMENT, "Completion Document"),
    ]

    work_order = models.ForeignKey(
        PropertyWorkOrder,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=property_work_order_attachment_upload_path)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=120, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.EmailField(blank=True, default="")
    attachment_type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_GENERAL)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["work_order", "created_at"]),
            models.Index(fields=["attachment_type", "created_at"]),
        ]

    def __str__(self):
        return f"{self.work_order_id}: {self.original_filename or 'Attachment'}"


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
    UPLOAD_SOURCE_PORTAL_DESKTOP = "portal_desktop"
    UPLOAD_SOURCE_QR_MOBILE_WEB = "qr_mobile_web"
    UPLOAD_SOURCE_MOBILE_APP = "mobile_app"
    UPLOAD_SOURCE_CHOICES = [
        (UPLOAD_SOURCE_PORTAL_DESKTOP, "Portal Desktop"),
        (UPLOAD_SOURCE_QR_MOBILE_WEB, "QR Mobile Web"),
        (UPLOAD_SOURCE_MOBILE_APP, "Mobile App"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    title = models.CharField(max_length=200)
    document_type = models.CharField(max_length=64, blank=True, default="")
    upload_source = models.CharField(max_length=32, choices=UPLOAD_SOURCE_CHOICES, blank=True, default="")
    file = models.FileField(upload_to=property_document_upload_path)
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self):
        return f"{self.property_profile_id} - {self.title}"


class CustomerPortalUploadSession(models.Model):
    PURPOSE_HOME_SYSTEM_DOCUMENT_SCAN = "home_system_document_scan"
    PURPOSE_CHOICES = [
        (PURPOSE_HOME_SYSTEM_DOCUMENT_SCAN, "Home System Document Scan"),
    ]

    session_token = models.CharField(max_length=96, unique=True, db_index=True)
    customer_email = models.EmailField(db_index=True)
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="upload_sessions",
    )
    home_system = models.ForeignKey(
        "projects.PropertyHomeSystem",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="upload_sessions",
    )
    purpose = models.CharField(max_length=48, choices=PURPOSE_CHOICES, default=PURPOSE_HOME_SYSTEM_DOCUMENT_SCAN)
    document_type = models.CharField(max_length=64, blank=True, default="")
    upload_source = models.CharField(
        max_length=32,
        choices=PropertyDocument.UPLOAD_SOURCE_CHOICES,
        default=PropertyDocument.UPLOAD_SOURCE_QR_MOBILE_WEB,
    )
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["customer_email", "expires_at"]),
            models.Index(fields=["property_profile", "home_system"]),
        ]

    @property
    def is_expired(self):
        return self.expires_at <= timezone.now()

    def mark_used(self):
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])

    def __str__(self):
        return f"{self.customer_email}: {self.purpose}"


class PropertyDocumentExtraction(models.Model):
    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    property_document = models.OneToOneField(
        PropertyDocument,
        on_delete=models.CASCADE,
        related_name="extraction",
    )
    home_system = models.ForeignKey(
        "projects.PropertyHomeSystem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="document_extractions",
    )
    extraction_status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    document_classification = models.CharField(max_length=80, blank=True, default="")
    extracted_text = models.TextField(blank=True, default="")
    suggested_fields = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["home_system", "extraction_status"]),
            models.Index(fields=["extraction_status", "created_at"]),
        ]

    def __str__(self):
        return f"Extraction for document #{self.property_document_id}: {self.extraction_status}"


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


class PropertyHomeSystem(models.Model):
    SYSTEM_HVAC = "hvac"
    SYSTEM_ROOF = "roof"
    SYSTEM_WATER_HEATER = "water_heater"
    SYSTEM_ELECTRICAL = "electrical"
    SYSTEM_PLUMBING = "plumbing"
    SYSTEM_APPLIANCE = "appliance"
    SYSTEM_WINDOWS_DOORS = "windows_doors"
    SYSTEM_FOUNDATION = "foundation"
    SYSTEM_EXTERIOR_SIDING = "exterior_siding"
    SYSTEM_SEPTIC_SEWER = "septic_sewer"
    SYSTEM_SOLAR = "solar"
    SYSTEM_POOL_SPA = "pool_spa"
    SYSTEM_OTHER = "other"
    SYSTEM_TYPE_CHOICES = [
        (SYSTEM_HVAC, "HVAC"),
        (SYSTEM_ROOF, "Roof"),
        (SYSTEM_WATER_HEATER, "Water Heater"),
        (SYSTEM_ELECTRICAL, "Electrical Panel"),
        (SYSTEM_PLUMBING, "Plumbing"),
        (SYSTEM_APPLIANCE, "Appliances"),
        (SYSTEM_WINDOWS_DOORS, "Windows/Doors"),
        (SYSTEM_FOUNDATION, "Foundation/Basement"),
        (SYSTEM_EXTERIOR_SIDING, "Exterior/Siding"),
        (SYSTEM_SEPTIC_SEWER, "Septic/Sewer"),
        (SYSTEM_SOLAR, "Solar"),
        (SYSTEM_POOL_SPA, "Pool/Spa"),
        (SYSTEM_OTHER, "Other"),
    ]

    CONDITION_UNKNOWN = "unknown"
    CONDITION_EXCELLENT = "excellent"
    CONDITION_GOOD = "good"
    CONDITION_FAIR = "fair"
    CONDITION_NEEDS_SERVICE = "needs_service"
    CONDITION_REPLACE_SOON = "replace_soon"
    CONDITION_CHOICES = [
        (CONDITION_UNKNOWN, "Unknown"),
        (CONDITION_EXCELLENT, "Excellent"),
        (CONDITION_GOOD, "Good"),
        (CONDITION_FAIR, "Fair"),
        (CONDITION_NEEDS_SERVICE, "Needs Service"),
        (CONDITION_REPLACE_SOON, "Replace Soon"),
    ]
    REMINDER_FREQUENCY_ONCE = "once"
    REMINDER_FREQUENCY_WEEKLY = "weekly"
    REMINDER_FREQUENCY_MONTHLY = "monthly"
    REMINDER_FREQUENCY_CHOICES = [
        (REMINDER_FREQUENCY_ONCE, "Once"),
        (REMINDER_FREQUENCY_WEEKLY, "Weekly"),
        (REMINDER_FREQUENCY_MONTHLY, "Monthly"),
    ]
    DELIVERY_STATUS_NONE = ""
    DELIVERY_STATUS_PENDING = "pending"
    DELIVERY_STATUS_SENT = "sent"
    DELIVERY_STATUS_SKIPPED = "skipped"
    DELIVERY_STATUS_RESOLVED = "resolved"
    DELIVERY_STATUS_CHOICES = [
        (DELIVERY_STATUS_NONE, "Not sent"),
        (DELIVERY_STATUS_PENDING, "Pending"),
        (DELIVERY_STATUS_SENT, "Sent"),
        (DELIVERY_STATUS_SKIPPED, "Skipped"),
        (DELIVERY_STATUS_RESOLVED, "Resolved"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="home_systems",
    )
    system_type = models.CharField(max_length=32, choices=SYSTEM_TYPE_CHOICES, default=SYSTEM_OTHER)
    custom_name = models.CharField(max_length=200, blank=True, default="")
    manufacturer = models.CharField(max_length=200, blank=True, default="")
    model_number = models.CharField(max_length=200, blank=True, default="")
    serial_number = models.CharField(max_length=200, blank=True, default="")
    install_date = models.DateField(null=True, blank=True)
    last_service_date = models.DateField(null=True, blank=True)
    warranty_start_date = models.DateField(null=True, blank=True)
    warranty_expiration_date = models.DateField(null=True, blank=True)
    expected_lifespan_years = models.PositiveSmallIntegerField(null=True, blank=True)
    condition = models.CharField(max_length=32, choices=CONDITION_CHOICES, default=CONDITION_UNKNOWN)
    notes = models.TextField(blank=True, default="")
    service_provider = models.CharField(max_length=200, blank=True, default="")
    linked_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_home_systems",
    )
    linked_customer_request = models.ForeignKey(
        "projects.CustomerRequest",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="property_home_systems",
    )
    linked_documents = models.ManyToManyField(
        PropertyDocument,
        blank=True,
        related_name="home_systems",
    )
    reminders_enabled = models.BooleanField(default=True)
    email_reminders_enabled = models.BooleanField(default=True)
    sms_reminders_enabled = models.BooleanField(default=False)
    reminder_lead_days = models.PositiveSmallIntegerField(default=30)
    reminder_frequency = models.CharField(
        max_length=16,
        choices=REMINDER_FREQUENCY_CHOICES,
        default=REMINDER_FREQUENCY_ONCE,
    )
    reminder_generated_at = models.DateTimeField(null=True, blank=True)
    last_notified_at = models.DateTimeField(null=True, blank=True)
    next_notification_at = models.DateTimeField(null=True, blank=True)
    reminder_delivery_status = models.CharField(
        max_length=24,
        choices=DELIVERY_STATUS_CHOICES,
        blank=True,
        default=DELIVERY_STATUS_NONE,
    )
    reminder_channel = models.CharField(max_length=24, blank=True, default="")
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    dismissed_until = models.DateTimeField(null=True, blank=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["is_archived", "system_type", "custom_name", "id"]
        indexes = [
            models.Index(fields=["property_profile", "is_archived", "system_type"]),
            models.Index(fields=["warranty_expiration_date"]),
            models.Index(fields=["last_service_date"]),
        ]

    @property
    def display_name(self):
        return self.custom_name.strip() or self.get_system_type_display()

    def archive(self):
        self.is_archived = True
        self.archived_at = timezone.now()
        self.save(update_fields=["is_archived", "archived_at", "updated_at"])

    def __str__(self):
        return f"{self.property_profile_id} - {self.display_name}"


class PropertyHomeSystemRecommendationPreference(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_IGNORED = "ignored"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_IGNORED, "Ignored"),
    ]

    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="home_system_recommendation_preferences",
    )
    home_system = models.ForeignKey(
        PropertyHomeSystem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="recommendation_preferences",
    )
    recommendation_key = models.CharField(max_length=160)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    ignored_at = models.DateTimeField(null=True, blank=True)
    restored_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["property_profile_id", "home_system_id", "recommendation_key"]
        constraints = [
            models.UniqueConstraint(
                fields=["property_profile", "home_system", "recommendation_key"],
                name="uniq_home_system_recommendation_preference",
            )
        ]
        indexes = [
            models.Index(fields=["property_profile", "status"]),
            models.Index(fields=["home_system", "status"]),
        ]

    def ignore(self):
        self.status = self.STATUS_IGNORED
        self.ignored_at = timezone.now()
        self.restored_at = None
        self.save(update_fields=["status", "ignored_at", "restored_at", "updated_at"])

    def restore(self):
        self.status = self.STATUS_ACTIVE
        self.restored_at = timezone.now()
        self.save(update_fields=["status", "restored_at", "updated_at"])

    def __str__(self):
        return f"{self.property_profile_id}:{self.home_system_id}:{self.recommendation_key}:{self.status}"


class CustomerNotificationCleanupPreference(models.Model):
    FREQUENCY_DAILY = "daily"
    FREQUENCY_WEEKLY = "weekly"
    FREQUENCY_MONTHLY = "monthly"
    FREQUENCY_CHOICES = [
        (FREQUENCY_DAILY, "Daily"),
        (FREQUENCY_WEEKLY, "Weekly"),
        (FREQUENCY_MONTHLY, "Monthly"),
    ]

    customer_email = models.EmailField(unique=True, db_index=True)
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notification_cleanup_preferences",
    )
    auto_archive_enabled = models.BooleanField(default=True)
    auto_archive_frequency = models.CharField(max_length=16, choices=FREQUENCY_CHOICES, default=FREQUENCY_DAILY)
    auto_archive_read_after_days = models.PositiveIntegerField(default=30)
    auto_archive_maintenance_after_days = models.PositiveIntegerField(default=60)
    auto_archive_completed_work_after_days = models.PositiveIntegerField(default=90)
    last_auto_archive_run_at = models.DateTimeField(null=True, blank=True)
    next_auto_archive_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["customer_email"]
        indexes = [
            models.Index(fields=["auto_archive_enabled", "next_auto_archive_run_at"]),
        ]

    def __str__(self):
        return f"{self.customer_email}: notification cleanup"


class PropertyIntelligenceSnapshot(models.Model):
    property_profile = models.ForeignKey(
        PropertyProfile,
        on_delete=models.CASCADE,
        related_name="intelligence_snapshots",
    )
    customer_email = models.EmailField(db_index=True)
    health_status = models.CharField(max_length=32, blank=True, default="")
    health_score = models.PositiveSmallIntegerField(default=0)
    confidence = models.CharField(max_length=24, blank=True, default="")
    insights = models.JSONField(default=list, blank=True)
    learning_summary = models.JSONField(default=dict, blank=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    snapshot_version = models.PositiveSmallIntegerField(default=1)
    generated_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-generated_at", "-id"]
        unique_together = [("property_profile", "content_hash")]
        indexes = [
            models.Index(fields=["customer_email", "generated_at"]),
            models.Index(fields=["health_status", "generated_at"]),
        ]

    def __str__(self):
        return f"{self.customer_email}:{self.health_status}:{self.generated_at:%Y-%m-%d}"


class CustomerRequest(models.Model):
    PROJECT_MODE_FULL_SERVICE = "full_service"
    PROJECT_MODE_DIY_ASSIST = "diy_assist"
    PROJECT_MODE_INSPECTION_ONLY = "inspection_only"
    PROJECT_MODE_NOT_SURE = "not_sure"
    PROJECT_MODE_CHOICES = [
        (PROJECT_MODE_FULL_SERVICE, "Full Service"),
        (PROJECT_MODE_DIY_ASSIST, "DIY Assist"),
        (PROJECT_MODE_INSPECTION_ONLY, "Inspection Only"),
        (PROJECT_MODE_NOT_SURE, "Not Sure Yet"),
    ]

    PAYMENT_PREFERENCE_ESCROW = "escrow_milestones"
    PAYMENT_PREFERENCE_DIRECT = "direct_pay"
    PAYMENT_PREFERENCE_DISCUSS = "discuss"
    PAYMENT_PREFERENCE_UNSURE = "unsure"
    PAYMENT_PREFERENCE_CHOICES = [
        (PAYMENT_PREFERENCE_ESCROW, "Escrow Milestone Holds"),
        (PAYMENT_PREFERENCE_DIRECT, "Direct Payment"),
        (PAYMENT_PREFERENCE_DISCUSS, "Discuss With Contractor"),
        (PAYMENT_PREFERENCE_UNSURE, "Not Sure Yet"),
    ]

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
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_ROUTED, "Routed"),
        (STATUS_MARKETPLACE_READY, "Marketplace Ready"),
        (STATUS_MATCHED, "Matched"),
        (STATUS_CONVERTED_TO_PROJECT, "Converted to Project"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_CANCELLED, "Cancelled"),
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
    linked_home_system = models.ForeignKey(
        "projects.PropertyHomeSystem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_requests",
    )
    customer_email = models.EmailField(db_index=True)
    request_type = models.CharField(max_length=32, choices=REQUEST_TYPE_CHOICES)
    project_mode = models.CharField(
        max_length=32,
        choices=PROJECT_MODE_CHOICES,
        blank=True,
        default="",
    )
    project_category = models.CharField(max_length=80, blank=True, default="")
    project_type = models.CharField(max_length=120, blank=True, default="")
    project_subtype = models.CharField(max_length=120, blank=True, default="")
    payment_preference = models.CharField(
        max_length=32,
        choices=PAYMENT_PREFERENCE_CHOICES,
        blank=True,
        default="",
    )
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
    source_intake = models.ForeignKey(
        "projects.ProjectIntake",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_customer_requests",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True, default="")
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
    MAINTENANCE_WORK_ORDER_SCHEDULED = "maintenance_work_order_scheduled", "Maintenance Work Order Scheduled"
    MAINTENANCE_WORK_ORDER_COMPLETED = "maintenance_work_order_completed", "Maintenance Work Order Completed"
    MAINTENANCE_CONTRACT_CANCELLED = "maintenance_contract_cancelled", "Maintenance Contract Cancelled"
    HOME_SYSTEM_MAINTENANCE_REMINDER = "home_system_maintenance_reminder", "Home System Maintenance Reminder"
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
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    auto_archived_at = models.DateTimeField(null=True, blank=True)
    archive_reason = models.CharField(max_length=160, blank=True, default="")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["recipient_email", "status"]),
            models.Index(fields=["recipient_email", "archived_at"]),
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
