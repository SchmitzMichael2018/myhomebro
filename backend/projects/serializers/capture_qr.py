from rest_framework import serializers

from projects.models import CaptureQrAsset


class CaptureQrAssetSerializer(serializers.ModelSerializer):
    public_url = serializers.SerializerMethodField()
    available = serializers.BooleanField(read_only=True)

    class Meta:
        model = CaptureQrAsset
        fields = (
            "id", "label", "asset_type", "campaign_key", "source_detail",
            "active", "available", "expires_at", "revoked_at", "rotated_at",
            "created_at", "updated_at", "public_url",
        )
        read_only_fields = (
            "id", "available", "revoked_at", "rotated_at", "created_at",
            "updated_at", "public_url",
        )

    def get_public_url(self, obj):
        request = self.context.get("request")
        path = f"/c/{obj.token_key}"
        return request.build_absolute_uri(path) if request else path

    def validate_label(self, value):
        value = str(value or "").strip()
        if not value:
            raise serializers.ValidationError("Label is required.")
        return value

    def validate_campaign_key(self, value):
        return str(value or "").strip().lower()

    def validate(self, attrs):
        if self.instance and self.instance.revoked_at:
            raise serializers.ValidationError("A revoked QR asset cannot be edited.")
        if "asset_type" in attrs and "source_detail" not in attrs:
            attrs["source_detail"] = attrs["asset_type"]
        return attrs
