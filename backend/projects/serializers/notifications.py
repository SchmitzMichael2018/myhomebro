from rest_framework import serializers

from projects.models import Notification
from projects.services.notification_center import (
    is_action_needed,
    notification_action_label,
    notification_action_url,
)


class NotificationSerializer(serializers.ModelSerializer):
    body = serializers.CharField(source="message", read_only=True)
    category_label = serializers.SerializerMethodField()
    agreement_id = serializers.IntegerField(read_only=True)
    milestone_id = serializers.IntegerField(read_only=True)
    invoice_id = serializers.IntegerField(read_only=True)
    draw_request_id = serializers.IntegerField(read_only=True)
    public_lead_id = serializers.IntegerField(read_only=True)
    project_title = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()
    action_url = serializers.SerializerMethodField()
    action_needed = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "category",
            "category_label",
            "event_type",
            "body",
            "message",
            "agreement_id",
            "milestone_id",
            "invoice_id",
            "draw_request_id",
            "public_lead_id",
            "actor_display_name",
            "actor_email",
            "title",
            "project_title",
            "action_label",
            "action_url",
            "action_needed",
            "is_read",
            "link",
            "created_at",
        ]

    def get_category_label(self, obj):
        value = getattr(obj, "category", "") or getattr(obj, "event_type", "")
        return str(value or "").replace("_", " ").strip().title() or "Notification"

    def get_project_title(self, obj):
        agreement = getattr(obj, "agreement", None)
        project = getattr(agreement, "project", None) if agreement is not None else None
        if getattr(project, "title", ""):
            return getattr(project, "title", "") or ""
        invoice = getattr(obj, "invoice", None)
        invoice_agreement = getattr(invoice, "agreement", None) if invoice is not None else None
        invoice_project = getattr(invoice_agreement, "project", None) if invoice_agreement is not None else None
        if getattr(invoice_project, "title", ""):
            return getattr(invoice_project, "title", "") or ""
        public_lead = getattr(obj, "public_lead", None)
        if public_lead is not None:
            return (
                getattr(public_lead, "project_type", "")
                or getattr(public_lead, "project_description", "")
                or f"Bid #{getattr(public_lead, 'id', '')}"
            )
        return ""

    def get_action_label(self, obj):
        return notification_action_label(obj)

    def get_action_url(self, obj):
        return notification_action_url(obj)

    def get_action_needed(self, obj):
        return is_action_needed(obj)
