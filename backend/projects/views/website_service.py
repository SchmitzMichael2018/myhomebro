from pathlib import Path
import warnings

from PIL import Image
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.viewsets import ModelViewSet

from projects.models_website_service import WebsiteServiceMaterial, WebsiteServiceProject, WebsiteServiceRequest

TEMPLATES = {"contractor-showcase", "contractor-local", "contractor-premium", "restaurant-food", "restaurant-local", "restaurant-dining"}


class WebsiteServiceThrottle(UserRateThrottle):
    scope = "website_service"
    rate = "240/hour"


class MaterialSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebsiteServiceMaterial
        fields = ["id", "original_name", "size", "created_at"]


class RequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebsiteServiceRequest
        fields = ["id", "message", "status", "response", "created_at"]
        read_only_fields = ["id", "status", "response", "created_at"]


class ProjectSerializer(serializers.ModelSerializer):
    materials = MaterialSerializer(many=True, read_only=True)
    requests = RequestSerializer(many=True, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = WebsiteServiceProject
        fields = ["id", "business_name", "business_type", "template_id", "current_website", "description", "services", "contact_details", "design_notes", "status", "status_label", "next_step", "preview_url", "live_url", "created_at", "updated_at", "materials", "requests"]
        read_only_fields = ["id", "status", "next_step", "preview_url", "live_url", "created_at", "updated_at"]

    def validate_template_id(self, value):
        if value and value not in TEMPLATES:
            raise serializers.ValidationError("Choose a design from the template gallery.")
        return value

    def validate_business_type(self, value):
        if self.instance and value != "restaurant" and (self.instance.menu_draft or self.instance.menu_published is not None):
            raise serializers.ValidationError("Remove all draft dishes and take the menu offline before changing the business type.")
        return value


class WebsiteServiceProjectViewSet(ModelViewSet):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WebsiteServiceThrottle]
    serializer_class = ProjectSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        # Even staff use their own customer workspace; staff administration is separate.
        return WebsiteServiceProject.objects.filter(owner=self.request.user).prefetch_related("materials", "requests")

    def perform_create(self, serializer):
        if WebsiteServiceProject.objects.filter(owner=self.request.user).count() >= 20:
            raise serializers.ValidationError({"detail": "Please contact MyHomeBro to add another website project."})
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        with transaction.atomic():
            project = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if project.status == "brief":
                if not project.description.strip() or not project.contact_details.strip():
                    raise serializers.ValidationError({"detail": "Add your website goals and public business contact information before submitting."})
                project.status = "review"
                project.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(project).data)

    @action(detail=True, methods=["post"])
    def requests(self, request, pk=None):
        project = self.get_object()
        serializer = RequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(project=project)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def materials(self, request, pk=None):
        project = self.get_object()  # Ownership before reading the uploaded file.
        upload = request.FILES.get("file")
        if not upload or upload.size > 5 * 1024 * 1024 or upload.size == 0:
            raise serializers.ValidationError({"detail": "Choose a JPG, PNG, WebP, or PDF up to 5 MB."})
        suffix = Path(upload.name).suffix.lower()
        try:
            if suffix == ".pdf":
                if upload.read(5) != b"%PDF-":
                    raise ValueError()
            elif suffix in {".jpg", ".jpeg", ".png", ".webp"}:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    image = Image.open(upload)
                    if image.format != {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[suffix]:
                        raise ValueError()
                    image.verify()
            else:
                raise ValueError()
        except Exception:
            raise serializers.ValidationError({"detail": "This file is not a supported photo or PDF."})
        finally:
            upload.seek(0)
        with transaction.atomic():
            project = WebsiteServiceProject.objects.select_for_update().get(pk=project.pk)
            if project.materials.count() >= 20:
                raise serializers.ValidationError({"detail": "A project can hold up to 20 files. Contact MyHomeBro if you need to share more."})
            material = WebsiteServiceMaterial.objects.create(project=project, file=upload, original_name=Path(upload.name).name[:200], size=upload.size)
        return Response(MaterialSerializer(material).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path=r"materials/(?P<material_id>\d+)/download")
    def download(self, request, pk=None, material_id=None):
        material = get_object_or_404(WebsiteServiceMaterial, project=self.get_object(), pk=material_id)
        response = FileResponse(material.file.open("rb"), as_attachment=True, filename=material.original_name, content_type="application/octet-stream")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
