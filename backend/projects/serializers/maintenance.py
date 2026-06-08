from __future__ import annotations

from rest_framework import serializers

from projects.models_maintenance import MaintenanceWorkOrder, MaintenanceWorkOrderAttachment


class MaintenanceWorkOrderAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    filename = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceWorkOrderAttachment
        fields = ["id", "original_name", "filename", "url", "uploaded_at"]
        read_only_fields = fields

    def get_url(self, obj):
        file_obj = getattr(obj, "file", None)
        return getattr(file_obj, "url", "") if file_obj else ""

    def get_filename(self, obj):
        name = getattr(getattr(obj, "file", None), "name", "") or ""
        return name.rsplit("/", 1)[-1]


class MaintenanceWorkOrderSerializer(serializers.ModelSerializer):
    agreement_id = serializers.IntegerField(source="maintenance_agreement_id", read_only=True)
    project_title = serializers.SerializerMethodField()
    contractor_name = serializers.SerializerMethodField()
    property_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    source_milestone_id = serializers.IntegerField(read_only=True)
    attachments = MaintenanceWorkOrderAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = MaintenanceWorkOrder
        fields = [
            "id",
            "agreement_id",
            "source_milestone_id",
            "property_profile_id",
            "property_name",
            "contractor_id",
            "contractor_name",
            "homeowner_id",
            "project_title",
            "title",
            "description",
            "scheduled_date",
            "completed_at",
            "status",
            "status_label",
            "notes",
            "generated_from_schedule",
            "attachments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "agreement_id",
            "source_milestone_id",
            "property_profile_id",
            "property_name",
            "contractor_id",
            "contractor_name",
            "homeowner_id",
            "project_title",
            "completed_at",
            "status_label",
            "generated_from_schedule",
            "attachments",
            "created_at",
            "updated_at",
        ]

    def get_project_title(self, obj):
        agreement = getattr(obj, "maintenance_agreement", None)
        project = getattr(agreement, "project", None) if agreement else None
        return (
            getattr(project, "title", "")
            or getattr(agreement, "project_title", "")
            or getattr(agreement, "title", "")
            or f"Agreement #{getattr(agreement, 'id', '')}"
        )

    def get_contractor_name(self, obj):
        contractor = getattr(obj, "contractor", None)
        if not contractor:
            return "Your contractor"
        user = getattr(contractor, "user", None)
        return (
            getattr(contractor, "business_name", "")
            or getattr(contractor, "name", "")
            or (user.get_full_name() if user and hasattr(user, "get_full_name") else "")
            or getattr(user, "email", "")
            or "Your contractor"
        )

    def get_property_name(self, obj):
        profile = getattr(obj, "property_profile", None)
        if not profile:
            return ""
        return getattr(profile, "display_name", "") or getattr(profile, "address_line1", "") or "Property"
