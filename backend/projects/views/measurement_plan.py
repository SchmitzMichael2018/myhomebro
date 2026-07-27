import hashlib
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from pypdf import PdfReader
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    CaptureArtifact,
    MeasurementCalculatedResult,
    MeasurementEntry,
    MeasurementEvent,
    MeasurementSession,
    PlanMeasurementAnnotation,
    PlanMeasurementCalibration,
    PlanMeasurementDocument,
)
from projects.serializers.measurement_plan import (
    AnnotationCreateSerializer,
    AnnotationRevisionSerializer,
    CalibrationCreateSerializer,
    PlanAnnotationSerializer,
    PlanCalibrationSerializer,
    PlanDocumentSerializer,
)
from projects.services.capture_permissions import can_create_project_capture
from projects.services.plan_measurement_geometry import (
    CALCULATION_VERSION,
    calculate_annotation,
    calculate_calibration,
    validate_geometry,
)


def _disabled():
    return not getattr(settings, "MEASUREMENT_PDF_ENABLED", False)


def _unavailable():
    return Response({"detail": "PDF plan measurement is unavailable.", "code": "feature_disabled"}, status=404)


def _session_for_user(user, session_id):
    session = get_object_or_404(MeasurementSession.objects.select_related("project", "contractor", "source_capture"), pk=session_id)
    if not can_create_project_capture(user, session.project):
        return None
    return session


def _document_for_user(user, document_id):
    document = get_object_or_404(
        PlanMeasurementDocument.objects.select_related("measurement_session__project", "artifact", "created_by"),
        pk=document_id,
    )
    if not can_create_project_capture(user, document.project):
        return None
    return document


def _event(session, actor, event_type, metadata):
    MeasurementEvent.objects.create(
        session=session, actor=actor, event_type=event_type,
        session_version=session.version, metadata=metadata,
    )


class PlanDocumentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _disabled():
            return _unavailable()
        session = _session_for_user(request.user, request.query_params.get("measurement_session"))
        if not session:
            return Response({"detail": "Not found."}, status=404)
        rows = session.plan_documents.select_related("artifact").filter(status="active")
        return Response(PlanDocumentSerializer(rows, many=True, context={"request": request}).data)

    @transaction.atomic
    def post(self, request):
        if _disabled():
            return _unavailable()
        session = _session_for_user(request.user, request.data.get("measurement_session"))
        if not session:
            return Response({"detail": "Not found."}, status=404)
        upload = request.FILES.get("file")
        artifact_id = request.data.get("artifact_id")
        if bool(upload) == bool(artifact_id):
            raise ValidationError({"file": "Provide exactly one PDF file or artifact_id."})
        if upload:
            if upload.size > settings.MEASUREMENT_PDF_MAX_BYTES:
                raise ValidationError({"file": "PDF exceeds the configured size limit."})
            raw = upload.read()
            upload.seek(0)
            if not raw.startswith(b"%PDF-"):
                raise ValidationError({"file": "File signature is not a PDF."})
            artifact = CaptureArtifact.objects.create(
                capture=session.source_capture, artifact_type=CaptureArtifact.TYPE_DOCUMENT,
                file=upload, original_filename=(upload.name or "plan.pdf")[:255],
                mime_type="application/pdf", file_size=upload.size,
                file_sha256=hashlib.sha256(raw).hexdigest(), uploaded_by=request.user,
            )
        else:
            artifact = get_object_or_404(CaptureArtifact, pk=artifact_id, capture__contractor=session.contractor)
            if artifact.retention_state != CaptureArtifact.RETENTION_ACTIVE:
                raise ValidationError({"artifact_id": "Artifact is unavailable."})
            artifact.file.open("rb")
            raw = artifact.file.read()
            artifact.file.close()
            if artifact.mime_type != "application/pdf" or not raw.startswith(b"%PDF-"):
                raise ValidationError({"artifact_id": "Artifact is not a valid PDF."})
            if PlanMeasurementDocument.objects.filter(artifact=artifact).exists():
                raise ValidationError({"artifact_id": "This PDF is already associated with a Measurement Session."})
        try:
            reader = PdfReader(artifact.file)
            if reader.is_encrypted:
                raise ValidationError({"file": "Password-protected PDFs are not supported."})
            page_count = len(reader.pages)
        except ValidationError:
            raise
        except Exception:
            raise ValidationError({"file": "PDF is corrupt or unsupported."})
        if not 1 <= page_count <= settings.MEASUREMENT_PDF_MAX_PAGES:
            raise ValidationError({"file": "PDF page count exceeds the configured limit."})
        document = PlanMeasurementDocument.objects.create(
            contractor=session.contractor, measurement_session=session,
            artifact=artifact, project=session.project, proposal=session.proposal,
            original_filename=artifact.original_filename, checksum=artifact.file_sha256,
            page_count=page_count, file_size=artifact.file_size, created_by=request.user,
        )
        _event(session, request.user, "plan_uploaded", {"document_id": document.id, "page_count": page_count})
        return Response(PlanDocumentSerializer(document, context={"request": request}).data, status=201)


class PlanDocumentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        if _disabled():
            return _unavailable()
        document = _document_for_user(request.user, document_id)
        if not document:
            return Response({"detail": "Not found."}, status=404)
        data = PlanDocumentSerializer(document, context={"request": request}).data
        data["calibrations"] = PlanCalibrationSerializer(document.calibrations.select_related("created_by"), many=True).data
        data["annotations"] = PlanAnnotationSerializer(document.annotations.select_related("created_by").filter(archived_at__isnull=True), many=True).data
        return Response(data)


class PlanDocumentFileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        if _disabled():
            return _unavailable()
        document = _document_for_user(request.user, document_id)
        if not document or document.artifact.retention_state != CaptureArtifact.RETENTION_ACTIVE:
            return Response({"detail": "Not found."}, status=404)
        _event(document.measurement_session, request.user, "plan_opened", {"document_id": document.id})
        return FileResponse(document.artifact.file.open("rb"), content_type="application/pdf", filename=document.original_filename)


class PlanCalibrationCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, document_id):
        if _disabled():
            return _unavailable()
        document = _document_for_user(request.user, document_id)
        if not document:
            return Response({"detail": "Not found."}, status=404)
        serializer = CalibrationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["expected_document_version"] != document.version:
            return Response({"detail": "Plan document changed. Reload and try again.", "code": "version_conflict"}, status=409)
        if data["page_number"] > document.page_count:
            raise ValidationError({"page_number": "Page does not exist."})
        if document.calibrations.filter(page_number=data["page_number"], invalidated_at__isnull=True).count() >= settings.MEASUREMENT_PDF_MAX_CALIBRATIONS_PER_PAGE:
            raise ValidationError({"page_number": "Calibration limit reached for this page."})
        geometry, known, distance, scale = calculate_calibration(
            data["reference_geometry"], data["known_length"], data["unit"], data["page_box"]
        )
        region = validate_geometry("polygon", data["region_geometry"]) if data["calibration_type"] == "region" else {}
        warnings = ["Plan measurements depend on correct scale.", "Fabrication-critical work must be verified in the field."]
        calibration = PlanMeasurementCalibration.objects.create(
            document=document, page_number=data["page_number"], calibration_type=data["calibration_type"],
            reference_geometry=geometry, region_geometry=region, known_length=known, unit=data["unit"],
            canonical_distance=distance, scale_per_point=scale, page_rotation=data["page_rotation"],
            page_box=data["page_box"], source_dimension_label=data["source_dimension_label"],
            confidence="high_estimate", warnings=warnings, document_checksum=document.checksum,
            created_by=request.user,
        )
        supersedes_id = data.get("supersedes_id")
        if supersedes_id:
            previous = get_object_or_404(document.calibrations, pk=supersedes_id, invalidated_at__isnull=True)
            previous.superseded_by = calibration
            previous.invalidated_at = timezone.now()
            previous.save(update_fields=("superseded_by", "invalidated_at"))
            _event(document.measurement_session, request.user, "calibration_superseded", {"previous_id": previous.id, "calibration_id": calibration.id})
        document.version += 1
        document.save(update_fields=("version", "updated_at"))
        _event(document.measurement_session, request.user, "calibration_created", {"document_id": document.id, "calibration_id": calibration.id, "page": calibration.page_number})
        return Response(PlanCalibrationSerializer(calibration).data, status=201)


class PlanCalibrationInvalidateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, calibration_id):
        if _disabled():
            return _unavailable()
        calibration = get_object_or_404(PlanMeasurementCalibration.objects.select_related("document__project", "document__measurement_session"), pk=calibration_id)
        if not can_create_project_capture(request.user, calibration.document.project):
            return Response({"detail": "Not found."}, status=404)
        if calibration.invalidated_at:
            return Response(PlanCalibrationSerializer(calibration).data)
        if calibration.annotations.filter(archived_at__isnull=True).filter(
            models.Q(measurement_entry__isnull=False) | models.Q(measurement_result__isnull=False)
        ).exists():
            raise ValidationError({"detail": "A calibration used by a saved proposal cannot be invalidated."})
        calibration.invalidated_at = timezone.now()
        calibration.save(update_fields=("invalidated_at",))
        _event(calibration.document.measurement_session, request.user, "calibration_invalidated", {"calibration_id": calibration.id})
        return Response(PlanCalibrationSerializer(calibration).data)


def _create_annotation(document, actor, data, previous=None):
    calibration = None
    if data["annotation_type"] != "count" or data.get("calibration_id"):
        calibration = get_object_or_404(document.calibrations, pk=data.get("calibration_id"))
        if calibration.page_number != data["page_number"] or calibration.invalidated_at or calibration.document_checksum != document.checksum:
            raise ValidationError({"calibration_id": "Calibration is stale, invalid, or belongs to another page."})
        geometry, value, unit, perimeter = calculate_annotation(data["annotation_type"], data["geometry"], calibration)
        confidence = "high_estimate"
        reasons = ["Known dimension calibration applied.", "Server recalculated canonical PDF geometry."]
        warnings = list(calibration.warnings)
    else:
        geometry = validate_geometry("count", data["geometry"])
        value, unit, perimeter = Decimal("1"), "each", None
        confidence, reasons, warnings = "high_estimate", ["Count marker reviewed by a person."], []
    return PlanMeasurementAnnotation.objects.create(
        document=document, calibration=calibration, previous_revision=previous,
        page_number=data["page_number"], annotation_type=data["annotation_type"],
        geometry=geometry, label=data["label"], category=data["category"],
        normalized_value=value, normalized_unit=unit, perimeter_value=perimeter,
        confidence=confidence, confidence_reasons=reasons, warnings=warnings,
        calculation_version=CALCULATION_VERSION, created_by=actor,
        version=(previous.version + 1 if previous else 1),
    )


class PlanAnnotationCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, document_id):
        if _disabled():
            return _unavailable()
        document = _document_for_user(request.user, document_id)
        if not document:
            return Response({"detail": "Not found."}, status=404)
        serializer = AnnotationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["expected_document_version"] != document.version:
            return Response({"detail": "Plan document changed. Reload and try again.", "code": "version_conflict"}, status=409)
        if data["page_number"] > document.page_count:
            raise ValidationError({"page_number": "Page does not exist."})
        if document.annotations.filter(page_number=data["page_number"], archived_at__isnull=True).count() >= settings.MEASUREMENT_PDF_MAX_ANNOTATIONS_PER_PAGE:
            raise ValidationError({"page_number": "Annotation limit reached for this page."})
        annotation = _create_annotation(document, request.user, data)
        document.version += 1
        document.save(update_fields=("version", "updated_at"))
        _event(document.measurement_session, request.user, "plan_annotation_created", {"document_id": document.id, "annotation_id": annotation.id, "page": annotation.page_number})
        return Response(PlanAnnotationSerializer(annotation).data, status=201)


