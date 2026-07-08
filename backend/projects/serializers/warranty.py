from __future__ import annotations

from rest_framework import serializers
from django.utils import timezone

from projects.models import Agreement, AgreementWarranty
from projects.models_warranty import (
    WarrantyRequest,
    WarrantyRequestEvidence,
    WarrantyRequestStatusHistory,
    WarrantyWorkOrder,
)


class AgreementWarrantySerializer(serializers.ModelSerializer):
    agreement = serializers.PrimaryKeyRelatedField(queryset=Agreement.objects.all())
    agreement_title = serializers.SerializerMethodField(read_only=True)
    customer_name = serializers.SerializerMethodField(read_only=True)
    project_id = serializers.SerializerMethodField(read_only=True)
    days_remaining = serializers.SerializerMethodField(read_only=True)
    open_request_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AgreementWarranty
        fields = [
            "id",
            "agreement",
            "agreement_title",
            "contractor",
            "title",
            "coverage_details",
            "exclusions",
            "workmanship_duration_months",
            "labor_duration_months",
            "materials_duration_months",
            "manufacturer_notes",
            "covered_work",
            "excluded_work",
            "customer_responsibilities",
            "contractor_responsibilities",
            "response_time_expectations",
            "generated_from_agreement_completion",
            "completion_date",
            "start_date",
            "end_date",
            "status",
            "applies_to",
            "customer_name",
            "project_id",
            "days_remaining",
            "open_request_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "contractor",
            "created_at",
            "updated_at",
            "agreement_title",
            "generated_from_agreement_completion",
            "customer_name",
            "project_id",
            "days_remaining",
            "open_request_count",
        ]

    def validate(self, attrs):
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": "End date cannot be before start date."}
            )
        return attrs

    def get_agreement_title(self, obj):
        try:
            return obj.agreement.project.title
        except Exception:
            return ""

    def get_customer_name(self, obj):
        homeowner = getattr(getattr(obj, "agreement", None), "homeowner", None)
        return getattr(homeowner, "full_name", "") or getattr(homeowner, "email", "") or ""

    def get_project_id(self, obj):
        return getattr(getattr(obj, "agreement", None), "project_id", None)

    def get_days_remaining(self, obj):
        if not obj.end_date:
            return None
        return (obj.end_date - timezone.localdate()).days

    def get_open_request_count(self, obj):
        terminal = {
            WarrantyRequest.STATUS_COMPLETED,
            WarrantyRequest.STATUS_DENIED,
            WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION,
            WarrantyRequest.STATUS_CLOSED,
        }
        try:
            return obj.requests.exclude(status__in=terminal).count()
        except Exception:
            return 0


class WarrantyRequestStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = WarrantyRequestStatusHistory
        fields = ["id", "from_status", "to_status", "note", "actor", "actor_email", "created_at", "metadata"]
        read_only_fields = fields


class WarrantyRequestEvidenceSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = WarrantyRequestEvidence
        fields = [
            "id",
            "file",
            "file_url",
            "evidence_type",
            "description",
            "original_filename",
            "content_type",
            "size_bytes",
            "uploaded_by",
            "uploaded_by_email",
            "uploaded_at",
        ]
        read_only_fields = ["id", "file_url", "uploaded_by", "uploaded_by_email", "uploaded_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        try:
            url = obj.file.url
        except Exception:
            url = ""
        return request.build_absolute_uri(url) if request and url else url


class WarrantyWorkOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = WarrantyWorkOrder
        fields = [
            "id",
            "warranty_request",
            "warranty",
            "agreement",
            "project",
            "contractor",
            "title",
            "scope",
            "assigned_user",
            "assigned_team_notes",
            "materials",
            "scheduled_for",
            "labor_estimate_hours",
            "customer_notes",
            "completion_checklist",
            "completion_notes",
            "repair_outcome",
            "estimated_duration_minutes",
            "customer_acknowledged_at",
            "status",
            "linked_property_work_order",
            "created_at",
            "updated_at",
            "completed_at",
        ]
        read_only_fields = ["id", "warranty", "agreement", "project", "contractor", "created_at", "updated_at", "completed_at"]


class WarrantyRequestSerializer(serializers.ModelSerializer):
    status_history = WarrantyRequestStatusHistorySerializer(many=True, read_only=True)
    evidence = WarrantyRequestEvidenceSerializer(many=True, read_only=True)
    work_order = WarrantyWorkOrderSerializer(read_only=True)
    warranty_title = serializers.SerializerMethodField(read_only=True)
    agreement_title = serializers.SerializerMethodField(read_only=True)
    customer_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = WarrantyRequest
        fields = [
            "id",
            "warranty",
            "warranty_title",
            "agreement",
            "agreement_title",
            "project",
            "contractor",
            "homeowner",
            "customer_name",
            "property_profile",
            "title",
            "description",
            "date_noticed",
            "area_affected",
            "severity",
            "urgency",
            "other_contractor_worked",
            "preferred_scheduling",
            "status",
            "coverage_decision",
            "contractor_response",
            "customer_notes",
            "ai_review",
            "response_due_at",
            "next_expected_action",
            "customer_acknowledged_at",
            "customer_acknowledgment_response",
            "unresolved_reason",
            "submitted_by",
            "submitted_by_email",
            "created_at",
            "updated_at",
            "closed_at",
            "customer_acknowledged_at",
            "escalated_dispute_id",
            "source_context",
            "status_history",
            "evidence",
            "work_order",
        ]
        read_only_fields = [
            "id",
            "agreement",
            "project",
            "contractor",
            "homeowner",
            "submitted_by",
            "submitted_by_email",
            "created_at",
            "updated_at",
            "closed_at",
            "escalated_dispute_id",
            "source_context",
            "status_history",
            "evidence",
            "work_order",
        ]

    def get_warranty_title(self, obj):
        return getattr(getattr(obj, "warranty", None), "title", "")

    def get_agreement_title(self, obj):
        return getattr(getattr(getattr(obj, "agreement", None), "project", None), "title", "")

    def get_customer_name(self, obj):
        homeowner = getattr(obj, "homeowner", None)
        return getattr(homeowner, "full_name", "") or getattr(homeowner, "email", "") or ""
