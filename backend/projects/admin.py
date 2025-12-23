# backend/projects/admin.py
from __future__ import annotations

from django.contrib import admin, messages

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

# Optional services used by admin actions (guarded)
try:
    from projects.services.mailer import email_signed_agreement  # type: no cover
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
