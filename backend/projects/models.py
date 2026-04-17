# backend/projects/models.py

from decimal import Decimal
from datetime import timedelta
import secrets
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

from .models_ai_scope import AgreementAIScope  # noqa: E402,F401
from .models_dispute import Dispute, DisputeAttachment
from .models_invite import ContractorInvite  # noqa: F401
from .models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from .models_project_taxonomy import ProjectType, ProjectSubtype  # noqa: E402,F401
from .models_sms import DeferredSMSAutomation, SMSAutomationDecision, SMSConsent, SMSConsentStatus  # noqa: E402,F401
from .models_subcontractor import SubcontractorInvitation  # noqa: E402,F401


# --- Safe default for warranty snapshot (used if blank/None) ---
DEFAULT_WARRANTY_TEXT = (
    "Standard workmanship warranty: Contractor warrants all labor performed under this "
    "Agreement for one (1) year from substantial completion. Materials are covered by the "
    "manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, "
    "alteration, improper maintenance, or acts of God."
)


# --- TextChoices for status fields ---
class ProjectStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SIGNED = "signed", "Signed"
    FUNDED = "funded", "Funded"
    IN_PROGRESS = "in_progress", "In Progress"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class AgreementProjectType(models.TextChoices):
    REMODEL = "Remodel", "Remodel"
    NEW_CONSTRUCTION = "New Construction", "New Construction"
    REPAIR = "Repair", "Repair"
    HVAC = "HVAC", "HVAC"
    ROOFING = "Roofing", "Roofing"
    ELECTRICAL = "Electrical", "Electrical"
    PLUMBING = "Plumbing", "Plumbing"
    LANDSCAPING = "Landscaping", "Landscaping"
    PAINTING = "Painting", "Painting"
    FLOORING = "Flooring", "Flooring"
    INSTALLATION = "Installation", "Installation"
    OUTDOOR = "Outdoor", "Outdoor"
    INSPECTION = "Inspection", "Inspection"
    DIY_HELP = "DIY Help", "DIY Help"
    CUSTOM = "Custom", "Custom"


class AgreementPaymentMode(models.TextChoices):
    ESCROW = "escrow", "Escrow (Protected)"
    DIRECT = "direct", "Direct Pay (Fast)"


class AgreementPaymentStructure(models.TextChoices):
    SIMPLE = "simple", "Simple Payments"
    PROGRESS = "progress", "Progress Payments"


class AgreementMode(models.TextChoices):
    STANDARD = "standard", "Standard"
    MAINTENANCE = "maintenance", "Maintenance"


class AgreementProjectClass(models.TextChoices):
    RESIDENTIAL = "residential", "Residential"
    COMMERCIAL = "commercial", "Commercial"


class RecurrencePattern(models.TextChoices):
    WEEKLY = "weekly", "Weekly"
    MONTHLY = "monthly", "Monthly"
    QUARTERLY = "quarterly", "Quarterly"
    YEARLY = "yearly", "Yearly"


class MaintenanceStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    PAUSED = "paused", "Paused"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class AgreementSignaturePolicy(models.TextChoices):
    BOTH_REQUIRED = "both_required", "Both Parties Sign (Recommended)"
    CONTRACTOR_ONLY = "contractor_only", "Contractor Only (Work Order / Internal)"
    EXTERNAL_SIGNED = "external_signed", "Signed Outside MyHomeBro (Upload/Reference/Attest)"


class WarrantyStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    EXPIRED = "expired", "Expired"
    VOID = "void", "Void"


class WarrantyAppliesTo(models.TextChoices):
    FULL_AGREEMENT = "full_agreement", "Full Agreement"
    WORKMANSHIP = "workmanship", "Workmanship"
    MATERIALS = "materials", "Materials"
    OTHER = "other", "Other"


class InvoiceStatus(models.TextChoices):
    INCOMPLETE = "incomplete", "Incomplete"
    SENT = "sent", "Sent (Awaiting Payment)"
    PENDING = "pending", "Pending Approval"
    APPROVED = "approved", "Approved"
    DISPUTED = "disputed", "Disputed"
    PAID = "paid", "Paid"


class ExpenseStatus(models.TextChoices):
    PENDING = "pending", "Pending Approval"
    APPROVED = "approved", "Approved"
    DISPUTED = "disputed", "Disputed"
    PAID = "paid", "Paid"


class HomeownerStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    PROSPECT = "prospect", "Prospect"
    ARCHIVED = "archived", "Archived"


class SubcontractorCompletionStatus(models.TextChoices):
    NOT_SUBMITTED = "not_submitted", "Not Submitted"
    SUBMITTED_FOR_REVIEW = "submitted_for_review", "Submitted for Review"
    APPROVED = "approved", "Approved"
    NEEDS_CHANGES = "needs_changes", "Needs Changes"


class SubcontractorComplianceStatus(models.TextChoices):
    NOT_REQUIRED = "not_required", "Not Required"
    COMPLIANT = "compliant", "Compliant"
    MISSING_LICENSE = "missing_license", "Missing License"
    MISSING_INSURANCE = "missing_insurance", "Missing Insurance"
    PENDING_LICENSE = "pending_license", "Pending License"
    OVERRIDDEN = "overridden", "Overridden"
    UNKNOWN = "unknown", "Unknown"


class MilestonePayoutStatus(models.TextChoices):
    NOT_ELIGIBLE = "not_eligible", "Not Eligible"
    ELIGIBLE = "eligible", "Eligible"
    READY_FOR_PAYOUT = "ready_for_payout", "Ready for Payout"
    PAID = "paid", "Paid"
    FAILED = "failed", "Failed"


class MilestonePayoutExecutionMode(models.TextChoices):
    MANUAL = "manual", "Manual"
    AUTOMATIC = "automatic", "Automatic"


class DrawRequestStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    APPROVED = "approved", "Approved"
    AWAITING_RELEASE = "awaiting_release", "Awaiting Release"
    RELEASED = "released", "Released"
    REJECTED = "rejected", "Rejected"
    CHANGES_REQUESTED = "changes_requested", "Changes Requested"
    PAID = "paid", "Paid"


class ExternalPaymentStatus(models.TextChoices):
    RECORDED = "recorded", "Recorded"
    VERIFIED = "verified", "Verified"
    DISPUTED = "disputed", "Disputed"
    VOIDED = "voided", "Voided"


