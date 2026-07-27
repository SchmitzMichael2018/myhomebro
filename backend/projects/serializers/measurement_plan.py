from rest_framework import serializers

from projects.models import (
    PlanMeasurementAnnotation,
    PlanMeasurementCalibration,
    PlanMeasurementDocument,
)


class PlanDocumentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = PlanMeasurementDocument
        fields = (
            "id", "measurement_session_id", "artifact_id", "project_id", "proposal_id",
            "original_filename", "checksum", "page_count", "file_size", "status",
            "source", "version", "created_at", "updated_at", "file_url",
        )

    def get_file_url(self, obj):
        request = self.context.get("request")
        path = f"/api/projects/measurement-plan-documents/{obj.pk}/file/"
        return request.build_absolute_uri(path) if request else path


class PlanCalibrationSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanMeasurementCalibration
        fields = (
            "id", "document_id", "page_number", "calibration_type",
            "reference_geometry", "region_geometry", "known_length", "unit",
            "canonical_distance", "scale_per_point", "page_rotation", "page_box",
            "source_dimension_label", "confidence", "warnings",
            "invalidated_at", "superseded_by_id", "version", "created_by_name",
            "created_at",
        )

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.email if obj.created_by else "System"


class PlanAnnotationSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanMeasurementAnnotation
        fields = (
            "id", "document_id", "calibration_id", "previous_revision_id",
            "measurement_entry_id", "measurement_result_id", "page_number",
            "annotation_type", "geometry", "label", "category",
            "normalized_value", "normalized_unit", "perimeter_value",
            "confidence", "confidence_reasons", "warnings", "source_version",
            "calculation_version", "created_by_name", "archived_at", "version",
            "created_at", "updated_at",
        )

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.email if obj.created_by else "System"


class CalibrationCreateSerializer(serializers.Serializer):
    page_number = serializers.IntegerField(min_value=1)
    calibration_type = serializers.ChoiceField(choices=("page", "region"), default="page")
    reference_geometry = serializers.DictField()
    region_geometry = serializers.DictField(required=False, default=dict)
    known_length = serializers.DecimalField(max_digits=24, decimal_places=10)
    unit = serializers.ChoiceField(choices=("inches", "feet", "millimeters", "centimeters", "meters"))
    page_rotation = serializers.ChoiceField(choices=(0, 90, 180, 270), default=0)
    page_box = serializers.DictField()
    source_dimension_label = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    supersedes_id = serializers.IntegerField(required=False)
    expected_document_version = serializers.IntegerField(min_value=1)


class AnnotationCreateSerializer(serializers.Serializer):
    page_number = serializers.IntegerField(min_value=1)
    calibration_id = serializers.IntegerField(required=False, allow_null=True)
    annotation_type = serializers.ChoiceField(choices=("line", "polyline", "polygon", "count"))
    geometry = serializers.DictField()
    label = serializers.CharField(max_length=160)
    category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    expected_document_version = serializers.IntegerField(min_value=1)


class AnnotationRevisionSerializer(AnnotationCreateSerializer):
    expected_annotation_version = serializers.IntegerField(min_value=1)
