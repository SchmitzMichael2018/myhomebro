# backend/projects/serializers/attachment.py
from rest_framework import serializers
from projects.models_attachments import AgreementAttachment


class AgreementAttachmentSerializer(serializers.ModelSerializer):
    """
    Presents native fields and common aliases used by the frontend.

    Aliases:
      - visible  <-> visible_to_homeowner
      - acknowledgement_required <-> ack_required

    Read-only helpers:
      - file_url
      - file_name
      - uploaded_by_name
    """

    # Aliases that many UIs send/read
    visible = serializers.BooleanField(source="visible_to_homeowner", required=False)
    acknowledgement_required = serializers.BooleanField(source="ack_required", required=False)

    file_url = serializers.SerializerMethodField(read_only=True)
    file_name = serializers.SerializerMethodField(read_only=True)
    uploaded_by_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AgreementAttachment
        fields = [
            "id",
            "agreement",
            "title",
            "category",
            "file",
            "file_url",
            "file_name",
            "visible_to_homeowner",
            "ack_required",
            "visible",                    # alias
            "acknowledgement_required",   # alias
            "uploaded_by",
            "uploaded_by_name",
            "uploaded_at",
        ]
        read_only_fields = ["uploaded_by", "uploaded_at", "file_url", "file_name", "uploaded_by_name"]

    def get_file_url(self, obj):
        try:
            return obj.file.url if obj.file else None
        except Exception:
            return None

    def get_file_name(self, obj):
        try:
            return obj.file.name.split("/")[-1] if obj.file and obj.file.name else None
        except Exception:
            return None

    def get_uploaded_by_name(self, obj):
        u = getattr(obj, "uploaded_by", None)
        if not u:
            return None
        return u.get_full_name() or getattr(u, "username", None) or getattr(u, "email", None)

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            validated_data["uploaded_by"] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("uploaded_by", None)
        return super().update(instance, validated_data)
