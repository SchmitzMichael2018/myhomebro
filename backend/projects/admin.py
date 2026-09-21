from __future__ import annotations

from django.contrib import admin, messages
from django.utils import timezone

# ─────────────────────────────────────────────────────────────
# Safe model imports (admin must not block migrations)
# If models are mid-change during makemigrations/migrate, we skip registration.
# ─────────────────────────────────────────────────────────────
try:
    from .models import (
        Skill,
        Contractor,
        CrewAssignmentDraft,
        EmployeeCapability,
        Homeowner,
        Project,
        Agreement,
        AgreementWarranty,
        ContractorGalleryItem,
        ContractorPublicProfile,
        ContractorReview,
        Milestone,
        MilestoneFile,
        MilestoneComment,
        PublicContractorLead,
        Invoice,
        Expense,
        AgreementAmendment,
        ContractorEditEvent,
        MilestonePerformanceSnapshot,
        SignedAgreementSnapshot,
        ProjectOutcomeSnapshot,
        ContractorBenchmarkAggregate,
        AgreementOutcomeSnapshot,
        AgreementOutcomeMilestoneSnapshot,
        MilestoneBenchmarkAggregate,
        ProjectBenchmarkAggregate,
        RegionalBenchmarkAggregate,
        SupportTicket,
        PlatformFeePromotionAuditEvent,
        PlatformFeePromotionGrant,
    )
except Exception:  # pragma: no cover
    Skill = Contractor = Homeowner = Project = Agreement = AgreementWarranty = None
    CrewAssignmentDraft = None
    EmployeeCapability = None
    ContractorGalleryItem = ContractorPublicProfile = ContractorReview = None
    Milestone = MilestoneFile = MilestoneComment = None
    PublicContractorLead = None
    Invoice = Expense = AgreementAmendment = None
    ContractorEditEvent = MilestonePerformanceSnapshot = SignedAgreementSnapshot = ProjectOutcomeSnapshot = ContractorBenchmarkAggregate = AgreementOutcomeSnapshot = AgreementOutcomeMilestoneSnapshot = MilestoneBenchmarkAggregate = ProjectBenchmarkAggregate = RegionalBenchmarkAggregate = None
    SupportTicket = None
    PlatformFeePromotionAuditEvent = PlatformFeePromotionGrant = None

try:
    from .models_warranty import (
        WarrantyRequest,
        WarrantyRequestEvidence,
        WarrantyRequestStatusHistory,
        WarrantyWorkOrder,
    )
except Exception:  # pragma: no cover
    WarrantyRequest = WarrantyRequestEvidence = WarrantyRequestStatusHistory = WarrantyWorkOrder = None

# Optional/independent models (guarded with try so admin doesn’t break)
try:
    from .models_dispute import (  # type: ignore
        Dispute,
        DisputeAttachment,
        DisputeEscrowAllocation,
        DisputeEscrowAllocationAttempt,
        DisputeEscrowAllocationSource,
        ResolutionAgreement,
        ResolutionAgreementSignature,
        ResolutionCaseAuditEvent,
        ResolutionCaseTimelineEvent,
        ResolutionDocument,
        ResolutionEvidenceIndex,
        ResolutionPartyStatement,
        ResolutionProposal,
    )
except Exception:  # pragma: no cover
    Dispute = None
    DisputeAttachment = DisputeEscrowAllocation = DisputeEscrowAllocationAttempt = DisputeEscrowAllocationSource = None
    ResolutionAgreement = ResolutionAgreementSignature = ResolutionCaseAuditEvent = ResolutionCaseTimelineEvent = None
    ResolutionDocument = ResolutionEvidenceIndex = ResolutionPartyStatement = ResolutionProposal = None

try:
    from .models_attachments import AgreementAttachment  # type: ignore
except Exception:  # pragma: no cover
    AgreementAttachment = None  # type: ignore

try:
    from .models_contractor_discovery import ContractorEstimateAvailabilityWindow, OpportunityEstimateAppointment  # type: ignore
except Exception:  # pragma: no cover
    ContractorEstimateAvailabilityWindow = None  # type: ignore
    OpportunityEstimateAppointment = None  # type: ignore

try:
    from .models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement  # type: ignore
except Exception:  # pragma: no cover
    Proposal = ProposalActivity = ProposalAttachment = ProposalLineItem = ProposalMeasurement = None  # type: ignore

try:
    from .models_ai_artifacts import DisputeAIArtifact  # type: ignore
except Exception:  # pragma: no cover
    DisputeAIArtifact = None  # type: ignore

# ✅ Template + pricing intelligence models (guarded)
try:
    from .models_templates import (  # <-- corrected import
        ProjectTemplate,
        ProjectTemplateMilestone,
        ProjectTemplatePublicSlug,
        SeedBenchmarkProfile,
        MarketPricingBaseline,
        PricingObservation,
        PricingStatistic,
    )
except Exception:  # pragma: no cover
    ProjectTemplate = None  # type: ignore
    ProjectTemplateMilestone = None  # type: ignore
    ProjectTemplatePublicSlug = None  # type: ignore
    SeedBenchmarkProfile = None  # type: ignore
    MarketPricingBaseline = None  # type: ignore
    PricingObservation = None  # type: ignore
    PricingStatistic = None  # type: ignore

try:
    from .models_compliance import (  # type: ignore
        ContractorComplianceRecord,
        StateTradeLicenseRequirement,
    )
except Exception:  # pragma: no cover
    ContractorComplianceRecord = None  # type: ignore
    StateTradeLicenseRequirement = None  # type: ignore

# ✅ NEW: Project Intake model (guarded)
try:
    from .models_project_intake import ProjectIntake  # type: ignore
except Exception:  # pragma: no cover
    ProjectIntake = None  # type: ignore

try:
    from .models_customer_portal import (  # type: ignore
        CustomerRequest,
        NotificationLog,
        NotificationRule,
        PropertyDocument,
        PropertyHomeSystem,
        PropertyManagementCompany,
        PropertyManagementStaffMembership,
        PropertyOwnerContact,
        PropertyOwnership,
        PropertyVendor,
        PropertyWorkOrderActivity,
        PropertyWorkOrderAttachment,
        PropertyWorkOrder,
        PropertyPhoto,
        PropertyProfile,
        PropertyUnit,
        SmartNotification,
        Tenant,
        TenantMaintenanceRequest,
        TenantMaintenanceRequestAttachment,
        Tenancy,
    )
except Exception:  # pragma: no cover
    CustomerRequest = NotificationLog = NotificationRule = PropertyDocument = PropertyHomeSystem = PropertyPhoto = PropertyProfile = SmartNotification = None  # type: ignore
    PropertyManagementCompany = PropertyManagementStaffMembership = PropertyOwnerContact = PropertyOwnership = PropertyVendor = PropertyWorkOrder = PropertyWorkOrderActivity = PropertyWorkOrderAttachment = PropertyUnit = None  # type: ignore
    Tenant = TenantMaintenanceRequest = TenantMaintenanceRequestAttachment = Tenancy = None  # type: ignore

try:
    from .models_sms import DeferredSMSAutomation, SMSAutomationDecision, SMSConsent  # type: ignore
except Exception:  # pragma: no cover
    DeferredSMSAutomation = None  # type: ignore
    SMSAutomationDecision = None  # type: ignore
    SMSConsent = None  # type: ignore

# Optional services used by admin actions (guarded)
try:
    from projects.services.mailer import email_signed_agreement  # type: ignore  # pragma: no cover
except Exception:  # pragma: no cover
    def email_signed_agreement(*_a, **_k):
        return False


# ─────────────────────────────────────────────────────────────
# Skill
# ─────────────────────────────────────────────────────────────
if Skill is not None:
    @admin.register(Skill)
    class SkillAdmin(admin.ModelAdmin):
        list_display = ("id", "name", "slug")
        search_fields = ("name", "slug")
        ordering = ("name",)


# ─────────────────────────────────────────────────────────────
if EmployeeCapability is not None:
    @admin.register(EmployeeCapability)
    class EmployeeCapabilityAdmin(admin.ModelAdmin):
        list_display = ("id", "subaccount", "skill", "skill_level", "updated_at")
        list_filter = ("skill", "skill_level")
        search_fields = ("subaccount__display_name", "subaccount__user__email", "skill__name", "skill__slug")
        ordering = ("subaccount__display_name", "skill__name")


