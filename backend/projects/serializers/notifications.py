from rest_framework import serializers

from projects.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    agreement_id = serializers.IntegerField(read_only=True)
    milestone_id = serializers.IntegerField(read_only=True)
    draw_request_id = serializers.IntegerField(read_only=True)
    public_lead_id = serializers.IntegerField(read_only=True)
    project_title = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()
    action_url = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "event_type",
            "agreement_id",
            "milestone_id",
            "draw_request_id",
            "public_lead_id",
            "actor_display_name",
            "actor_email",
            "title",
            "message",
            "project_title",
            "action_label",
            "action_url",
            "is_read",
            "created_at",
        ]

    def get_project_title(self, obj):
        agreement = getattr(obj, "agreement", None)
        project = getattr(agreement, "project", None) if agreement is not None else None
        if getattr(project, "title", ""):
            return getattr(project, "title", "") or ""
        public_lead = getattr(obj, "public_lead", None)
        if public_lead is not None:
            return (
                getattr(public_lead, "project_type", "")
                or getattr(public_lead, "project_description", "")
                or f"Bid #{getattr(public_lead, 'id', '')}"
            )
        return ""

    def get_action_label(self, obj):
        event_type = getattr(obj, "event_type", "")
        if event_type == Notification.EVENT_BID_AWARDED:
            return "Open Agreement" if getattr(obj, "agreement_id", None) else "View Bid"
        if event_type == Notification.EVENT_BID_NOT_SELECTED:
            return "View Bids"
        if getattr(obj, "agreement_id", None):
            return "Open Agreement"
        if getattr(obj, "draw_request_id", None):
            return "Open Draw"
        return "View Details"

    def get_action_url(self, obj):
        event_type = getattr(obj, "event_type", "")
        agreement_id = getattr(obj, "agreement_id", None)
        if event_type == Notification.EVENT_BID_AWARDED and agreement_id:
            return f"/app/agreements/{agreement_id}"
        if event_type == Notification.EVENT_BID_NOT_SELECTED:
            return "/app/bids"
        if agreement_id:
            return f"/app/agreements/{agreement_id}"
        draw_request_id = getattr(obj, "draw_request_id", None)
        if draw_request_id:
            return f"/app/agreements/{agreement_id}" if agreement_id else "/app/dashboard"
        return ""
