from rest_framework import serializers

from projects.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    agreement_id = serializers.IntegerField(source="agreement_id", read_only=True)
    milestone_id = serializers.IntegerField(source="milestone_id", read_only=True)
    draw_request_id = serializers.IntegerField(source="draw_request_id", read_only=True)
    project_title = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "event_type",
            "agreement_id",
            "milestone_id",
            "draw_request_id",
            "actor_display_name",
            "actor_email",
            "title",
            "message",
            "project_title",
            "is_read",
            "created_at",
        ]

    def get_project_title(self, obj):
        agreement = getattr(obj, "agreement", None)
        project = getattr(agreement, "project", None) if agreement is not None else None
        return getattr(project, "title", "") or ""