if CrewAssignmentDraft is not None:
    @admin.register(CrewAssignmentDraft)
    class CrewAssignmentDraftAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "source_type", "status", "apply_enabled", "created_at")
        list_filter = ("source_type", "status", "apply_enabled")
        search_fields = ("contractor__business_name", "contractor__user__email")
        readonly_fields = ("preview_snapshot", "assignment_plan", "created_at", "updated_at")
        ordering = ("-created_at", "-id")


# Contractor
# ─────────────────────────────────────────────────────────────
if Contractor is not None:
    @admin.register(Contractor)
    class ContractorAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "business_name",
            "is_active",
            "name",
            "email",
            "phone",
            "get_city",
            "get_state",
            "stripe_account_id",
            "charges_enabled",
            "payouts_enabled",
            "details_submitted",
            "created_at",
        )
        search_fields = (
            "business_name",
            "user__email",
            "phone",
            "license_number",
            "stripe_account_id",
        )
        list_filter = ("is_active", "charges_enabled", "payouts_enabled", "details_submitted")
        readonly_fields = ("created_at", "updated_at", "deactivated_at")

        def get_city(self, obj):
            return getattr(obj, "city", "")
        get_city.short_description = "City"

        def get_state(self, obj):
            return getattr(obj, "state", "")
        get_state.short_description = "State"


if ContractorPublicProfile is not None:
    @admin.register(ContractorPublicProfile)
    class ContractorPublicProfileAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "slug", "is_public", "allow_public_intake", "allow_public_reviews", "updated_at")
        search_fields = ("slug", "business_name_public", "contractor__business_name", "contractor__user__email")
        list_filter = ("is_public", "allow_public_intake", "allow_public_reviews")
        readonly_fields = ("created_at", "updated_at")


if ContractorGalleryItem is not None:
    @admin.register(ContractorGalleryItem)
    class ContractorGalleryItemAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "title", "category", "is_featured", "is_public", "sort_order", "created_at")
        search_fields = ("title", "description", "category", "contractor__business_name")
        list_filter = ("is_featured", "is_public", "category")


if PublicContractorLead is not None:
    @admin.register(PublicContractorLead)
    class PublicContractorLeadAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "full_name", "email", "phone", "status", "source", "created_at")
        search_fields = ("full_name", "email", "phone", "project_description", "contractor__business_name")
        list_filter = ("status", "source")
        readonly_fields = ("created_at", "updated_at")


if ContractorReview is not None:
    @admin.register(ContractorReview)
    class ContractorReviewAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "customer_name", "customer_email", "rating", "moderation_status", "is_verified", "is_public", "submitted_at", "published_at")
        search_fields = ("customer_name", "customer_email", "title", "review_text", "contractor__business_name")
        list_filter = ("moderation_status", "is_verified", "is_public", "rating")


# ─────────────────────────────────────────────────────────────
# Homeowner
# ─────────────────────────────────────────────────────────────
if Homeowner is not None:
    @admin.register(Homeowner)
    class HomeownerAdmin(admin.ModelAdmin):
        list_display = ("id", "full_name", "email", "phone_number", "status", "city", "state", "created_at")
        search_fields = ("full_name", "email", "phone_number", "street_address", "city", "state", "zip_code")
        list_filter = ("status",)
        readonly_fields = ("created_at", "updated_at")


if SMSConsent is not None:
    @admin.register(SMSConsent)
    class SMSConsentAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "phone_number_e164",
            "contractor",
            "homeowner",
            "can_send_sms",
            "opted_out",
            "opted_in_source",
            "opted_in_at",
            "opted_out_at",
            "consent_source_page",
            "updated_at",
        )
        search_fields = ("phone_number_e164", "contractor__business_name", "homeowner__full_name", "homeowner__email")
        list_filter = ("can_send_sms", "opted_out", "opted_in_source", "opted_out_source")
        readonly_fields = ("created_at", "updated_at")


if SMSAutomationDecision is not None:
    @admin.register(SMSAutomationDecision)
    class SMSAutomationDecisionAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "event_type",
            "phone_number_e164",
            "channel_decision",
            "priority",
            "reason_code",
            "sent",
            "duplicate_suppressed",
            "twilio_message_sid",
            "created_at",
        )
        search_fields = ("phone_number_e164", "agreement__id", "invoice__invoice_number", "milestone__title", "reason_code", "template_key")
        list_filter = ("should_send", "channel_decision", "priority", "reason_code", "template_key", "sent", "deferred")
        readonly_fields = (
            "event_type",
            "phone_number_e164",
            "contractor",
            "homeowner",
            "agreement",
            "invoice",
            "milestone",
            "should_send",
            "channel_decision",
            "reason_code",
            "priority",
            "template_key",
            "intent_key",
            "intent_summary",
            "message_preview",
            "cooldown_applied",
            "duplicate_suppressed",
            "sent",
            "deferred",
            "sms_consent_snapshot_json",
            "decision_context_json",
            "twilio_message_sid",
            "created_at",
        )


if DeferredSMSAutomation is not None:
    @admin.register(DeferredSMSAutomation)
    class DeferredSMSAutomationAdmin(admin.ModelAdmin):
        list_display = ("id", "event_type", "phone_number_e164", "status", "scheduled_for", "created_at")
        search_fields = ("phone_number_e164", "template_key", "event_type", "agreement__id")
        list_filter = ("status", "event_type", "template_key")
        readonly_fields = ("created_at", "updated_at")


# ─────────────────────────────────────────────────────────────
# Project Intake
# ─────────────────────────────────────────────────────────────
if OpportunityEstimateAppointment is not None:
    @admin.register(OpportunityEstimateAppointment)
    class OpportunityEstimateAppointmentAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "contractor",
            "source_type",
            "status",
            "requested_by",
            "appointment_type",
            "scheduled_start",
            "duration_minutes",
            "customer_name",
        )
        list_filter = ("status", "requested_by", "appointment_type", "source_type", "scheduled_start")
        search_fields = ("customer_name", "customer_email", "customer_phone", "opportunity_title", "opportunity_reference")
        readonly_fields = (
            "source_type", "public_lead", "project_intake", "contractor_opportunity",
            "direct_proposal", "created_at", "updated_at",
        )


if ContractorEstimateAvailabilityWindow is not None:
    @admin.register(ContractorEstimateAvailabilityWindow)
    class ContractorEstimateAvailabilityWindowAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "weekday", "start_time", "end_time", "timezone", "appointment_type", "duration_minutes", "is_active")
        list_filter = ("is_active", "weekday", "appointment_type", "timezone")
        search_fields = ("contractor__business_name", "contractor__user__email", "notes")
        readonly_fields = ("created_at", "updated_at")


if Proposal is not None:
    @admin.register(Proposal)
    class ProposalAdmin(admin.ModelAdmin):
        list_display = ("id", "contractor", "project_title", "status", "source_type", "source_id", "customer_name", "updated_at")
        list_filter = ("status", "source_type", "created_at", "updated_at")
        search_fields = ("project_title", "customer_name", "customer_email", "customer_phone", "service_location")
        readonly_fields = ("estimate_appointment", "created_at", "updated_at")


if ProposalMeasurement is not None:
    @admin.register(ProposalMeasurement)
    class ProposalMeasurementAdmin(admin.ModelAdmin):
        list_display = ("id", "proposal", "label", "location", "quantity", "unit", "updated_at")
        search_fields = ("label", "location", "notes", "proposal__project_title")
        readonly_fields = ("created_at", "updated_at")


if ProposalLineItem is not None:
    @admin.register(ProposalLineItem)
    class ProposalLineItemAdmin(admin.ModelAdmin):
        list_display = ("id", "proposal", "category", "description", "quantity", "unit_price", "total", "updated_at")
        list_filter = ("category", "created_at", "updated_at")
        search_fields = ("description", "notes", "proposal__project_title")
        readonly_fields = ("total", "created_at", "updated_at")


if ProposalAttachment is not None:
    @admin.register(ProposalAttachment)
    class ProposalAttachmentAdmin(admin.ModelAdmin):
        list_display = ("id", "proposal", "attachment_type", "category", "original_name", "created_at")
        list_filter = ("attachment_type", "category", "created_at")
        search_fields = ("original_name", "caption", "notes", "proposal__project_title")
        readonly_fields = ("created_at", "updated_at")


if ProposalActivity is not None:
    @admin.register(ProposalActivity)
    class ProposalActivityAdmin(admin.ModelAdmin):
        list_display = ("id", "proposal", "event_type", "message", "created_at")
        list_filter = ("event_type", "created_at")
        search_fields = ("message", "proposal__project_title")
        readonly_fields = ("created_at",)


