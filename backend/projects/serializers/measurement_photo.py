from rest_framework import serializers

from projects.models import PhotoMeasurementAnnotation, PhotoMeasurementCalibration, PhotoMeasurementDocument
from projects.services.photo_measurement import repeat_statistics


class PhotoDocumentSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    class Meta:
        model = PhotoMeasurementDocument
        fields = ("id", "measurement_session_id", "artifact_id", "project_id", "proposal_id", "original_filename", "mime_type", "checksum", "original_width", "original_height", "normalized_width", "normalized_height", "original_orientation", "orientation_transform", "source", "status", "version", "created_at", "updated_at", "image_url")
    def get_image_url(self, obj):
        path = f"/api/projects/measurement-photo-documents/{obj.id}/image/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class PhotoCalibrationSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    class Meta:
        model = PhotoMeasurementCalibration
        fields = ("id", "document_id", "reference_geometry", "known_length", "unit", "canonical_pixel_distance", "scale_per_pixel", "working_region", "same_plane_attested", "same_plane_attested_at", "marker_version", "confidence", "evidence", "warnings", "image_checksum", "algorithm_version", "invalidated_at", "superseded_by_id", "version", "created_by_name", "created_at")
    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.email if obj.created_by else "System"


class PhotoAnnotationSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    repeat_statistics = serializers.SerializerMethodField()
    class Meta:
        model = PhotoMeasurementAnnotation
        fields = ("id", "document_id", "calibration_id", "previous_revision_id", "measurement_entry_id", "measurement_result_id", "geometry_type", "geometry", "label", "category", "repeat_group", "preferred_attempt", "normalized_value", "normalized_unit", "perimeter_value", "confidence", "evidence", "warnings", "calculation_version", "created_by_name", "archived_at", "version", "created_at", "updated_at", "repeat_statistics")
    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.email if obj.created_by else "System"
    def get_repeat_statistics(self, obj):
        return repeat_statistics(obj.document.annotations.filter(repeat_group=obj.repeat_group, archived_at__isnull=True)) if obj.repeat_group else None


class PhotoCalibrationCreateSerializer(serializers.Serializer):
    reference_geometry = serializers.DictField()
    known_length = serializers.DecimalField(max_digits=24, decimal_places=10)
    unit = serializers.ChoiceField(choices=("inches", "feet", "millimeters", "centimeters", "meters"))
    label = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    same_plane_attested = serializers.BooleanField()
    expected_document_version = serializers.IntegerField(min_value=1)
    supersedes_id = serializers.IntegerField(required=False)


class PhotoAnnotationCreateSerializer(serializers.Serializer):
    calibration_id = serializers.IntegerField()
    geometry_type = serializers.ChoiceField(choices=("line", "polyline", "polygon"))
    geometry = serializers.DictField()
    label = serializers.CharField(max_length=160)
    category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    repeat_group = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    preferred_attempt = serializers.BooleanField(required=False, default=False)
    expected_document_version = serializers.IntegerField(min_value=1)


class PhotoAnnotationRevisionSerializer(PhotoAnnotationCreateSerializer):
    expected_annotation_version = serializers.IntegerField(min_value=1)
