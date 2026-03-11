from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement
from projects.models_project_taxonomy import ProjectType, ProjectSubtype
from projects.models_templates import ProjectTemplate
from projects.serializers.project_taxonomy import (
    MergeProjectSubtypeSerializer,
    MergeProjectTypeSerializer,
    ProjectSubtypeOptionSerializer,
    ProjectSubtypeSerializer,
    ProjectTypeOptionSerializer,
    ProjectTypeSerializer,
)


class _TaxonomyBaseMixin:
    permission_classes = [IsAuthenticated]

    def _contractor(self):
        return (
            getattr(self.request.user, "contractor", None)
            or getattr(self.request.user, "contractor_profile", None)
        )

    def _is_staff(self):
        return bool(getattr(self.request.user, "is_staff", False))

    def _visible_filter(self):
        contractor = self._contractor()
        if self._is_staff():
            return Q()
        if contractor is None:
            return Q(pk__isnull=True)
        return Q(is_system=True) | Q(contractor=contractor)

    def _can_edit_type(self, obj: ProjectType) -> bool:
        if self._is_staff():
            return True
        contractor = self._contractor()
        return contractor is not None and obj.contractor_id == contractor.id and not obj.is_system

    def _can_edit_subtype(self, obj: ProjectSubtype) -> bool:
        if self._is_staff():
            return True
        contractor = self._contractor()
        return contractor is not None and obj.contractor_id == contractor.id and not obj.is_system

    def _include_inactive(self) -> bool:
        return str(self.request.query_params.get("include_inactive", "")).lower() in {
            "1",
            "true",
            "yes",
        }

    def _include_merged(self) -> bool:
        return str(self.request.query_params.get("include_merged", "")).lower() in {
            "1",
            "true",
            "yes",
        }


