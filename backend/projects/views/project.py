# backend/projects/views/project.py
from __future__ import annotations

from typing import Iterable

from django.apps import apps
from django.db import transaction
from django.db.models import QuerySet
from rest_framework import viewsets, permissions, serializers, status
from rest_framework.parsers import JSONParser
from rest_framework.request import Request
from rest_framework.response import Response


def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None


Project = _get_model("projects", "Project")
Contractor = _get_model("projects", "Contractor")

# Prefer your real serializer; fall back if needed.
ProjectSerializer = None
try:
    mod = __import__("projects.serializers.project", fromlist=["ProjectSerializer"])
    ProjectSerializer = getattr(mod, "ProjectSerializer", None)
except Exception:
    ProjectSerializer = None

if Project is not None and ProjectSerializer is None:
    class _FallbackProjectSerializer(serializers.ModelSerializer):
        class Meta:
            model = Project  # type: ignore
            fields = "__all__"
    ProjectSerializer = _FallbackProjectSerializer  # type: ignore


class IsAuthed(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class ProjectViewSet(viewsets.ModelViewSet):
    """
    POST /api/projects/projects/
      - If the client omits `contractor`, infer it from request.user's contractor profile.
      - If provided, we still allow it (subject to your permission checks).

    This brings back the old "it just works when I'm signed in" behavior.
    """
    permission_classes = [IsAuthed]
    parser_classes = (JSONParser,)

    @property
    def queryset(self) -> QuerySet | list:
        mdl = Project or _get_model("projects", "Project")
        if mdl is None:
            return []
        return mdl.objects.select_related("contractor", "homeowner").all().order_by("-created_at")

    serializer_class = ProjectSerializer  # type: ignore

    def get_queryset(self) -> Iterable:
        return self.queryset

    @transaction.atomic
    def create(self, request: Request, *args, **kwargs) -> Response:
        if Project is None:
            return Response({"detail": "Project model unavailable."}, status=503)

        data = request.data.copy()

        # ---- infer contractor if missing ----
        if not data.get("contractor"):
            mdl_ctr = Contractor or _get_model("projects", "Contractor")
            if mdl_ctr is None:
                return Response({"detail": "Contractor model unavailable."}, status=503)
            try:
                c = mdl_ctr.objects.get(user=request.user)
            except mdl_ctr.DoesNotExist:
                return Response(
                    {"detail": "No contractor profile found for the signed-in user."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            data["contractor"] = c.id  # inject for serializer validation

        # NOTE: address fields are optional here — keep existing model/serializer rules.
        ser = self.get_serializer(data=data)
        ser.is_valid(raise_exception=True)
        self.perform_create(ser)
        headers = {"Location": f"{request.build_absolute_uri().rstrip('/')}/{ser.data.get('id')}/"}
        return Response(ser.data, status=status.HTTP_201_CREATED, headers=headers)