if ProjectIntake is not None:
    @admin.register(ProjectIntake)
    class ProjectIntakeAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "customer_name",
            "customer_email",
            "initiated_by",
            "status",
            "homeowner",
            "agreement",
            "same_as_customer_address",
            "created_at",
            "updated_at",
        )
        list_filter = (
            "initiated_by",
            "status",
            "same_as_customer_address",
            "created_at",
            "updated_at",
        )
        search_fields = (
            "customer_name",
            "customer_email",
            "customer_phone",
            "accomplishment_text",
            "ai_project_title",
            "ai_project_type",
            "ai_project_subtype",
            "homeowner__full_name",
            "homeowner__email",
        )
        readonly_fields = (
            "submitted_at",
            "analyzed_at",
            "converted_at",
            "created_at",
            "updated_at",
        )

        fieldsets = (
            (
                "Workflow",
                {
                    "fields": (
                        "contractor",
                        "homeowner",
                        "agreement",
                        "initiated_by",
                        "status",
                    )
                },
            ),
            (
                "Customer Information",
                {
                    "fields": (
                        "customer_name",
                        "customer_email",
                        "customer_phone",
                    )
                },
            ),
            (
                "Customer Address",
                {
                    "fields": (
                        "customer_address_line1",
                        "customer_address_line2",
                        "customer_city",
                        "customer_state",
                        "customer_postal_code",
                    )
                },
            ),
            (
                "Project Address",
                {
                    "fields": (
                        "same_as_customer_address",
                        "project_address_line1",
                        "project_address_line2",
                        "project_city",
                        "project_state",
                        "project_postal_code",
                    )
                },
            ),
            (
                "Intake Request",
                {
                    "fields": (
                        "accomplishment_text",
                    )
                },
            ),
            (
                "AI Recommendation",
                {
                    "fields": (
                        "ai_project_title",
                        "ai_project_type",
                        "ai_project_subtype",
                        "ai_description",
                        "ai_recommended_template_id",
                        "ai_recommendation_confidence",
                        "ai_recommendation_reason",
                    )
                },
            ),
            (
                "AI Generated Structure",
                {
                    "fields": (
                        "ai_milestones",
                        "ai_clarification_questions",
                        "ai_analysis_payload",
                    )
                },
            ),
            (
                "Timestamps",
                {
                    "fields": (
                        "submitted_at",
                        "analyzed_at",
                        "converted_at",
                        "created_at",
                        "updated_at",
                    )
                },
            ),
        )


# ─────────────────────────────────────────────────────────────
# Project
# ─────────────────────────────────────────────────────────────
if PropertyProfile is not None:
    @admin.register(PropertyProfile)
    class PropertyProfileAdmin(admin.ModelAdmin):
        list_display = ("customer_email", "display_name", "property_type", "managed_by_company", "city", "state", "updated_at")
        search_fields = ("customer_email", "display_name", "address_line1", "city", "state", "managed_by_company__name")
        list_filter = ("property_type", "state", "managed_by_company")


if PropertyManagementCompany is not None:
    @admin.register(PropertyManagementCompany)
    class PropertyManagementCompanyAdmin(admin.ModelAdmin):
        list_display = ("id", "name", "homeowner", "email", "phone", "city", "state", "is_active", "updated_at")
        search_fields = ("name", "email", "phone", "license_number", "homeowner__full_name", "homeowner__email")
        list_filter = ("is_active", "state")
        readonly_fields = ("created_at", "updated_at")


if PropertyManagementStaffMembership is not None:
    @admin.register(PropertyManagementStaffMembership)
    class PropertyManagementStaffMembershipAdmin(admin.ModelAdmin):
        list_display = ("id", "company", "name", "email", "role", "status", "updated_at")
        search_fields = ("company__name", "name", "email", "phone", "user__email")
        list_filter = ("role", "status", "company")
        readonly_fields = ("created_at", "updated_at")


if PropertyVendor is not None:
    @admin.register(PropertyVendor)
    class PropertyVendorAdmin(admin.ModelAdmin):
        list_display = ("id", "property_management_company", "name", "trade_category", "email", "phone", "status", "updated_at")
        search_fields = ("property_management_company__name", "name", "trade_category", "email", "phone", "website")
        list_filter = ("status", "trade_category", "property_management_company")
        readonly_fields = ("created_at", "updated_at")


if PropertyOwnerContact is not None:
    @admin.register(PropertyOwnerContact)
    class PropertyOwnerContactAdmin(admin.ModelAdmin):
        list_display = ("id", "name", "company", "email", "phone", "updated_at")
        search_fields = ("name", "email", "phone", "mailing_address", "company__name")
        list_filter = ("company",)
        readonly_fields = ("created_at", "updated_at")


if PropertyOwnership is not None:
    @admin.register(PropertyOwnership)
    class PropertyOwnershipAdmin(admin.ModelAdmin):
        list_display = ("id", "property_profile", "owner_contact", "ownership_type", "is_primary", "updated_at")
        search_fields = ("property_profile__display_name", "property_profile__customer_email", "owner_contact__name", "owner_contact__email")
        list_filter = ("ownership_type", "is_primary")
        readonly_fields = ("created_at", "updated_at")


if PropertyUnit is not None:
    @admin.register(PropertyUnit)
    class PropertyUnitAdmin(admin.ModelAdmin):
        list_display = ("id", "property_profile", "unit_label", "unit_type", "status", "updated_at")
        search_fields = ("property_profile__display_name", "property_profile__customer_email", "unit_label", "access_notes")
        list_filter = ("unit_type", "status")
        readonly_fields = ("created_at", "updated_at")


if Tenant is not None:
    @admin.register(Tenant)
    class TenantAdmin(admin.ModelAdmin):
        list_display = ("id", "display_name", "company", "email", "phone", "status", "maintenance_access_enabled", "portal_enabled", "updated_at")
        search_fields = ("first_name", "last_name", "email", "phone", "company__name")
        list_filter = ("status", "maintenance_access_enabled", "portal_enabled", "company")
        readonly_fields = ("created_at", "updated_at")


if Tenancy is not None:
    @admin.register(Tenancy)
    class TenancyAdmin(admin.ModelAdmin):
        list_display = ("id", "tenant", "property_profile", "unit", "status", "move_in_date", "move_out_date", "updated_at")
        search_fields = ("tenant__first_name", "tenant__last_name", "tenant__email", "property_profile__display_name", "unit__unit_label")
        list_filter = ("status", "property_profile", "unit")
        readonly_fields = ("created_at", "updated_at")


if TenantMaintenanceRequest is not None:
    @admin.register(TenantMaintenanceRequest)
    class TenantMaintenanceRequestAdmin(admin.ModelAdmin):
        list_display = ("id", "title", "property_profile", "unit", "submitted_by_name", "urgency", "status", "created_at")
        search_fields = ("title", "description", "submitted_by_name", "submitted_by_email", "submitted_by_phone", "property_profile__display_name", "unit__unit_label")
        list_filter = ("status", "urgency", "category", "property_profile")
        readonly_fields = ("created_at", "updated_at", "reviewed_at")


if TenantMaintenanceRequestAttachment is not None:
    @admin.register(TenantMaintenanceRequestAttachment)
    class TenantMaintenanceRequestAttachmentAdmin(admin.ModelAdmin):
        list_display = ("id", "tenant_request", "original_filename", "content_type", "size_bytes", "created_at")
        search_fields = ("original_filename", "content_type", "uploaded_by_name", "uploaded_by_email", "tenant_request__title")
        list_filter = ("content_type",)
        readonly_fields = ("created_at",)


if PropertyWorkOrder is not None:
    @admin.register(PropertyWorkOrder)
    class PropertyWorkOrderAdmin(admin.ModelAdmin):
        list_display = ("id", "work_order_number", "title", "property_management_company", "property_profile", "unit", "assignment_type", "assigned_staff_member", "assigned_vendor", "priority", "status", "scheduled_for", "created_at")
        search_fields = ("work_order_number", "title", "description", "property_profile__display_name", "tenant__first_name", "tenant__last_name", "assigned_vendor__name")
        list_filter = ("status", "priority", "category", "assignment_type", "created_at")
        readonly_fields = ("work_order_number", "created_at", "updated_at")


