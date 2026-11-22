from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .models_website_service import WebsiteServiceEvent, WebsiteServiceMaterial, WebsiteServiceProject, WebsiteServiceRequest
from .services.website_service import send_website_notification


class WebsiteRequestInline(admin.TabularInline):
    model = WebsiteServiceRequest
    extra = 0
    fields = ["message", "created_at", "status", "response"]
    readonly_fields = ["message", "created_at"]
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


class WebsiteMaterialInline(admin.TabularInline):
    model = WebsiteServiceMaterial
    extra = 0
    fields = ["original_name", "size", "created_at", "download_link"]
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description="File")
    def download_link(self, obj):
        return format_html('<a href="{}">Download</a>', reverse("admin:website-service-material-download", args=[obj.pk]))


class WebsiteEventInline(admin.TabularInline):
    model = WebsiteServiceEvent
    extra = 0
    fields = ["event_type", "recipient", "delivered", "detail", "created_at"]
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

@admin.register(WebsiteServiceProject)
class WebsiteServiceProjectAdmin(admin.ModelAdmin):
    list_display = ["business_name", "owner", "business_type", "status", "payment_status", "updated_at"]
    list_filter = ["status", "payment_status", "business_type"]
    search_fields = ["business_name", "owner__email"]
    readonly_fields = ["created_at", "updated_at", "proposal_sent_at", "terms_accepted_at", "paid_at", "stripe_checkout_session_id", "stripe_payment_intent_id", "final_approved_at", "menu_public_id", "menu_draft", "menu_revision", "menu_published", "menu_published_revision", "menu_published_at"]
    inlines = [WebsiteMaterialInline, WebsiteRequestInline, WebsiteEventInline]

    def save_model(self, request, obj, form, change):
        previous = WebsiteServiceProject.objects.filter(pk=obj.pk).first() if change else None
        proposal_changed = any(name in form.changed_data for name in ["proposal_deliverables", "service_terms", "refund_terms", "quoted_price_cents"])
        if obj.has_complete_proposal and (not obj.proposal_sent_at or proposal_changed):
            obj.proposal_sent_at = timezone.now()
            if obj.payment_status not in {"paid", "refunded"}:
                obj.payment_status = "checkout"
                obj.stripe_checkout_session_id = None
                obj.terms_accepted_at = None
        super().save_model(request, obj, form, change)
        if obj.proposal_sent_at and (not previous or obj.proposal_sent_at != previous.proposal_sent_at):
            send_website_notification(obj, "proposal_available", "Your website proposal is ready", "Review the price, deliverables, service terms, and refund terms in your dashboard before accepting and paying.", "customer")
        preview_became_available = bool(obj.preview_url) and (not previous or previous.preview_url != obj.preview_url)
        if preview_became_available:
            send_website_notification(obj, "preview_available", "Your website preview is ready", "Open your dashboard to review the preview and send changes or final approval.", "customer")

    def save_formset(self, request, form, formset, change):
        super().save_formset(request, form, formset, change)
        if formset.model is WebsiteServiceRequest:
            for request_form in formset.forms:
                if request_form.instance.pk and set(request_form.changed_data) & {"status", "response"}:
                    send_website_notification(form.instance, "request_updated", "Your website request was updated", request_form.instance.response or "The status of your request changed. See the dashboard for details.", "customer")

    def get_urls(self):
        return [path("materials/<int:material_id>/download/", self.admin_site.admin_view(self.download_material), name="website-service-material-download")] + super().get_urls()

    def download_material(self, request, material_id):
        material = get_object_or_404(WebsiteServiceMaterial.objects.select_related("project"), pk=material_id)
        if not self.has_view_permission(request, material.project):
            raise PermissionDenied
        response = FileResponse(material.file.open("rb"), as_attachment=True, filename=material.original_name, content_type="application/octet-stream")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