class Skill(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Contractor(models.Model):
    SERVICE_RADIUS_CHOICES = [
        (10, "10"),
        (25, "25"),
        (50, "50"),
        (100, "100"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contractor_profile",
    )
    business_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)

    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=50, blank=True)
    zip = models.CharField(max_length=20, blank=True, default="")
    service_radius_miles = models.PositiveIntegerField(choices=SERVICE_RADIUS_CHOICES, default=25)

    skills = models.ManyToManyField(Skill, blank=True)
    license_number = models.CharField(max_length=50, blank=True)
    license_expiration = models.DateField(null=True, blank=True)
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    license_file = models.FileField(upload_to="licenses/", null=True, blank=True)
    insurance_file = models.FileField(upload_to="insurance/", null=True, blank=True)

    stripe_account_id = models.CharField(max_length=255, blank=True, db_index=True)
    onboarding_status = models.CharField(max_length=50, blank=True)

    charges_enabled = models.BooleanField(default=False)
    payouts_enabled = models.BooleanField(default=False)
    details_submitted = models.BooleanField(default=False)
    requirements_due_count = models.IntegerField(default=0)
    stripe_status_updated_at = models.DateTimeField(default=timezone.now)
    stripe_deauthorized_at = models.DateTimeField(null=True, blank=True)
    auto_subcontractor_payouts_enabled = models.BooleanField(default=False)
    contractor_onboarding_status = models.CharField(max_length=50, blank=True, default="not_started")
    contractor_onboarding_step = models.CharField(max_length=50, blank=True, default="welcome")
    first_project_started_at = models.DateTimeField(null=True, blank=True)
    first_agreement_created_at = models.DateTimeField(null=True, blank=True)
    stripe_prompt_dismissed_at = models.DateTimeField(null=True, blank=True)
    stripe_connected_at = models.DateTimeField(null=True, blank=True)
    onboarding_last_step_reached = models.CharField(max_length=50, blank=True, default="")
    onboarding_step_entered_at = models.DateTimeField(null=True, blank=True)
    onboarding_step_durations = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    ai_free_agreements_total = models.PositiveIntegerField(default=5)
    ai_free_agreements_used = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["business_name"]

    def __str__(self):
        return (
            self.business_name
            or self.name
            or getattr(self.user, "email", "")
            or f"Contractor {self.pk}"
        )

    @property
    def name(self):
        full = getattr(self.user, "get_full_name", lambda: "")() or ""
        return full or self.business_name or getattr(self.user, "email", "") or ""

    @property
    def email(self):
        return getattr(self.user, "email", "") or ""

    @property
    def public_profile_url(self):
        return f"/contractors/{self.id}/profile"

    @property
    def stripe_connected(self) -> bool:
        return bool(self.charges_enabled or self.payouts_enabled)

    @property
    def stripe_action_required(self) -> bool:
        return int(self.requirements_due_count or 0) > 0

    @property
    def activation_started(self) -> bool:
        return bool(self.first_project_started_at or self.first_agreement_created_at)


class ContractorActivationEvent(models.Model):
    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="activation_events",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_activation_events",
    )
    event_type = models.CharField(max_length=100, db_index=True)
    step = models.CharField(max_length=50, blank=True, default="")
    context = models.JSONField(default=dict, blank=True)
    seconds_in_step = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.event_type} ({self.step or 'no-step'})"


class ContractorActivityEvent(models.Model):
    class Severity(models.TextChoices):
        INFO = "info", "Info"
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="activity_events",
    )
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_activity_events",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="activity_events",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="activity_events",
    )
    related_entity_type = models.CharField(max_length=64, blank=True, default="")
    related_entity_id = models.CharField(max_length=64, blank=True, default="")
    event_type = models.CharField(max_length=100, db_index=True)
    title = models.CharField(max_length=255)
    summary = models.TextField(blank=True, default="")
    severity = models.CharField(
        max_length=16,
        choices=Severity.choices,
        default=Severity.INFO,
        db_index=True,
    )
    related_label = models.CharField(max_length=255, blank=True, default="")
    icon_hint = models.CharField(max_length=48, blank=True, default="")
    navigation_target = models.CharField(max_length=255, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    dedupe_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    surfaced_in_dashboard = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.event_type} ({self.contractor_id})"


def contractor_public_asset_upload_to(instance, filename: str) -> str:
    contractor_id = getattr(instance, "contractor_id", None) or "unknown"
    ts = timezone.now().strftime("%Y%m%d-%H%M%S")
    return f"contractor_public/{contractor_id}/{ts}_{filename}"


def _unique_contractor_public_slug(base_text: str, *, exclude_profile_id: int | None = None) -> str:
    base = slugify(base_text or "")[:50] or f"contractor-{secrets.token_hex(3)}"
    candidate = base
    suffix = 2
    while True:
        qs = ContractorPublicProfile.objects.filter(slug=candidate)
        if exclude_profile_id is not None:
            qs = qs.exclude(pk=exclude_profile_id)
        if not qs.exists():
            return candidate
        candidate = f"{base[:44]}-{suffix}"
        suffix += 1


class ContractorPublicProfile(models.Model):
    contractor = models.OneToOneField(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="public_profile",
    )
    slug = models.SlugField(max_length=64, unique=True, db_index=True, blank=True)
    business_name_public = models.CharField(max_length=255, blank=True, default="")
    tagline = models.CharField(max_length=255, blank=True, default="")
    bio = models.TextField(blank=True, default="")
    logo = models.ImageField(upload_to=contractor_public_asset_upload_to, null=True, blank=True)
    cover_image = models.ImageField(upload_to=contractor_public_asset_upload_to, null=True, blank=True)
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=60, blank=True, default="")
    service_area_text = models.CharField(max_length=255, blank=True, default="")
    years_in_business = models.PositiveIntegerField(null=True, blank=True)
    website_url = models.URLField(blank=True, default="")
    phone_public = models.CharField(max_length=40, blank=True, default="")
    email_public = models.EmailField(blank=True, default="")
    specialties = models.JSONField(default=list, blank=True)
    work_types = models.JSONField(default=list, blank=True)
    show_license_public = models.BooleanField(default=True)
    show_phone_public = models.BooleanField(default=True)
    show_email_public = models.BooleanField(default=False)
    allow_public_intake = models.BooleanField(default=True)
    allow_public_reviews = models.BooleanField(default=True)
    is_public = models.BooleanField(default=False)
    seo_title = models.CharField(max_length=255, blank=True, default="")
    seo_description = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["contractor_id"]

    def __str__(self) -> str:
        return self.business_name_public or self.contractor.business_name or f"PublicProfile {self.pk}"

    def save(self, *args, **kwargs):
        if not self.slug:
            business_name = self.business_name_public or getattr(self.contractor, "business_name", "") or getattr(self.contractor, "name", "")
            self.slug = _unique_contractor_public_slug(
                business_name or f"contractor-{self.contractor_id}",
                exclude_profile_id=self.pk,
            )
        elif self.pk:
            self.slug = _unique_contractor_public_slug(self.slug, exclude_profile_id=self.pk)
        else:
            self.slug = _unique_contractor_public_slug(self.slug)
        super().save(*args, **kwargs)

    @property
    def public_url_path(self) -> str:
        return f"/contractors/{self.slug}"


