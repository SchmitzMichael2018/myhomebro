import hashlib

from django.conf import settings
from django.db import models, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import CaptureArtifact, MeasurementCalculatedResult, MeasurementEntry, MeasurementEvent, MeasurementSession, PhotoMeasurementAnnotation, PhotoMeasurementCalibration, PhotoMeasurementDocument
from projects.serializers.measurement_photo import PhotoAnnotationCreateSerializer, PhotoAnnotationRevisionSerializer, PhotoAnnotationSerializer, PhotoCalibrationCreateSerializer, PhotoCalibrationSerializer, PhotoDocumentSerializer
from projects.services.capture_permissions import can_create_project_capture
from projects.services.photo_measurement import CALCULATION_VERSION, calculate_photo_annotation, create_calibration_data, normalize_image, repeat_statistics


def disabled(): return not getattr(settings, "MEASUREMENT_PHOTO_ASSISTED_ENABLED", False)
def unavailable(): return Response({"detail": "Photo-assisted measurement is unavailable.", "code": "feature_disabled"}, status=404)
def event(session, actor, kind, metadata): MeasurementEvent.objects.create(session=session, actor=actor, event_type=kind, session_version=session.version, metadata=metadata)


def session_for(user, pk):
    session = get_object_or_404(MeasurementSession.objects.select_related("project", "contractor", "source_capture"), pk=pk)
    return session if can_create_project_capture(user, session.project) else None


def document_for(user, pk):
    row = get_object_or_404(PhotoMeasurementDocument.objects.select_related("project", "measurement_session", "artifact"), pk=pk)
    return row if can_create_project_capture(user, row.project) else None


class PhotoDocumentListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        if disabled(): return unavailable()
        session = session_for(request.user, request.query_params.get("measurement_session"))
        if not session: return Response({"detail": "Not found."}, status=404)
        return Response(PhotoDocumentSerializer(session.photo_documents.filter(status="active"), many=True, context={"request": request}).data)

    @transaction.atomic
    def post(self, request):
        if disabled(): return unavailable()
        session = session_for(request.user, request.data.get("measurement_session"))
        if not session: return Response({"detail": "Not found."}, status=404)
        upload, artifact_id = request.FILES.get("file"), request.data.get("artifact_id")
        if bool(upload) == bool(artifact_id): raise ValidationError({"file": "Provide exactly one image or artifact_id."})
        if upload:
            raw = upload.read(); upload.seek(0)
            normalized = normalize_image(raw, upload.name or "photo.jpg")
            artifact = CaptureArtifact.objects.create(capture=session.source_capture, artifact_type="photo", file=upload, original_filename=(upload.name or "photo.jpg")[:255], mime_type=normalized["mime"], file_size=upload.size, file_sha256=hashlib.sha256(raw).hexdigest(), uploaded_by=request.user, sanitization_metadata={"derived_preview_exif_stripped": True})
        else:
            artifact = get_object_or_404(CaptureArtifact, pk=artifact_id, capture__contractor=session.contractor, retention_state="active")
            if PhotoMeasurementDocument.objects.filter(artifact=artifact).exists(): raise ValidationError({"artifact_id": "This photo is already associated with a Measurement Session."})
            artifact.file.open("rb"); raw = artifact.file.read(); artifact.file.close()
            normalized = normalize_image(raw, artifact.original_filename or "photo.jpg")
            if artifact.mime_type not in {"image/jpeg", "image/png", "image/webp"}: raise ValidationError({"artifact_id": "Artifact is not a supported image."})
        document = PhotoMeasurementDocument.objects.create(contractor=session.contractor, measurement_session=session, artifact=artifact, project=session.project, proposal=session.proposal, normalized_image=normalized["content"], original_filename=artifact.original_filename, mime_type=normalized["mime"], checksum=artifact.file_sha256 or hashlib.sha256(raw).hexdigest(), original_width=normalized["original_width"], original_height=normalized["original_height"], normalized_width=normalized["width"], normalized_height=normalized["height"], original_orientation=normalized["orientation"], orientation_transform=normalized["transform"], created_by=request.user)
        event(session, request.user, "photo_measurement_uploaded", {"document_id": document.id, "orientation_transform": document.orientation_transform})
        return Response(PhotoDocumentSerializer(document, context={"request": request}).data, status=201)


class PhotoDocumentDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, document_id):
        if disabled(): return unavailable()
        document = document_for(request.user, document_id)
        if not document: return Response({"detail": "Not found."}, status=404)
        data = PhotoDocumentSerializer(document, context={"request": request}).data
        data["calibrations"] = PhotoCalibrationSerializer(document.calibrations.select_related("created_by"), many=True).data
        data["annotations"] = PhotoAnnotationSerializer(document.annotations.filter(archived_at__isnull=True).select_related("created_by"), many=True).data
        return Response(data)


class PhotoDocumentImageView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, document_id):
        if disabled(): return unavailable()
        document = document_for(request.user, document_id)
        if not document: return Response({"detail": "Not found."}, status=404)
        event(document.measurement_session, request.user, "photo_measurement_opened", {"document_id": document.id})
        return FileResponse(document.normalized_image.open("rb"), content_type=document.mime_type)


class PhotoCalibrationCreateView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request, document_id):
        if disabled(): return unavailable()
        document = document_for(request.user, document_id)
        if not document: return Response({"detail": "Not found."}, status=404)
        serializer = PhotoCalibrationCreateSerializer(data=request.data); serializer.is_valid(raise_exception=True); data = serializer.validated_data
        if data["expected_document_version"] != document.version: return Response({"detail": "Photo changed. Reload and try again.", "code": "version_conflict"}, status=409)
        if not data["same_plane_attested"]: raise ValidationError({"same_plane_attested": "Confirm that the reference and target are on the same physical plane."})
        if document.calibrations.filter(invalidated_at__isnull=True).count() >= settings.MEASUREMENT_PHOTO_MAX_CALIBRATIONS: raise ValidationError({"detail": "Calibration limit reached."})
        geometry, known, pixels, scale, confidence, evidence, warnings = create_calibration_data(document, data["reference_geometry"], data["known_length"], data["unit"])
        calibration = PhotoMeasurementCalibration.objects.create(document=document, reference_geometry=geometry, known_length=known, unit=data["unit"], canonical_pixel_distance=pixels, scale_per_pixel=scale, same_plane_attested=True, same_plane_attested_at=timezone.now(), confidence=confidence, evidence=evidence, warnings=warnings, image_checksum=document.checksum, created_by=request.user)
        if data.get("supersedes_id"):
            old = get_object_or_404(document.calibrations, pk=data["supersedes_id"], invalidated_at__isnull=True); old.invalidated_at=timezone.now(); old.superseded_by=calibration; old.save(update_fields=("invalidated_at","superseded_by"))
        document.version += 1; document.save(update_fields=("version","updated_at"))
        event(document.measurement_session, request.user, "photo_calibration_created", {"document_id": document.id, "calibration_id": calibration.id, "same_plane_attested": True})
        return Response(PhotoCalibrationSerializer(calibration).data, status=201)


class PhotoCalibrationInvalidateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, calibration_id):
        if disabled(): return unavailable()
        calibration = get_object_or_404(
            PhotoMeasurementCalibration.objects.select_related("document__project", "document__measurement_session"),
            pk=calibration_id,
        )
        if not can_create_project_capture(request.user, calibration.document.project):
            return Response({"detail": "Not found."}, status=404)
        if calibration.invalidated_at:
            return Response(PhotoCalibrationSerializer(calibration).data)
        if calibration.annotations.filter(archived_at__isnull=True).filter(
            models.Q(measurement_entry__isnull=False) | models.Q(measurement_result__isnull=False)
        ).exists():
            raise ValidationError({"detail": "A reference used by a saved proposal cannot be invalidated."})
        calibration.invalidated_at = timezone.now()
        calibration.save(update_fields=("invalidated_at",))
        calibration.document.version += 1
        calibration.document.save(update_fields=("version", "updated_at"))
        event(calibration.document.measurement_session, request.user, "photo_calibration_invalidated", {"calibration_id": calibration.id})
        return Response(PhotoCalibrationSerializer(calibration).data)


