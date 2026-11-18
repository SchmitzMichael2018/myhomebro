"""Paid website projects, independent of contractor self-service websites."""
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models


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
