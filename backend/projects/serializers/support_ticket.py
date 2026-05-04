from __future__ import annotations

from rest_framework import serializers

from projects.models import Contractor
from projects.models_support import (
    SupportMessage,
    SupportTicket,
    SupportTicketCategory,
    SupportTicketPriority,
    SupportTicketStatus,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


def infer_support_user_role(user) -> str:
    if not user or not getattr(user, "is_authenticated", False):
        return ""

    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return "staff"

    subaccount = get_subaccount_for_user(user)
    if subaccount is not None:
        # Preserve the platform role on the ticket so support can see the source context.
        return getattr(subaccount, "role", "") or "subaccount"

    contractor = get_contractor_for_user(user)
    if contractor is not None:
        owner_contractor = getattr(user, "contractor_profile", None) or Contractor.objects.filter(user=user).first()
        if owner_contractor is not None:
            return "contractor_owner"
        return "contractor"

    role = (
        getattr(user, "role", "")
        or getattr(user, "type", "")
        or getattr(user, "identity_type", "")
        or ""
    )
    return str(role).strip() or "authenticated"


class SupportTicketSerializer(serializers.ModelSerializer):
    attachment_url = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    related_object = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    priority_display = serializers.CharField(source="get_priority_display", read_only=True)
    attachment = serializers.FileField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            "ticket_number",
            "submitted_by",
            "submitted_by_name",
            "email",
            "user_role",
            "subject",
            "category",
            "category_display",
            "priority",
            "priority_display",
            "message",
            "status",
            "status_display",
            "related_object_type",
            "related_object_id",
            "related_object",
            "attachment",
            "attachment_url",
            "attachment_name",
            "assigned_to",
            "resolved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "ticket_number",
            "submitted_by",
            "submitted_by_name",
            "user_role",
            "status",
            "status_display",
            "assigned_to",
            "resolved_at",
            "created_at",
            "updated_at",
            "attachment_url",
            "attachment_name",
            "related_object",
            "category_display",
            "priority_display",
        ]

    def get_attachment_url(self, obj):
        request = self.context.get("request")
        attachment = getattr(obj, "attachment", None)
        if not attachment or not getattr(attachment, "url", ""):
            return ""
        try:
            url = attachment.url
        except Exception:
            return ""
        if request is not None:
            try:
                return request.build_absolute_uri(url)
            except Exception:
                pass
        return url

    def get_attachment_name(self, obj):
        attachment = getattr(obj, "attachment", None)
        return getattr(attachment, "name", "") or ""

    def get_related_object(self, obj):
        related_type = getattr(obj, "related_object_type", "") or ""
        related_id = getattr(obj, "related_object_id", "") or ""
        if not related_type and not related_id:
            return None
        label = related_type.replace("_", " ").title() if related_type else "Related Item"
        if related_id:
            label = f"{label} #{related_id}"
        return {
            "type": related_type,
            "id": related_id,
            "label": label,
        }

    def get_submitted_by_name(self, obj):
        user = getattr(obj, "submitted_by", None)
        if not user:
            return ""
        full_name = getattr(user, "get_full_name", lambda: "")()
        return full_name or getattr(user, "first_name", "") or getattr(user, "email", "") or ""

    def validate_category(self, value):
        if value not in SupportTicketCategory.values:
            raise serializers.ValidationError("Choose a valid support category.")
        return value

    def validate_priority(self, value):
        if value not in SupportTicketPriority.values:
            raise serializers.ValidationError("Choose a valid priority.")
        return value

    def validate_status(self, value):
        if value not in SupportTicketStatus.values:
            raise serializers.ValidationError("Choose a valid status.")
        return value


class SupportMessageSerializer(serializers.ModelSerializer):
    sender_display = serializers.SerializerMethodField()
    sender_role_display = serializers.CharField(source="get_sender_role_display", read_only=True)

    class Meta:
        model = SupportMessage
        fields = [
            "id",
            "sender",
            "sender_display",
            "sender_role",
            "sender_role_display",
            "message_text",
            "is_internal",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "sender",
            "sender_display",
            "sender_role_display",
            "created_at",
        ]

    def get_sender_display(self, obj):
        sender = getattr(obj, "sender", None)
        if not sender:
            return obj.get_sender_role_display()
        return (
            getattr(sender, "get_full_name", lambda: "")()
            or getattr(sender, "first_name", "")
            or getattr(sender, "email", "")
            or obj.get_sender_role_display()
        )


class SupportTicketDetailSerializer(SupportTicketSerializer):
    messages = SupportMessageSerializer(many=True, read_only=True)

    class Meta(SupportTicketSerializer.Meta):
        fields = SupportTicketSerializer.Meta.fields + ["messages"]
        read_only_fields = SupportTicketSerializer.Meta.read_only_fields + ["messages"]


class SupportTicketReplySerializer(serializers.Serializer):
    message_text = serializers.CharField(allow_blank=False, trim_whitespace=True)
    is_internal = serializers.BooleanField(required=False, default=False)

    def validate_message_text(self, value):
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Reply message is required.")
        return text