class ContractorGalleryItem(models.Model):
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="public_gallery_items",
    )
    public_profile = models.ForeignKey(
        "projects.ContractorPublicProfile",
        on_delete=models.CASCADE,
        related_name="gallery_items",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    category = models.CharField(max_length=80, blank=True, default="")
    image = models.ImageField(upload_to=contractor_public_asset_upload_to)
    is_featured = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    project_city = models.CharField(max_length=120, blank=True, default="")
    project_state = models.CharField(max_length=60, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_featured", "sort_order", "-created_at", "-id"]

    def __str__(self) -> str:
        return self.title or f"Gallery Item {self.pk}"


class PublicContractorLead(models.Model):
    STATUS_NEW = "new"
    STATUS_PENDING_CUSTOMER_RESPONSE = "pending_customer_response"
    STATUS_READY_FOR_REVIEW = "ready_for_review"
    STATUS_FOLLOW_UP = "follow_up"
    STATUS_ACCEPTED = "accepted"
    STATUS_REJECTED = "rejected"
    STATUS_CONTACTED = "contacted"
    STATUS_QUALIFIED = "qualified"
    STATUS_CLOSED = "closed"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_PENDING_CUSTOMER_RESPONSE, "Pending Customer Response"),
        (STATUS_READY_FOR_REVIEW, "Ready for Review"),
        (STATUS_FOLLOW_UP, "Follow-Up"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_CONTACTED, "Contacted"),
        (STATUS_QUALIFIED, "Qualified"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    SOURCE_LANDING_PAGE = "landing_page"
    SOURCE_PUBLIC_PROFILE = "public_profile"
    SOURCE_MANUAL = "manual"
    SOURCE_QR = "qr"
    SOURCE_CONTRACTOR_SENT_FORM = "contractor_sent_form"
    SOURCE_DIRECT = "direct"
    SOURCE_CHOICES = [
        (SOURCE_LANDING_PAGE, "Landing Page"),
        (SOURCE_PUBLIC_PROFILE, "Public Profile"),
        (SOURCE_MANUAL, "Manual"),
        (SOURCE_QR, "QR"),
        (SOURCE_CONTRACTOR_SENT_FORM, "Contractor Sent Form"),
        (SOURCE_DIRECT, "Direct"),
    ]

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="public_leads",
    )
    public_profile = models.ForeignKey(
        "projects.ContractorPublicProfile",
        on_delete=models.CASCADE,
        related_name="leads",
    )
    source = models.CharField(
        max_length=20,
        choices=SOURCE_CHOICES,
        default=SOURCE_PUBLIC_PROFILE,
    )
    full_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    project_address = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=60, blank=True, default="")
    zip_code = models.CharField(max_length=20, blank=True, default="")
    project_type = models.CharField(max_length=120, blank=True, default="")
    project_description = models.TextField(blank=True, default="")
    preferred_timeline = models.CharField(max_length=120, blank=True, default="")
    budget_text = models.CharField(max_length=120, blank=True, default="")
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_NEW)
    internal_notes = models.TextField(blank=True, default="")
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_email_sent_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_email_sent_at = models.DateTimeField(null=True, blank=True)
    ai_analysis = models.JSONField(default=dict, blank=True)
    converted_homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="converted_public_leads",
    )
    converted_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_public_leads",
    )
    converted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.full_name} -> contractor {self.contractor_id}"


class ContractorReview(models.Model):
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="public_reviews",
    )
    public_profile = models.ForeignKey(
        "projects.ContractorPublicProfile",
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_reviews",
    )
    customer_name = models.CharField(max_length=255)
    rating = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=255, blank=True, default="")
    review_text = models.TextField(blank=True, default="")
    is_verified = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    submitted_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_verified", "-submitted_at", "-created_at"]

    def clean(self):
        super().clean()
        if self.rating < 1 or self.rating > 5:
            raise ValidationError({"rating": "Rating must be between 1 and 5."})

    def __str__(self) -> str:
        return f"{self.customer_name} ({self.rating}/5)"

    @property
    def ai_free_agreements_remaining(self) -> int:
        return 0

    def can_use_ai_agreement_writer(self) -> bool:
        return True


class Homeowner(models.Model):
    created_by = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="homeowners",
        null=True,
    )

    full_name = models.CharField(max_length=255)

    company_name = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Optional company name for subcontractor / GC customers.",
    )

    email = models.EmailField(db_index=True)
    phone_number = models.CharField(max_length=20, blank=True, default="")

    street_address = models.CharField(max_length=255, blank=True, default="")
    address_line_2 = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="e.g., Apt, Suite, Building",
    )
    city = models.CharField(max_length=100, blank=True, default="")
    state = models.CharField(max_length=50, blank=True, default="")
    zip_code = models.CharField(max_length=20, blank=True, default="")

    status = models.CharField(
        max_length=20,
        choices=HomeownerStatus.choices,
        default=HomeownerStatus.ACTIVE,
        db_index=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["created_by", "email"],
                name="uniq_homeowner_email_per_contractor",
            )
        ]

    def __str__(self):
        company = (self.company_name or "").strip()
        if company:
            return f"{company} ({self.full_name})"
        return self.full_name