if PropertyWorkOrderActivity is not None:
    @admin.register(PropertyWorkOrderActivity)
    class PropertyWorkOrderActivityAdmin(admin.ModelAdmin):
        list_display = ("id", "work_order", "activity_type", "actor", "created_at")
        search_fields = ("work_order__work_order_number", "work_order__title", "message", "actor")
        list_filter = ("activity_type", "created_at")
        readonly_fields = ("created_at",)


if PropertyWorkOrderAttachment is not None:
    @admin.register(PropertyWorkOrderAttachment)
    class PropertyWorkOrderAttachmentAdmin(admin.ModelAdmin):
        list_display = ("id", "work_order", "original_filename", "attachment_type", "content_type", "size_bytes", "created_at")
        search_fields = ("work_order__work_order_number", "work_order__title", "original_filename", "uploaded_by")
        list_filter = ("attachment_type", "content_type", "created_at")
        readonly_fields = ("created_at",)


if CustomerRequest is not None:
    @admin.register(CustomerRequest)
    class CustomerRequestAdmin(admin.ModelAdmin):
        list_display = ("title", "customer_email", "request_type", "status", "urgency", "created_at")
        search_fields = ("title", "customer_email", "description", "address_line1", "city")
        list_filter = ("request_type", "status", "urgency")


if PropertyDocument is not None:
    @admin.register(PropertyDocument)
    class PropertyDocumentAdmin(admin.ModelAdmin):
        list_display = ("title", "property_profile", "document_type", "uploaded_at")
        search_fields = ("title", "document_type", "property_profile__customer_email")


if PropertyHomeSystem is not None:
    @admin.register(PropertyHomeSystem)
    class PropertyHomeSystemAdmin(admin.ModelAdmin):
        list_display = ("display_name", "property_profile", "system_type", "condition", "warranty_expiration_date", "is_archived", "updated_at")
        search_fields = ("custom_name", "manufacturer", "model_number", "serial_number", "property_profile__customer_email")
        list_filter = ("system_type", "condition", "is_archived")
        filter_horizontal = ("linked_documents",)


if PropertyPhoto is not None:
    @admin.register(PropertyPhoto)
    class PropertyPhotoAdmin(admin.ModelAdmin):
        list_display = ("title", "property_profile", "uploaded_at")
        search_fields = ("title", "property_profile__customer_email")


if NotificationRule is not None:
    @admin.register(NotificationRule)
    class NotificationRuleAdmin(admin.ModelAdmin):
        list_display = ("name", "event_type", "channel", "audience", "is_active", "updated_at")
        search_fields = ("name", "event_type", "title_template", "message_template")
        list_filter = ("event_type", "channel", "audience", "is_active")


if SmartNotification is not None:
    @admin.register(SmartNotification)
    class SmartNotificationAdmin(admin.ModelAdmin):
        list_display = ("title", "recipient_email", "event_type", "channel", "status", "created_at")
        search_fields = ("title", "recipient_email", "message")
        list_filter = ("event_type", "channel", "status")
        readonly_fields = ("created_at", "read_at")


if NotificationLog is not None:
    @admin.register(NotificationLog)
    class NotificationLogAdmin(admin.ModelAdmin):
        list_display = ("event_type", "channel", "status", "recipient_email", "created_at")
        search_fields = ("event_type", "recipient_email", "message")
        list_filter = ("event_type", "channel", "status")
        readonly_fields = ("created_at",)


if Project is not None:
    @admin.register(Project)
    class ProjectAdmin(admin.ModelAdmin):
        list_display = ("id", "number", "title", "contractor", "homeowner", "status", "created_at")
        search_fields = ("number", "title", "homeowner__full_name", "contractor__business_name")
        list_filter = ("status", "created_at")
        readonly_fields = ("created_at", "updated_at")


# ─────────────────────────────────────────────────────────────
# Agreement
# ─────────────────────────────────────────────────────────────
if Agreement is not None:
    @admin.register(Agreement)
    class AgreementAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "project",
            "contractor",
            "status",
            "escrow_funded",
            "pdf_version",
            "amendment_number",
            "created_at",
            "updated_at",
        )
        search_fields = (
            "id",
            "project__number",
            "project__title",
            "homeowner__full_name",
            "contractor__business_name",
        )
        list_filter = ("status", "escrow_funded", "is_archived", "created_at")
        readonly_fields = ("created_at", "updated_at")

        actions = ("action_email_signed_pdf",)

        @admin.action(description="Email latest signed PDF to both parties (if available)")
        def action_email_signed_pdf(self, request, queryset):
            sent = 0
            for ag in queryset:
                try:
                    if email_signed_agreement(ag):
                        sent += 1
                except Exception as exc:
                    self.message_user(
                        request,
                        f"Email failed for Agreement {ag.pk}: {exc}",
                        level=messages.ERROR,
                    )
            if sent:
                self.message_user(request, f"Emailed {sent} agreement(s).", level=messages.SUCCESS)


if AgreementWarranty is not None:
    @admin.register(AgreementWarranty)
    class AgreementWarrantyAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "title",
            "agreement",
            "contractor",
            "status",
            "applies_to",
            "start_date",
            "end_date",
            "updated_at",
        )
        search_fields = (
            "title",
            "agreement__project__title",
            "agreement__project__number",
            "contractor__business_name",
        )
        list_filter = ("status", "applies_to", "start_date", "end_date")
        readonly_fields = ("created_at", "updated_at")


if WarrantyRequest is not None:
    @admin.register(WarrantyRequest)
    class WarrantyRequestAdmin(admin.ModelAdmin):
        list_display = ("id", "title", "contractor", "homeowner", "status", "severity", "created_at", "updated_at")
        search_fields = ("title", "description", "agreement__project__title", "homeowner__full_name", "homeowner__email")
        list_filter = ("status", "severity", "created_at")
        readonly_fields = ("created_at", "updated_at", "closed_at", "source_context", "ai_review")


if WarrantyRequestEvidence is not None:
    @admin.register(WarrantyRequestEvidence)
    class WarrantyRequestEvidenceAdmin(admin.ModelAdmin):
        list_display = ("id", "warranty_request", "evidence_type", "original_filename", "uploaded_by_email", "uploaded_at")
        search_fields = ("original_filename", "description", "warranty_request__title")
        list_filter = ("evidence_type", "uploaded_at")


if WarrantyRequestStatusHistory is not None:
    @admin.register(WarrantyRequestStatusHistory)
    class WarrantyRequestStatusHistoryAdmin(admin.ModelAdmin):
        list_display = ("id", "warranty_request", "from_status", "to_status", "actor_email", "created_at")
        search_fields = ("warranty_request__title", "note", "actor_email")
        list_filter = ("to_status", "created_at")
        readonly_fields = ("created_at",)


if WarrantyWorkOrder is not None:
    @admin.register(WarrantyWorkOrder)
    class WarrantyWorkOrderAdmin(admin.ModelAdmin):
        list_display = ("id", "title", "warranty_request", "contractor", "status", "scheduled_for", "updated_at")
        search_fields = ("title", "scope", "warranty_request__title")
        list_filter = ("status", "scheduled_for", "created_at")
        readonly_fields = ("created_at", "updated_at", "completed_at")


# ─────────────────────────────────────────────────────────────
# Milestone & related
# ─────────────────────────────────────────────────────────────
if Milestone is not None:
    @admin.register(Milestone)
    class MilestoneAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "order",
            "title",
            "amount",
            "start_date",
            "completion_date",
            "completed",
            "is_invoiced",
        )
        search_fields = ("title", "agreement__project__title", "agreement__project__number")
        list_filter = ("completed", "is_invoiced")


if MilestoneFile is not None:
    @admin.register(MilestoneFile)
    class MilestoneFileAdmin(admin.ModelAdmin):
        list_display = ("id", "milestone", "uploaded_by", "uploaded_at", "file")
        search_fields = ("milestone__title", "uploaded_by__email")
        list_filter = ("uploaded_at",)


if MilestoneComment is not None:
    @admin.register(MilestoneComment)
    class MilestoneCommentAdmin(admin.ModelAdmin):
        list_display = ("id", "milestone", "author", "created_at")
        search_fields = ("milestone__title", "author__email", "content")
        list_filter = ("created_at",)


# ─────────────────────────────────────────────────────────────
# Invoice
# ─────────────────────────────────────────────────────────────
if Invoice is not None:
    @admin.register(Invoice)
    class InvoiceAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "invoice_number",
            "agreement",
            "amount",
            "status",
            "approved_at",
            "escrow_released",
            "disputed",
            "created_at",
        )
        search_fields = ("invoice_number", "agreement__project__number", "agreement__project__title")
        list_filter = ("status", "disputed", "escrow_released", "created_at")
        readonly_fields = ("created_at", "approved_at", "escrow_released_at")


