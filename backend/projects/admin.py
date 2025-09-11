# projects/admin.py
from __future__ import annotations

from django.contrib import admin, messages
from django.contrib.admin import SimpleListFilter
from django.utils import timezone
from django.http import HttpResponse
from typing import Iterable
import csv

from .models import (
    Homeowner,
    Contractor,
    Project,
    Agreement,
    Milestone,
    Invoice,
)

# Optional: import Dispute if present in your models
try:
    from .models import Dispute
    HAS_DISPUTE = True
except Exception:
    HAS_DISPUTE = False


# =========================
# Common helpers / mixins
# =========================

class ExportCsvMixin:
    """Adds an 'Export selected to CSV' bulk action to any ModelAdmin."""
    def export_as_csv(self, request, queryset):
        model = self.model
        meta = model._meta
        field_names = [f.name for f in meta.fields]

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{meta.model_name}_export.csv"'
        writer = csv.writer(response)
        writer.writerow(field_names)

        for obj in queryset:
            row = []
            for field in field_names:
                val = getattr(obj, field, "")
                if isinstance(val, timezone.datetime):
                    try:
                        val = timezone.localtime(val).isoformat()
                    except Exception:
                        val = val.isoformat()
                row.append(str(val))
            writer.writerow(row)

        return response

    export_as_csv.short_description = "Export selected to CSV"


# =========================
# Inlines
# =========================

class MilestoneInline(admin.TabularInline):
    model = Milestone
    extra = 0
    fields = ("order", "title", "amount", "start_date", "completion_date", "completed", "is_invoiced")
    readonly_fields = ()
    ordering = ("order",)


class InvoiceInline(admin.TabularInline):
    model = Invoice
    extra = 0
    fields = ("invoice_number", "amount", "status", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)


# Dispute inline (only if model exists)
if HAS_DISPUTE:
    class DisputeInline(admin.TabularInline):
        model = Dispute
        extra = 0
        fields = ("status", "raised_by_role", "opened_at", "resolved_at", "resolution_summary")
        readonly_fields = ("opened_at", "resolved_at")
        ordering = ("-opened_at",)


class AgreementInline(admin.TabularInline):
    model = Agreement
    extra = 0
    fields = ("project", "contractor", "total_cost", "escrow_funded", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)


# =========================
# Custom Filters
# =========================

class MilestoneStatusFilter(SimpleListFilter):
    title = "Milestone status"
    parameter_name = "m_status"

    def lookups(self, request, model_admin):
        return [
            ("completed", "Completed"),
            ("open", "Not completed"),
            ("invoiced", "Invoiced"),
            ("not_invoiced", "Not invoiced"),
        ]

    def queryset(self, request, qs):
        v = self.value()
        if v == "completed":
            return qs.filter(completed=True)
        if v == "open":
            return qs.filter(completed=False)
        if v == "invoiced":
            return qs.filter(is_invoiced=True)
        if v == "not_invoiced":
            return qs.filter(is_invoiced=False)
        return qs


class InvoiceStatusFilter(SimpleListFilter):
    title = "Invoice status"
    parameter_name = "inv_status"

    def lookups(self, request, model_admin):
        # Keep generic to match your current status values
        return [
            ("draft", "Draft"),
            ("sent", "Sent"),
            ("pending_approval", "Pending Approval"),
            ("approved", "Approved"),
            ("paid", "Paid"),
            ("disputed", "Disputed"),
        ]

    def queryset(self, request, qs):
        v = self.value()
        if v:
            return qs.filter(status=v)
        return qs


# Dispute filter (only if model exists)
if HAS_DISPUTE:
    class DisputeStatusFilter(SimpleListFilter):
        title = "Dispute status"
        parameter_name = "d_status"

        def lookups(self, request, model_admin):
            # Adjust choices to your model's values if different
            return [
                ("open", "Open"),
                ("awaiting_mediation", "Awaiting Mediation"),
                ("in_arbitration", "In Arbitration"),
                ("resolved", "Resolved"),
            ]

        def queryset(self, request, qs):
            v = self.value()
            if v:
                return qs.filter(status=v)
            return qs


# =========================
# ModelAdmins
# =========================

