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
from .models_dispute import (
    Dispute,
    DisputeAttachment,
    ResolutionAgreement,
    ResolutionAgreementSignature,
    ResolutionCaseAuditEvent,
    ResolutionCaseTimelineEvent,
    ResolutionDocument,
    ResolutionEvidenceIndex,
    ResolutionPartyStatement,
    ResolutionProposal,
)
from .models_invite import ContractorInvite  # noqa: F401
from .models_contractor_discovery import (  # noqa: F401
    ContractorDirectoryDiscovery,
    ContractorEstimateAvailabilityWindow,
    ContractorDirectoryClaimToken,
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
    ContractorOpportunity,
    ContractorDiscoveryInvite,
    ContractorMarketplaceJoinInvite,
    MarketplaceLocation,
    OpportunityEstimateAppointment,
)
from .models_quick_capture import ProjectAssistantCaptureSession, ProjectAssistantPreparedAction  # noqa: E402,F401
from .models_smart_capture import AIUsageLedger, ContractorAsset, ProjectAssistantSmartCaptureSession  # noqa: E402,F401
from .models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement  # noqa: E402,F401
from .models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from .models_project_taxonomy import ProjectType, ProjectSubtype  # noqa: E402,F401
from .models_sms import DeferredSMSAutomation, SMSAutomationDecision, SMSConsent, SMSConsentStatus  # noqa: E402,F401
from .models_subcontractor import (  # noqa: E402,F401
    SubcontractorInvitation,
    SubcontractorMilestoneAgreement,
    SubcontractorQuoteRequest,
)


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


class AgreementProjectMode(models.TextChoices):
    FULL_SERVICE = "full_service", "Full Service"
    ASSISTED_DIY = "assisted_diy", "DIY Assistance"
    CONSULTATION = "consultation", "Consultation / Guidance"
    INSPECTION_ONLY = "inspection_only", "Inspection Only"


class MilestoneRole(models.TextChoices):
    HOMEOWNER_TASK = "homeowner_task", "Homeowner Task"
    CONTRACTOR_TASK = "contractor_task", "Contractor Task"
    SHARED_TASK = "shared_task", "Shared Task"
    INSPECTION_CHECKPOINT = "inspection_checkpoint", "Inspection Checkpoint"


class EmployeeSkillLevel(models.TextChoices):
    BEGINNER = "beginner", "Beginner"
    WORKING = "working", "Working"
    SKILLED = "skilled", "Skilled"
    LEAD = "lead", "Lead"
    EXPERT = "expert", "Expert"


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


class InspectionStatus(models.TextChoices):
    NOT_REQUESTED = "not_requested", "Not Requested"
    REQUESTED = "inspection_requested", "Inspection Requested"
    PASSED = "inspection_passed", "Inspection Passed"
    REVISION_REQUIRED = "inspection_revision_required", "Inspection Revision Required"


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
    ACTIVATION_TRADITIONAL_SIGNUP = "traditional_signup"
    ACTIVATION_PREFILLED_DIRECTORY = "prefilled_directory"
    ACTIVATION_HOMEOWNER_SELECTED = "homeowner_selected"
    ACTIVATION_TYPE_CHOICES = [
        (ACTIVATION_TRADITIONAL_SIGNUP, "Traditional Signup"),
        (ACTIVATION_PREFILLED_DIRECTORY, "Prefilled Directory"),
        (ACTIVATION_HOMEOWNER_SELECTED, "Homeowner Selected"),
    ]

    MARKETPLACE_UNVERIFIED = "unverified"
    MARKETPLACE_PENDING_REVIEW = "pending_review"
    MARKETPLACE_VERIFIED = "verified"
    MARKETPLACE_REJECTED = "rejected"
    MARKETPLACE_SUSPENDED = "suspended"
    MARKETPLACE_VERIFICATION_STATUS_CHOICES = [
        (MARKETPLACE_UNVERIFIED, "Unverified"),
        (MARKETPLACE_PENDING_REVIEW, "Pending Review"),
        (MARKETPLACE_VERIFIED, "Verified"),
        (MARKETPLACE_REJECTED, "Rejected"),
        (MARKETPLACE_SUSPENDED, "Suspended"),
    ]

    SERVICE_RADIUS_CHOICES = [
        (5, "5"),
        (10, "10"),
        (15, "15"),
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
    accepts_diy_assistance = models.BooleanField(default=False)
    accepts_consultation_only = models.BooleanField(default=False)
    accepts_hourly_help = models.BooleanField(default=False)
    accepts_inspection_only = models.BooleanField(default=False)
    accepts_homeowner_participation = models.BooleanField(default=False)
    license_number = models.CharField(max_length=50, blank=True)
    license_expiration = models.DateField(null=True, blank=True)
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    license_file = models.FileField(upload_to="licenses/", null=True, blank=True)
    insurance_file = models.FileField(upload_to="insurance/", null=True, blank=True)

    stripe_account_id = models.CharField(max_length=255, blank=True, db_index=True)
    onboarding_status = models.CharField(max_length=50, blank=True)
    stripe_onboarding_status = models.CharField(max_length=50, blank=True, default="not_started", db_index=True)

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
    activation_type = models.CharField(
        max_length=40,
        choices=ACTIVATION_TYPE_CHOICES,
        null=True,
        blank=True,
        db_index=True,
    )
    has_seen_prefilled_profile_intro = models.BooleanField(default=False)
    has_seen_public_leads_intro = models.BooleanField(default=False)
    has_seen_draft_agreement_intro = models.BooleanField(default=False)
    has_completed_guided_activation = models.BooleanField(default=False)
    first_opportunity_seen_at = models.DateTimeField(null=True, blank=True)
    first_draft_agreement_seen_at = models.DateTimeField(null=True, blank=True)
    marketplace_verification_status = models.CharField(
        max_length=32,
        choices=MARKETPLACE_VERIFICATION_STATUS_CHOICES,
        default=MARKETPLACE_UNVERIFIED,
        db_index=True,
    )
    marketplace_verification_notes = models.TextField(blank=True, default="")
    marketplace_verification_rejected_reason = models.TextField(blank=True, default="")
    marketplace_verified_at = models.DateTimeField(null=True, blank=True)
    marketplace_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="marketplace_verified_contractors",
    )
    marketplace_suspended_at = models.DateTimeField(null=True, blank=True)
    marketplace_suspended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="marketplace_suspended_contractors",
    )
    marketplace_preferred = models.BooleanField(default=False, db_index=True)
    marketplace_preferred_reason = models.TextField(blank=True, default="")
    marketplace_preferred_at = models.DateTimeField(null=True, blank=True)
    marketplace_preferred_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="marketplace_preferred_contractors",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    ai_free_agreements_total = models.PositiveIntegerField(default=5)
    ai_free_agreements_used = models.PositiveIntegerField(default=0)
    average_rating = models.FloatField(default=0)
    review_count = models.PositiveIntegerField(default=0)

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

    @property
    def marketplace_is_verified(self) -> bool:
        return self.marketplace_verification_status == self.MARKETPLACE_VERIFIED

    @property
    def marketplace_is_suspended(self) -> bool:
        return self.marketplace_verification_status == self.MARKETPLACE_SUSPENDED

    @property
    def marketplace_is_preferred(self) -> bool:
        return bool(self.marketplace_preferred and self.marketplace_is_verified and not self.marketplace_is_suspended)


