from rest_framework import serializers

from projects.models import Capture, CaptureApplication, CaptureArtifact, CaptureEvent


class CaptureArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaptureArtifact
        fields = (
            "id",
            "artifact_type",
            "original_filename",
            "mime_type",
            "file_size",
            "file_sha256",
            "captured_at",
            "retention_state",
            "sanitization_metadata",
            "deleted_at",
            "created_at",
        )


class CaptureEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaptureEvent
        fields = (
            "id",
            "event_type",
            "from_status",
            "to_status",
            "actor_id",
            "reason",
            "metadata",
            "created_at",
        )


class CaptureApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaptureApplication
        fields = (
            "id",
            "adapter",
            "adapter_version",
            "status",
            "actor_id",
            "capture_version",
            "created_records",
            "receipt_payload",
            "failure_code",
            "executed_at",
            "created_at",
        )


class CaptureSerializer(serializers.ModelSerializer):
    captured_by_name = serializers.SerializerMethodField()
    customer_id = serializers.IntegerField(read_only=True)
    project_id = serializers.IntegerField(read_only=True)
    agreement_id = serializers.IntegerField(read_only=True)
    milestone_id = serializers.IntegerField(read_only=True)
    artifacts = CaptureArtifactSerializer(many=True, read_only=True)
    events = CaptureEventSerializer(many=True, read_only=True)

    class Meta:
        model = Capture
        fields = (
            "id",
            "capture_type",
            "status",
            "processing_engine",
            "original_captured_at",
            "source_category",
            "source_detail",
            "capture_method",
            "proposed_destination",
            "customer_id",
            "project_id",
            "agreement_id",
            "milestone_id",
            "raw_text_payload",
            "structured_draft",
            "confidence",
            "duplicate_candidates",
            "failure_details",
            "attribution_metadata",
            "audit_metadata",
            "retry_count",
            "version",
            "archived_at",
            "captured_by_id",
            "captured_by_name",
            "artifacts",
            "events",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "processing_engine",
            "structured_draft",
            "confidence",
            "duplicate_candidates",
            "failure_details",
            "retry_count",
            "version",
            "archived_at",
            "captured_by_id",
            "captured_by_name",
            "artifacts",
            "events",
            "created_at",
            "updated_at",
        )

    def get_captured_by_name(self, obj):
        actor = obj.captured_by
        if not actor:
            return ""
        return actor.get_full_name() or actor.email

    def validate_raw_text_payload(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Raw text payload must be an object.")
        allowed = {"text", "transcript", "language", "input_metadata"}
        unknown = set(value) - allowed
        if unknown:
            raise serializers.ValidationError(f"Unsupported raw text fields: {', '.join(sorted(unknown))}.")
        return value

    def validate_attribution_metadata(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Attribution metadata must be an object.")
        allowed = {"campaign", "referral", "utm_source", "utm_medium", "utm_campaign"}
        unknown = set(value) - allowed
        if unknown:
            raise serializers.ValidationError(
                f"Unsupported attribution fields: {', '.join(sorted(unknown))}."
            )
        return value


class CaptureCreateSerializer(CaptureSerializer):
    class Meta(CaptureSerializer.Meta):
        read_only_fields = CaptureSerializer.Meta.read_only_fields + (
            "customer_id",
            "project_id",
            "agreement_id",
            "milestone_id",
            "proposed_destination",
            "audit_metadata",
        )


class CapturePatchSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(min_value=1)
    raw_text_payload = serializers.JSONField(required=False)
    source_category = serializers.CharField(max_length=40, required=False, allow_blank=True)
    source_detail = serializers.CharField(max_length=80, required=False, allow_blank=True)
    capture_method = serializers.ChoiceField(choices=Capture.METHOD_CHOICES, required=False)
    attribution_metadata = serializers.JSONField(required=False)

    def validate_raw_text_payload(self, value):
        return CaptureSerializer().validate_raw_text_payload(value)

    def validate_attribution_metadata(self, value):
        return CaptureSerializer().validate_attribution_metadata(value)