# ─────────────────────────────────────────────────────────────
# Expense
# ─────────────────────────────────────────────────────────────
if Expense is not None:
    @admin.register(Expense)
    class ExpenseAdmin(admin.ModelAdmin):
        list_display = ("id", "agreement", "description", "amount", "incurred_date", "status", "created_at")
        search_fields = ("description", "agreement__project__title", "agreement__project__number")
        list_filter = ("status", "incurred_date", "created_at")


# ─────────────────────────────────────────────────────────────
# AgreementAmendment
# ─────────────────────────────────────────────────────────────
if AgreementAmendment is not None:
    @admin.register(AgreementAmendment)
    class AgreementAmendmentAdmin(admin.ModelAdmin):
        list_display = ("id", "parent", "child", "amendment_number")
        search_fields = ("parent__project__number", "child__project__number")
        list_filter = ("amendment_number",)


# ─────────────────────────────────────────────────────────────
# Project Templates
# ─────────────────────────────────────────────────────────────
if ProjectTemplate is not None and ProjectTemplateMilestone is not None:

    class ProjectTemplateMilestoneInline(admin.TabularInline):
        model = ProjectTemplateMilestone
        extra = 1
        fields = (
            "sort_order",
            "title",
            "description",
            "normalized_milestone_type",
            "recommended_days_from_start",
            "recommended_duration_days",
            "suggested_amount_percent",
            "suggested_amount_low",
            "suggested_amount_fixed",
            "suggested_amount_high",
            "pricing_confidence",
            "pricing_source_note",
            "materials_hint",
            "is_optional",
        )

    @admin.register(ProjectTemplate)
    class ProjectTemplateAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "name",
            "project_type",
            "project_subtype",
            "is_system",
            "is_system_template",
            "is_published",
            "public_publication_status",
            "public_category_slug",
            "public_slug",
            "is_featured_public",
            "visibility",
            "allow_discovery",
            "normalized_region_key",
            "source_system_template",
            "benchmark_profile",
            "contractor",
            "is_active",
            "estimated_days",
            "milestone_count_display",
            "created_at",
        )
        list_filter = (
            "is_system",
            "is_system_template",
            "is_published",
            "public_publication_status",
            "is_featured_public",
            "is_active",
            "visibility",
            "allow_discovery",
            "project_type",
            "project_subtype",
            "created_at",
        )
        search_fields = (
            "name",
            "project_type",
            "project_subtype",
            "description",
            "public_summary",
            "seo_title",
            "seo_description",
            "contractor__business_name",
            "contractor__user__email",
        )
        readonly_fields = ("created_at", "updated_at")
        inlines = [ProjectTemplateMilestoneInline]

        fieldsets = (
            (
                "Template Basics",
                {
                    "fields": (
                        "name",
                        "contractor",
                        "is_system",
                        "is_system_template",
                        "is_published",
                        "is_active",
                    )
                },
            ),
            (
                "Project Matching",
                {
                    "fields": (
                        "project_type",
                        "project_subtype",
                        "estimated_days",
                    )
                },
            ),
            (
                "Defaults",
                {
                    "fields": (
                        "description",
                        "default_scope",
                        "default_clarifications",
                        "workflow_profile",
                        "visibility",
                        "allow_discovery",
                        "normalized_region_key",
                        "published_at",
                        "published_by",
                        "benchmark_match_key",
                        "benchmark_profile",
                        "source_system_template",
                        "region_tags",
                    )
                },
            ),
            (
                "Public Improvement Library",
                {
                    "fields": (
                        "public_publication_status",
                        "public_category_slug",
                        "public_slug",
                        "public_summary",
                        "public_intro",
                        "difficulty",
                        "estimated_duration_min_days",
                        "estimated_duration_max_days",
                        "cost_guidance",
                        "preparation",
                        "safety_guidance",
                        "common_mistakes",
                        "diy_guidance",
                        "pro_guidance",
                        "public_faqs",
                        "seo_title",
                        "seo_description",
                        "social_image",
                        "is_featured_public",
                        "related_public_templates",
                        "public_published_at",
                        "public_reviewed_at",
                        "public_reviewed_by",
                    ),
                    "classes": ("collapse",),
                },
            ),
            (
                "Audit",
                {
                    "fields": (
                        "created_from_agreement",
                        "created_at",
                        "updated_at",
                    )
                },
            ),
        )

        @admin.display(description="Milestones")
        def milestone_count_display(self, obj):
            try:
                return obj.milestones.count()
            except Exception:
                return 0

        def save_model(self, request, obj, form, change):
            if obj.is_system_template:
                obj.is_system = True
                obj.contractor = None
            elif obj.is_system:
                obj.is_system_template = True

            if obj.is_system_template:
                obj.visibility = ProjectTemplate.Visibility.SYSTEM
                obj.allow_discovery = bool(obj.is_published)
                if obj.is_published:
                    obj.published_at = obj.published_at or timezone.now()
                    if obj.published_by_id is None:
                        obj.published_by = request.user
                else:
                    obj.published_at = None
                    obj.published_by = None

            super().save_model(request, obj, form, change)

    @admin.register(ProjectTemplateMilestone)
    class ProjectTemplateMilestoneAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "template",
            "sort_order",
            "title",
            "normalized_milestone_type",
            "suggested_amount_low",
            "suggested_amount_fixed",
            "suggested_amount_high",
            "pricing_confidence",
            "is_optional",
        )
        list_filter = (
            "is_optional",
            "pricing_confidence",
            "template__project_type",
            "template__is_system",
        )
        search_fields = (
            "title",
            "description",
            "materials_hint",
            "normalized_milestone_type",
            "template__name",
        )


# ─────────────────────────────────────────────────────────────
# Market Pricing Baselines
# ─────────────────────────────────────────────────────────────
if MarketPricingBaseline is not None:
    @admin.register(MarketPricingBaseline)
    class MarketPricingBaselineAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "region_state",
            "region_city",
            "low_amount",
            "median_amount",
            "high_amount",
            "typical_total_project_days",
            "is_active",
            "updated_at",
        )
        list_filter = (
            "is_active",
            "project_type",
            "project_subtype",
            "region_state",
            "region_city",
        )
        search_fields = (
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "region_state",
            "region_city",
            "source_note",
        )
        readonly_fields = ("created_at", "updated_at")


# ─────────────────────────────────────────────────────────────
# Pricing Observations
# ─────────────────────────────────────────────────────────────
if PricingObservation is not None:
    @admin.register(PricingObservation)
    class PricingObservationAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "contractor",
            "agreement",
            "normalized_milestone_type",
            "project_type",
            "project_subtype",
            "amount",
            "region_state",
            "region_city",
            "paid_at",
        )
        list_filter = (
            "project_type",
            "project_subtype",
            "region_state",
            "region_city",
            "paid_at",
        )
        search_fields = (
            "normalized_milestone_type",
            "milestone_title_snapshot",
            "milestone_description_snapshot",
            "project_type",
            "project_subtype",
            "contractor__business_name",
            "contractor__user__email",
        )
        readonly_fields = ("created_at",)


# ─────────────────────────────────────────────────────────────
# Pricing Statistics
# ─────────────────────────────────────────────────────────────
if PricingStatistic is not None:
    @admin.register(PricingStatistic)
    class PricingStatisticAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "scope",
            "contractor",
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "region_state",
            "region_city",
            "sample_size",
            "low_amount",
            "median_amount",
            "high_amount",
            "updated_at",
        )
        list_filter = (
            "scope",
            "project_type",
            "project_subtype",
            "region_state",
            "region_city",
        )
        search_fields = (
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "region_state",
            "region_city",
            "source_note",
            "contractor__business_name",
            "contractor__user__email",
        )
        readonly_fields = ("updated_at",)


if SeedBenchmarkProfile is not None:
    @admin.register(SeedBenchmarkProfile)
    class SeedBenchmarkProfileAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "benchmark_key",
            "project_type",
            "project_subtype",
            "region_scope_display",
            "region_state",
            "region_city",
            "template",
            "base_price_low",
            "base_price_high",
            "region_priority_weight",
            "is_active",
        )
        list_filter = ("is_system", "is_active", "project_type", "project_subtype", "region_state", "region_city")
        search_fields = (
            "benchmark_key",
            "benchmark_match_key",
            "project_type",
            "project_subtype",
            "template__name",
            "normalized_region_key",
            "source_note",
        )

        @admin.display(description="Region Scope")
        def region_scope_display(self, obj):
            if obj.region_city and obj.region_state:
                return "City"
            if obj.region_state:
                return "State"
            if obj.normalized_region_key:
                return "Normalized Region"
            return "National"