class ContractorWorkspaceContext(models.Model):
    contractor = models.OneToOneField(
        Contractor,
        on_delete=models.CASCADE,
        related_name="workspace_context",
    )
    default_project_family_key = models.CharField(max_length=100, blank=True, default="")
    default_project_family_label = models.CharField(max_length=255, blank=True, default="")
    context_updated_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        contractor_label = getattr(self.contractor, "business_name", "") or getattr(self.contractor, "name", "")
        return f"Workspace context for {contractor_label or self.contractor_id}"


class ContractorOnboardingSetup(models.Model):
    contractor = models.OneToOneField(
        Contractor,
        on_delete=models.CASCADE,
        related_name="onboarding_setup",
    )
    work_description = models.TextField(blank=True, default="")
    preferred_project_family_keys = models.JSONField(default=list, blank=True)
    preferred_project_family_label = models.CharField(max_length=255, blank=True, default="")
    workflow_style = models.CharField(max_length=255, blank=True, default="")
    milestone_tendencies = models.JSONField(default=list, blank=True)
    pricing_baseline = models.JSONField(default=dict, blank=True)
    agreement_defaults = models.JSONField(default=dict, blank=True)
    clarification_questions = models.JSONField(default=list, blank=True)
    clarification_answers = models.JSONField(default=dict, blank=True)
    generated_setup = models.JSONField(default=dict, blank=True)
    quick_adjustment_notes = models.TextField(blank=True, default="")
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        contractor_label = getattr(self.contractor, "business_name", "") or getattr(self.contractor, "name", "")
        return f"Onboarding setup for {contractor_label or self.contractor_id}"


class ProposalTone(models.TextChoices):
    PROFESSIONAL = "professional", "Professional"
    FRIENDLY = "friendly", "Friendly"
    STRAIGHTFORWARD = "straightforward", "Straightforward"
    PREMIUM = "premium", "Premium"
    WARM_CONSULTATIVE = "warm_and_consultative", "Warm and Consultative"


class ContractorPublicTheme(models.TextChoices):
    MODERN = "modern", "Modern"
    PROFESSIONAL = "professional", "Professional"
    MINIMAL = "minimal", "Minimal"
    BOLD = "bold", "Bold"
    WARM = "warm", "Warm"