class Project(models.Model):
    number = models.CharField(
        max_length=30, unique=True, editable=False, db_index=True
    )
    contractor = models.ForeignKey(
        Contractor, on_delete=models.CASCADE, related_name="projects"
    )
    homeowner = models.ForeignKey(
        Homeowner,
        on_delete=models.SET_NULL,
        related_name="projects",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    project_street_address = models.CharField(max_length=255, blank=True)
    project_address_line_2 = models.CharField(max_length=255, blank=True)
    project_city = models.CharField(max_length=100, blank=True)
    project_state = models.CharField(max_length=50, blank=True)
    project_zip_code = models.CharField(max_length=20, blank=True)
    status = models.CharField(
        max_length=20,
        choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = self._generate_project_number()
        super().save(*args, **kwargs)

    def _generate_project_number(self):
        prefix = f'PRJ-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_project = (
                Project.objects.filter(number__startswith=prefix)
                .order_by("number")
                .last()
            )
            if last_project:
                last_suffix = int(last_project.number.split("-")[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        homeowner_name = getattr(self.homeowner, "full_name", "N/A")
        return f"[{self.number}] {self.title} ({homeowner_name})"


class Agreement(models.Model):
    project = models.OneToOneField(
        Project, on_delete=models.CASCADE, related_name="agreement"
    )
    contractor = models.ForeignKey(
        Contractor, on_delete=models.SET_NULL, null=True, blank=True
    )
    homeowner = models.ForeignKey(
        Homeowner,
        on_delete=models.CASCADE,
        related_name="agreements",
        null=True,
    )

    project_uid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    project_class = models.CharField(
        max_length=24,
        choices=AgreementProjectClass.choices,
        default=AgreementProjectClass.RESIDENTIAL,
        db_index=True,
        help_text="Top-level workflow path. Residential keeps the experience simpler; Commercial unlocks structured billing workflows.",
    )
    payment_mode = models.CharField(
        max_length=20,
        choices=AgreementPaymentMode.choices,
        default=AgreementPaymentMode.ESCROW,
        db_index=True,
        help_text="ESCROW uses protected funding/release. DIRECT uses pay-now invoices to contractor Stripe.",
    )
    payment_structure = models.CharField(
        max_length=20,
        choices=AgreementPaymentStructure.choices,
        default=AgreementPaymentStructure.SIMPLE,
        db_index=True,
        help_text="SIMPLE keeps milestone-paid workflow intact. PROGRESS enables draw-based requests.",
    )
    agreement_mode = models.CharField(
        max_length=24,
        choices=AgreementMode.choices,
        default=AgreementMode.STANDARD,
        db_index=True,
        help_text="Standard keeps one-time project behavior. Maintenance enables recurring-service support.",
    )
    recurring_service_enabled = models.BooleanField(
        default=False,
        help_text="Whether this agreement should generate recurring maintenance milestone occurrences.",
    )
    recurrence_pattern = models.CharField(
        max_length=24,
        choices=RecurrencePattern.choices,
        blank=True,
        default="",
    )
    recurrence_interval = models.PositiveIntegerField(default=1)
    recurrence_start_date = models.DateField(null=True, blank=True, db_index=True)
    recurrence_end_date = models.DateField(null=True, blank=True, db_index=True)
    next_occurrence_date = models.DateField(null=True, blank=True, db_index=True)
    auto_generate_next_occurrence = models.BooleanField(default=True)
    maintenance_status = models.CharField(
        max_length=24,
        choices=MaintenanceStatus.choices,
        default=MaintenanceStatus.ACTIVE,
        db_index=True,
    )
    service_window_notes = models.TextField(blank=True, default="")
    recurring_summary_label = models.CharField(max_length=255, blank=True, default="")
    retainage_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Optional retainage withheld on progress-payment draw requests.",
    )
    external_payment_enabled = models.BooleanField(
        default=False,
        help_text="Whether the contractor can record external progress payments for this agreement.",
    )

    signature_policy = models.CharField(
        max_length=32,
        choices=AgreementSignaturePolicy.choices,
        default=AgreementSignaturePolicy.BOTH_REQUIRED,
        db_index=True,
        help_text="Controls signature requirements: both parties, contractor-only, or signed externally.",
    )

    require_contractor_signature = models.BooleanField(
        default=True,
        help_text="If False, contractor signature is waived and treated as satisfied.",
    )
    require_customer_signature = models.BooleanField(
        default=True,
        help_text="If False, customer signature is waived and treated as satisfied.",
    )

    external_contract_reference = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Optional: external contract / PO / work order reference number.",
    )
    external_contract_file = models.FileField(
        upload_to="agreements/external_contracts/",
        null=True,
        blank=True,
        help_text="Optional: upload external signed agreement/work order.",
    )
    external_contract_attested = models.BooleanField(
        default=False,
        help_text="Contractor attests external agreement exists (used with EXTERNAL_SIGNED policy).",
    )
    external_contract_attested_at = models.DateTimeField(null=True, blank=True)
    external_contract_attested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="external_contract_attestations",
    )

    description = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    agreement_fee_total_cents = models.PositiveIntegerField(default=0)
    agreement_fee_allocated_cents = models.PositiveIntegerField(default=0)
    total_time_estimate = models.DurationField(null=True, blank=True)
    milestone_count = models.PositiveIntegerField(default=0)

    selected_template = models.ForeignKey(
        "projects.ProjectTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="applied_agreements",
        help_text="Template used to generate the current agreement milestones.",
    )
    selected_template_name_snapshot = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Snapshot of template name at time of apply, for audit/history.",
    )
    source_lead = models.ForeignKey(
        "projects.PublicContractorLead",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="agreements_created_from_lead",
    )

    start = models.DateField(null=True, blank=True, db_index=True)
    end = models.DateField(null=True, blank=True, db_index=True)

    project_address_line1 = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Project street address (e.g., 5202 Texana Drive).",
    )
    project_address_line2 = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Project address line 2 (e.g., Apt/Suite).",
    )
    project_address_city = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Project city.",
    )
    project_address_state = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Project state / region.",
    )
    project_postal_code = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text="Project ZIP / postal code.",
    )
    report_recipient_name = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Optional owner/investor-facing contact name for project report emails.",
    )
    report_recipient_email = models.EmailField(
        blank=True,
        default="",
        help_text="Optional owner/investor-facing contact email for project report emails.",
    )

    status = models.CharField(
        max_length=20,
        choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT,
        db_index=True,
    )

    homeowner_access_token = models.UUIDField(
        default=uuid.uuid4, editable=False, db_index=True
    )

    # Taxonomy references (new source of truth)
    project_type_ref = models.ForeignKey(
        "projects.ProjectType",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="agreements",
    )
    project_subtype_ref = models.ForeignKey(
        "projects.ProjectSubtype",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="agreements",
    )

    # Snapshot text fields (legacy/backward compatibility/history)
    project_type = models.CharField(
        max_length=100,
        blank=True,
        default="",
    )
    project_subtype = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        default="",
    )

    standardized_category = models.CharField(
        max_length=100, blank=True, db_index=True
    )

    terms_text = models.TextField(blank=True)
    privacy_text = models.TextField(blank=True)

    warranty_type = models.CharField(
        max_length=16,
        choices=[("default", "Default"), ("custom", "Custom")],
        default="default",
    )
    warranty_text_snapshot = models.TextField(blank=True, default="")

    escrow_funded_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Total amount funded into escrow so far.",
    )

    escrow_payment_intent_id = models.CharField(max_length=255, blank=True)
    escrow_funded = models.BooleanField(default=False)

    reviewed = models.BooleanField(default=False)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=32, null=True, blank=True)

    contractor_ack_reviewed = models.BooleanField(default=False)
    contractor_ack_tos = models.BooleanField(default=False)
    contractor_ack_esign = models.BooleanField(default=False)
    contractor_ack_at = models.DateTimeField(null=True, blank=True)

    signed_by_contractor = models.BooleanField(default=False)
    signed_at_contractor = models.DateTimeField(null=True, blank=True)
    signed_by_homeowner = models.BooleanField(default=False)
    signed_at_homeowner = models.DateTimeField(null=True, blank=True)
    contractor_signature_name = models.CharField(max_length=255, blank=True)
    homeowner_signature_name = models.CharField(max_length=255, blank=True)
    contractor_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    homeowner_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    contractor_signature = models.FileField(
        upload_to="signatures/contractor/", null=True, blank=True
    )
    homeowner_signature = models.FileField(
        upload_to="signatures/homeowner/", null=True, blank=True
    )

    pdf_file = models.FileField(
        upload_to="agreements/pdf/", null=True, blank=True
    )
    pdf_version = models.PositiveIntegerField(default=1)
    pdf_archived = models.BooleanField(default=False)
    signature_log = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    amendment_number = models.PositiveIntegerField(default=0, editable=False)
    addendum_file = models.FileField(
        upload_to="agreements/addenda/", null=True, blank=True
    )
    is_archived = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        suffix = f" (Amendment {self.amendment_number})" if self.amendment_number else ""
        return f"Agreement for {self.project.title}{suffix}"

    @property
    def is_fully_signed(self):
        return self.signed_by_contractor and self.signed_by_homeowner

    @property
    def signature_is_satisfied(self) -> bool:
        contractor_ok = (not bool(self.require_contractor_signature)) or bool(self.signed_by_contractor)
        homeowner_ok = (not bool(self.require_customer_signature)) or bool(self.signed_by_homeowner)

        policy = (self.signature_policy or AgreementSignaturePolicy.BOTH_REQUIRED).strip()

        if policy == AgreementSignaturePolicy.BOTH_REQUIRED:
            return bool(contractor_ok and homeowner_ok)

        if policy == AgreementSignaturePolicy.CONTRACTOR_ONLY:
            return bool(contractor_ok)

        if policy == AgreementSignaturePolicy.EXTERNAL_SIGNED:
            evidence = False
            if (self.external_contract_reference or "").strip():
                evidence = True
            if bool(self.external_contract_file):
                evidence = True
            if self.external_contract_attested is True:
                evidence = True
            return bool(contractor_ok) and evidence

        return bool(contractor_ok and homeowner_ok)

    @property
    def is_direct_pay(self) -> bool:
        return self.payment_mode == AgreementPaymentMode.DIRECT

    @property
    def is_residential(self) -> bool:
        return self.project_class == AgreementProjectClass.RESIDENTIAL

    @property
    def is_commercial(self) -> bool:
        return self.project_class == AgreementProjectClass.COMMERCIAL

    @property
    def requires_escrow(self) -> bool:
        return not self.is_direct_pay

    @property
    def is_maintenance(self) -> bool:
        return self.agreement_mode == AgreementMode.MAINTENANCE or bool(self.recurring_service_enabled)

    def save(self, *args, **kwargs):
        if not self.contractor and self.project and self.project.contractor_id:
            self.contractor = self.project.contractor

        if not (self.project_class or "").strip():
            self.project_class = (
                AgreementProjectClass.COMMERCIAL
                if self.payment_structure == AgreementPaymentStructure.PROGRESS
                else AgreementProjectClass.RESIDENTIAL
            )

        if self.agreement_mode == AgreementMode.MAINTENANCE:
            self.recurring_service_enabled = True
        elif not self.recurring_service_enabled:
            self.maintenance_status = MaintenanceStatus.ACTIVE

        if not self.recurring_service_enabled:
            self.recurrence_pattern = ""
            self.recurrence_interval = 1
            self.recurrence_start_date = None
            self.recurrence_end_date = None
            self.next_occurrence_date = None
            self.auto_generate_next_occurrence = False
            self.service_window_notes = self.service_window_notes or ""
            self.recurring_summary_label = self.recurring_summary_label or ""

        if self.recurrence_interval < 1:
            self.recurrence_interval = 1

        # Sync taxonomy refs -> snapshot text fields
        if self.project_type_ref_id and not (self.project_type or "").strip():
            self.project_type = self.project_type_ref.name

        if self.project_subtype_ref_id and not (self.project_subtype or "").strip():
            self.project_subtype = self.project_subtype_ref.name

        if self.project_subtype_ref_id and self.project_type_ref_id is None:
            try:
                self.project_type_ref = self.project_subtype_ref.project_type
                if not (self.project_type or "").strip():
                    self.project_type = self.project_type_ref.name
            except Exception:
                pass

        if self.warranty_type:
            self.warranty_type = str(self.warranty_type).strip().lower()
            if self.warranty_type not in ("default", "custom"):
                self.warranty_type = "default"
        else:
            self.warranty_type = "default"

        snap = (self.warranty_text_snapshot or "").strip()
        if not snap:
            self.warranty_text_snapshot = DEFAULT_WARRANTY_TEXT

        if self.status in (ProjectStatus.COMPLETED, ProjectStatus.CANCELLED):
            super().save(*args, **kwargs)
            return

        if not self.is_direct_pay:
            try:
                funded_amt = Decimal(str(self.escrow_funded_amount or "0"))
            except Exception:
                funded_amt = Decimal("0.00")

            try:
                total_amt = Decimal(str(self.total_cost or "0"))
            except Exception:
                total_amt = Decimal("0.00")

            if total_amt > 0 and funded_amt >= total_amt:
                self.escrow_funded = True

                if self.status in (
                    ProjectStatus.DRAFT,
                    ProjectStatus.SIGNED,
                    ProjectStatus.FUNDED,
                ):
                    self.status = ProjectStatus.FUNDED

            elif self.signature_is_satisfied and self.status == ProjectStatus.DRAFT:
                self.status = ProjectStatus.SIGNED

        else:
            if self.signature_is_satisfied and self.status == ProjectStatus.DRAFT:
                self.status = ProjectStatus.SIGNED

        super().save(*args, **kwargs)