if StateTradeLicenseRequirement is not None:
    @admin.register(StateTradeLicenseRequirement)
    class StateTradeLicenseRequirementAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "state_code",
            "trade_key",
            "license_required",
            "insurance_required",
            "authority_short_name",
            "active",
            "last_reviewed_at",
        )
        list_filter = ("state_code", "license_required", "insurance_required", "active", "source_type")
        search_fields = (
            "state_code",
            "state_name",
            "trade_key",
            "trade_label",
            "issuing_authority_name",
            "official_lookup_url",
            "source_reference",
        )
        readonly_fields = ("created_at", "updated_at")


if ContractorComplianceRecord is not None:
    @admin.register(ContractorComplianceRecord)
    class ContractorComplianceRecordAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "contractor",
            "record_type",
            "trade_key",
            "state_code",
            "identifier",
            "expiration_date",
            "status",
            "source",
            "updated_at",
        )
        list_filter = ("record_type", "status", "state_code", "source")
        search_fields = (
            "contractor__business_name",
            "contractor__user__email",
            "trade_key",
            "trade_label",
            "identifier",
            "state_code",
        )
        readonly_fields = ("created_at", "updated_at")


if AgreementOutcomeSnapshot is not None:
    @admin.register(AgreementOutcomeSnapshot)
    class AgreementOutcomeSnapshotAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "contractor",
            "template",
            "project_type",
            "project_subtype",
            "agreement_completed_date",
            "final_agreed_total_amount",
            "actual_duration_days",
            "excluded_from_benchmarks",
        )
        list_filter = (
            "excluded_from_benchmarks",
            "project_type",
            "project_subtype",
            "payment_mode",
            "agreement_completed_date",
        )
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "contractor__business_name",
            "project_type",
            "project_subtype",
            "normalized_region_key",
        )
        readonly_fields = ("snapshot_created_at", "snapshot_updated_at")


if ProjectOutcomeSnapshot is not None:
    @admin.register(ProjectOutcomeSnapshot)
    class ProjectOutcomeSnapshotAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "project_family_key",
            "scope_mode",
            "template_used",
            "total_project_value",
            "actual_duration_days",
            "milestone_count",
            "dispute_flag",
            "completion_status",
        )
        list_filter = ("project_family_key", "scope_mode", "completion_status", "dispute_flag")
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "contractor__business_name",
            "project_family_key",
            "project_family_label",
            "template_used",
        )
        readonly_fields = ("created_at",)


if ContractorEditEvent is not None:
    @admin.register(ContractorEditEvent)
    class ContractorEditEventAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "contractor",
            "field_changed",
            "source",
            "change_reason",
            "created_at",
        )
        list_filter = ("field_changed", "source", "created_at")
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "contractor__business_name",
            "change_reason",
        )
        readonly_fields = (
            "agreement",
            "contractor",
            "field_changed",
            "original_value",
            "updated_value",
            "source",
            "change_reason",
            "metadata",
            "created_at",
        )

        def has_add_permission(self, request):
            return False

        def has_change_permission(self, request, obj=None):
            return False

        def has_delete_permission(self, request, obj=None):
            return False


if MilestonePerformanceSnapshot is not None:
    @admin.register(MilestonePerformanceSnapshot)
    class MilestonePerformanceSnapshotAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "milestone",
            "contractor",
            "project_type",
            "normalized_milestone_type",
            "source_event",
            "is_delayed",
            "created_at",
        )
        list_filter = (
            "project_type",
            "normalized_milestone_type",
            "source_event",
            "is_delayed",
            "draft_source",
            "created_at",
        )
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "milestone_title",
            "contractor__business_name",
            "project_type",
            "project_subtype",
        )
        readonly_fields = (
            "agreement",
            "milestone",
            "contractor",
            "invoice",
            "selected_template",
            "project_title",
            "project_type",
            "project_subtype",
            "draft_source",
            "template_name_snapshot",
            "milestone_order",
            "milestone_title",
            "normalized_milestone_type",
            "milestone_amount",
            "planned_start_date",
            "planned_completion_date",
            "contractor_completed_at",
            "homeowner_approved_at",
            "invoice_created_at",
            "invoice_paid_at",
            "escrow_released_at",
            "dispute_opened_at",
            "dispute_resolved_at",
            "planned_vs_actual_completion_days",
            "completion_to_approval_seconds",
            "approval_to_payment_release_seconds",
            "invoice_to_payment_release_seconds",
            "total_lifecycle_seconds",
            "is_delayed",
            "source_event",
            "state_signature",
            "metadata",
            "created_at",
        )

        def has_add_permission(self, request):
            return False

        def has_change_permission(self, request, obj=None):
            return False

        def has_delete_permission(self, request, obj=None):
            return False


if SignedAgreementSnapshot is not None:
    @admin.register(SignedAgreementSnapshot)
    class SignedAgreementSnapshotAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "contractor",
            "homeowner",
            "project_type",
            "project_subtype",
            "draft_source",
            "payment_structure",
            "pdf_version",
            "fully_signed_at",
            "created_at",
        )
        list_filter = (
            "project_type",
            "project_subtype",
            "draft_source",
            "payment_structure",
            "template_recommendation_tier",
            "fully_signed_at",
            "created_at",
        )
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "project_title",
            "project_type",
            "project_subtype",
            "contractor__business_name",
            "homeowner__full_name",
            "template_name_snapshot",
        )
        readonly_fields = (
            "agreement",
            "contractor",
            "homeowner",
            "selected_template",
            "draft_intelligence_snapshot",
            "project_title",
            "project_type",
            "project_subtype",
            "signed_scope",
            "exclusions",
            "customer_responsibilities",
            "milestone_count",
            "milestone_details",
            "contract_amount",
            "pricing_structure",
            "payment_structure",
            "payment_mode",
            "retainage_percent",
            "draft_source",
            "template_name_snapshot",
            "template_recommendation_result",
            "template_recommendation_tier",
            "amendment_number",
            "pdf_version",
            "pdf_version_id",
            "warranty_type",
            "warranty_text",
            "contractor_signed_at",
            "homeowner_signed_at",
            "fully_signed_at",
            "snapshot_version",
            "created_at",
        )

        def has_add_permission(self, request):
            return False

        def has_change_permission(self, request, obj=None):
            return False

        def has_delete_permission(self, request, obj=None):
            return False


if ContractorBenchmarkAggregate is not None:
    @admin.register(ContractorBenchmarkAggregate)
    class ContractorBenchmarkAggregateAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "contractor",
            "project_family_key",
            "scope_mode",
            "template_used",
            "sample_size",
            "avg_project_value",
            "p50_project_value",
            "avg_duration_days",
            "dispute_rate",
            "amendment_rate",
            "last_updated",
        )
        list_filter = ("project_family_key", "scope_mode", "template_used")
        search_fields = (
            "contractor__business_name",
            "project_family_key",
            "template_used",
        )
        readonly_fields = ("last_updated",)


if AgreementOutcomeMilestoneSnapshot is not None:
    @admin.register(AgreementOutcomeMilestoneSnapshot)
    class AgreementOutcomeMilestoneSnapshotAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "snapshot",
            "sort_order",
            "title",
            "normalized_milestone_type",
            "amount",
            "actual_duration_days",
        )
        list_filter = ("normalized_milestone_type",)
        search_fields = ("title", "normalized_milestone_type", "snapshot__agreement__project__title")
        readonly_fields = ("created_at",)


if ProjectBenchmarkAggregate is not None:
    @admin.register(ProjectBenchmarkAggregate)
    class ProjectBenchmarkAggregateAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "scope",
            "project_type",
            "project_subtype",
            "normalized_region_key",
            "template",
            "contractor",
            "completed_project_count",
            "average_final_total",
            "average_actual_duration_days",
            "updated_at",
        )
        list_filter = ("scope", "project_type", "project_subtype")
        search_fields = (
            "project_type",
            "project_subtype",
            "normalized_region_key",
            "template__name",
            "contractor__business_name",
        )
        readonly_fields = ("updated_at",)