class ContractorPublicFontTheme(models.TextChoices):
    CLEAN_SANS = "clean_sans", "Clean Sans"
    MODERN_SANS = "modern_sans", "Modern Sans"
    EDITORIAL_SERIF = "editorial_serif", "Editorial Serif"
    WARM_SERIF = "warm_serif", "Warm Serif"
    COMPACT_SANS = "compact_sans", "Compact Sans"


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
    proposal_tone = models.CharField(max_length=32, choices=ProposalTone.choices, blank=True, default="")
    preferred_signoff = models.CharField(max_length=120, blank=True, default="")
    brand_primary_color = models.CharField(max_length=32, blank=True, default="")
    brand_accent_color = models.CharField(max_length=32, blank=True, default="")
    brand_font_theme = models.CharField(
        max_length=32,
        choices=ContractorPublicFontTheme.choices,
        blank=True,
        default=ContractorPublicFontTheme.CLEAN_SANS,
    )
    profile_theme = models.CharField(
        max_length=32,
        choices=ContractorPublicTheme.choices,
        blank=True,
        default=ContractorPublicTheme.MODERN,
    )
    logo = models.ImageField(upload_to=contractor_public_asset_upload_to, null=True, blank=True)
    cover_image = models.ImageField(upload_to=contractor_public_asset_upload_to, null=True, blank=True)
    hero_image = models.ImageField(upload_to=contractor_public_asset_upload_to, null=True, blank=True)
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=60, blank=True, default="")
    service_area_text = models.CharField(max_length=255, blank=True, default="")
    owner_contact_name = models.CharField(max_length=120, blank=True, default="")
    primary_trade = models.CharField(max_length=120, blank=True, default="")
    service_area_mode = models.CharField(max_length=24, blank=True, default="radius")
    service_cities = models.JSONField(default=list, blank=True)
    service_counties = models.JSONField(default=list, blank=True)
    credentials = models.JSONField(default=dict, blank=True)
    customer_trust_badges = models.JSONField(default=list, blank=True)
    has_existing_website = models.BooleanField(default=False)
    existing_website_url = models.URLField(blank=True, default="")
    website_analysis_status = models.CharField(max_length=32, blank=True, default="not_started")
    years_in_business = models.PositiveIntegerField(null=True, blank=True)
    website_url = models.URLField(blank=True, default="")
    phone_public = models.CharField(max_length=40, blank=True, default="")
    email_public = models.EmailField(blank=True, default="")
    specialties = models.JSONField(default=list, blank=True)
    work_types = models.JSONField(default=list, blank=True)
    show_license_public = models.BooleanField(default=True)
    show_phone_public = models.BooleanField(default=True)
    show_email_public = models.BooleanField(default=False)
    show_reviews = models.BooleanField(default=True)
    show_gallery = models.BooleanField(default=True)
    show_quote_cta = models.BooleanField(default=True)
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
    SOURCE_WEBSITE = "website"
    SOURCE_QUOTE_REQUEST = "quote_request"
    SOURCE_MANUAL = "manual"
    SOURCE_QR = "qr"
    SOURCE_CONTRACTOR_SENT_FORM = "contractor_sent_form"
    SOURCE_DIRECT = "direct"
    SOURCE_CHOICES = [
        (SOURCE_LANDING_PAGE, "Landing Page"),
        (SOURCE_PUBLIC_PROFILE, "Public Profile"),
        (SOURCE_WEBSITE, "Website"),
        (SOURCE_QUOTE_REQUEST, "Quote Request"),
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
    MODERATION_PENDING = "pending"
    MODERATION_APPROVED = "approved"
    MODERATION_HIDDEN = "hidden"
    MODERATION_REJECTED = "rejected"
    MODERATION_CHOICES = [
        (MODERATION_PENDING, "Pending Review"),
        (MODERATION_APPROVED, "Approved / Published"),
        (MODERATION_HIDDEN, "Hidden"),
        (MODERATION_REJECTED, "Rejected"),
    ]

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
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contractor_reviews",
    )
    linked_invoice = models.ForeignKey(
        "projects.Invoice",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="linked_contractor_reviews",
    )
    linked_milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="linked_contractor_reviews",
    )
    customer_name = models.CharField(max_length=255)
    customer_email = models.EmailField(blank=True, default="", db_index=True)
    project_type = models.CharField(max_length=120, blank=True, default="")
    project_subtype = models.CharField(max_length=120, blank=True, default="")
    rating = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=255, blank=True, default="")
    review_text = models.TextField(blank=True, default="")
    moderation_status = models.CharField(
        max_length=20,
        choices=MODERATION_CHOICES,
        default=MODERATION_PENDING,
        db_index=True,
    )
    moderation_notes = models.TextField(blank=True, default="")
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="moderated_contractor_reviews",
    )
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_verified = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    submitted_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_verified", "-submitted_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["agreement", "customer_email"],
                condition=Q(agreement__isnull=False) & ~Q(customer_email=""),
                name="uniq_contractor_review_agreement_customer_email",
            )
        ]

    def clean(self):
        super().clean()
        if self.rating < 1 or self.rating > 5:
            raise ValidationError({"rating": "Rating must be between 1 and 5."})
        if self.linked_invoice_id and self.linked_milestone_id:
            invoice_agreement_id = getattr(self.linked_invoice, "agreement_id", None)
            milestone_agreement_id = getattr(self.linked_milestone, "agreement_id", None)
            if invoice_agreement_id and milestone_agreement_id and invoice_agreement_id != milestone_agreement_id:
                raise ValidationError(
                    {"linked_milestone": "Linked invoice and milestone must belong to the same agreement."}
                )
        if self.is_public and self.is_verified and self.moderation_status == self.MODERATION_PENDING:
            self.moderation_status = self.MODERATION_APPROVED
        if self.moderation_status == self.MODERATION_APPROVED and not self.published_at:
            self.published_at = timezone.now()
        if self.moderation_status != self.MODERATION_APPROVED:
            self.published_at = None

    def save(self, *args, **kwargs):
        if self.is_public and self.is_verified and self.moderation_status == self.MODERATION_PENDING:
            self.moderation_status = self.MODERATION_APPROVED
        if self.moderation_status == self.MODERATION_APPROVED:
            self.is_public = True
            if not self.published_at:
                self.published_at = timezone.now()
        elif self.moderation_status in {self.MODERATION_PENDING, self.MODERATION_HIDDEN, self.MODERATION_REJECTED}:
            self.is_public = False
            self.published_at = None
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.customer_name} ({self.rating}/5)"