class AgreementPDFVersion(models.Model):
    KIND_PREVIEW = "preview"
    KIND_FINAL = "final"
    KIND_EXECUTED = "executed"

    KIND_CHOICES = (
        (KIND_PREVIEW, "Preview"),
        (KIND_FINAL, "Final"),
        (KIND_EXECUTED, "Executed"),
    )

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="pdf_versions",
        db_index=True,
    )

    version_number = models.PositiveIntegerField(db_index=True)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_FINAL, db_index=True)

    file = models.FileField(upload_to="agreements/pdf_versions/", null=True, blank=True)

    sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    signed_by_contractor = models.BooleanField(default=False)
    signed_by_homeowner = models.BooleanField(default=False)
    contractor_signature_name = models.CharField(max_length=255, blank=True, default="")
    homeowner_signature_name = models.CharField(max_length=255, blank=True, default="")
    contractor_signed_at = models.DateTimeField(null=True, blank=True)
    homeowner_signed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        unique_together = (("agreement", "version_number"),)

    def __str__(self):
        return f"AgreementPDFVersion(agreement={self.agreement_id}, v{self.version_number}, kind={self.kind})"


class AgreementWarranty(models.Model):
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="warranty_records",
        db_index=True,
    )
    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="agreement_warranties",
        db_index=True,
    )
    title = models.CharField(max_length=255)
    coverage_details = models.TextField(blank=True, default="")
    exclusions = models.TextField(blank=True, default="")
    start_date = models.DateField(null=True, blank=True, db_index=True)
    end_date = models.DateField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=16,
        choices=WarrantyStatus.choices,
        default=WarrantyStatus.ACTIVE,
        db_index=True,
    )
    applies_to = models.CharField(
        max_length=24,
        choices=WarrantyAppliesTo.choices,
        blank=True,
        default="",
        help_text="Optional lightweight scope label for the warranty record.",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date", "-created_at", "-id"]

    def clean(self):
        super().clean()
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "End date cannot be before start date."})

    def save(self, *args, **kwargs):
        if not self.contractor_id and self.agreement_id and self.agreement.contractor_id:
            self.contractor = self.agreement.contractor

        if (
            self.status == WarrantyStatus.ACTIVE
            and self.end_date
            and self.end_date < timezone.localdate()
        ):
            self.status = WarrantyStatus.EXPIRED

        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Warranty({self.title} • agreement={self.agreement_id})"