if RegionalBenchmarkAggregate is not None:
    @admin.register(RegionalBenchmarkAggregate)
    class RegionalBenchmarkAggregateAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "region_key",
            "region_granularity",
            "project_family_key",
            "scope_mode",
            "template_used",
            "sample_size",
            "avg_project_value",
            "avg_duration_days",
            "last_updated",
        )
        list_filter = ("region_granularity", "project_family_key", "scope_mode")
        search_fields = (
            "region_key",
            "region_label",
            "project_family_key",
            "template_used",
        )
        readonly_fields = ("last_updated",)


if SupportTicket is not None:
    @admin.register(SupportTicket)
    class SupportTicketAdmin(admin.ModelAdmin):
        list_display = (
            "ticket_number",
            "subject",
            "category",
            "priority",
            "status",
            "submitted_by",
            "email",
            "created_at",
        )
        list_filter = ("category", "priority", "status")
        search_fields = ("ticket_number", "subject", "email", "related_object_type", "related_object_id")
        readonly_fields = ("ticket_number", "created_at", "updated_at", "resolved_at")


if MilestoneBenchmarkAggregate is not None:
    @admin.register(MilestoneBenchmarkAggregate)
    class MilestoneBenchmarkAggregateAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "scope",
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "normalized_region_key",
            "template",
            "contractor",
            "completed_milestone_count",
            "average_final_amount",
            "average_actual_duration_days",
            "updated_at",
        )
        list_filter = ("scope", "project_type", "project_subtype", "normalized_milestone_type")
        search_fields = (
            "project_type",
            "project_subtype",
            "normalized_milestone_type",
            "normalized_region_key",
            "template__name",
            "contractor__business_name",
        )
        readonly_fields = ("updated_at",)


# ─────────────────────────────────────────────────────────────
# Disputes (optional)
# ─────────────────────────────────────────────────────────────
if Dispute is not None:
    @admin.register(Dispute)  # type: ignore[misc]
    class DisputeAdmin(admin.ModelAdmin):
        list_display = ("id", "obj_str")

        def obj_str(self, obj):
            return str(obj)


if DisputeAttachment is not None:
    @admin.register(DisputeAttachment)  # type: ignore[misc]
    class DisputeAttachmentAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "file") if hasattr(DisputeAttachment, "file") else ("id", "dispute")
        search_fields = ("dispute__id",)


if DisputeEscrowAllocation is not None:
    @admin.register(DisputeEscrowAllocation)  # type: ignore[misc]
    class DisputeEscrowAllocationAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "source_amount_cents", "contractor_amount_cents", "homeowner_amount_cents", "status", "executed_at")
        list_filter = ("status", "created_at", "executed_at")
        search_fields = ("dispute__id", "execution_reference")
        readonly_fields = ("idempotency_key", "created_at", "updated_at", "executed_at")


if DisputeEscrowAllocationSource is not None:
    @admin.register(DisputeEscrowAllocationSource)  # type: ignore[misc]
    class DisputeEscrowAllocationSourceAdmin(admin.ModelAdmin):
        list_display = ("id", "allocation", "payment", "source_amount_cents", "homeowner_refund_cents", "contractor_payout_cents", "platform_fee_cents", "status")
        list_filter = ("status", "created_at")
        search_fields = ("allocation__dispute__id", "stripe_refund_id", "stripe_transfer_id")
        readonly_fields = ("created_at", "updated_at")


if DisputeEscrowAllocationAttempt is not None:
    @admin.register(DisputeEscrowAllocationAttempt)  # type: ignore[misc]
    class DisputeEscrowAllocationAttemptAdmin(admin.ModelAdmin):
        list_display = ("id", "allocation", "source", "action", "attempt_number", "amount_cents", "status", "created_at", "completed_at")
        list_filter = ("action", "status", "created_at")
        search_fields = ("allocation__dispute__id", "external_reference", "idempotency_key")
        readonly_fields = tuple(field.name for field in DisputeEscrowAllocationAttempt._meta.fields)


if ResolutionCaseTimelineEvent is not None:
    @admin.register(ResolutionCaseTimelineEvent)  # type: ignore[misc]
    class ResolutionCaseTimelineEventAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "event_type", "title", "actor", "occurred_at")
        list_filter = ("event_type", "visibility", "occurred_at")
        search_fields = ("dispute__id", "title", "description", "actor__email")
        readonly_fields = ("occurred_at",)


if ResolutionCaseAuditEvent is not None:
    @admin.register(ResolutionCaseAuditEvent)  # type: ignore[misc]
    class ResolutionCaseAuditEventAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "action", "summary", "actor", "occurred_at")
        list_filter = ("action", "occurred_at")
        search_fields = ("dispute__id", "summary", "actor__email")
        readonly_fields = ("occurred_at",)


if ResolutionPartyStatement is not None:
    @admin.register(ResolutionPartyStatement)  # type: ignore[misc]
    class ResolutionPartyStatementAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "party_role", "statement_type", "version", "is_current", "author", "created_at")
        list_filter = ("party_role", "statement_type", "is_current", "visibility", "created_at")
        search_fields = ("dispute__id", "text", "author__email")
        readonly_fields = ("created_at",)


if ResolutionEvidenceIndex is not None:
    @admin.register(ResolutionEvidenceIndex)  # type: ignore[misc]
    class ResolutionEvidenceIndexAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "category", "attachment", "uploaded_by", "uploaded_at")
        list_filter = ("category", "visibility", "uploaded_at")
        search_fields = ("dispute__id", "description", "uploaded_by__email")
        readonly_fields = ("uploaded_at",)


if ResolutionProposal is not None:
    @admin.register(ResolutionProposal)  # type: ignore[misc]
    class ResolutionProposalAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "status", "proposed_by", "created_at", "updated_at")
        list_filter = ("status", "created_at")
        search_fields = ("dispute__id", "problem_statement", "proposed_solution", "proposed_by__email")
        readonly_fields = ("created_at", "updated_at")


if ResolutionAgreement is not None:
    @admin.register(ResolutionAgreement)  # type: ignore[misc]
    class ResolutionAgreementAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "status", "agreement", "created_by", "created_at", "locked_at")
        list_filter = ("status", "created_at", "locked_at")
        search_fields = ("dispute__id", "problem_statement", "agreed_solution", "created_by__email")
        readonly_fields = ("created_at", "updated_at", "locked_at")


if ResolutionAgreementSignature is not None:
    @admin.register(ResolutionAgreementSignature)  # type: ignore[misc]
    class ResolutionAgreementSignatureAdmin(admin.ModelAdmin):
        list_display = ("id", "resolution_agreement", "signer_role", "signer_name", "signer", "signed_at")
        list_filter = ("signer_role", "signed_at")
        search_fields = ("resolution_agreement__dispute__id", "signer_name", "signer__email")
        readonly_fields = ("signed_at",)


if ResolutionDocument is not None:
    @admin.register(ResolutionDocument)  # type: ignore[misc]
    class ResolutionDocumentAdmin(admin.ModelAdmin):
        list_display = ("id", "dispute", "document_type", "title", "generated_by", "generated_at", "sha256")
        list_filter = ("document_type", "generated_at")
        search_fields = ("dispute__id", "title", "sha256", "generated_by__email")
        readonly_fields = ("generated_at", "sha256")


# ─────────────────────────────────────────────────────────────
# AgreementAttachment (optional)
# ─────────────────────────────────────────────────────────────
if AgreementAttachment is not None:
    @admin.register(AgreementAttachment)  # type: ignore[misc]
    class AgreementAttachmentAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "agreement",
            "category",
            "title",
            "visible_to_homeowner",
            "ack_required",
            "uploaded_by",
            "uploaded_at",
        )
        list_filter = ("category", "visible_to_homeowner", "ack_required", "uploaded_at")
        search_fields = ("title", "file", "agreement__project__title", "agreement__project__number")
        readonly_fields = ("uploaded_at",)


if PlatformFeePromotionGrant is not None:
    @admin.register(PlatformFeePromotionGrant)  # type: ignore[misc]
    class PlatformFeePromotionGrantAdmin(admin.ModelAdmin):
        list_display = ("code", "contractor", "waiver_percent", "starts_at", "ends_at", "active", "granted_by")
        list_filter = ("active", "waiver_percent", "starts_at", "ends_at")
        search_fields = ("code", "contractor__business_name", "contractor__user__email", "reason")
        readonly_fields = ("created_at", "updated_at")


