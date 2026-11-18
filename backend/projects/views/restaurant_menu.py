"""Restaurant-owned drafts and explicit, separately served public menu snapshots."""
import io
import uuid
import warnings
from decimal import Decimal

from PIL import Image, ImageOps
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_website_service import WebsiteMenuEvent, WebsiteMenuPhoto, WebsiteServiceProject
from .website_service import WebsiteServiceThrottle


def menu_origin():
    return settings.SITE_URL.rstrip("/")


def menu_feed(project):
    return f"{menu_origin()}/api/projects/public/restaurant-menus/{project.menu_public_id}/"


def photo_url(project, photo_id):
    return f"{menu_feed(project)}photos/{photo_id}/"


class MenuItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=2000, allow_blank=True, default="")
    category = serializers.CharField(max_length=80, default="Menu")
    price = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("0"), coerce_to_string=True)
    available = serializers.BooleanField(default=True)
    vegetarian = serializers.BooleanField(default=False)
    photo_id = serializers.UUIDField(allow_null=True, default=None)


class MenuDraftSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    items = MenuItemSerializer(many=True, max_length=150)

    def validate_items(self, items):
        ids = [item["id"] for item in items]
        if len(ids) != len(set(ids)):
            raise ValidationError("Each menu item needs a unique ID.")
        return items


def menu_state(project):
    return {
        "revision": project.menu_revision, "items": project.menu_draft,
        "published_revision": project.menu_published_revision,
        "published_at": project.menu_published_at,
        "is_published": project.menu_published is not None,
        "feed_url": menu_feed(project), "currency": "USD",
    }


class OwnerMenuView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WebsiteServiceThrottle]

    def project(self, request, pk, lock=False):
        rows = WebsiteServiceProject.objects.filter(owner=request.user)
        if lock:
            rows = rows.select_for_update()
        project = get_object_or_404(rows, pk=pk)
        if project.business_type != "restaurant":
            raise ValidationError({"detail": "Save this website project as a restaurant to manage its menu."})
        return project

    def get(self, request, pk):
        return Response(menu_state(self.project(request, pk)))

    def put(self, request, pk):
        with transaction.atomic():
            project = self.project(request, pk, lock=True)
            serializer = MenuDraftSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            if serializer.validated_data["revision"] != project.menu_revision:
                return Response({"detail": "This menu changed in another window. Reload the saved menu before applying your edits."}, status=409)
            photo_ids = {item["photo_id"] for item in serializer.validated_data["items"] if item["photo_id"]}
            if project.menu_photos.filter(pk__in=photo_ids).count() != len(photo_ids):
                raise ValidationError({"detail": "A selected photo does not belong to this restaurant."})
            # Serializer output contains UUID/Decimal values; .data normalizes them for JSON storage.
            items = list(serializer.data["items"])
            if items != project.menu_draft:
                project.menu_draft = items
                project.menu_revision += 1
                project.save(update_fields=["menu_draft", "menu_revision", "updated_at"])
                WebsiteMenuEvent.objects.create(project=project, actor=request.user, action="saved", revision=project.menu_revision)
            return Response(menu_state(project))


class OwnerMenuPublishView(OwnerMenuView):
    http_method_names = ["post", "options"]

    def post(self, request, pk):
        with transaction.atomic():
            project = self.project(request, pk, lock=True)
            if request.data.get("revision") != project.menu_revision:
                return Response({"detail": "Save or reload your menu before publishing."}, status=409)
            if project.menu_published_revision != project.menu_revision or project.menu_published is None:
                project.menu_published = project.menu_draft
                project.menu_published_revision = project.menu_revision
                project.menu_published_at = timezone.now()
                project.save(update_fields=["menu_published", "menu_published_revision", "menu_published_at", "updated_at"])
                WebsiteMenuEvent.objects.create(project=project, actor=request.user, action="published", revision=project.menu_revision)
            return Response(menu_state(project))


class OwnerMenuUnpublishView(OwnerMenuView):
    http_method_names = ["post", "options"]

    def post(self, request, pk):
        with transaction.atomic():
            project = self.project(request, pk, lock=True)
            if request.data.get("revision") != project.menu_revision:
                return Response({"detail": "Reload the current menu before taking it offline."}, status=409)
            if project.menu_published is not None:
                project.menu_published = None
                project.menu_published_revision = None
                project.menu_published_at = None
                project.save(update_fields=["menu_published", "menu_published_revision", "menu_published_at", "updated_at"])
                WebsiteMenuEvent.objects.create(project=project, actor=request.user, action="unpublished", revision=project.menu_revision)
            return Response(menu_state(project))


class OwnerMenuPhotoView(OwnerMenuView):
    http_method_names = ["get", "post", "head", "options"]

    def get(self, request, pk, photo_id=None):
        if photo_id is None:
            from rest_framework.exceptions import MethodNotAllowed
            raise MethodNotAllowed("GET")
        photo = get_object_or_404(WebsiteMenuPhoto, project=self.project(request, pk), pk=photo_id)
        response = FileResponse(photo.file.open("rb"), content_type="image/jpeg")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def post(self, request, pk, photo_id=None):
        if photo_id is not None:
            from rest_framework.exceptions import MethodNotAllowed
            raise MethodNotAllowed("POST")
        project = self.project(request, pk)  # Ownership checked before decoding.
        upload = request.FILES.get("file")
        if not upload or not 0 < upload.size <= 5 * 1024 * 1024:
            raise ValidationError({"detail": "Choose a JPG, PNG, or WebP photo up to 5 MB."})
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                image = Image.open(upload)
                if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 20_000_000:
                    raise ValueError()
                image = ImageOps.exif_transpose(image)
                image.thumbnail((1280, 1280))
                converted = image.convert("RGB")
                output = io.BytesIO()
                converted.save(output, format="JPEG", quality=85, optimize=True)
        except Exception:
            raise ValidationError({"detail": "This file is not a supported photo. Use JPG, PNG, or WebP."})
        with transaction.atomic():
            project = self.project(request, pk, lock=True)
            if project.menu_photos.count() >= 200:
                raise ValidationError({"detail": "This project has reached its menu photo limit. Contact MyHomeBro for help."})
            photo = WebsiteMenuPhoto(project=project)
            photo.file.save(f"{uuid.uuid4()}.jpg", ContentFile(output.getvalue()), save=True)
        return Response({"id": str(photo.pk)}, status=201)


class PublicMenuView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        # Published menu data is intentionally public and usable on independent customer domains.
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def project(self, public_id):
        return get_object_or_404(WebsiteServiceProject, menu_public_id=public_id, business_type="restaurant", menu_published__isnull=False)

    def get(self, request, public_id):
        project = self.project(public_id)
        items = [dict(item, photo_url=photo_url(project, item["photo_id"]) if item.get("photo_id") else "") for item in project.menu_published if item.get("available")]
        return Response({"business_name": project.business_name, "currency": "USD", "revision": project.menu_published_revision, "items": items})


class PublicMenuPhotoView(PublicMenuView):
    def get(self, request, public_id, photo_id):
        project = self.project(public_id)
        if not any(item.get("available") and item.get("photo_id") == str(photo_id) for item in project.menu_published):
            from django.http import Http404
            raise Http404
        photo = get_object_or_404(WebsiteMenuPhoto, project=project, pk=photo_id)
        return FileResponse(photo.file.open("rb"), content_type="image/jpeg")
