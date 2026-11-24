from datetime import timedelta

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .models_website_service import WebsiteServiceEvent, WebsiteServiceMaterial, WebsiteServiceProject, WebsiteServiceRequest
from .services.website_service import expire_checkout_for_revision, queue_website_notification


PROPOSAL_FIELDS = ("proposal_deliverables", "service_terms", "refund_terms", "quoted_price_cents")
PAYMENT_FIELDS = (
    "proposal_sent_at", "terms_accepted_at", "paid_at", "payment_status", "stripe_checkout_session_id",
    "checkout_proposal_fingerprint", "checkout_attempt_token", "checkout_attempt_started_at",
    "stripe_payment_intent_id",
)
REVISION_REVIEW_EVENT = "payment_revision_review"


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

class PaymentRevisionReviewFilter(admin.SimpleListFilter):
    title = "Checkout revision review"
    parameter_name = "checkout_revision_review"

    def lookups(self, request, model_admin):
        return [("flagged", "Flagged for review")]

    def queryset(self, request, queryset):
        if self.value() == "flagged":
            return queryset.filter(events__event_type=REVISION_REVIEW_EVENT).distinct()
        return queryset


class WebsiteServiceProjectForm(forms.ModelForm):
    class Meta:
        model = WebsiteServiceProject
        fields = "__all__"
        help_texts = {
            "next_step": "Tell the customer who acts next, what they should do, and when they can expect an update.",
            "proposal_deliverables": "List the pages, features, and handoff included at this price. Call out any exclusions.",
            "service_terms": "Confirm timing, customer materials, revision rounds, launch approval, and who pays for hosting, domain, and ongoing care.",
            "refund_terms": "State how to request cancellation, what is refundable at each stage, and the timing for approved refunds.",
        }


@admin.register(WebsiteServiceProject)
class WebsiteServiceProjectAdmin(admin.ModelAdmin):
    form = WebsiteServiceProjectForm
    list_display = ["business_name", "owner", "business_type", "status", "payment_status", "updated_at"]
    list_filter = ["status", "payment_status", "business_type", PaymentRevisionReviewFilter]
    search_fields = ["business_name", "owner__email"]
    readonly_fields = (
        "created_at", "updated_at", *PAYMENT_FIELDS, "final_approved_at", "menu_public_id",
        "menu_draft", "menu_revision", "menu_published", "menu_published_revision", "menu_published_at",
    )
    inlines = [WebsiteMaterialInline, WebsiteRequestInline, WebsiteEventInline]

    def get_readonly_fields(self, request, obj=None):
        if obj and (obj.paid_at or obj.payment_status in {"paid", "refunded"}):
            return (*self.readonly_fields, *PROPOSAL_FIELDS)
        return self.readonly_fields

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        previous = WebsiteServiceProject.objects.select_for_update().get(pk=obj.pk) if change else None
        proposal_changed = bool(set(form.changed_data).intersection(PROPOSAL_FIELDS))
        if previous:
            stale_proposal = obj.proposal_sent_at != previous.proposal_sent_at
            payment_arrived = not obj.paid_at and obj.payment_status != "paid" and previous.payment_status == "paid"
            for field in PAYMENT_FIELDS:
                setattr(obj, field, getattr(previous, field))

            if proposal_changed:
                if payment_arrived and obj.stripe_checkout_session_id:
                    self._flag_revision_review(obj)
                reason = self._revision_block_reason(obj, stale_proposal)
                if reason:
                    proposal_changed = False
                    self.message_user(request, reason, level=messages.WARNING)

            for field in PROPOSAL_FIELDS:
                if not proposal_changed or field not in form.changed_data:
                    setattr(obj, field, getattr(previous, field))

        if proposal_changed or (not previous and obj.has_complete_proposal):
            obj.proposal_sent_at = timezone.now() if obj.has_complete_proposal else None
            obj.payment_status = "checkout" if obj.has_complete_proposal else "not_ready"
            obj.stripe_checkout_session_id = None
            obj.checkout_proposal_fingerprint = ""
            obj.checkout_attempt_token = ""
            obj.checkout_attempt_started_at = None
            obj.terms_accepted_at = None
        super().save_model(request, obj, form, change)
        if obj.proposal_sent_at and (not previous or obj.proposal_sent_at != previous.proposal_sent_at):
            queue_website_notification(obj, "proposal_available", "Your website proposal is ready", "Review the price, deliverables, service terms, and refund terms in your dashboard before accepting and paying.", "customer")
        preview_became_available = bool(obj.preview_url) and (not previous or previous.preview_url != obj.preview_url)
        if preview_became_available:
            queue_website_notification(obj, "preview_available", "Your website preview is ready", "Open your dashboard to review the preview and send changes or final approval.", "customer")

    def _revision_block_reason(self, project, stale_proposal):
        if stale_proposal:
            return "The proposal changed while this form was open. Review the latest proposal before revising it."
        if project.paid_at or project.payment_status in {"paid", "refunded"}:
            return "The accepted proposal is locked because payment has been recorded."
        if (
            project.checkout_attempt_token
            and project.checkout_attempt_started_at
            and project.checkout_attempt_started_at > timezone.now() - timedelta(minutes=5)
        ):
            return "Checkout is being prepared. Wait and review its status before revising the proposal."

        session_id = project.stripe_checkout_session_id
        if session_id and not expire_checkout_for_revision(session_id):
            self._flag_revision_review(project)
            return (
                "The proposal and its Checkout link were retained. Check Stripe for payment and review "
                "the Checkout revision flag before making another change."
            )
        return None

    def _flag_revision_review(self, project):
        WebsiteServiceEvent.objects.get_or_create(
            project=project,
            event_type=REVISION_REVIEW_EVENT,
            recipient="",
            detail=f"Checkout {project.stripe_checkout_session_id}: revision blocked. Verify payment in Stripe.",
        )

    def save_formset(self, request, form, formset, change):
        super().save_formset(request, form, formset, change)
        if formset.model is WebsiteServiceRequest:
            for request_form in formset.forms:
                if request_form.instance.pk and set(request_form.changed_data) & {"status", "response"}:
                    queue_website_notification(form.instance, "request_updated", "Your website request was updated", request_form.instance.response or "The status of your request changed. See the dashboard for details.", "customer")

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