class PlanAnnotationActionView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, annotation_id, action):
        if _disabled():
            return _unavailable()
        annotation = get_object_or_404(
            PlanMeasurementAnnotation.objects.select_related("document__project", "document__measurement_session", "calibration"),
            pk=annotation_id,
        )
        if not can_create_project_capture(request.user, annotation.document.project):
            return Response({"detail": "Not found."}, status=404)
        if action == "archive":
            if annotation.measurement_entry_id or annotation.measurement_result_id:
                raise ValidationError({"detail": "Saved proposals cannot be destructively archived."})
            annotation.archived_at = timezone.now()
            annotation.save(update_fields=("archived_at",))
            _event(annotation.document.measurement_session, request.user, "plan_annotation_archived", {"annotation_id": annotation.id})
        elif action == "revise":
            serializer = AnnotationRevisionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            if data["expected_annotation_version"] != annotation.version or data["expected_document_version"] != annotation.document.version:
                return Response({"detail": "Annotation changed. Reload and try again.", "code": "version_conflict"}, status=409)
            revised = _create_annotation(annotation.document, request.user, data, previous=annotation)
            annotation.archived_at = timezone.now()
            annotation.save(update_fields=("archived_at",))
            annotation.document.version += 1
            annotation.document.save(update_fields=("version", "updated_at"))
            _event(annotation.document.measurement_session, request.user, "plan_annotation_revised", {"annotation_id": annotation.id, "revision_id": revised.id})
            return Response(PlanAnnotationSerializer(revised).data, status=201)
        elif action == "create-proposal":
            if annotation.archived_at:
                raise ValidationError({"detail": "Archived annotations cannot create proposals."})
            if annotation.measurement_entry_id or annotation.measurement_result_id:
                return Response(PlanAnnotationSerializer(annotation).data)
            session = annotation.document.measurement_session
            key = f"pdf-plan-{annotation.id}-v{annotation.version}"
            entry = None
            if annotation.annotation_type in {"line", "polyline"}:
                entry = MeasurementEntry.objects.create(
                    session=session, client_key=key, label=annotation.label,
                    dimension_type="perimeter_segment" if annotation.annotation_type == "polyline" else "length",
                    normalized_value=annotation.normalized_value, display_unit=annotation.normalized_unit,
                    raw_value=f"{annotation.normalized_value} {annotation.normalized_unit}",
                    source_method="pdf_plan", verification_status="needs_verification",
                    tool_description="Calibrated PDF plan", notes="Verify in field before tolerance-sensitive work.",
                    source_metadata={
                        "provider": "pdf_plan", "provider_version": annotation.source_version,
                        "document_id": annotation.document_id, "document_checksum": annotation.document.checksum,
                        "page_number": annotation.page_number, "calibration_id": annotation.calibration_id,
                        "annotation_id": annotation.id, "confidence": annotation.confidence,
                        "warnings": annotation.warnings,
                    },
                    measured_by=request.user,
                )
                annotation.measurement_entry = entry
            formula = {
                "line": "pdf.line_length", "polyline": "pdf.polyline_length",
                "polygon": "pdf.polygon_area", "count": "pdf.count",
            }[annotation.annotation_type]
            result_type = {
                "line": "total_linear_length", "polyline": "total_linear_length",
                "polygon": "net_area", "count": "custom_calculated",
            }[annotation.annotation_type]
            result = MeasurementCalculatedResult.objects.create(
                session=session, result_type=result_type, label=annotation.label,
                normalized_value=annotation.normalized_value, normalized_unit=annotation.normalized_unit,
                display_value=str(annotation.normalized_value), display_unit=annotation.normalized_unit,
                formula_key=formula, calculation_version=CALCULATION_VERSION,
                source_entry_keys=[key] if entry else [], verification_status="needs_verification",
                lineage={
                    "provider": "pdf_plan", "provider_version": annotation.source_version,
                    "document_id": annotation.document_id, "document_name": annotation.document.original_filename,
                    "document_checksum": annotation.document.checksum, "page_number": annotation.page_number,
                    "calibration_id": annotation.calibration_id, "annotation_id": annotation.id,
                    "confidence": annotation.confidence, "warnings": annotation.warnings,
                },
            )
            annotation.measurement_result = result
            annotation.save(update_fields=("measurement_entry", "measurement_result", "updated_at"))
            _event(session, request.user, "plan_measurement_proposal_created", {"annotation_id": annotation.id, "provider": "pdf_plan"})
        else:
            return Response({"detail": "Unsupported action."}, status=400)
        return Response(PlanAnnotationSerializer(annotation).data)