class ContractorWebsite(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_PAUSED = "paused"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_PAUSED, "Paused"),
    ]

    TEMPLATE_STARTER = "starter"
    TEMPLATE_MODERN_TRADE = "modern_trade"
    TEMPLATE_PREMIUM_HOME = "premium_home"
    TEMPLATE_COMMERCIAL = "commercial"
    TEMPLATE_CHOICES = [
        (TEMPLATE_STARTER, "Starter"),
        (TEMPLATE_MODERN_TRADE, "Modern Trade"),
        (TEMPLATE_PREMIUM_HOME, "Premium Home"),
        (TEMPLATE_COMMERCIAL, "Commercial"),
    ]

    contractor = models.OneToOneField(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="website",
    )
    public_profile = models.OneToOneField(
        "projects.ContractorPublicProfile",
        on_delete=models.CASCADE,
        related_name="website",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    template_key = models.CharField(max_length=32, choices=TEMPLATE_CHOICES, default=TEMPLATE_STARTER)
    homepage_layout = models.JSONField(default=dict, blank=True)
    published_snapshot = models.JSONField(default=dict, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["contractor_id"]

    def __str__(self) -> str:
        return f"Website {self.contractor_id} ({self.status})"


class ContractorInsightsGoal(models.Model):
    METRIC_MONTHLY_REVENUE = "monthly_revenue"
    METRIC_ANNUAL_REVENUE = "annual_revenue"
    METRIC_PROJECTS_COMPLETED = "projects_completed"
    METRIC_AVERAGE_PROJECT_VALUE = "average_project_value"
    METRIC_ESTIMATE_ACCEPTANCE_RATE = "estimate_acceptance_rate"
    METRIC_CHOICES = [
        (METRIC_MONTHLY_REVENUE, "Monthly Revenue"),
        (METRIC_ANNUAL_REVENUE, "Annual Revenue"),
        (METRIC_PROJECTS_COMPLETED, "Projects Completed"),
        (METRIC_AVERAGE_PROJECT_VALUE, "Average Project Value"),
        (METRIC_ESTIMATE_ACCEPTANCE_RATE, "Estimate Acceptance Rate"),
    ]

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="insights_goals",
    )
    metric_type = models.CharField(max_length=64, choices=METRIC_CHOICES, db_index=True)
    name = models.CharField(max_length=160, blank=True, default="")
    target_value = models.DecimalField(max_digits=14, decimal_places=2)
    deadline = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_insights_goals",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_active", "deadline", "-updated_at"]

    def __str__(self) -> str:
        return self.name or self.get_metric_type_display()


class ContractorInsightsPreference(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="insights_preference",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="insights_preferences",
    )
    visible_widget_ids = models.JSONField(default=list, blank=True)
    view_preferences = models.JSONField(default=dict, blank=True)
    default_reporting_period = models.CharField(max_length=24, default="30", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["user_id"]

    def __str__(self) -> str:
        return f"Insights preferences for {self.user_id}"


class ContractorWebsitePage(models.Model):
    PAGE_HOME = "home"
    PAGE_SERVICES = "services"
    PAGE_GALLERY = "gallery"
    PAGE_REVIEWS = "reviews"
    PAGE_CONTACT = "contact"
    PAGE_CHOICES = [
        (PAGE_HOME, "Home"),
        (PAGE_SERVICES, "Services"),
        (PAGE_GALLERY, "Gallery"),
        (PAGE_REVIEWS, "Reviews"),
        (PAGE_CONTACT, "Contact"),
    ]

    website = models.ForeignKey(
        "projects.ContractorWebsite",
        on_delete=models.CASCADE,
        related_name="pages",
    )
    page_type = models.CharField(max_length=32, choices=PAGE_CHOICES, db_index=True)
    slug = models.SlugField(max_length=80)
    title = models.CharField(max_length=255, blank=True, default="")
    seo_title = models.CharField(max_length=255, blank=True, default="")
    seo_description = models.TextField(blank=True, default="")
    content_blocks = models.JSONField(default=dict, blank=True)
    is_published = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["website", "page_type"], name="uniq_website_page_type"),
            models.UniqueConstraint(fields=["website", "slug"], name="uniq_website_page_slug"),
        ]

    def __str__(self) -> str:
        return self.title or f"{self.website_id}:{self.page_type}"

    @property
    def ai_free_agreements_remaining(self) -> int:
        return 0

    def can_use_ai_agreement_writer(self) -> bool:
        return True