if PlatformFeePromotionAuditEvent is not None:
    @admin.register(PlatformFeePromotionAuditEvent)  # type: ignore[misc]
    class PlatformFeePromotionAuditEventAdmin(admin.ModelAdmin):
        list_display = ("grant", "action", "actor", "project_id_snapshot", "waived_fee_cents", "created_at")
        list_filter = ("action", "created_at")
        search_fields = ("grant__code", "grant__contractor__business_name", "actor__email")
        readonly_fields = (
            "grant", "action", "actor", "project_id_snapshot", "context",
            "original_fee_cents", "waived_fee_cents", "metadata", "created_at",
        )


# ─────────────────────────────────────────────────────────────
# AI: Admin Controls (Artifacts)
# ─────────────────────────────────────────────────────────────
if DisputeAIArtifact is not None:

    @admin.register(DisputeAIArtifact)
    class DisputeAIArtifactAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "dispute_id",
            "artifact_type",
            "version",
            "model_name",
            "paid",
            "price_cents",
            "created_by_id",
            "created_at",
            "input_digest_short",
        )
        list_filter = ("artifact_type", "paid", "model_name", "created_at")
        search_fields = (
            "dispute__id",
            "artifact_type",
            "model_name",
            "input_digest",
            "stripe_payment_intent_id",
            "created_by__email",
        )
        readonly_fields = ("created_at",)
        ordering = ("-created_at", "-id")

        fieldsets = (
            ("Identity", {"fields": ("dispute", "artifact_type", "version", "input_digest")}),
            ("Model", {"fields": ("model_name",)}),
            ("Output", {"fields": ("payload",)}),
            ("Monetization", {"fields": ("paid", "price_cents", "stripe_payment_intent_id")}),
            ("Audit", {"fields": ("created_by", "created_at")}),
        )

        @admin.display(description="Digest")
        def input_digest_short(self, obj):
            d = getattr(obj, "input_digest", "") or ""
            return d[:10] + ("…" if len(d) > 10 else "")


# Referral rewards are reviewed and paid by operations; no automatic money movement.
from .models_referrals import (  # noqa: E402
    ContractorReferral,
    FoundingContractorAward,
    ReferralEarning,
    ReferralInvitation,
    ReferralParticipant,
    ReferralPayout,
    ReferralProjectCredit,
    ReferralVisit,
)
from .models_attribution import (  # noqa: E402
    AccountAcquisition,
    AttributionEvent,
    MarketingCampaign,
    ProjectAttributionSnapshot,
    RevenueAttributionSnapshot,
)


@admin.register(ReferralParticipant)
class ReferralParticipantAdmin(admin.ModelAdmin):
    list_display = ("user", "code", "is_eligible", "created_at")
    list_filter = ("is_eligible",)
    search_fields = ("user__email", "code")
    readonly_fields = ("code", "created_at", "updated_at")


@admin.register(FoundingContractorAward)
class FoundingContractorAwardAdmin(admin.ModelAdmin):
    list_display = ("participant", "contractor", "pool", "slot_number", "status", "qualification_deadline", "promotion_ends_at")
    list_filter = ("pool", "status")
    search_fields = ("participant__user__email", "contractor__business_name", "contractor__user__email")


@admin.register(ContractorReferral)
class ContractorReferralAdmin(admin.ModelAdmin):
    list_display = ("referred_user", "referred_role", "referrer", "referrer_role", "status", "program_code", "registered_at", "earning_ends_at")
    list_filter = ("referred_role", "referrer_role", "status", "program_code")
    search_fields = ("referred_user__email", "referred_contractor__business_name", "referred_contractor__user__email", "referrer__email", "attributed_code")
    readonly_fields = ("referrer", "participant", "referred_user", "referred_contractor", "referred_homeowner", "attributed_code", "registered_at", "attribution_locked_at")


@admin.register(ReferralEarning)
class ReferralEarningAdmin(admin.ModelAdmin):
    list_display = ("referral", "receipt", "allocation_side", "qualifying_platform_fee_cents", "maximum_reward_pool_cents", "reward_cents", "status", "available_at")
    list_filter = ("allocation_side", "status")
    readonly_fields = ("referral", "receipt", "allocation_side", "qualifying_platform_fee_cents", "maximum_reward_pool_cents", "reward_rate_bps", "reward_cents", "created_at")


@admin.register(ReferralPayout)
class ReferralPayoutAdmin(admin.ModelAdmin):
    list_display = ("participant", "amount_cents", "payout_method", "status", "stripe_transfer_id", "paid_at")
    list_filter = ("status", "payout_method")
    readonly_fields = ("stripe_transfer_id", "paid_at", "approved_by", "approved_at", "created_at", "updated_at")
    actions = ("execute_contractor_stripe_payouts",)

    @admin.action(description="Execute selected contractor Stripe referral payouts")
    def execute_contractor_stripe_payouts(self, request, queryset):
        from .services.referral_payouts import execute_contractor_referral_payout

        paid = 0
        failed = []
        for payout_id in queryset.values_list("id", flat=True):
            try:
                payout = execute_contractor_referral_payout(payout_id, approved_by=request.user)
                if payout.status == ReferralPayout.STATUS_PAID:
                    paid += 1
                else:
                    failed.append(f"#{payout_id}: {payout.failure_reason or 'Stripe transfer failed'}")
            except Exception as exc:
                failed.append(f"#{payout_id}: {exc}")
        if paid:
            self.message_user(request, f"Executed {paid} contractor referral payout(s).", level=messages.SUCCESS)
        if failed:
            self.message_user(request, " | ".join(failed), level=messages.ERROR)


@admin.register(ReferralInvitation)
class ReferralInvitationAdmin(admin.ModelAdmin):
    list_display = ("participant", "channel", "created_at")
    list_filter = ("channel",)
    readonly_fields = ("participant", "channel", "created_at")


@admin.register(ReferralProjectCredit)
class ReferralProjectCreditAdmin(admin.ModelAdmin):
    list_display = ("participant", "project", "invoice", "amount_cents", "status", "created_at", "applied_at")
    list_filter = ("status",)
    search_fields = ("participant__user__email", "project__number", "external_reference")
    readonly_fields = ("participant", "earnings", "project", "agreement", "invoice", "amount_cents", "requested_by", "created_at", "updated_at", "applied_at")


@admin.register(ReferralVisit)
class ReferralVisitAdmin(admin.ModelAdmin):
    list_display = ("visitor_token", "first_source", "first_medium", "last_source", "campaign", "referral_code", "registered_user", "excluded_from_reporting")
    list_filter = ("first_source", "first_medium", "last_source", "excluded_from_reporting")
    search_fields = ("referral_code", "participant__user__email", "registered_user__email", "session_key")
    readonly_fields = ("visitor_token", "participant", "referral_code", "medium", "landing_page", "session_key", "first_touch_at", "registered_user", "registration_at", "created_at")


@admin.register(MarketingCampaign)
class MarketingCampaignAdmin(admin.ModelAdmin):
    list_display = ("name", "public_code", "source", "medium", "campaign_name", "destination", "is_active", "starts_at", "ends_at")
    list_filter = ("is_active", "source", "medium", "partner_type")
    search_fields = ("name", "public_code", "campaign_name", "partner_code")


@admin.register(AccountAcquisition)
class AccountAcquisitionAdmin(admin.ModelAdmin):
    list_display = ("user", "roles", "first_touch_at", "last_touch_at", "referral")
    search_fields = ("user__email",)
    readonly_fields = ("user", "first_visit", "last_visit", "referral", "roles", "first_touch", "last_touch", "first_touch_at", "last_touch_at", "account_created_at", "profile_completed_at", "created_at", "updated_at")


@admin.register(AttributionEvent)
class AttributionEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "source", "medium", "campaign_name", "role", "user", "project", "occurred_at")
    list_filter = ("event_type", "source", "medium", "role")
    search_fields = ("user__email", "object_id", "idempotency_key", "campaign_name")
    readonly_fields = tuple(field.name for field in AttributionEvent._meta.fields)


@admin.register(ProjectAttributionSnapshot)
class ProjectAttributionSnapshotAdmin(admin.ModelAdmin):
    list_display = ("project", "customer_user", "contractor_user", "snapshotted_at")
    readonly_fields = tuple(field.name for field in ProjectAttributionSnapshot._meta.fields)


@admin.register(RevenueAttributionSnapshot)
class RevenueAttributionSnapshotAdmin(admin.ModelAdmin):
    list_display = ("receipt", "project", "eligible_platform_fee_cents", "total_referral_reward_cents", "retained_platform_fee_cents", "created_at")
    readonly_fields = tuple(field.name for field in RevenueAttributionSnapshot._meta.fields)