class ProjectTypeViewSet(_TaxonomyBaseMixin, viewsets.ModelViewSet):
    serializer_class = ProjectTypeSerializer

    def get_queryset(self):
        qs = ProjectType.objects.filter(self._visible_filter()).select_related(
            "contractor",
            "merged_into",
        )

        if not self._include_inactive():
            qs = qs.filter(is_active=True)

        if not self._include_merged():
            qs = qs.filter(merged_into__isnull=True)

        return qs.order_by("sort_order", "name")

    def get_serializer_class(self):
        mode = self.request.query_params.get("mode")
        if self.action == "list" and mode == "options":
            return ProjectTypeOptionSerializer
        return ProjectTypeSerializer

    def perform_create(self, serializer):
        contractor = self._contractor()
        serializer.save(contractor=contractor, is_system=False)

    def perform_update(self, serializer):
        obj = self.get_object()
        if not self._can_edit_type(obj):
            raise PermissionDenied("You do not have permission to modify this project type.")
        serializer.save()

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        obj = self.get_object()
        if not self._can_edit_type(obj):
            return Response(
                {"detail": "You do not have permission to archive this type."},
                status=status.HTTP_403_FORBIDDEN,
            )

        obj.archive(save=True)
        return Response(self.get_serializer(obj).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        obj = self.get_object()
        if not self._can_edit_type(obj):
            return Response(
                {"detail": "You do not have permission to unarchive this type."},
                status=status.HTTP_403_FORBIDDEN,
            )

        obj.unarchive(save=True)
        return Response(self.get_serializer(obj).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        source = self.get_object()

        if not self._can_edit_type(source):
            return Response(
                {"detail": "You do not have permission to merge this type."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = MergeProjectTypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_id = serializer.validated_data["target_type_id"]

        if source.id == target_id:
            return Response(
                {"detail": "Source and target type cannot be the same."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target = ProjectType.objects.get(pk=target_id)
        except ProjectType.DoesNotExist:
            return Response(
                {"detail": "Target project type not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        contractor = self._contractor()
        if not (
            self._is_staff()
            or target.is_system
            or (contractor is not None and target.contractor_id == contractor.id)
        ):
            return Response(
                {"detail": "You do not have permission to merge into that target type."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if target.merged_into_id:
            return Response(
                {"detail": "Target project type has already been merged into another type."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if source.merged_into_id:
            return Response(
                {"detail": "Source project type has already been merged."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            ProjectSubtype.objects.filter(project_type=source).update(project_type=target)

            # If your Agreement model includes project_type_ref, keep this.
            # If not, remove project_type_ref from the update/filter.
            try:
                Agreement.objects.filter(project_type_ref=source).update(
                    project_type_ref=target,
                    project_type=target.name,
                )
            except Exception:
                Agreement.objects.filter(project_type=source.name).update(
                    project_type=target.name,
                )

            ProjectTemplate.objects.filter(project_type=source.name).update(
                project_type=target.name
            )

            source.merged_into = target
            source.is_active = False
            source.save(update_fields=["merged_into", "is_active", "updated_at"])

        return Response(
            {
                "detail": f'Project type "{source.name}" merged into "{target.name}".',
                "source_id": source.id,
                "target_id": target.id,
            },
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()

        if not self._can_edit_type(obj):
            return Response(
                {"detail": "You do not have permission to delete this type."},
                status=status.HTTP_403_FORBIDDEN,
            )

        subtype_exists = ProjectSubtype.objects.filter(project_type=obj).exists()

        try:
            agreement_exists = Agreement.objects.filter(project_type_ref=obj).exists()
        except Exception:
            agreement_exists = Agreement.objects.filter(project_type=obj.name).exists()

        template_exists = ProjectTemplate.objects.filter(project_type=obj.name).exists()

        if subtype_exists or agreement_exists or template_exists:
            return Response(
                {"detail": "This project type is in use. Archive or merge it instead of deleting."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return super().destroy(request, *args, **kwargs)


class ProjectSubtypeViewSet(_TaxonomyBaseMixin, viewsets.ModelViewSet):
    serializer_class = ProjectSubtypeSerializer

    def get_queryset(self):
        qs = ProjectSubtype.objects.filter(self._visible_filter()).select_related(
            "project_type",
            "contractor",
            "merged_into",
        )

        project_type_id = self.request.query_params.get("project_type_id")
        project_type_name = (self.request.query_params.get("project_type") or "").strip()

        if project_type_id:
            qs = qs.filter(project_type_id=project_type_id)
        elif project_type_name:
            qs = qs.filter(project_type__name__iexact=project_type_name)

        if not self._include_inactive():
            qs = qs.filter(is_active=True)

        if not self._include_merged():
            qs = qs.filter(merged_into__isnull=True)

        return qs.order_by("project_type__sort_order", "sort_order", "name")

    def get_serializer_class(self):
        mode = self.request.query_params.get("mode")
        if self.action == "list" and mode == "options":
            return ProjectSubtypeOptionSerializer
        return ProjectSubtypeSerializer

    def perform_create(self, serializer):
        contractor = self._contractor()
        serializer.save(contractor=contractor, is_system=False)

    def perform_update(self, serializer):
        obj = self.get_object()
        if not self._can_edit_subtype(obj):
            raise PermissionDenied("You do not have permission to modify this project subtype.")
        serializer.save()

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        obj = self.get_object()

        if not self._can_edit_subtype(obj):
            return Response(
                {"detail": "You do not have permission to archive this subtype."},
                status=status.HTTP_403_FORBIDDEN,
            )

        obj.archive(save=True)
        return Response(self.get_serializer(obj).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        obj = self.get_object()

        if not self._can_edit_subtype(obj):
            return Response(
                {"detail": "You do not have permission to unarchive this subtype."},
                status=status.HTTP_403_FORBIDDEN,
            )

        obj.unarchive(save=True)
        return Response(self.get_serializer(obj).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        source = self.get_object()

        if not self._can_edit_subtype(source):
            return Response(
                {"detail": "You do not have permission to merge this subtype."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = MergeProjectSubtypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_id = serializer.validated_data["target_subtype_id"]

        if source.id == target_id:
            return Response(
                {"detail": "Source and target subtype cannot be the same."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target = ProjectSubtype.objects.select_related("project_type").get(pk=target_id)
        except ProjectSubtype.DoesNotExist:
            return Response(
                {"detail": "Target project subtype not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        contractor = self._contractor()
        if not (
            self._is_staff()
            or target.is_system
            or (contractor is not None and target.contractor_id == contractor.id)
        ):
            return Response(
                {"detail": "You do not have permission to merge into that target subtype."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if target.merged_into_id:
            return Response(
                {"detail": "Target project subtype has already been merged into another subtype."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if source.merged_into_id:
            return Response(
                {"detail": "Source project subtype has already been merged."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # If your Agreement model includes project_subtype_ref / project_type_ref, keep this.
            # If not, fallback to string-based updates.
            try:
                Agreement.objects.filter(project_subtype_ref=source).update(
                    project_subtype_ref=target,
                    project_type_ref=target.project_type,
                    project_type=target.project_type.name,
                    project_subtype=target.name,
                )
            except Exception:
                Agreement.objects.filter(
                    project_type=source.project_type.name,
                    project_subtype=source.name,
                ).update(
                    project_type=target.project_type.name,
                    project_subtype=target.name,
                )

            ProjectTemplate.objects.filter(
                project_type=source.project_type.name,
                project_subtype=source.name,
            ).update(
                project_type=target.project_type.name,
                project_subtype=target.name,
            )

            source.merged_into = target
            source.is_active = False
            source.save(update_fields=["merged_into", "is_active", "updated_at"])

        return Response(
            {
                "detail": f'Project subtype "{source.name}" merged into "{target.name}".',
                "source_id": source.id,
                "target_id": target.id,
            },
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()

        if not self._can_edit_subtype(obj):
            return Response(
                {"detail": "You do not have permission to delete this subtype."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            agreement_exists = Agreement.objects.filter(project_subtype_ref=obj).exists()
        except Exception:
            agreement_exists = Agreement.objects.filter(
                project_type=obj.project_type.name,
                project_subtype=obj.name,
            ).exists()

        template_exists = ProjectTemplate.objects.filter(
            project_type=obj.project_type.name,
            project_subtype=obj.name,
        ).exists()

        if agreement_exists or template_exists:
            return Response(
                {"detail": "This project subtype is in use. Archive or merge it instead of deleting."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return super().destroy(request, *args, **kwargs)