class AgreementFundingLink(models.Model):
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="funding_links",
    )
    token = models.CharField(
        max_length=255,
        unique=True,
        db_index=True,
        help_text="Public token used in the /public-fund/:token URL.",
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Escrow amount the homeowner is asked to fund.",
    )
    currency = models.CharField(
        max_length=8,
        default="usd",
        help_text="Currency code for the escrow funding amount.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    payment_intent_id = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"FundingLink({self.agreement_id}, {self.amount} {self.currency}, active={self.is_active})"

    @classmethod
    def generate_token(cls) -> str:
        return secrets.token_urlsafe(32)

    @classmethod
    def default_expiry(cls) -> timezone.datetime:
        return timezone.now() + timedelta(days=7)

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def mark_used(self):
        self.used_at = timezone.now()
        self.is_active = False
        self.save(update_fields=["used_at", "is_active"])

    def is_valid(self) -> bool:
        if not self.is_active:
            return False
        if self.is_expired:
            return False
        if self.used_at is not None:
            return False
        return True

    @classmethod
    def create_for_agreement(cls, agreement, amount, currency="usd"):
        token = cls.generate_token()
        return cls.objects.create(
            agreement=agreement,
            token=token,
            amount=amount,
            currency=currency,
            expires_at=cls.default_expiry(),
        )


class Milestone(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="milestones"
    )
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    start_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    duration = models.DurationField(
        null=True,
        blank=True,
        help_text="Estimated time to complete the milestone.",
    )
    is_recurring_rule = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Whether this milestone acts as the recurring-service rule/template for future occurrences.",
    )
    recurrence_pattern = models.CharField(
        max_length=24,
        choices=RecurrencePattern.choices,
        blank=True,
        default="",
    )
    recurrence_interval = models.PositiveIntegerField(default=1)
    recurrence_anchor_date = models.DateField(null=True, blank=True, db_index=True)
    recurrence_end_date = models.DateField(null=True, blank=True, db_index=True)
    next_occurrence_date = models.DateField(null=True, blank=True, db_index=True)
    recurring_rule_parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="generated_occurrences",
    )
    occurrence_sequence_number = models.PositiveIntegerField(default=0)
    generated_from_recurring_rule = models.BooleanField(default=False, db_index=True)
    service_period_start = models.DateField(null=True, blank=True)
    service_period_end = models.DateField(null=True, blank=True)
    scheduled_service_date = models.DateField(null=True, blank=True, db_index=True)

    # --- estimate assist snapshot fields ---
    normalized_milestone_type = models.CharField(
        max_length=128,
        blank=True,
        default="",
        db_index=True,
        help_text="Stable milestone category copied from template/AI guidance.",
    )
    template_suggested_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Original template-suggested amount snapshot.",
    )
    ai_suggested_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="AI or applied suggestion snapshot at milestone creation time.",
    )
    suggested_amount_low = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Low-end suggested price range snapshot.",
    )
    suggested_amount_high = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="High-end suggested price range snapshot.",
    )
    labor_estimate_low = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Advisory labor-only low-end estimate snapshot.",
    )
    labor_estimate_high = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Advisory labor-only high-end estimate snapshot.",
    )
    materials_estimate_low = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Advisory materials-only low-end estimate snapshot.",
    )
    materials_estimate_high = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Advisory materials-only high-end estimate snapshot.",
    )
    pricing_confidence = models.CharField(
        max_length=16,
        blank=True,
        default="",
        help_text="Confidence level for pricing guidance.",
    )
    pricing_source_note = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Short note describing pricing guidance source.",
    )
    agreement_fee_allocation_cents = models.PositiveIntegerField(default=0)
    amendment_number_snapshot = models.PositiveIntegerField(default=0)
    recommended_days_from_start = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Suggested relative day offset from agreement start.",
    )
    recommended_duration_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Suggested duration in days copied from template/AI guidance.",
    )
    materials_hint = models.TextField(
        blank=True,
        default="",
        help_text="Suggested materials or takeoff hint copied from template/AI guidance.",
    )

    is_invoiced = models.BooleanField(default=False)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    rework_origin_milestone_id = models.IntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Original milestone id that this rework milestone corrects (the milestone referenced by the dispute).",
    )

    invoice = models.OneToOneField(
        "projects.Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="source_milestone",
        help_text="Invoice created from this milestone (idempotent link).",
    )
    assigned_subcontractor_invitation = models.ForeignKey(
        "projects.SubcontractorInvitation",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_milestones",
        help_text="Accepted subcontractor invitation assigned to this milestone.",
    )
    subcontractor_review_requested_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the assigned subcontractor requested contractor review.",
    )
    subcontractor_review_requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="subcontractor_review_requests",
        help_text="Assigned subcontractor user who requested contractor review.",
    )
    subcontractor_review_note = models.TextField(
        blank=True,
        default="",
        help_text="Optional note from the assigned subcontractor when requesting review.",
    )
    subcontractor_completion_status = models.CharField(
        max_length=32,
        choices=SubcontractorCompletionStatus.choices,
        default=SubcontractorCompletionStatus.NOT_SUBMITTED,
        db_index=True,
        help_text="Parallel subcontractor completion-review workflow state.",
    )
    subcontractor_marked_complete_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the assigned subcontractor submitted completion for review.",
    )
    subcontractor_marked_complete_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="subcontractor_completion_submissions",
        help_text="Assigned subcontractor user who submitted completion for review.",
    )
    subcontractor_completion_note = models.TextField(
        blank=True,
        default="",
        help_text="Optional note from the subcontractor when submitting completion.",
    )
    subcontractor_reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the contractor reviewed the subcontractor completion submission.",
    )
    subcontractor_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="subcontractor_completion_reviews",
        help_text="Owning contractor user who reviewed the subcontractor completion submission.",
    )
    subcontractor_review_response_note = models.TextField(
        blank=True,
        default="",
        help_text="Optional contractor response note for approval or change requests.",
    )
    delegated_reviewer_subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="review_milestones",
        help_text="Optional delegated internal reviewer for worker submissions on this milestone.",
    )
    subcontractor_payout_amount_cents = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Optional subcontractor payout amount in cents for this milestone. Defaults to the milestone amount in V1.",
    )
    subcontractor_compliance_status = models.CharField(
        max_length=32,
        choices=SubcontractorComplianceStatus.choices,
        default=SubcontractorComplianceStatus.UNKNOWN,
        db_index=True,
        help_text="Advisory compliance state snapshot for the assigned subcontractor on this milestone.",
    )
    subcontractor_license_required = models.BooleanField(default=False)
    subcontractor_insurance_required = models.BooleanField(default=False)
    subcontractor_compliance_override = models.BooleanField(default=False)
    subcontractor_compliance_override_reason = models.TextField(blank=True, default="")
    subcontractor_license_requested_at = models.DateTimeField(null=True, blank=True)
    subcontractor_license_requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="subcontractor_license_requests",
        help_text="Contractor user who requested compliance documents before assignment acceptance.",
    )
    subcontractor_compliance_warning_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Structured advisory compliance decision snapshot captured when the assignment changed.",
    )
    subcontractor_required_trade_key = models.CharField(max_length=64, blank=True, default="")
    subcontractor_required_state_code = models.CharField(max_length=8, blank=True, default="")

    class Meta:
        ordering = ["order"]
        unique_together = [("agreement", "order")]
        indexes = [
            models.Index(fields=["normalized_milestone_type"]),
        ]
        constraints = [
            models.CheckConstraint(
                name="milestone_invoiced_requires_completed",
                check=Q(is_invoiced=False) | Q(completed=True),
            ),
            models.CheckConstraint(
                name="milestone_invoice_requires_completed_and_flag",
                check=Q(invoice__isnull=True) | (Q(completed=True) & Q(is_invoiced=True)),
            ),
        ]

    def clean(self):
        if self.is_invoiced and not self.completed:
            raise ValidationError("Milestone cannot be invoiced unless it is completed.")
        if self.invoice_id and (not self.completed or not self.is_invoiced):
            raise ValidationError("Milestone invoice link requires completed=True and is_invoiced=True.")
        if self.recurrence_interval < 1:
            raise ValidationError({"recurrence_interval": "Recurrence interval must be at least 1."})

    def __str__(self):
        return f"{self.order}. {self.title} (${self.amount})"

    @property
    def is_late(self):
        return (
            self.completion_date
            and not self.completed
            and timezone.now().date() > self.completion_date
        )



