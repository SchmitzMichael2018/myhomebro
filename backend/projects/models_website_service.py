"""Paid website projects, independent of contractor self-service websites."""
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.utils import timezone


def website_material_storage():
    # Deliberately outside MEDIA_ROOT and static files; downloads require the API.
    return FileSystemStorage(location=getattr(
        settings, "WEBSITE_MATERIAL_ROOT", Path(settings.BASE_DIR).parent / "private_website_materials"
    ))


def website_material_path(instance, filename):
    return f"{instance.project_id}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class WebsiteServiceProject(models.Model):
    STATUS_CHOICES = [
        ("brief", "Preparing your brief"), ("review", "Brief under review"),
        ("building", "Website in progress"), ("preview", "Preview ready"),
        ("launched", "Launched"), ("maintenance", "Ongoing care"),
    ]
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="website_service_projects")
    business_name = models.CharField(max_length=180)
    business_type = models.CharField(max_length=20, choices=[("contractor", "Contractor"), ("restaurant", "Restaurant"), ("other", "Other business")], default="contractor")
    template_id = models.CharField(max_length=50, blank=True)
    current_website = models.URLField(blank=True)
    description = models.TextField(max_length=8000, blank=True)
    services = models.TextField(max_length=8000, blank=True)
    contact_details = models.TextField(max_length=3000, blank=True)
    design_notes = models.TextField(max_length=8000, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="brief", db_index=True)
    next_step = models.TextField(max_length=3000, blank=True)
    preview_url = models.URLField(blank=True)
    live_url = models.URLField(blank=True)
    proposal_deliverables = models.TextField(max_length=8000, blank=True)
    service_terms = models.TextField(max_length=8000, blank=True)
    refund_terms = models.TextField(max_length=4000, blank=True)
    quoted_price_cents = models.PositiveIntegerField(null=True, blank=True)
    proposal_sent_at = models.DateTimeField(null=True, blank=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    payment_status = models.CharField(
        max_length=20,
        choices=[("not_ready", "Not ready"), ("checkout", "Checkout available"), ("paid", "Paid"), ("failed", "Payment failed"), ("refunded", "Refunded")],
        default="not_ready",
        db_index=True,
    )
    stripe_checkout_session_id = models.CharField(max_length=255, null=True, blank=True, unique=True)
    checkout_proposal_fingerprint = models.CharField(max_length=64, blank=True)
    checkout_attempt_token = models.CharField(max_length=32, blank=True)
    checkout_attempt_started_at = models.DateTimeField(null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=255, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    final_approved_at = models.DateTimeField(null=True, blank=True)
    menu_public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    menu_draft = models.JSONField(default=list, blank=True)
    menu_revision = models.PositiveIntegerField(default=0)
    menu_published = models.JSONField(null=True, blank=True)
    menu_published_revision = models.PositiveIntegerField(null=True, blank=True)
    menu_published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-pk"]

    def __str__(self):
        return self.business_name

    @property
    def has_complete_proposal(self):
        return bool(
            self.quoted_price_cents
            and self.proposal_deliverables.strip()
            and self.service_terms.strip()
            and self.refund_terms.strip()
        )


class WebsiteServiceMaterial(models.Model):
    project = models.ForeignKey(WebsiteServiceProject, on_delete=models.CASCADE, related_name="materials")
    file = models.FileField(storage=website_material_storage, upload_to=website_material_path)
    original_name = models.CharField(max_length=200)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class WebsiteServiceRequest(models.Model):
    project = models.ForeignKey(WebsiteServiceProject, on_delete=models.CASCADE, related_name="requests")
    message = models.TextField(max_length=5000)
    status = models.CharField(max_length=20, choices=[("open", "Open"), ("in_progress", "In progress"), ("done", "Completed")], default="open")
    response = models.TextField(max_length=5000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]


class WebsiteServiceEvent(models.Model):
    """Auditable customer/staff notification attempts for the paid website service."""

    project = models.ForeignKey(WebsiteServiceProject, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=40, db_index=True)
    recipient = models.EmailField()
    delivered = models.BooleanField(default=False)
    detail = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-pk"]


def restaurant_menu_photo_path(instance, filename):
    return f"menu/{instance.project_id}/{instance.pk}.jpg"


class WebsiteMenuPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(WebsiteServiceProject, on_delete=models.CASCADE, related_name="menu_photos")
    file = models.FileField(storage=website_material_storage, upload_to=restaurant_menu_photo_path)
    created_at = models.DateTimeField(auto_now_add=True)


class WebsiteMenuEvent(models.Model):
    project = models.ForeignKey(WebsiteServiceProject, on_delete=models.CASCADE, related_name="menu_events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=16, choices=[("saved", "Saved draft"), ("published", "Published"), ("unpublished", "Unpublished")])
    revision = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
