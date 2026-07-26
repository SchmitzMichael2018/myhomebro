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

from projects.models import Capture, CaptureApplication, CaptureArtifact, CaptureEvent
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
    can_review_capture,
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
        if capture.capture_type != Capture.TYPE_QUICK_LEAD:
            return Response(
                {"detail": "Duplicate search is supported only for Quick Lead Captures."},
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
