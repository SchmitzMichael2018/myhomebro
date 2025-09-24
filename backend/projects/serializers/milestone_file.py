from rest_framework import serializers
from projects.models import MilestoneFile


class MilestoneFileSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    size_bytes = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MilestoneFile
        fields = [
            "id",
            "milestone",
            "uploaded_by",
            "uploaded_by_name",
            "file",
            "file_url",
            "file_name",
            "size_bytes",
            "uploaded_at",
        ]
        read_only_fields = ["id", "uploaded_at", "file_url", "file_name", "size_bytes", "uploaded_by_name"]

    def get_file_url(self, obj):
        try:
            f = getattr(obj, "file", None)
            if not f:
                return None
            request = self.context.get("request")
            return request.build_absolute_uri(f.url) if request else getattr(f, "url", None)
        except Exception:
            return None

    def get_file_name(self, obj):
        try:
            f = getattr(obj, "file", None)
            if not f:
                return None
            name = getattr(f, "name", "") or ""
            return name.split("/")[-1] if name else None
        except Exception:
            return None

    def get_size_bytes(self, obj):
        try:
            f = getattr(obj, "file", None)
            return getattr(f, "size", None)
        except Exception:
            return None

    def get_uploaded_by_name(self, obj):
        try:
            u = getattr(obj, "uploaded_by", None)
            if not u:
                return None
            full = getattr(u, "get_full_name", lambda: "")() or ""
            return full or getattr(u, "email", "") or getattr(u, "username", "")
        except Exception:
            return None