class MilestoneFile(models.Model):
    milestone = models.ForeignKey(
        Milestone, on_delete=models.CASCADE, related_name="files"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    file = models.FileField(upload_to="milestone_uploads/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"File {self.id} for milestone {self.milestone.title}"


class MilestoneComment(models.Model):
    milestone = models.ForeignKey(
        Milestone, on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        author_name = "Deleted User"
        if self.author:
            author_name = self.author.get_full_name()
        return f"Comment by {author_name} on {self.created_at.strftime('%Y-%m-%d')}"


class Notification(models.Model):
    EVENT_SUBCONTRACTOR_COMMENT = "subcontractor_comment"
    EVENT_SUBCONTRACTOR_FILE = "subcontractor_file"
    EVENT_SUBCONTRACTOR_REVIEW = "subcontractor_review"
    EVENT_DRAW_APPROVED = "draw_approved"
    EVENT_DRAW_CHANGES_REQUESTED = "draw_changes_requested"
    EVENT_DRAW_PAID = "draw_paid"
    EVENT_DRAW_RELEASED = "draw_released"
    EVENT_BID_AWARDED = "bid_awarded"
    EVENT_BID_NOT_SELECTED = "bid_not_selected"

    EVENT_CHOICES = (
        (EVENT_SUBCONTRACTOR_COMMENT, "Subcontractor Comment"),
        (EVENT_SUBCONTRACTOR_FILE, "Subcontractor File"),
        (EVENT_SUBCONTRACTOR_REVIEW, "Subcontractor Review Request"),
        (EVENT_DRAW_APPROVED, "Draw Approved"),
        (EVENT_DRAW_CHANGES_REQUESTED, "Draw Changes Requested"),
        (EVENT_DRAW_PAID, "Draw Paid"),
        (EVENT_DRAW_RELEASED, "Draw Released"),
        (EVENT_BID_AWARDED, "Bid Awarded"),
        (EVENT_BID_NOT_SELECTED, "Bid Not Selected"),
    )

    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    event_type = models.CharField(max_length=64, choices=EVENT_CHOICES, db_index=True)
    agreement = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    milestone = models.ForeignKey(
        Milestone,
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    draw_request = models.ForeignKey(
        "projects.DrawRequest",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    public_lead = models.ForeignKey(
        "projects.PublicContractorLead",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_project_notifications",
    )
    actor_display_name = models.CharField(max_length=255, blank=True, default="")
    actor_email = models.EmailField(blank=True, default="")
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True, default="")
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.contractor_id}:{self.event_type}:{self.title}"


class MilestonePayout(models.Model):
    milestone = models.OneToOneField(
        Milestone,
        on_delete=models.CASCADE,
        related_name="payout_record",
    )
    subcontractor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="milestone_payouts",
    )
    amount_cents = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=32,
        choices=MilestonePayoutStatus.choices,
        default=MilestonePayoutStatus.NOT_ELIGIBLE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    eligible_at = models.DateTimeField(null=True, blank=True)
    ready_for_payout_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    stripe_transfer_id = models.CharField(max_length=255, blank=True, default="")
    failure_reason = models.TextField(blank=True, default="")
    execution_mode = models.CharField(max_length=16, choices=MilestonePayoutExecutionMode.choices, blank=True, default="")

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return f"MilestonePayout(milestone={self.milestone_id}, subcontractor={self.subcontractor_user_id}, status={self.status})"


class DrawRequest(models.Model):
    agreement = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name="draw_requests",
    )
    draw_number = models.PositiveIntegerField()
    status = models.CharField(
        max_length=32,
        choices=DrawRequestStatus.choices,
        default=DrawRequestStatus.DRAFT,
        db_index=True,
    )
    title = models.CharField(max_length=255)
    notes = models.TextField(blank=True, default="")
    public_token = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        help_text="Public token for owner draw review and payment flow.",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="submitted_draw_requests",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_draw_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    homeowner_viewed_at = models.DateTimeField(null=True, blank=True)
    homeowner_acted_at = models.DateTimeField(null=True, blank=True)
    homeowner_review_notes = models.TextField(blank=True, default="")
    review_email_sent_at = models.DateTimeField(null=True, blank=True)
    last_review_email_error = models.TextField(blank=True, default="")
    gross_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    retainage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    net_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    previous_payments_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    current_requested_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    stripe_checkout_session_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stripe_checkout_url = models.URLField(blank=True, default="")
    stripe_payment_intent_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stripe_transfer_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    escrow_source_payment_intent_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    escrow_source_charge_id = models.CharField(max_length=255, blank=True, default="")
    platform_fee_cents = models.PositiveIntegerField(default=0)
    payout_cents = models.PositiveIntegerField(default=0)
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_via = models.CharField(max_length=32, blank=True, default="")
    released_at = models.DateTimeField(null=True, blank=True)
    transfer_created_at = models.DateTimeField(null=True, blank=True)
    transfer_failure_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["agreement", "draw_number"],
                name="unique_draw_number_per_agreement",
            )
        ]

    def __str__(self):
        return f"DrawRequest(agreement={self.agreement_id}, draw_number={self.draw_number}, status={self.status})"


class DrawLineItem(models.Model):
    draw_request = models.ForeignKey(
        DrawRequest,
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    milestone = models.ForeignKey(
        Milestone,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="draw_line_items",
    )
    description = models.CharField(max_length=255)
    scheduled_value = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    percent_complete = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    earned_to_date = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    previous_billed = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    this_draw_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    retainage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    remaining_balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"DrawLineItem(draw_request={self.draw_request_id}, milestone={self.milestone_id})"


class ExternalPaymentRecord(models.Model):
    agreement = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name="external_payment_records",
    )
    draw_request = models.ForeignKey(
        DrawRequest,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="external_payment_records",
    )
    payer_name = models.CharField(max_length=255, blank=True, default="")
    payee_name = models.CharField(max_length=255, blank=True, default="")
    gross_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    retainage_withheld_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    net_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    payment_method = models.CharField(max_length=16, default="other")
    payment_date = models.DateField()
    reference_number = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    proof_file = models.FileField(upload_to="payments/external_proof/", null=True, blank=True)
    status = models.CharField(
        max_length=16,
        choices=ExternalPaymentStatus.choices,
        default=ExternalPaymentStatus.RECORDED,
        db_index=True,
    )
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="recorded_external_payments",
    )
    recorded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-payment_date", "-id"]

    def __str__(self):
        return f"ExternalPaymentRecord(agreement={self.agreement_id}, draw={self.draw_request_id}, status={self.status})"