def make_annotation(document, actor, data, previous=None):
    calibration = get_object_or_404(document.calibrations, pk=data["calibration_id"])
    if calibration.invalidated_at or calibration.image_checksum != document.checksum or not calibration.same_plane_attested: raise ValidationError({"calibration_id": "Calibration is stale or unsuitable."})
    geometry, value, unit, perimeter, confidence, evidence, warnings = calculate_photo_annotation(document, calibration, data["geometry_type"], data["geometry"])
    row = PhotoMeasurementAnnotation.objects.create(document=document, calibration=calibration, previous_revision=previous, geometry_type=data["geometry_type"], geometry=geometry, label=data["label"], category=data["category"], repeat_group=data["repeat_group"], preferred_attempt=data["preferred_attempt"], normalized_value=value, normalized_unit=unit, perimeter_value=perimeter, confidence=confidence, evidence=evidence, warnings=warnings, created_by=actor, version=previous.version+1 if previous else 1)
    if row.repeat_group:
        stats = repeat_statistics(document.annotations.filter(repeat_group=row.repeat_group, archived_at__isnull=True))
        if stats["variance_warning"]:
            row.confidence="low"; row.warnings=sorted(set(row.warnings+["Repeated measurements disagree beyond the configured provisional threshold."])); row.save(update_fields=("confidence","warnings"))
            event(document.measurement_session, actor, "photo_variance_warning", {"annotation_id": row.id, "repeat_group": row.repeat_group, "relative_spread": stats["relative_spread"]})
    return row


class PhotoAnnotationCreateView(APIView):
    permission_classes=[IsAuthenticated]
    @transaction.atomic
    def post(self, request, document_id):
        if disabled(): return unavailable()
        document=document_for(request.user, document_id)
        if not document: return Response({"detail":"Not found."},status=404)
        serializer=PhotoAnnotationCreateSerializer(data=request.data); serializer.is_valid(raise_exception=True); data=serializer.validated_data
        if data["expected_document_version"] != document.version: return Response({"detail":"Photo changed. Reload and try again.","code":"version_conflict"},status=409)
        if document.annotations.filter(archived_at__isnull=True).count() >= settings.MEASUREMENT_PHOTO_MAX_ANNOTATIONS: raise ValidationError({"detail":"Annotation limit reached."})
        row=make_annotation(document,request.user,data); document.version+=1; document.save(update_fields=("version","updated_at")); event(document.measurement_session,request.user,"photo_annotation_created",{"annotation_id":row.id})
        return Response(PhotoAnnotationSerializer(row).data,status=201)


