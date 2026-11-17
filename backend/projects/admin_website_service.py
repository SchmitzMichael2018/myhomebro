from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils.html import format_html

from .models_website_service import WebsiteServiceMaterial, WebsiteServiceProject, WebsiteServiceRequest


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


@admin.register(WebsiteServiceProject)
class WebsiteServiceProjectAdmin(admin.ModelAdmin):
    list_display = ["business_name", "owner", "business_type", "status", "updated_at"]
    list_filter = ["status", "business_type"]
    search_fields = ["business_name", "owner__email"]
    readonly_fields = ["created_at", "updated_at"]
    inlines = [WebsiteMaterialInline, WebsiteRequestInline]

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