@admin.register(Homeowner)
class HomeownerAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    (id, full_name, email, phone_number, status, created_at)
    """
    list_display = ("id", "full_name", "email", "phone_number", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("full_name", "email", "phone_number")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    actions = ["export_as_csv"]


@admin.register(Contractor)
class ContractorAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    Contractor with Agreements inline for quick drill-down.
    """
    list_display = ("id", "name", "email", "phone", "business_name", "created_at")
    list_filter = ("created_at",)
    search_fields = (
        "name", "email", "phone", "business_name",
        "user__first_name", "user__last_name", "user__email",
    )
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    inlines = [AgreementInline]
    list_select_related = ("user",)
    actions = ["export_as_csv"]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    Projects with Agreements inline.
    """
    list_display = ("id", "number", "title", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("number", "title")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    inlines = [AgreementInline]
    actions = ["export_as_csv"]


@admin.register(Agreement)
class AgreementAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    Agreements show Milestones + Invoices inline; Disputes inline if present.
    """
    list_display = ("id", "project", "contractor", "total_cost", "escrow_funded", "created_at")
    list_filter = ("escrow_funded", "created_at")
    search_fields = (
        "project__number",
        "project__title",
        "contractor__user__email",
        "contractor__email",
        "contractor__name",
        "contractor__business_name",
    )
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    inlines = [MilestoneInline, InvoiceInline] + ([DisputeInline] if HAS_DISPUTE else [])
    list_select_related = ("project", "contractor")
    actions = ["export_as_csv"]


@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    Bulk actions for ops: mark completed / invoiced.
    """
    list_display = (
        "id",
        "agreement",
        "order",
        "title",
        "amount",
        "start_date",
        "completion_date",
        "is_invoiced",
        "completed",
    )
    list_filter = (MilestoneStatusFilter, "start_date", "completion_date")
    search_fields = ("title", "agreement__project__number", "agreement__project__title")
    ordering = ("agreement", "order")
    list_select_related = ("agreement", "agreement__project")
    actions = ["action_mark_completed", "action_mark_invoiced", "export_as_csv"]

    @admin.action(description="Mark selected milestones as completed (set completion_date=now if empty)")
    def action_mark_completed(self, request, queryset):
        now = timezone.now().date()
        updated = 0
        for ms in queryset:
            if not ms.completed:
                ms.completed = True
                if not ms.completion_date:
                    ms.completion_date = now
                ms.save(update_fields=["completed", "completion_date"])
                updated += 1
        if updated:
            self.message_user(request, f"Marked {updated} milestone(s) completed.", level=messages.SUCCESS)

    @admin.action(description="Mark selected milestones as invoiced")
    def action_mark_invoiced(self, request, queryset):
        updated = queryset.exclude(is_invoiced=True).update(is_invoiced=True)
        if updated:
            self.message_user(request, f"Marked {updated} milestone(s) as invoiced.", level=messages.SUCCESS)


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin, ExportCsvMixin):
    """
    Invoice ops with status filter & fast relation loading.
    """
    list_display = ("id", "invoice_number", "agreement", "amount", "status", "created_at")
    list_filter = (InvoiceStatusFilter, "created_at")
    search_fields = ("invoice_number", "agreement__project__number", "agreement__project__title")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("agreement", "agreement__project")
    actions = ["export_as_csv"]


# =========================
# Dispute Admin (if present)
# =========================
if HAS_DISPUTE:
    @admin.register(Dispute)
    class DisputeAdmin(admin.ModelAdmin, ExportCsvMixin):
        """
        Disputes tie together Agreements/Invoices and your Disputed Modal frontend.
        Assumes fields: agreement (FK), optional invoice (FK), status, raised_by_role,
        opened_at, resolved_at, resolution_summary, notes.
        Adjust field names if your model uses different ones.
        """
        list_display = (
            "id",
            "agreement",
            "get_invoice",
            "raised_by_role",
            "status",
            "opened_at",
            "resolved_at",
            "short_resolution",
        )
        list_filter = (DisputeStatusFilter, "opened_at")
        search_fields = (
            "agreement__project__number",
            "agreement__project__title",
            "resolution_summary",
            "notes",
        )
        readonly_fields = ("opened_at", "resolved_at")
        ordering = ("-opened_at",)
        date_hierarchy = "opened_at"
        actions = ["action_mark_resolved", "export_as_csv"]

        def get_invoice(self, obj):
            # Support either 'invoice' FK or None
            inv = getattr(obj, "invoice", None)
            return inv or "—"
        get_invoice.short_description = "Invoice"

        def short_resolution(self, obj):
            txt = (getattr(obj, "resolution_summary", "") or "").strip()
            return (txt[:80] + "…") if len(txt) > 80 else txt
        short_resolution.short_description = "Resolution"

        @admin.action(description="Mark as resolved (sets resolved_at=now)")
        def action_mark_resolved(self, request, queryset):
            now = timezone.now()
            updated = 0
            for d in queryset:
                if getattr(d, "status", None) != "resolved":
                    setattr(d, "status", "resolved")
                    # set resolved_at if present on model
                    if hasattr(d, "resolved_at"):
                        d.resolved_at = now
                    d.save()
                    updated += 1
            if updated:
                self.message_user(request, f"Resolved {updated} dispute(s).", level=messages.SUCCESS)
