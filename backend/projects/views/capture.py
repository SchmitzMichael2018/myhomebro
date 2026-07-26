from __future__ import annotations

import hashlib
import logging

from django.conf import settings
from django.db import transaction
from django.db.models import (
    Case, Count, IntegerField, Prefetch, Q, TextField, Value, When,
)
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Coalesce, Lower
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    Capture,
    CaptureApplication,
    CaptureArtifact,
    CaptureEvent,
    Milestone,
    MilestoneAssignment,
    Project,
)
from projects.serializers.capture import (
    CaptureApplicationSerializer,
    CaptureArtifactSerializer,
    CaptureCreateSerializer,
    CaptureEventSerializer,
    CapturePatchSerializer,
    CaptureSerializer,
)
from projects.services.capture_lifecycle import (
    CaptureLifecycleError,
    CaptureVersionConflict,
    archive_capture,
    check_expected_version,
)
from projects.services.capture_application import (
    CaptureApplicationError,
    CaptureIdempotencyConflict,
    application_response,
    apply_capture,
    preview_application,
)
from projects.services.capture_processing import (
    CaptureProcessingError,
    CaptureSchemaError,
    approve_review,
    find_duplicate_candidates,
    process_capture,
    review_envelope,
    update_review,
)
from projects.services.capture_permissions import (
    can_archive_capture,
    can_apply_capture,
    can_create_capture,
    can_create_project_capture,
    can_review_capture,
    can_view_company_capture,
    visible_project_capture_projects,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


logger = logging.getLogger(__name__)


class CapturePagination(CursorPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100
    ordering = ("-original_captured_at", "-created_at", "-id")

    def paginate_queryset(self, queryset, request, view=None):
        self.total_count = queryset.count()
        return super().paginate_queryset(queryset, request, view=view)

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.total_count,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )


def _foundation_enabled():
    return bool(getattr(settings, "CAPTURE_FOUNDATION_ENABLED", False))


def _disabled_response():
    return Response({"detail": "Capture foundation is not enabled."}, status=status.HTTP_404_NOT_FOUND)


def _review_enabled():
    return _foundation_enabled() and bool(getattr(settings, "CAPTURE_REVIEW_ENABLED", False))


def _review_disabled_response():
    return Response(
        {"detail": "Capture review is not enabled.", "code": "capture_review_disabled"},
        status=status.HTTP_404_NOT_FOUND,
    )


def _application_enabled():
    return _review_enabled() and bool(getattr(settings, "CAPTURE_APPLICATION_ENABLED", False))


def _application_disabled_response():
    return Response(
        {"detail": "Capture application is not enabled.", "code": "capture_application_disabled"},
        status=status.HTTP_404_NOT_FOUND,
    )


def _lifecycle_error_response(exc):
    response_status = status.HTTP_409_CONFLICT if isinstance(exc, CaptureVersionConflict) else status.HTTP_400_BAD_REQUEST
    return Response(
        {"detail": str(exc), "code": exc.code},
        status=response_status,
    )


def _review_response(capture):
    return {
        "capture": CaptureSerializer(capture).data,
        "review": review_envelope(capture),
    }


def _review_error_response(exc, capture=None):
    response = {
        "detail": str(exc),
        "code": getattr(exc, "code", "capture_processing_error"),
    }
    if isinstance(exc, CaptureVersionConflict) and capture is not None:
        capture.refresh_from_db()
        response.update(_review_response(capture))
    return Response(
        response,
        status=status.HTTP_409_CONFLICT
        if isinstance(exc, CaptureVersionConflict)
        else status.HTTP_400_BAD_REQUEST,
    )


def _capture_for_user(request, capture_id):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        return None
    capture = (
        Capture.objects.select_related("captured_by")
        .prefetch_related("artifacts", "events")
        .filter(contractor=contractor, pk=capture_id)
        .first()
    )
    if capture is None or not can_view_company_capture(request.user, capture):
        return None
    return capture


def _core_capture_for_user(request, capture_id):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        return None
    capture = Capture.objects.select_related("captured_by").filter(
        contractor=contractor, pk=capture_id
    ).first()
    if capture is None or not can_view_company_capture(request.user, capture):
        return None
    return capture


def _visible_captures(user, contractor):
    queryset = Capture.objects.filter(contractor=contractor)
    subaccount = get_subaccount_for_user(user)
    if subaccount and subaccount.role != subaccount.ROLE_EMPLOYEE_SUPERVISOR:
        queryset = queryset.filter(captured_by=user)
    return queryset


def _validate_photo(upload):
    if not upload:
        return "Choose a photo to save."
    mime_type = str(getattr(upload, "content_type", "") or "").lower()
    if not mime_type.startswith("image/"):
        return "Capture photos must be image files."
    max_bytes = int(getattr(settings, "CAPTURE_MAX_PHOTO_SIZE_MB", 10)) * 1024 * 1024
    if int(getattr(upload, "size", 0) or 0) > max_bytes:
        return f"Capture photos must be {max_bytes // (1024 * 1024)} MB or smaller."
    return ""


PROJECT_CAPTURE_TYPES = {
    Capture.TYPE_PROJECT_UPDATE,
    Capture.TYPE_PROGRESS_PHOTO,
    Capture.TYPE_ISSUE,
    Capture.TYPE_COMMUNICATION,
    Capture.TYPE_DOCUMENT,
}
D2_CAPTURE_TYPES = {
    Capture.TYPE_EQUIPMENT,
    Capture.TYPE_WARRANTY_DOCUMENT,
    Capture.TYPE_WARRANTY_CONCERN,
}
MEASUREMENT_CAPTURE_TYPES = {Capture.TYPE_MEASUREMENT}


def _d2_enabled(capture_type):
    if capture_type == Capture.TYPE_EQUIPMENT:
        return bool(getattr(settings, "CAPTURE_EQUIPMENT_ENABLED", False))
    if capture_type in {Capture.TYPE_WARRANTY_DOCUMENT, Capture.TYPE_WARRANTY_CONCERN}:
        return bool(getattr(settings, "CAPTURE_WARRANTY_ENABLED", False))
    if capture_type == Capture.TYPE_MEASUREMENT:
        return bool(getattr(settings, "CAPTURE_MEASUREMENT_ENABLED", False))
    return True


def _validate_project_upload(upload, capture_type):
    photo_types = {Capture.TYPE_PROJECT_UPDATE, Capture.TYPE_PROGRESS_PHOTO}
    if capture_type in photo_types:
        return _validate_photo(upload)
    allowed = {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "text/plain",
    }
    mime_type = str(getattr(upload, "content_type", "") or "").lower()
    if mime_type not in allowed:
        return "Project documents must be PDF, image, or plain-text files."
    max_bytes = int(getattr(settings, "CAPTURE_MAX_DOCUMENT_SIZE_MB", 15)) * 1024 * 1024
    if int(getattr(upload, "size", 0) or 0) > max_bytes:
        return f"Project documents must be {max_bytes // (1024 * 1024)} MB or smaller."
    header = upload.read(12)
    upload.seek(0)
    signatures = {
        "application/pdf": header.startswith(b"%PDF-"),
        "image/jpeg": header.startswith(b"\xff\xd8\xff"),
        "image/png": header.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": header.startswith(b"RIFF") and header[8:12] == b"WEBP",
        "text/plain": True,
    }
    if not signatures.get(mime_type, False):
        return "The file contents do not match the selected file type."
    return ""


class CaptureProjectOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        projects = visible_project_capture_projects(request.user)
        if projects is None:
            return Response({"detail": "Contractor account required."}, status=403)
        subaccount = get_subaccount_for_user(request.user)
        rows = []
        for project in projects.order_by("-updated_at", "-id")[:100]:
            milestones = Milestone.objects.filter(agreement__project=project).order_by("order", "id")
            if subaccount and subaccount.role != subaccount.ROLE_EMPLOYEE_SUPERVISOR:
                has_project_assignment = project.agreement.subaccount_assignments.filter(
                    subaccount=subaccount
                ).exists() if hasattr(project, "agreement") else False
                if not has_project_assignment:
                    milestones = milestones.filter(
                        subaccount_assignment__subaccount=subaccount
                    )
            rows.append({
                "id": project.id,
                "title": project.title,
                "number": project.number,
                "customer_name": getattr(project.homeowner, "full_name", ""),
                "milestones": [
                    {"id": row.id, "title": row.title, "completed": row.completed}
                    for row in milestones
                ],
            })
        return Response({"results": rows})


class CaptureListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        queryset = (
            _visible_captures(request.user, contractor)
            .select_related("captured_by")
            .prefetch_related(
                "artifacts",
                Prefetch("events", queryset=CaptureEvent.objects.select_related("actor")),
            )
        )
        capture_status = str(request.query_params.get("status") or "").strip()
        capture_type = str(request.query_params.get("type") or "").strip()
        search = str(request.query_params.get("search") or "").strip()
        creator = str(request.query_params.get("creator") or "").strip()
        date_from = parse_date(str(request.query_params.get("date_from") or ""))
        date_to = parse_date(str(request.query_params.get("date_to") or ""))
        has_duplicates = str(request.query_params.get("has_duplicates") or "").lower() == "true"
        has_follow_up = str(request.query_params.get("has_follow_up") or "").lower() == "true"
        sort = str(request.query_params.get("sort") or "newest").strip()
        status_groups = {
            "pending": (
                Capture.STATUS_DRAFT, Capture.STATUS_SAVED,
                Capture.STATUS_PROCESSING, Capture.STATUS_APPLYING,
            ),
            "needs_review": (
                Capture.STATUS_READY_FOR_REVIEW, Capture.STATUS_NEEDS_INFORMATION,
                Capture.STATUS_POSSIBLE_DUPLICATE,
            ),
            "failed": (Capture.STATUS_FAILED, Capture.STATUS_APPLY_FAILED),
        }
        if capture_status:
            queryset = queryset.filter(
                status__in=status_groups.get(capture_status, (capture_status,))
            )
        if capture_type:
            queryset = queryset.filter(capture_type=capture_type)
        if search:
            queryset = queryset.filter(
                Q(raw_text_payload__icontains=search)
                | Q(structured_draft__icontains=search)
                | Q(source_detail__icontains=search)
                | Q(proposed_destination__icontains=search)
                | Q(status__icontains=search)
                | Q(capture_type__icontains=search)
                | Q(captured_by__email__icontains=search)
                | Q(captured_by__first_name__icontains=search)
                | Q(captured_by__last_name__icontains=search)
            )
        if creator:
            queryset = queryset.filter(captured_by_id=creator)
        if date_from:
            queryset = queryset.filter(original_captured_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(original_captured_at__date__lte=date_to)
        if has_duplicates:
            queryset = queryset.exclude(duplicate_candidates=[])
        if has_follow_up:
            queryset = queryset.filter(
                Q(structured_draft__follow_up__suggested=True)
                | Q(approved_snapshot__structured_draft__follow_up__suggested=True)
            )
        paginator = CapturePagination()
        if sort == "oldest":
            paginator.ordering = ("original_captured_at", "created_at", "id")
        elif sort == "updated":
            paginator.ordering = ("-updated_at", "-id")
        elif sort == "attention":
            queryset = queryset.annotate(
                attention_rank=Case(
                    When(status__in=status_groups["failed"], then=Value(0)),
                    When(status__in=status_groups["needs_review"], then=Value(1)),
                    When(status=Capture.STATUS_APPROVED, then=Value(2)),
                    default=Value(3),
                    output_field=IntegerField(),
                )
            )
            paginator.ordering = ("attention_rank", "-updated_at", "-id")
        elif sort == "alphabetical":
            queryset = queryset.annotate(
                capture_name=Lower(
                    Coalesce(
                        KeyTextTransform("title", "raw_text_payload"),
                        KeyTextTransform("name", "raw_text_payload"),
                        KeyTextTransform("text", "raw_text_payload"),
                        Value(""),
                        output_field=TextField(),
                    )
                )
            )
            paginator.ordering = ("capture_name", "-original_captured_at", "-id")
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            CaptureSerializer(page, many=True, context={"request": request}).data
        )

    def post(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        if not can_create_capture(request.user):
            return Response({"detail": "You do not have permission to create Captures."}, status=status.HTTP_403_FORBIDDEN)
        contractor = get_contractor_for_user(request.user)
        uploads = request.FILES.getlist("files") or request.FILES.getlist("file")
        upload = uploads[0] if uploads else None
        capture_type = str(request.data.get("capture_type") or "")
        if capture_type in D2_CAPTURE_TYPES | MEASUREMENT_CAPTURE_TYPES and not _d2_enabled(capture_type):
            return Response(
                {"detail": "This Capture workflow is not enabled."},
                status=status.HTTP_404_NOT_FOUND,
            )
        project = None
        milestone = None
        if capture_type in PROJECT_CAPTURE_TYPES | D2_CAPTURE_TYPES | MEASUREMENT_CAPTURE_TYPES:
            project = Project.objects.filter(
                contractor=contractor, pk=request.data.get("project_id")
            ).first()
            if project and request.data.get("milestone_id"):
                milestone = Milestone.objects.filter(
                    pk=request.data.get("milestone_id"),
                    agreement__project=project,
                ).first()
                if not milestone:
                    return Response(
                        {"detail": "The selected milestone is unavailable."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            if not project or not can_create_project_capture(request.user, project, milestone):
                return Response(
                    {"detail": "The selected project is unavailable."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if len(uploads) > int(getattr(settings, "CAPTURE_PROJECT_MAX_FILES", 10)):
                return Response(
                    {"detail": "Choose no more than 10 files."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        serializer = CaptureCreateSerializer(
            data=request.data,
            context={"has_file": bool(upload), "project": project},
        )
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["capture_type"] == Capture.TYPE_PHOTO:
            photo_error = _validate_photo(upload)
            if photo_error:
                return Response({"detail": photo_error}, status=status.HTTP_400_BAD_REQUEST)
        elif capture_type in PROJECT_CAPTURE_TYPES | D2_CAPTURE_TYPES | MEASUREMENT_CAPTURE_TYPES:
            for row in uploads:
                upload_error = _validate_project_upload(row, capture_type)
                if upload_error:
                    return Response(
                        {"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST
                    )
        elif upload:
            return Response(
                {"detail": "File uploads are only supported for photo Captures."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            capture = serializer.save(
                contractor=contractor,
                captured_by=request.user,
                status=Capture.STATUS_SAVED,
                processing_engine="",
                project=project,
                milestone=milestone,
                customer=project.homeowner if project else None,
            )
            for upload in uploads:
                digest = hashlib.sha256()
                for chunk in upload.chunks():
                    digest.update(chunk)
                upload.seek(0)
                CaptureArtifact.objects.create(
                    capture=capture,
                    artifact_type=(
                        CaptureArtifact.TYPE_DOCUMENT
                        if capture_type in {
                            Capture.TYPE_DOCUMENT, Capture.TYPE_WARRANTY_DOCUMENT,
                        } or not str(upload.content_type or "").startswith("image/")
                        else CaptureArtifact.TYPE_PHOTO
                    ),
                    file=upload,
                    original_filename=str(upload.name or "")[:255],
                    mime_type=str(upload.content_type or "")[:120],
                    file_size=upload.size or 0,
                    file_sha256=digest.hexdigest(),
                    uploaded_by=request.user,
                )
            CaptureEvent.objects.create(
                capture=capture,
                event_type="created",
                to_status=capture.status,
                actor=request.user,
                metadata={
                    "version": capture.version,
                    "capture_method": capture.capture_method,
                    "artifact_count": len(uploads),
                },
            )
        capture = _capture_for_user(request, capture.id)
        return Response(CaptureSerializer(capture).data, status=status.HTTP_201_CREATED)


class CaptureSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        queryset = _visible_captures(request.user, contractor)
        counts = {
            row["status"]: row["count"]
            for row in queryset.values("status").annotate(count=Count("id"))
        }
        today = timezone.localdate()
        creators = []
        for actor in (
            queryset.exclude(captured_by=None)
            .values_list(
                "captured_by_id",
                "captured_by__first_name",
                "captured_by__last_name",
                "captured_by__email",
            )
            .order_by(
                "captured_by_id",
                "captured_by__first_name",
                "captured_by__last_name",
                "captured_by__email",
            )
            .distinct()
        ):
            actor_id, first_name, last_name, email = actor
            name = f"{first_name} {last_name}".strip() or email or "Team member"
            creators.append({"id": actor_id, "name": name})
        return Response(
            {
                "pending": sum(
                    counts.get(value, 0)
                    for value in (
                        Capture.STATUS_DRAFT,
                        Capture.STATUS_SAVED,
                        Capture.STATUS_PROCESSING,
                        Capture.STATUS_APPLYING,
                    )
                ),
                "needs_review": sum(
                    counts.get(value, 0)
                    for value in (
                        Capture.STATUS_READY_FOR_REVIEW,
                        Capture.STATUS_NEEDS_INFORMATION,
                        Capture.STATUS_POSSIBLE_DUPLICATE,
                    )
                ),
                "approved": counts.get(Capture.STATUS_APPROVED, 0),
                "applied": counts.get(Capture.STATUS_APPLIED, 0),
                "applied_today": queryset.filter(
                    status=Capture.STATUS_APPLIED, updated_at__date=today
                ).count(),
                "failed": counts.get(Capture.STATUS_FAILED, 0)
                + counts.get(Capture.STATUS_APPLY_FAILED, 0),
                "archived": counts.get(Capture.STATUS_ARCHIVED, 0),
                "today": queryset.filter(original_captured_at__date=today).count(),
                "creators": sorted(creators, key=lambda row: row["name"].lower()),
            }
        )


class CaptureDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _core_capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _d2_enabled(capture.capture_type):
            return Response({"detail": "This Capture workflow is not enabled."}, status=404)
        payload = CaptureSerializer(capture, context={"request": request}).data
        payload["artifacts"] = []
        payload["events"] = []
        return Response(payload)

    def patch(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if capture.captured_by_id != request.user.id:
            return Response({"detail": "Only the Capture author can edit this draft."}, status=status.HTTP_403_FORBIDDEN)
        if capture.status not in {
            Capture.STATUS_DRAFT,
            Capture.STATUS_SAVED,
            Capture.STATUS_NEEDS_INFORMATION,
            Capture.STATUS_FAILED,
        }:
            return Response({"detail": "This Capture can no longer be edited."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = CapturePatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                locked = Capture.objects.select_for_update().get(pk=capture.pk)
                check_expected_version(locked, serializer.validated_data["expected_version"])
                changed = []
                for field, value in serializer.validated_data.items():
                    if field == "expected_version":
                        continue
                    setattr(locked, field, value)
                    changed.append(field)
                locked.version += 1
                changed.extend(["version", "updated_at"])
                locked.save(update_fields=changed)
                CaptureEvent.objects.create(
                    capture=locked,
                    event_type="draft_updated",
                    from_status=locked.status,
                    to_status=locked.status,
                    actor=request.user,
                    metadata={"fields": [field for field in changed if field not in {"version", "updated_at"}]},
                )
        except CaptureLifecycleError as exc:
            return _lifecycle_error_response(exc)
        return Response(CaptureSerializer(locked).data)


class CaptureTimelineView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _core_capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        events = capture.events.select_related("actor").all()
        return Response({"results": CaptureEventSerializer(events, many=True).data})


class CaptureArtifactListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _core_capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        artifacts = capture.artifacts.filter(
            retention_state=CaptureArtifact.RETENTION_ACTIVE
        )
        return Response(
            {
                "results": CaptureArtifactSerializer(
                    artifacts, many=True, context={"request": request}
                ).data
            }
        )


class CaptureArchiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_archive_capture(request.user, capture):
            return Response({"detail": "You do not have permission to archive this Capture."}, status=status.HTTP_403_FORBIDDEN)
        try:
            capture = archive_capture(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                reason=str(request.data.get("reason") or ""),
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _lifecycle_error_response(exc)
        return Response(CaptureSerializer(capture).data)


class CaptureRetryView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _review_enabled():
            return _review_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_review_capture(request.user, capture):
            return Response({"detail": "You do not have permission to retry this Capture."}, status=status.HTTP_403_FORBIDDEN)
        try:
            capture = process_capture(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                mode=str(request.data.get("mode") or "deterministic"),
                is_retry=True,
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _review_error_response(exc, capture)
        return Response(_review_response(capture))


class CaptureProcessView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _review_enabled():
            return _review_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _d2_enabled(capture.capture_type):
            return Response({"detail": "This Capture workflow is not enabled."}, status=404)
        if not can_review_capture(request.user, capture):
            return Response({"detail": "You do not have permission to process this Capture."}, status=status.HTTP_403_FORBIDDEN)
        try:
            capture = process_capture(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                mode=str(request.data.get("mode") or "deterministic"),
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _review_error_response(exc, capture)
        response_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if capture.status == Capture.STATUS_FAILED
            else status.HTTP_200_OK
        )
        payload = _review_response(capture)
        if capture.status == Capture.STATUS_FAILED:
            payload.update({
                "detail": "Project Assistant preparation is temporarily unavailable. Manual review remains available.",
                "code": "capture_processing_unavailable",
                "capture_saved": True,
            })
        return Response(payload, status=response_status)


class CaptureReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, capture_id):
        if not _review_enabled():
            return _review_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_review_capture(request.user, capture):
            return Response({"detail": "You do not have permission to review this Capture."}, status=status.HTTP_403_FORBIDDEN)
        allowed = {"expected_version", "structured_draft", "duplicate_decision"}
        unknown = set(request.data) - allowed
        if unknown:
            return Response(
                {"detail": f"Unsupported review fields: {', '.join(sorted(unknown))}.", "code": "invalid_capture_review"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            capture = update_review(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                draft=request.data.get("structured_draft"),
                duplicate_decision=request.data.get("duplicate_decision"),
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _review_error_response(exc, capture)
        return Response(_review_response(capture))


class CaptureApproveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _review_enabled():
            return _review_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_review_capture(request.user, capture):
            return Response({"detail": "You do not have permission to approve this Capture."}, status=status.HTTP_403_FORBIDDEN)
        try:
            capture = approve_review(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _review_error_response(exc, capture)
        return Response(_review_response(capture))


class CaptureDuplicatesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _review_enabled():
            return _review_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_review_capture(request.user, capture):
            return Response({"detail": "You do not have permission to review duplicates."}, status=status.HTTP_403_FORBIDDEN)
        if capture.capture_type not in {Capture.TYPE_QUICK_LEAD, Capture.TYPE_EQUIPMENT}:
            return Response(
                {"detail": "Duplicate search is not supported for this Capture type."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"capture_id": str(capture.id), "duplicate_candidates": find_duplicate_candidates(capture)})


class CaptureApplicationPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _application_enabled():
            return _application_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _d2_enabled(capture.capture_type):
            return Response({"detail": "This Capture workflow is not enabled."}, status=404)
        if not can_apply_capture(request.user, capture):
            return Response(
                {"detail": "You do not have permission to apply this Capture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            preview = preview_application(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                payload=request.data,
            )
        except CaptureVersionConflict as exc:
            return _review_error_response(exc, capture)
        except (CaptureApplicationError, TypeError, ValueError) as exc:
            return Response(
                {"detail": str(exc), "code": getattr(exc, "code", "capture_application_error")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(preview)


class CaptureApplyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, capture_id):
        if not _application_enabled():
            return _application_disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _d2_enabled(capture.capture_type):
            return Response({"detail": "This Capture workflow is not enabled."}, status=404)
        if not can_apply_capture(request.user, capture):
            return Response(
                {"detail": "You do not have permission to apply this Capture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        allowed = {
            "expected_version", "idempotency_key", "destinations",
            "adapter_versions", "application_options", "confirmed",
        }
        unknown = set(request.data) - allowed
        if unknown:
            return Response(
                {"detail": f"Unsupported application fields: {', '.join(sorted(unknown))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            capture, application, replayed = apply_capture(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
                idempotency_key=request.data.get("idempotency_key"),
                payload=request.data,
            )
        except CaptureVersionConflict as exc:
            return _review_error_response(exc, capture)
        except CaptureIdempotencyConflict as exc:
            return Response(
                {"detail": str(exc), "code": exc.code},
                status=status.HTTP_409_CONFLICT,
            )
        except (CaptureApplicationError, TypeError, ValueError) as exc:
            return Response(
                {"detail": str(exc), "code": getattr(exc, "code", "capture_application_error")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        payload = {
            "capture": CaptureSerializer(capture).data,
            **application_response(capture, application),
            "idempotent_replay": replayed,
        }
        if application.status == CaptureApplication.STATUS_FAILED:
            payload.update({
                "detail": "The application failed safely. No partial records were kept.",
                "code": application.failure_code or "capture_application_failed",
            })
            return Response(payload, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        return Response(payload)


class CaptureReceiptView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        applications = capture.applications.filter(receipt_payload__isnull=False).exclude(receipt_payload={})
        return Response(
            {
                "capture_id": str(capture.id),
                "capture_version": capture.version,
                "receipts": CaptureApplicationSerializer(applications, many=True).data,
            }
        )