class Homeowner(models.Model):
    ACCOUNT_TYPE_INDIVIDUAL = "individual"
    ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY = "property_management_company"
    ACCOUNT_TYPE_CHOICES = [
        (ACCOUNT_TYPE_INDIVIDUAL, "Individual / Homeowner"),
        (ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY, "Property Management Company"),
    ]

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
    account_type = models.CharField(
        max_length=40,
        choices=ACCOUNT_TYPE_CHOICES,
        default=ACCOUNT_TYPE_INDIVIDUAL,
        db_index=True,
    )

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
    company_phone = models.CharField(max_length=40, blank=True, default="")
    company_email = models.EmailField(blank=True, default="")
    company_website = models.CharField(max_length=255, blank=True, default="")
    company_street = models.CharField(max_length=255, blank=True, default="")
    company_unit = models.CharField(max_length=255, blank=True, default="")
    company_city = models.CharField(max_length=100, blank=True, default="")
    company_state = models.CharField(max_length=50, blank=True, default="")
    company_zip = models.CharField(max_length=20, blank=True, default="")
    company_license_number = models.CharField(max_length=120, blank=True, default="")
    company_notes = models.TextField(blank=True, default="")

    status = models.CharField(
        max_length=20,
        choices=HomeownerStatus.choices,
        default=HomeownerStatus.ACTIVE,
        db_index=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # TODO CRM: Contractor customer rating should be private/internal CRM data,
    # not public review data. A future relationship profile can support 1-5
    # stars, tags, priority, and relationship notes without exposing them to
    # homeowners or public contractor profiles.

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


class CustomerCommunicationLog(models.Model):
    TYPE_INTERNAL_NOTE = "internal_note"
    TYPE_PHONE_CALL = "phone_call"
    TYPE_EMAIL = "email"
    TYPE_SMS = "sms"
    TYPE_IN_PERSON = "in_person"
    TYPE_OTHER = "other"
    COMMUNICATION_TYPE_CHOICES = [
        (TYPE_INTERNAL_NOTE, "Internal note"),
        (TYPE_PHONE_CALL, "Phone call"),
        (TYPE_EMAIL, "Email"),
        (TYPE_SMS, "SMS"),
        (TYPE_IN_PERSON, "In-person meeting"),
        (TYPE_OTHER, "Other"),
    ]

    DIRECTION_INTERNAL = "internal"
    DIRECTION_INBOUND = "inbound"
    DIRECTION_OUTBOUND = "outbound"
    DIRECTION_CHOICES = [
        (DIRECTION_INTERNAL, "Internal"),
        (DIRECTION_INBOUND, "Inbound"),
        (DIRECTION_OUTBOUND, "Outbound"),
    ]

    VISIBILITY_INTERNAL_ONLY = "internal_only"
    VISIBILITY_CUSTOMER_VISIBLE_FUTURE = "customer_visible_future"
    VISIBILITY_CHOICES = [
        (VISIBILITY_INTERNAL_ONLY, "Internal only"),
        (VISIBILITY_CUSTOMER_VISIBLE_FUTURE, "Customer visible future"),
    ]

    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name="customer_communication_logs")
    customer = models.ForeignKey(Homeowner, on_delete=models.CASCADE, related_name="communication_logs")
    communication_type = models.CharField(max_length=32, choices=COMMUNICATION_TYPE_CHOICES, default=TYPE_INTERNAL_NOTE, db_index=True)
    direction = models.CharField(max_length=16, choices=DIRECTION_CHOICES, default=DIRECTION_INTERNAL, db_index=True)
    subject = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField(blank=True, default="")
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    follow_up_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_communication_logs")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    visibility = models.CharField(max_length=32, choices=VISIBILITY_CHOICES, default=VISIBILITY_INTERNAL_ONLY, db_index=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "customer", "-occurred_at"]),
            models.Index(fields=["contractor", "follow_up_at"]),
        ]

    def __str__(self):
        return self.subject or self.get_communication_type_display()


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
    pricing_strategy = models.CharField(
        max_length=32,
        choices=[
            ("fixed", "I know my pricing"),
            ("estimate", "I will estimate and adjust later"),
            ("requires_sub_quote", "I need subcontractor pricing first"),
        ],
        default="fixed",
        db_index=True,
        help_text="High-level pricing approach for agreement creation and send validation.",
    )
    agreement_mode = models.CharField(
        max_length=24,
        choices=AgreementMode.choices,
        default=AgreementMode.STANDARD,
        db_index=True,
        help_text="Standard keeps one-time project behavior. Maintenance enables recurring-service support.",
    )
    project_mode = models.CharField(
        max_length=24,
        choices=AgreementProjectMode.choices,
        default=AgreementProjectMode.FULL_SERVICE,
        db_index=True,
        help_text="Defines whether the project is full-service, DIY assistance, consultation, or inspection-only.",
    )
    step_status = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="Lightweight wizard progress marker for resuming the agreement flow.",
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
    incidentals_reserve_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Optional escrow incidentals reserve configured separately from milestone totals.",
    )
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
    homeowner_participation_notes = models.TextField(blank=True, default="")
    homeowner_responsibilities = models.TextField(blank=True, default="")
    contractor_responsibilities = models.TextField(blank=True, default="")
    excluded_work = models.TextField(blank=True, default="")
    collaboration_summary_snapshot = models.JSONField(default=dict, blank=True)
    planning_assumptions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Advisory milestone planning snapshot captured from the Agreement Wizard. No assignments or schedules are created from this field.",
    )
    planning_validation_status = models.CharField(
        max_length=24,
        blank=True,
        default="",
        db_index=True,
        help_text="Internal advisory timeline validation status. Customer-facing portals must not expose this field.",
    )
    planning_validation_checked_at = models.DateTimeField(null=True, blank=True)
    planning_validation_summary = models.JSONField(default=dict, blank=True)
    planning_validation_acknowledged_at = models.DateTimeField(null=True, blank=True)
    planning_validation_acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="acknowledged_agreement_planning_validations",
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

    pdf_viewed = models.BooleanField(default=False)
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
            try:
                incidentals_amt = Decimal(str(self.incidentals_reserve_amount or "0"))
            except Exception:
                incidentals_amt = Decimal("0.00")
            if incidentals_amt > Decimal("0.00"):
                total_amt += incidentals_amt

            if total_amt > 0 and funded_amt >= total_amt:
                self.escrow_funded = True

                if self.status in (
                    ProjectStatus.DRAFT,
                    ProjectStatus.SIGNED,
                    ProjectStatus.FUNDED,
                ):
                    self.status = ProjectStatus.FUNDED
                if kwargs.get("update_fields") is not None:
                    kwargs["update_fields"] = set(kwargs["update_fields"]) | {"escrow_funded", "status"}

            elif self.signature_is_satisfied and self.status == ProjectStatus.DRAFT:
                self.status = ProjectStatus.SIGNED
                if kwargs.get("update_fields") is not None:
                    kwargs["update_fields"] = set(kwargs["update_fields"]) | {"status"}

        else:
            if self.signature_is_satisfied and self.status == ProjectStatus.DRAFT:
                self.status = ProjectStatus.SIGNED
                if kwargs.get("update_fields") is not None:
                    kwargs["update_fields"] = set(kwargs["update_fields"]) | {"status"}

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
    workmanship_duration_months = models.PositiveIntegerField(default=12)
    labor_duration_months = models.PositiveIntegerField(default=12)
    materials_duration_months = models.PositiveIntegerField(default=0)
    manufacturer_notes = models.TextField(blank=True, default="")
    covered_work = models.TextField(blank=True, default="")
    excluded_work = models.TextField(blank=True, default="")
    customer_responsibilities = models.TextField(blank=True, default="")
    contractor_responsibilities = models.TextField(blank=True, default="")
    response_time_expectations = models.TextField(blank=True, default="")
    generated_from_agreement_completion = models.BooleanField(default=False, db_index=True)
    completion_date = models.DateField(null=True, blank=True, db_index=True)
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
        if not self.covered_work and self.coverage_details:
            self.covered_work = self.coverage_details
        if not self.excluded_work and self.exclusions:
            self.excluded_work = self.exclusions
        if not self.coverage_details and self.covered_work:
            self.coverage_details = self.covered_work
        if not self.exclusions and self.excluded_work:
            self.exclusions = self.excluded_work

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
    milestone_role = models.CharField(
        max_length=32,
        choices=MilestoneRole.choices,
        blank=True,
        default="",
        db_index=True,
        help_text="Human-readable milestone role used for homeowner/contractor/shared/inspection workflow visibility.",
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

    completion_notes = models.TextField(blank=True, default="")
    inspection_status = models.CharField(
        max_length=40,
        choices=InspectionStatus.choices,
        blank=True,
        default=InspectionStatus.NOT_REQUESTED,
        db_index=True,
    )
    inspection_notes = models.TextField(blank=True, default="")
    inspection_requested_at = models.DateTimeField(null=True, blank=True)
    inspection_reviewed_at = models.DateTimeField(null=True, blank=True)
    inspection_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inspection_reviewed_milestones",
    )
    amendment_review_status = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="When set to pending, milestone completion/invoicing is blocked by an open amendment review.",
    )
    amendment_review_request = models.ForeignKey(
        "projects.AmendmentRequest",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="blocked_milestones",
        help_text="Open amendment request currently blocking this milestone.",
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
    EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED = "contractor_opportunity_received"
    EVENT_MARKETPLACE_VERIFICATION_APPROVED = "marketplace_verification_approved"
    EVENT_MARKETPLACE_VERIFICATION_REJECTED = "marketplace_verification_rejected"
    EVENT_MARKETPLACE_VERIFICATION_SUSPENDED = "marketplace_verification_suspended"
    EVENT_REIMBURSEMENT_SUBMITTED = "reimbursement_submitted"
    EVENT_REIMBURSEMENT_APPROVED = "reimbursement_approved"
    EVENT_REIMBURSEMENT_DENIED = "reimbursement_denied"
    EVENT_REIMBURSEMENT_RELEASED = "reimbursement_released"
    EVENT_REIMBURSEMENT_HELD = "reimbursement_held"
    EVENT_DISPUTE_OPENED = "dispute_opened"
    EVENT_DISPUTE_UPDATED = "dispute_updated"
    EVENT_DISPUTE_RESOLVED = "dispute_resolved"
    EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED = "maintenance_work_order_scheduled"
    EVENT_MAINTENANCE_WORK_ORDER_COMPLETED = "maintenance_work_order_completed"
    EVENT_MAINTENANCE_CONTRACT_CANCELLED = "maintenance_contract_cancelled"
    EVENT_QUOTE_REQUEST_RECEIVED = "quote_request_received"
    EVENT_AGREEMENT_SIGNED = "agreement_signed"
    EVENT_ESCROW_FUNDED = "escrow_funded"
    EVENT_INVOICE_APPROVED = "invoice_approved"
    EVENT_MILESTONE_PENDING_APPROVAL = "milestone_pending_approval"
    EVENT_PAYMENT_RELEASED = "payment_released"

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
        (EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED, "Contractor Opportunity Received"),
        (EVENT_MARKETPLACE_VERIFICATION_APPROVED, "Marketplace Verification Approved"),
        (EVENT_MARKETPLACE_VERIFICATION_REJECTED, "Marketplace Verification Rejected"),
        (EVENT_MARKETPLACE_VERIFICATION_SUSPENDED, "Marketplace Verification Suspended"),
        (EVENT_REIMBURSEMENT_SUBMITTED, "Reimbursement Submitted"),
        (EVENT_REIMBURSEMENT_APPROVED, "Reimbursement Approved"),
        (EVENT_REIMBURSEMENT_DENIED, "Reimbursement Denied"),
        (EVENT_REIMBURSEMENT_RELEASED, "Reimbursement Released"),
        (EVENT_REIMBURSEMENT_HELD, "Reimbursement Held"),
        (EVENT_DISPUTE_OPENED, "Dispute Opened"),
        (EVENT_DISPUTE_UPDATED, "Dispute Updated"),
        (EVENT_DISPUTE_RESOLVED, "Dispute Resolved"),
        (EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED, "Maintenance Work Order Scheduled"),
        (EVENT_MAINTENANCE_WORK_ORDER_COMPLETED, "Maintenance Work Order Completed"),
        (EVENT_MAINTENANCE_CONTRACT_CANCELLED, "Maintenance Contract Cancelled"),
        (EVENT_QUOTE_REQUEST_RECEIVED, "Quote Request Received"),
        (EVENT_AGREEMENT_SIGNED, "Agreement Signed"),
        (EVENT_ESCROW_FUNDED, "Escrow Funded"),
        (EVENT_INVOICE_APPROVED, "Invoice Approved"),
        (EVENT_MILESTONE_PENDING_APPROVAL, "Milestone Pending Approval"),
        (EVENT_PAYMENT_RELEASED, "Payment Released"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    category = models.CharField(max_length=64, blank=True, default="", db_index=True)
    link = models.CharField(max_length=500, blank=True, default="")
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
    invoice = models.ForeignKey(
        "projects.Invoice",
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
        recipient = getattr(self.user, "email", None) or self.contractor_id or "notification"
        return f"{recipient}:{self.event_type}:{self.title}"


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
    COST_BASIS_HOURLY = "hourly"
    COST_BASIS_SALARY = "salary"

    ROLE_CHOICES = (
        (ROLE_EMPLOYEE_READONLY, "Read-only employee"),
        (ROLE_EMPLOYEE_MILESTONES, "Milestones employee"),
        (ROLE_EMPLOYEE_SUPERVISOR, "Supervisor / Foreman"),
    )
    COST_BASIS_CHOICES = (
        (COST_BASIS_HOURLY, "Hourly"),
        (COST_BASIS_SALARY, "Salary"),
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
    setup_sent_at = models.DateTimeField(null=True, blank=True)
    setup_completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    notes = models.TextField(blank=True)
    cost_basis = models.CharField(
        max_length=16,
        choices=COST_BASIS_CHOICES,
        default=COST_BASIS_HOURLY,
    )
    hourly_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    annual_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    standard_hours_per_week = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    overtime_multiplier = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    labor_cost_notes = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Contractor Sub-Account"
        verbose_name_plural = "Contractor Sub-Accounts"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.display_name} ({self.get_role_display()}) for {self.parent_contractor}"

    @property
    def calculated_effective_hourly_cost(self):
        if self.cost_basis == self.COST_BASIS_SALARY:
            if not self.annual_salary or not self.standard_hours_per_week:
                return None
            annual_hours = self.standard_hours_per_week * 52
            if annual_hours <= 0:
                return None
            return self.annual_salary / annual_hours
        return self.hourly_cost


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


class EmployeeCapability(models.Model):
    subaccount = models.ForeignKey(
        ContractorSubAccount,
        on_delete=models.CASCADE,
        related_name="capabilities",
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.PROTECT,
        related_name="employee_capabilities",
    )
    skill_level = models.CharField(
        max_length=24,
        choices=EmployeeSkillLevel.choices,
        default=EmployeeSkillLevel.WORKING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["skill__name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["subaccount", "skill"],
                name="unique_employee_capability_per_skill",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.subaccount_id}: {self.skill.name} ({self.get_skill_level_display()})"


class CrewAssignmentDraft(models.Model):
    SOURCE_OPPORTUNITY = "opportunity"
    SOURCE_AGREEMENT = "agreement"
    SOURCE_TYPE_CHOICES = [
        (SOURCE_OPPORTUNITY, "Opportunity"),
        (SOURCE_AGREEMENT, "Agreement"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_APPLIED = "applied"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_APPLIED, "Applied"),
    ]

    contractor = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="crew_assignment_drafts",
    )
    source_type = models.CharField(max_length=24, choices=SOURCE_TYPE_CHOICES, db_index=True)
    source_opportunity = models.ForeignKey(
        ContractorOpportunity,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="crew_assignment_drafts",
    )
    source_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="crew_assignment_drafts",
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    preview_snapshot = models.JSONField(default=dict, blank=True)
    assignment_plan = models.JSONField(default=dict, blank=True)
    apply_enabled = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_crew_assignment_drafts",
    )
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="applied_crew_assignment_drafts",
    )
    applied_at = models.DateTimeField(null=True, blank=True)
    apply_result = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["contractor", "source_type", "status"]),
            models.Index(fields=["contractor", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"CrewAssignmentDraft({self.source_type}={self.source_opportunity_id or self.source_agreement_id})"


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
from .models_warranty import WarrantyRequest, WarrantyRequestEvidence, WarrantyRequestStatusHistory, WarrantyWorkOrder  # noqa: E402,F401
from .models_expense_request import ExpenseRequest  # noqa: E402,F401
from .models_templates import ProjectTemplate, ProjectTemplateMilestone, SeedBenchmarkProfile  # noqa: E402,F401
from .models_customer_portal import (  # noqa: E402,F401
    CustomerRequest,
    CustomerPortalUploadSession,
    NotificationLog,
    NotificationRule,
    PropertyDocument,
    PropertyDocumentExtraction,
    PropertyHomeSystem,
    PropertyHomeSystemRecommendationPreference,
    PropertyIntelligenceRecord,
    PropertyIntelligenceSnapshot,
    PropertyManagementCompany,
    PropertyManagementStaffMembership,
    PropertyOwnerContact,
    PropertyOwnership,
    PropertyVendor,
    PropertyWorkOrderRecipientInvitation,
    PropertyWorkOrderActivity,
    PropertyWorkOrderAttachment,
    PropertyWorkOrder,
    PropertyPhoto,
    PropertyProfile,
    PropertyUnit,
    SmartNotification,
    SmartNotificationEvent,
    Tenant,
    TenantMaintenanceRequestAttachment,
    TenantMaintenanceRequest,
    Tenancy,
)
from .models_amendment_request import AmendmentRequest, AmendmentRequestAttachment  # noqa: E402,F401
from .models_customer_refund_request import CustomerRefundRequest  # noqa: E402,F401
from .models_project_activity import ProjectActivityEvent  # noqa: E402,F401
from .models_learning import (
    AgreementDraftIntelligenceSnapshot,
    ContractorEditEvent,
    MilestonePerformanceSnapshot,
    SignedAgreementSnapshot,
    ProjectOutcomeSnapshot,
    ContractorBenchmarkAggregate,
    AgreementOutcomeSnapshot,
    AgreementOutcomeMilestoneSnapshot,
    AgreementProposalSnapshot,
    RegionalBenchmarkAggregate,
    MilestoneBenchmarkAggregate,
    ProjectBenchmarkAggregate,
)  # noqa: E402,F401
from .models_compliance import (
    StateTradeLicenseRequirement,
    ContractorComplianceRecord,
)  # noqa: E402,F401
from .models_support import SupportMessage, SupportTicket, SupportTicketMessage  # noqa: E402,F401
from .models_maintenance import MaintenanceWorkOrder, MaintenanceWorkOrderAttachment  # noqa: E402,F401
