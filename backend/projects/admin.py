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
        Milestone,
        MilestoneFile,
        MilestoneComment,
        Invoice,
        Expense,
        AgreementAmendment,
    )
except Exception:  # pragma: no cover
    Skill = Contractor = Homeowner = Project = Agreement = AgreementWarranty = None
    Milestone = MilestoneFile = MilestoneComment = None
    Invoice = Expense = AgreementAmendment = None

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
        MarketPricingBaseline,
        PricingObservation,
        PricingStatistic,
    )
except Exception:  # pragma: no cover
    ProjectTemplate = None  # type: ignore
    ProjectTemplateMilestone = None  # type: ignore
    MarketPricingBaseline = None  # type: ignore
    PricingObservation = None  # type: ignore
    PricingStatistic = None  # type: ignore

# ✅ NEW: Project Intake model (guarded)
try:
    from .models_project_intake import ProjectIntake  # type: ignore
except Exception:  # pragma: no cover
    ProjectIntake = None  # type: ignore

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
            "contractor",
            "is_active",
            "estimated_days",
            "milestone_count_display",
            "created_at",
        )
        list_filter = (
            "is_system",
            "is_active",
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
