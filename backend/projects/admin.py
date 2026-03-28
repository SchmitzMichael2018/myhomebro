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
        AgreementOutcomeSnapshot,
        AgreementOutcomeMilestoneSnapshot,
        ProjectBenchmarkAggregate,
    )
except Exception:  # pragma: no cover
    Skill = Contractor = Homeowner = Project = Agreement = AgreementWarranty = None
    ContractorGalleryItem = ContractorPublicProfile = ContractorReview = None
    Milestone = MilestoneFile = MilestoneComment = None
    PublicContractorLead = None
    Invoice = Expense = AgreementAmendment = None
    AgreementOutcomeSnapshot = AgreementOutcomeMilestoneSnapshot = ProjectBenchmarkAggregate = None

# Optional/independent models (guarded with try so admin doesn’t break)
try:
    from .models_dispute import Dispute, DisputeAttachment  # type: ignore
except Exception:  # pragma: no cover
    Dispute = None
    DisputeAttachment = None

try:
    from .models_attachments import AgreementAttachment  # type: ignore
except Exception:  # pragma: no cover
    AgreementAttachment = None  # type: ignore

try:
    from .models_ai_artifacts import DisputeAIArtifact  # type: ignore
except Exception:  # pragma: no cover
    DisputeAIArtifact = None  # type: ignore

# ✅ Template + pricing intelligence models (guarded)
try:
    from .models_templates import (  # <-- corrected import
        ProjectTemplate,
        ProjectTemplateMilestone,
        SeedBenchmarkProfile,
        MarketPricingBaseline,
        PricingObservation,
        PricingStatistic,
    )
except Exception:  # pragma: no cover
    ProjectTemplate = None  # type: ignore
    ProjectTemplateMilestone = None  # type: ignore
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
# Contractor
# ─────────────────────────────────────────────────────────────
if Contractor is not None:
    @admin.register(Contractor)
    class ContractorAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "business_name",
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
        list_filter = ("charges_enabled", "payouts_enabled", "details_submitted")
        readonly_fields = ("created_at", "updated_at")

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
        list_display = ("id", "contractor", "customer_name", "rating", "is_verified", "is_public", "submitted_at")
        search_fields = ("customer_name", "title", "review_text", "contractor__business_name")
        list_filter = ("is_verified", "is_public", "rating")


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
        list_display = ("id", "phone_number_e164", "contractor", "homeowner", "can_send_sms", "opted_out", "opted_in_source", "updated_at")
        search_fields = ("phone_number_e164", "contractor__business_name", "homeowner__full_name", "homeowner__email")
        list_filter = ("can_send_sms", "opted_out", "opted_in_source", "opted_out_source")
        readonly_fields = ("created_at", "updated_at")


if SMSAutomationDecision is not None:
    @admin.register(SMSAutomationDecision)
    class SMSAutomationDecisionAdmin(admin.ModelAdmin):
        list_display = ("id", "event_type", "phone_number_e164", "channel_decision", "priority", "reason_code", "sent", "created_at")
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
