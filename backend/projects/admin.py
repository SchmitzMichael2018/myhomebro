# backend/projects/admin.py
from __future__ import annotations

from django.contrib import admin, messages
from django.utils import timezone

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

# Try to import Dispute models if present, but don't assume any field names
try:
    from .models_dispute import Dispute, DisputeAttachment  # type: ignore
except Exception:  # pragma: no cover
    Dispute = None
    DisputeAttachment = None

# Optional helpers if you created them; wrapped in try/except so admin doesn't fail if absent
try:
    from projects.services.mailer import email_signed_agreement  # type: ignore
except Exception:  # pragma: no cover
    def email_signed_agreement(*args, **kwargs):
        return False

# NEW: attachments model (contractor warranties/addenda)
try:
    from .models_attachments import AgreementAttachment  # type: ignore
except Exception:  # pragma: no cover
    AgreementAttachment = None  # type: ignore


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "slug")
    search_fields = ("name", "slug")
    ordering = ("name",)


@admin.register(Contractor)
class ContractorAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business_name",
        "name",
        "email",
        "phone",
        "stripe_account_id",
        "created_at",
    )
    search_fields = ("business_name", "user__email", "phone", "license_number")
    readonly_fields = ("created_at", "updated_at")
    list_filter = ("license_expiration",)


@admin.register(Homeowner)
class HomeownerAdmin(admin.ModelAdmin):
    list_display = ("id", "full_name", "email", "phone_number", "status", "created_at")
    search_fields = ("full_name", "email", "phone_number", "street_address", "city", "state", "zip_code")
    list_filter = ("status",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("id", "number", "title", "contractor", "homeowner", "status", "created_at")
    search_fields = ("number", "title", "homeowner__full_name", "contractor__business_name")
    list_filter = ("status", "created_at")
    readonly_fields = ("created_at", "updated_at")


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
        "reviewed_at",   # safe if present; Django shows blank if missing
        "created_at",
    )
    search_fields = (
        "id",
        "project__number",
        "project__title",
        "homeowner__full_name",
        "contractor__business_name",
    )
    list_filter = ("status", "escrow_funded", "is_archived")
    readonly_fields = ("created_at", "updated_at")

    actions = ("action_email_signed_pdf",)

    @admin.action(description="Email latest signed PDF to both parties (if available)")
    def action_email_signed_pdf(self, request, queryset):
        sent = 0
        for ag in queryset:
            try:
                if email_signed_agreement(ag):
                    sent += 1
            except Exception as e:
                self.message_user(request, f"Email failed for Agreement {ag.id}: {e}", level=messages.ERROR)
        if sent:
            self.message_user(request, f"Emailed {sent} agreement(s).", level=messages.SUCCESS)


@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = ("id", "agreement", "order", "title", "amount", "start_date", "completion_date", "completed", "is_invoiced")
    search_fields = ("title", "agreement__project__title", "agreement__project__number")
    list_filter = ("completed", "is_invoiced")


@admin.register(MilestoneFile)
class MilestoneFileAdmin(admin.ModelAdmin):
    list_display = ("id", "milestone", "uploaded_by", "uploaded_at", "file")
    search_fields = ("milestone__title", "uploaded_by__email")


@admin.register(MilestoneComment)
class MilestoneCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "milestone", "author", "created_at")
    search_fields = ("milestone__title", "author__email", "content")
    list_filter = ("created_at",)


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


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("id", "agreement", "description", "amount", "incurred_date", "status", "created_at")
    search_fields = ("description", "agreement__project__title", "agreement__project__number")
    list_filter = ("status", "incurred_date", "created_at")


@admin.register(AgreementAmendment)
class AgreementAmendmentAdmin(admin.ModelAdmin):
    list_display = ("id", "parent", "child", "amendment_number")
    search_fields = ("parent__project__number", "child__project__number")


# --- Dispute admin (SAFE / optional) -----------------------------------------
if Dispute is not None:
    @admin.register(Dispute)
    class DisputeAdmin(admin.ModelAdmin):
        """
        Keep this minimal because Dispute fields vary between codebases.
        We only show a generic string plus id. No custom ordering/filters on unknown fields.
        """
        list_display = ("id", "obj_str")

        def obj_str(self, obj):
            return str(obj)

    if DisputeAttachment is not None:
        @admin.register(DisputeAttachment)
        class DisputeAttachmentAdmin(admin.ModelAdmin):
            list_display = ("id", "dispute", "file") if hasattr(DisputeAttachment, "file") else ("id", "dispute")
            search_fields = ("dispute__id",)


# --- NEW: AgreementAttachment admin (warranties/addenda) ---------------------
if AgreementAttachment is not None:
    @admin.register(AgreementAttachment)
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