class Invoice(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="invoices"
    )
    invoice_number = models.CharField(
        max_length=32, unique=True, editable=False, db_index=True, blank=True
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    status = models.CharField(
        max_length=20,
        choices=InvoiceStatus.choices,
        default=InvoiceStatus.INCOMPLETE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    approved_at = models.DateTimeField(null=True, blank=True)

    public_token = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        help_text="Public magic token for homeowner invoice access",
    )

    pdf_file = models.FileField(upload_to="invoices/pdf/", null=True, blank=True)

    escrow_released = models.BooleanField(default=False)
    escrow_released_at = models.DateTimeField(null=True, blank=True)
    stripe_transfer_id = models.CharField(max_length=255, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)

    platform_fee_cents = models.PositiveIntegerField(default=0)
    payout_cents = models.PositiveIntegerField(default=0)

    disputed = models.BooleanField(default=False)
    dispute_reason = models.TextField(blank=True)
    dispute_by = models.CharField(
        max_length=20,
        choices=[("contractor", "Contractor"), ("homeowner", "Homeowner")],
        blank=True,
    )
    disputed_at = models.DateTimeField(null=True, blank=True)
    marked_complete_at = models.DateTimeField(null=True, blank=True)

    email_sent_at = models.DateTimeField(null=True, blank=True)
    email_message_id = models.CharField(max_length=255, blank=True)
    last_email_error = models.TextField(blank=True)

    milestone_id_snapshot = models.IntegerField(null=True, blank=True, db_index=True)
    milestone_title_snapshot = models.CharField(max_length=255, blank=True)
    milestone_description_snapshot = models.TextField(blank=True)

    milestone_completion_notes = models.TextField(blank=True)
    milestone_attachments_snapshot = models.JSONField(default=list, blank=True)

    direct_pay_checkout_session_id = models.CharField(max_length=255, blank=True, default="")
    direct_pay_payment_intent_id = models.CharField(max_length=255, blank=True, default="")
    direct_pay_checkout_url = models.URLField(blank=True, default="")
    direct_pay_paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            self.invoice_number = self._generate_invoice_number()
        super().save(*args, **kwargs)

    def _generate_invoice_number(self):
        prefix = f'INV-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_invoice = (
                Invoice.objects.filter(invoice_number__startswith=prefix)
                .order_by("invoice_number")
                .last()
            )
            if last_invoice:
                last_suffix = int(last_invoice.invoice_number.split("-")[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        return f"Invoice {self.invoice_number} (${self.amount})"

    @property
    def is_direct_pay(self) -> bool:
        return getattr(self.agreement, "payment_mode", "") == AgreementPaymentMode.DIRECT

    @property
    def direct_pay_link_ready(self) -> bool:
        return bool(self.direct_pay_checkout_url)


class ProjectEmailReportLog(models.Model):
    class EventType(models.TextChoices):
        MILESTONE_APPROVAL_REQUESTED = "milestone_approval_requested", "Milestone Approval Requested"
        PAYMENT_RELEASED = "payment_released", "Payment Released"
        COMPLIANCE_ALERT = "compliance_alert", "Compliance Alert"
        WEEKLY_PROJECT_SUMMARY = "weekly_project_summary", "Weekly Project Summary"

    agreement = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name="email_report_logs",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="email_report_logs",
    )
    invoice = models.ForeignKey(
        "projects.Invoice",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="email_report_logs",
    )
    event_type = models.CharField(max_length=48, choices=EventType.choices, db_index=True)
    recipient_email = models.EmailField(db_index=True)
    recipient_name = models.CharField(max_length=255, blank=True, default="")
    dedup_key = models.CharField(max_length=255, unique=True, db_index=True)
    payload_snapshot = models.JSONField(default=dict, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-sent_at", "-id"]
        indexes = [
            models.Index(fields=["agreement", "event_type", "sent_at"]),
        ]

    def __str__(self):
        return f"ProjectEmailReportLog(agreement={self.agreement_id}, event={self.event_type}, recipient={self.recipient_email})"


class Expense(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="misc_expenses"
    )
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    incurred_date = models.DateField(default=timezone.now)
    status = models.CharField(
        max_length=20,
        choices=ExpenseStatus.choices,
        default=ExpenseStatus.PENDING,
        db_index=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    category = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-incurred_date"]

    def __str__(self):
        return f"{self.description} – ${self.amount}"


class AgreementAmendment(models.Model):
    parent = models.ForeignKey(
        "Agreement",
        on_delete=models.CASCADE,
        related_name="amendments",
    )
    child = models.OneToOneField(
        "Agreement",
        on_delete=models.CASCADE,
        related_name="as_amendment",
    )
    amendment_number = models.PositiveIntegerField(default=1)

    class Meta:
        verbose_name = "Agreement Amendment"
        verbose_name_plural = "Agreement Amendments"
        unique_together = (("parent", "amendment_number"),)

    def __str__(self):
        return (
            f"Amendment #{self.amendment_number} "
            f"to Agreement #{self.parent_id} (child #{self.child_id})"
        )


class ContractorSubAccount(models.Model):
    ROLE_EMPLOYEE_READONLY = "employee_readonly"
    ROLE_EMPLOYEE_MILESTONES = "employee_milestones"
    ROLE_EMPLOYEE_SUPERVISOR = "employee_supervisor"

    ROLE_CHOICES = (
        (ROLE_EMPLOYEE_READONLY, "Read-only employee"),
        (ROLE_EMPLOYEE_MILESTONES, "Milestones employee"),
        (ROLE_EMPLOYEE_SUPERVISOR, "Supervisor / Foreman"),
    )

    parent_contractor = models.ForeignKey(
        Contractor,
        related_name="subaccounts",
        on_delete=models.CASCADE,
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name="contractor_subaccount",
        on_delete=models.CASCADE,
    )

    display_name = models.CharField(max_length=255)
    role = models.CharField(
        max_length=32,
        choices=ROLE_CHOICES,
        default=ROLE_EMPLOYEE_READONLY,
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "Contractor Sub-Account"
        verbose_name_plural = "Contractor Sub-Accounts"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.display_name} ({self.get_role_display()}) for {self.parent_contractor}"


def employee_profile_upload_to(instance, filename: str) -> str:
    sid = getattr(instance, "subaccount_id", "unknown")
    ts = timezone.now().strftime("%Y%m%d-%H%M%S")
    return f"employee_profiles/{sid}/{ts}_{filename}"


class EmployeeProfile(models.Model):
    subaccount = models.OneToOneField(
        ContractorSubAccount,
        on_delete=models.CASCADE,
        related_name="employee_profile",
    )

    first_name = models.CharField(max_length=80, blank=True, default="")
    last_name = models.CharField(max_length=80, blank=True, default="")
    phone_number = models.CharField(max_length=40, blank=True, default="")

    home_address_line1 = models.CharField(max_length=200, blank=True, default="")
    home_address_line2 = models.CharField(max_length=200, blank=True, default="")
    home_city = models.CharField(max_length=120, blank=True, default="")
    home_state = models.CharField(max_length=60, blank=True, default="")
    home_postal_code = models.CharField(max_length=30, blank=True, default="")

    drivers_license_number = models.CharField(max_length=80, blank=True, default="")
    drivers_license_state = models.CharField(max_length=40, blank=True, default="")
    drivers_license_expiration = models.DateField(null=True, blank=True)
    drivers_license_file = models.FileField(upload_to=employee_profile_upload_to, null=True, blank=True)

    professional_license_type = models.CharField(max_length=120, blank=True, default="")
    professional_license_number = models.CharField(max_length=120, blank=True, default="")
    professional_license_expiration = models.DateField(null=True, blank=True)
    professional_license_file = models.FileField(upload_to=employee_profile_upload_to, null=True, blank=True)

    photo = models.ImageField(upload_to=employee_profile_upload_to, null=True, blank=True)

    assigned_work_schedule = models.TextField(blank=True, default="")
    day_off_requests = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self) -> str:
        return f"EmployeeProfile(subaccount_id={self.subaccount_id})"


class AgreementAssignment(models.Model):
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="subaccount_assignments",
    )
    subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="agreement_assignments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("agreement", "subaccount")

    def __str__(self):
        return f"AgreementAssignment(agreement={self.agreement_id}, subaccount={self.subaccount_id})"


class MilestoneAssignment(models.Model):
    milestone = models.OneToOneField(
        "projects.Milestone",
        on_delete=models.CASCADE,
        related_name="subaccount_assignment",
    )
    subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="milestone_assignments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"MilestoneAssignment(milestone={self.milestone_id}, subaccount={self.subaccount_id})"


# ensure related models are registered
from .models_attachments import AgreementAttachment, ExpenseRequestAttachment  # noqa: E402,F401
from .models_schedule import EmployeeWorkSchedule, EmployeeScheduleException  # noqa: E402,F401
from .models_ai_artifacts import DisputeAIArtifact  # noqa: E402,F401
from .models_expense_request import ExpenseRequest  # noqa: E402,F401
from .models_templates import ProjectTemplate, ProjectTemplateMilestone, SeedBenchmarkProfile  # noqa: E402,F401
from .models_amendment_request import AmendmentRequest  # noqa: E402,F401
from .models_learning import (
    AgreementOutcomeSnapshot,
    AgreementOutcomeMilestoneSnapshot,
    MilestoneBenchmarkAggregate,
    ProjectBenchmarkAggregate,
)  # noqa: E402,F401
from .models_compliance import (
    StateTradeLicenseRequirement,
    ContractorComplianceRecord,
)  # noqa: E402,F401
