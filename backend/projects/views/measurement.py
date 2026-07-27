from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    MeasurementAdjustment,
    MeasurementCalculatedResult,
    MeasurementEntry,
    MeasurementEvent,
    MeasurementSession,
    Project,
)
from projects.serializers.measurement import MeasurementSessionSerializer
from projects.services.capture_permissions import can_create_project_capture
from projects.services.manual_measurements import build_manual_measurement
from projects.services.measurement_calculations import MeasurementCalculationError


def _manual_error(exc):
    return Response(
        {"code": "invalid_manual_measurement", "detail": str(exc)},
        status=status.HTTP_400_BAD_REQUEST,
    )


class ManualMeasurementPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not getattr(settings, "CAPTURE_MEASUREMENT_ENABLED", False):
            return Response({"detail": "Measurement Capture is unavailable."}, status=status.HTTP_404_NOT_FOUND)
        project = get_object_or_404(Project, pk=request.data.get("project_id"))
        if not can_create_project_capture(request.user, project):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            result = build_manual_measurement(request.data.get("measurement"))
        except MeasurementCalculationError as exc:
            return _manual_error(exc)
        return Response(result)


class MeasurementSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        if not getattr(settings, "CAPTURE_MEASUREMENT_ENABLED", False):
            return Response({"detail": "Measurement Capture is unavailable."}, status=status.HTTP_404_NOT_FOUND)
        session = get_object_or_404(
            MeasurementSession.objects.select_related(
                "project", "proposal", "customer", "captured_by", "source_capture"
            ).prefetch_related(
                "entries__measured_by", "adjustments", "calculated_results",
                "attachments__artifact", "attachments__annotations", "events__actor",
                "plan_documents",
                "photo_documents",
            ),
            pk=session_id,
        )
        if not can_create_project_capture(request.user, session.project):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(MeasurementSessionSerializer(session, context={"request": request}).data)

    @transaction.atomic
    def post(self, request, session_id):
        if not getattr(settings, "CAPTURE_MEASUREMENT_ENABLED", False):
            return Response({"detail": "Measurement Capture is unavailable."}, status=status.HTTP_404_NOT_FOUND)
        session = get_object_or_404(
            MeasurementSession.objects.select_for_update().select_related("project"),
            pk=session_id,
        )
        if not can_create_project_capture(request.user, session.project):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            expected_version = int(request.data.get("version"))
        except (TypeError, ValueError):
            return Response({"code": "version_required", "detail": "The current session version is required."}, status=status.HTTP_400_BAD_REQUEST)
        if expected_version != session.version:
            return Response(
                {"code": "version_conflict", "detail": "This session changed. Reload before saving.", "current_version": session.version},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            result = build_manual_measurement(request.data.get("measurement"))
        except MeasurementCalculationError as exc:
            return _manual_error(exc)

        next_version = session.version + 1
        prefix = f"v{next_version}-"
        key_map = {row["client_key"]: f"{prefix}{row['client_key']}" for row in result["entries"]}
        base_sequence = session.entries.count()
        for sequence, item in enumerate(result["entries"]):
            verified = item["verification_status"] in {"verified", "confirmed"}
            MeasurementEntry.objects.create(
                session=session, client_key=key_map[item["client_key"]],
                reading_group=item.get("reading_group", ""), label=item["label"],
                dimension_type=item["dimension_type"], normalized_value=item["normalized_value"],
                display_unit=item["display_unit"], raw_value=item["raw_value"],
                source_method=item["source_method"], verification_status=item["verification_status"],
                selected_for_calculation=True, selection_method="manual_profile",
                sequence=base_sequence + sequence, notes=item.get("notes", ""),
                measured_by=request.user, verified_by=request.user if verified else None,
                verified_at=timezone.now() if verified else None,
            )
        for item in result["adjustments"]:
            MeasurementAdjustment.objects.create(
                session=session, client_key=f"{prefix}{item['client_key']}",
                label=item["label"], adjustment_type=item["adjustment_type"],
                source_entry_keys=[key_map[key] for key in item["source_entry_keys"]],
                calculated_value=item.get("calculated_value", 0),
                normalized_unit="square_inches", notes=item.get("notes", ""),
            )
        for item in result["calculations"]:
            lineage = dict(item["lineage"])
            lineage["inputs"] = {key_map.get(key, key): value for key, value in lineage.get("inputs", {}).items()}
            lineage["sources"] = {key_map.get(key, key): value for key, value in lineage.get("sources", {}).items()}
            MeasurementCalculatedResult.objects.create(
                session=session, result_type=item["result_type"], label=item["label"],
                normalized_value=item["normalized_value"], normalized_unit=item["normalized_unit"],
                display_value=item["display_value"], display_unit=item["display_unit"],
                formula_key=item["formula_key"], calculation_version=item["calculation_version"],
                source_entry_keys=[key_map[key] for key in item["source_entry_keys"]],
                adjustment_keys=[f"{prefix}{key}" for key in item["adjustment_keys"]],
                verification_status=item["verification_status"], lineage=lineage,
                revision=next_version,
            )
        session.version = next_version
        session.guided_profile = result["profile"]
        session.status = MeasurementSession.STATUS_VERIFIED if result["source"] in {"field_verified_manual", "laser_manual"} else MeasurementSession.STATUS_NEEDS_REVIEW
        session.save(update_fields=["version", "guided_profile", "status", "updated_at"])
        MeasurementEvent.objects.create(
            session=session, event_type="manual_measurement_added", actor=request.user,
            session_version=next_version,
            metadata={"profile": result["profile"], "source": result["source"], "result_count": len(result["calculations"])},
        )
        refreshed = MeasurementSession.objects.prefetch_related(
            "entries__measured_by", "adjustments", "calculated_results",
            "attachments__artifact", "attachments__annotations", "events__actor",
            "plan_documents", "photo_documents",
        ).get(pk=session.pk)
        return Response(MeasurementSessionSerializer(refreshed, context={"request": request}).data, status=status.HTTP_201_CREATED)
