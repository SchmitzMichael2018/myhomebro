from rest_framework import serializers
from projects.models import MilestoneComment


class MilestoneCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = MilestoneComment
        fields = [
            "id",
            "milestone",
            "author",
            "author_name",
            "content",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "author_name"]

    def get_author_name(self, obj):
        try:
            a = getattr(obj, "author", None)
            if not a:
                return "Deleted User"
            full = getattr(a, "get_full_name", lambda: "")() or ""
            return full or getattr(a, "email", "") or getattr(a, "username", "") or "User"
        except Exception:
            return "User"
