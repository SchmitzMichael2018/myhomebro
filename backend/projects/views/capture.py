from __future__ import annotations

import hashlib

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Capture, CaptureArtifact, CaptureEvent
from projects.serializers.capture import (
    CaptureApplicationSerializer,
    CaptureCreateSerializer,
    CapturePatchSerializer,
    CaptureSerializer,
)
from projects.services.capture_lifecycle import (
    CaptureLifecycleError,
    CaptureVersionConflict,
    archive_capture,
    check_expected_version,
    retry_capture,
)
from projects.services.capture_permissions import (
    can_archive_capture,
    can_create_capture,
    can_view_company_capture,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


class CapturePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


def _foundation_enabled():
    return bool(getattr(settings, "CAPTURE_FOUNDATION_ENABLED", False))


def _disabled_response():
    return Response({"detail": "Capture foundation is not enabled."}, status=status.HTTP_404_NOT_FOUND)


def _lifecycle_error_response(exc):
    response_status = status.HTTP_409_CONFLICT if isinstance(exc, CaptureVersionConflict) else status.HTTP_400_BAD_REQUEST
    return Response(
        {"detail": str(exc), "code": exc.code},
        status=response_status,
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


class CaptureListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        queryset = _visible_captures(request.user, contractor).select_related("captured_by")
        capture_status = str(request.query_params.get("status") or "").strip()
        capture_type = str(request.query_params.get("type") or "").strip()
        search = str(request.query_params.get("search") or "").strip()
        if capture_status:
            queryset = queryset.filter(status=capture_status)
        if capture_type:
            queryset = queryset.filter(capture_type=capture_type)
        if search:
            queryset = queryset.filter(
                Q(raw_text_payload__icontains=search)
                | Q(source_detail__icontains=search)
                | Q(proposed_destination__icontains=search)
            )
        paginator = CapturePagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(CaptureSerializer(page, many=True).data)

    def post(self, request):
        if not _foundation_enabled():
            return _disabled_response()
        if not can_create_capture(request.user):
            return Response({"detail": "You do not have permission to create Captures."}, status=status.HTTP_403_FORBIDDEN)
        contractor = get_contractor_for_user(request.user)
        upload = request.FILES.get("file")
        serializer = CaptureCreateSerializer(
            data=request.data,
            context={"has_file": bool(upload)},
        )
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["capture_type"] == Capture.TYPE_PHOTO:
            photo_error = _validate_photo(upload)
            if photo_error:
                return Response({"detail": photo_error}, status=status.HTTP_400_BAD_REQUEST)
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
            )
            if upload:
                digest = hashlib.sha256()
                for chunk in upload.chunks():
                    digest.update(chunk)
                upload.seek(0)
                CaptureArtifact.objects.create(
                    capture=capture,
                    artifact_type=CaptureArtifact.TYPE_PHOTO,
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
                    "artifact_count": 1 if upload else 0,
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
        return Response(
            {
                "pending": sum(
                    counts.get(value, 0)
                    for value in (
                        Capture.STATUS_DRAFT,
                        Capture.STATUS_SAVED,
                        Capture.STATUS_PROCESSING,
                        Capture.STATUS_NEEDS_INFORMATION,
                        Capture.STATUS_POSSIBLE_DUPLICATE,
                    )
                ),
                "needs_review": counts.get(Capture.STATUS_READY_FOR_REVIEW, 0),
                "applied": counts.get(Capture.STATUS_APPLIED, 0),
                "failed": counts.get(Capture.STATUS_FAILED, 0)
                + counts.get(Capture.STATUS_APPLY_FAILED, 0),
                "archived": counts.get(Capture.STATUS_ARCHIVED, 0),
                "today": queryset.filter(original_captured_at__date=today).count(),
            }
        )


class CaptureDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, capture_id):
        if not _foundation_enabled():
            return _disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(CaptureSerializer(capture).data)

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
        if not _foundation_enabled():
            return _disabled_response()
        capture = _capture_for_user(request, capture_id)
        if capture is None:
            return Response({"detail": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if capture.captured_by_id != request.user.id:
            return Response({"detail": "Only the Capture author can retry this Capture."}, status=status.HTTP_403_FORBIDDEN)
        try:
            capture = retry_capture(
                capture,
                actor=request.user,
                expected_version=request.data.get("expected_version"),
            )
        except (CaptureLifecycleError, TypeError, ValueError) as exc:
            if not isinstance(exc, CaptureLifecycleError):
                exc = CaptureVersionConflict("A valid expected_version is required.")
            return _lifecycle_error_response(exc)
        return Response(CaptureSerializer(capture).data)


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
