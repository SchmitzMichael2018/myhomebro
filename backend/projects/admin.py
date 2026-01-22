# backend/projects/admin.py
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
        Milestone,
        MilestoneFile,
        MilestoneComment,
        Invoice,
        Expense,
        AgreementAmendment,
    )
except Exception:  # pragma: no cover
    Skill = Contractor = Homeowner = Project = Agreement = None
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

# ✅ NEW: AI models (guarded)
try:
    from .models_ai_entitlements import ContractorAIEntitlement  # type: ignore
except Exception:  # pragma: no cover
    ContractorAIEntitlement = None  # type: ignore

try:
    from .models_ai_artifacts import DisputeAIArtifact  # type: ignore
except Exception:  # pragma: no cover
    DisputeAIArtifact = None  # type: ignore

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
# Shows city/state if present on the model (your model now includes them).
# ─────────────────────────────────────────────────────────────
if Contractor is not None:
    @admin.register(Contractor)
    class ContractorAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "business_name",
            "name",          # property -> user.get_full_name or business_name
            "email",         # property -> user.email
            "phone",
            # show if present (admin ignores missing attrs gracefully via callable)
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
# Disputes (optional)
# ─────────────────────────────────────────────────────────────
if Disappear := Dispute is not None:  # keep linter quiet about unused name
    @admin.register(Dispute)  # type: ignore[misc]
    class DisputeAdmin(admin.ModelAdmin):
        """Minimal, schema-agnostic registration."""
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
# ✅ AI: Admin Controls (Entitlements + Artifacts)
# ─────────────────────────────────────────────────────────────

# ---- Entitlement actions (only registered if model import works) ----
if ContractorAIEntitlement is not None:

    @admin.action(description="Grant +1 free AI recommendation")
    def grant_one_free_recommendation(modeladmin, request, queryset):
        for ent in queryset:
            ent.free_recommendations_remaining = int(ent.free_recommendations_remaining or 0) + 1
            ent.save(update_fields=["free_recommendations_remaining", "updated_at"])

    @admin.action(description="Grant +5 free AI recommendations")
    def grant_five_free_recommendations(modeladmin, request, queryset):
        for ent in queryset:
            ent.free_recommendations_remaining = int(ent.free_recommendations_remaining or 0) + 5
            ent.save(update_fields=["free_recommendations_remaining", "updated_at"])

    @admin.action(description="Reset monthly quota usage (sets used=0; sets period to next 30 days)")
    def reset_monthly_quota(modeladmin, request, queryset):
        now = timezone.now()
        for ent in queryset:
            ent.monthly_recommendations_used = 0
            ent.quota_period_start = now
            ent.quota_period_end = now + timezone.timedelta(days=30)
            ent.save(
                update_fields=[
                    "monthly_recommendations_used",
                    "quota_period_start",
                    "quota_period_end",
                    "updated_at",
                ]
            )

    @admin.action(description="Set tier: FREE")
    def set_tier_free(modeladmin, request, queryset):
        queryset.update(tier=ContractorAIEntitlement.TIER_FREE, updated_at=timezone.now())

    @admin.action(description="Set tier: STARTER")
    def set_tier_starter(modeladmin, request, queryset):
        queryset.update(tier=ContractorAIEntitlement.TIER_STARTER, updated_at=timezone.now())

    @admin.action(description="Set tier: PRO")
    def set_tier_pro(modeladmin, request, queryset):
        queryset.update(tier=ContractorAIEntitlement.TIER_PRO, updated_at=timezone.now())

    @admin.action(description="Set tier: BUSINESS")
    def set_tier_business(modeladmin, request, queryset):
        queryset.update(tier=ContractorAIEntitlement.TIER_BUSINESS, updated_at=timezone.now())

    @admin.action(description="Mark subscription: ACTIVE")
    def set_subscription_active(modeladmin, request, queryset):
        queryset.update(subscription_active=True, updated_at=timezone.now())

    @admin.action(description="Mark subscription: INACTIVE")
    def set_subscription_inactive(modeladmin, request, queryset):
        queryset.update(subscription_active=False, updated_at=timezone.now())

    @admin.register(ContractorAIEntitlement)
    class ContractorAIEntitlementAdmin(admin.ModelAdmin):
        list_display = (
            "id",
            "contractor_id",
            "contractor_email",
            "tier",
            "subscription_active",
            "free_recommendations_remaining",
            "monthly_recommendations_included",
            "monthly_recommendations_used",
            "quota_period_start",
            "quota_period_end",
            "allow_ai_summaries",
            "allow_ai_recommendations",
            "allow_scope_assistant",
            "allow_resolution_agreement",
            "allow_business_insights",
            "updated_at",
        )
        list_filter = (
            "tier",
            "subscription_active",
            "allow_ai_summaries",
            "allow_ai_recommendations",
            "allow_scope_assistant",
            "allow_resolution_agreement",
            "allow_business_insights",
            "updated_at",
        )
        search_fields = (
            "contractor__id",
            "contractor__user__email",
            "contractor__business_name",
            "stripe_customer_id",
            "stripe_subscription_id",
        )
        readonly_fields = ("created_at", "updated_at")
        ordering = ("-updated_at", "-id")
        actions = (
            grant_one_free_recommendation,
            grant_five_free_recommendations,
            reset_monthly_quota,
            set_tier_free,
            set_tier_starter,
            set_tier_pro,
            set_tier_business,
            set_subscription_active,
            set_subscription_inactive,
        )

        fieldsets = (
            ("Contractor", {"fields": ("contractor",)}),
            (
                "Tier & Subscription",
                {
                    "fields": (
                        "tier",
                        "subscription_active",
                        "stripe_customer_id",
                        "stripe_subscription_id",
                        "current_period_end",
                    )
                },
            ),
            (
                "Free / Quota",
                {
                    "fields": (
                        "free_recommendations_remaining",
                        "monthly_recommendations_included",
                        "monthly_recommendations_used",
                        "quota_period_start",
                        "quota_period_end",
                    )
                },
            ),
            (
                "Feature Toggles",
                {
                    "fields": (
                        "allow_ai_summaries",
                        "allow_ai_recommendations",
                        "allow_scope_assistant",
                        "allow_resolution_agreement",
                        "allow_business_insights",
                    )
                },
            ),
            ("Timestamps", {"fields": ("created_at", "updated_at")}),
        )

        @admin.display(description="Contractor Email")
        def contractor_email(self, obj):
            try:
                return obj.contractor.user.email
            except Exception:
                return ""


# ---- Artifact audit admin (only registered if model import works) ----
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