class PhotoAnnotationActionView(APIView):
    permission_classes=[IsAuthenticated]
    @transaction.atomic
    def post(self,request,annotation_id,action):
        if disabled(): return unavailable()
        row=get_object_or_404(PhotoMeasurementAnnotation.objects.select_related("document__project","document__measurement_session","calibration"),pk=annotation_id)
        if not can_create_project_capture(request.user,row.document.project): return Response({"detail":"Not found."},status=404)
        if action=="archive":
            if row.measurement_entry_id or row.measurement_result_id: raise ValidationError({"detail":"Saved proposals cannot be destructively archived."})
            row.archived_at=timezone.now(); row.save(update_fields=("archived_at",)); event(row.document.measurement_session,request.user,"photo_annotation_archived",{"annotation_id":row.id})
        elif action=="revise":
            if row.measurement_entry_id or row.measurement_result_id: raise ValidationError({"detail":"Saved proposals cannot be revised. Create a new measurement instead."})
            serializer=PhotoAnnotationRevisionSerializer(data=request.data); serializer.is_valid(raise_exception=True); data=serializer.validated_data
            if data["expected_annotation_version"] != row.version or data["expected_document_version"] != row.document.version:
                return Response({"detail":"Annotation changed. Reload and try again.","code":"version_conflict"},status=409)
            revised=make_annotation(row.document,request.user,data,previous=row)
            row.archived_at=timezone.now(); row.save(update_fields=("archived_at",))
            row.document.version+=1; row.document.save(update_fields=("version","updated_at"))
            event(row.document.measurement_session,request.user,"photo_annotation_revised",{"annotation_id":row.id,"revision_id":revised.id})
            return Response(PhotoAnnotationSerializer(revised).data,status=201)
        elif action=="repeat":
            payload={"calibration_id":row.calibration_id,"geometry_type":row.geometry_type,"geometry":row.geometry,"label":row.label,"category":row.category,"repeat_group":row.repeat_group or f"photo-{row.id}","preferred_attempt":False,"expected_document_version":row.document.version}
            serializer=PhotoAnnotationCreateSerializer(data={**payload,**request.data}); serializer.is_valid(raise_exception=True); repeated=make_annotation(row.document,request.user,serializer.validated_data); row.document.version+=1; row.document.save(update_fields=("version","updated_at")); event(row.document.measurement_session,request.user,"photo_annotation_repeated",{"source_id":row.id,"annotation_id":repeated.id}); return Response(PhotoAnnotationSerializer(repeated).data,status=201)
        elif action=="create-proposal":
            if row.confidence=="low": raise ValidationError({"detail":"Low-confidence photo measurements cannot create an eligible proposal. Verify in the field."})
            if row.measurement_result_id: return Response(PhotoAnnotationSerializer(row).data)
            session=row.document.measurement_session; key=f"photo-reference-{row.id}-v{row.version}"; entry=None
            lineage={"provider":"photo_reference","provider_version":"photo_reference.v1","document_id":row.document_id,"image_name":row.document.original_filename,"image_checksum":row.document.checksum,"original_dimensions":[row.document.original_width,row.document.original_height],"orientation_transform":row.document.orientation_transform,"calibration_id":row.calibration_id,"annotation_id":row.id,"confidence":row.confidence,"evidence":row.evidence,"warnings":row.warnings,"same_plane_attested":row.calibration.same_plane_attested,"repeat_group":row.repeat_group}
            if row.geometry_type in {"line","polyline"}:
                entry=MeasurementEntry.objects.create(session=session,client_key=key,label=row.label,dimension_type="perimeter_segment" if row.geometry_type=="polyline" else "length",normalized_value=row.normalized_value,display_unit=row.normalized_unit,raw_value=f"{row.normalized_value} {row.normalized_unit}",source_method="photo_reference",verification_status="needs_verification",tool_description="Calibrated photo reference",source_metadata=lineage,notes="Photo estimate; verify in field.",measured_by=request.user); row.measurement_entry=entry
            result=MeasurementCalculatedResult.objects.create(session=session,result_type="net_area" if row.geometry_type=="polygon" else "total_linear_length",label=row.label,normalized_value=row.normalized_value,normalized_unit=row.normalized_unit,display_value=str(row.normalized_value),display_unit=row.normalized_unit,formula_key=f"photo.{row.geometry_type}",calculation_version=CALCULATION_VERSION,source_entry_keys=[key] if entry else [],verification_status="needs_verification",lineage=lineage); row.measurement_result=result; row.save(update_fields=("measurement_entry","measurement_result","updated_at")); event(session,request.user,"photo_measurement_proposal_created",{"annotation_id":row.id,"provider":"photo_reference"})
        else: return Response({"detail":"Unsupported action."},status=400)
        return Response(PhotoAnnotationSerializer(row).data)
