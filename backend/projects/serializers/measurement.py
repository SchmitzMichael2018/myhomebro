from django.conf import settings
from rest_framework import serializers

from projects.models import (
    MeasurementAdjustment,
    MeasurementAnnotation,
    MeasurementAttachment,
    MeasurementCalculatedResult,
    MeasurementEntry,
    MeasurementEvent,
    MeasurementSession,
)


class MeasurementEntrySerializer(serializers.ModelSerializer):
    measured_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MeasurementEntry
        fields = (
            "id", "client_key", "reading_group", "label", "dimension_type",
            "normalized_value", "display_unit", "raw_value", "source_method",
            "verification_status", "confidence", "tool_description",
            "source_metadata",
            "selected_for_calculation", "selection_method", "direction", "sequence",
            "notes", "measured_by_name", "measured_at", "verified_at",
        )

    def get_measured_by_name(self, obj):
        return obj.measured_by.get_full_name() or obj.measured_by.email if obj.measured_by else ""


class MeasurementAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeasurementAdjustment
        fields = "__all__"


class MeasurementResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeasurementCalculatedResult
        exclude = ("session",)


class MeasurementAnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeasurementAnnotation
        fields = ("id", "label", "line", "entry_client_key", "known_reference_value", "verification_status", "warning")


class MeasurementAttachmentSerializer(serializers.ModelSerializer):
    annotations = MeasurementAnnotationSerializer(many=True, read_only=True)
    filename = serializers.CharField(source="artifact.original_filename", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = MeasurementAttachment
        fields = ("id", "attachment_type", "filename", "download_url", "annotations", "created_at")

    def get_download_url(self, obj):
        request = self.context.get("request")
        if not obj.artifact.file:
            return ""
        return request.build_absolute_uri(obj.artifact.file.url) if request else obj.artifact.file.url


class MeasurementEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = MeasurementEvent
        fields = ("id", "event_type", "actor_name", "session_version", "metadata", "created_at")

    def get_actor_name(self, obj):
        return obj.actor.get_full_name() or obj.actor.email if obj.actor else "System"


class MeasurementSessionSerializer(serializers.ModelSerializer):
    entries = MeasurementEntrySerializer(many=True, read_only=True)
    adjustments = MeasurementAdjustmentSerializer(many=True, read_only=True)
    calculated_results = MeasurementResultSerializer(many=True, read_only=True)
    attachments = MeasurementAttachmentSerializer(many=True, read_only=True)
    events = MeasurementEventSerializer(many=True, read_only=True)
    project_title = serializers.CharField(source="project.title", read_only=True)
    captured_by_name = serializers.SerializerMethodField()
    source_capture_id = serializers.UUIDField(read_only=True)
    plan_documents = serializers.SerializerMethodField()

    class Meta:
        model = MeasurementSession
        fields = (
            "id", "project_id", "project_title", "proposal_id", "customer_id",
            "room_name", "room_type", "purpose", "guided_profile",
            "default_unit_system", "status", "notes", "captured_by_name",
            "measured_at", "source_capture_id", "version", "confirmed_at",
            "created_at", "updated_at", "entries", "adjustments",
            "calculated_results", "attachments", "events", "plan_documents",
        )

    def get_captured_by_name(self, obj):
        return obj.captured_by.get_full_name() or obj.captured_by.email if obj.captured_by else ""

    def get_plan_documents(self, obj):
        if not getattr(settings, "MEASUREMENT_PDF_ENABLED", False):
            return []
        return [
            {
                "id": row.id,
                "artifact_id": str(row.artifact_id),
                "original_filename": row.original_filename,
                "page_count": row.page_count,
                "status": row.status,
                "version": row.version,
            }
            for row in obj.plan_documents.filter(status="active")
        ]
