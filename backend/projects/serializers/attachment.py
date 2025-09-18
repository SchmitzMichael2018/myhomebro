# backend/projects/serializers/attachment.py
from rest_framework import serializers
from projects.models_attachments import AgreementAttachment

class AgreementAttachmentSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    size_bytes = serializers.SerializerMethodField()

    class Meta:
        model = AgreementAttachment
        fields = [
            "id", "agreement", "title", "category",
            "file_url", "file_name", "size_bytes",
            "visible_to_homeowner", "ack_required",
            "uploaded_by", "uploaded_at",
        ]
        read_only_fields = ["id", "agreement", "file_url", "file_name", "size_bytes", "uploaded_by", "uploaded_at"]

    def get_file_name(self, obj):
        try:
            return obj.file.name.split("/")[-1]
        except Exception:
            return ""

    def get_file_url(self, obj):
        try:
            request = self.context.get("request")
            url = obj.file.url
            return request.build_absolute_uri(url) if request else url
        except Exception:
            return None

    def get_size_bytes(self, obj):
        try:
            return obj.file.size
        except Exception:
            return None
