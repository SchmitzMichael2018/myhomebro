from rest_framework import serializers

from projects.models_project_intake import ProjectIntake


class ProjectIntakeSerializer(serializers.ModelSerializer):
    customer_address_display = serializers.ReadOnlyField()
    project_address_display = serializers.ReadOnlyField()

    class Meta:
        model = ProjectIntake
        fields = [
            "id",
            "contractor",
            "homeowner",
            "agreement",
            "initiated_by",
            "status",

            "customer_name",
            "customer_email",
            "customer_phone",

            "customer_address_line1",
            "customer_address_line2",
            "customer_city",
            "customer_state",
            "customer_postal_code",

            "same_as_customer_address",

            "project_address_line1",
            "project_address_line2",
            "project_city",
            "project_state",
            "project_postal_code",

            "accomplishment_text",

            "ai_project_title",
            "ai_project_type",
            "ai_project_subtype",
            "ai_description",
            "ai_recommended_template_id",
            "ai_recommendation_confidence",
            "ai_recommendation_reason",
            "ai_milestones",
            "ai_clarification_questions",
            "ai_analysis_payload",

            "customer_address_display",
            "project_address_display",

            "submitted_at",
            "analyzed_at",
            "converted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "agreement",
            "submitted_at",
            "analyzed_at",
            "converted_at",
            "created_at",
            "updated_at",
            "customer_address_display",
            "project_address_display",
        ]


class ProjectIntakeAnalyzeResponseSerializer(serializers.Serializer):
    project_title = serializers.CharField(required=False, allow_blank=True)
    template_id = serializers.IntegerField(required=False, allow_null=True)
    template_name = serializers.CharField(required=False, allow_blank=True)
    confidence = serializers.CharField(required=False, allow_blank=True)
    reason = serializers.CharField(required=False, allow_blank=True)
    project_type = serializers.CharField(required=False, allow_blank=True)
    project_subtype = serializers.CharField(required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    milestones = serializers.ListField(child=serializers.DictField(), required=False)
    clarification_questions = serializers.ListField(child=serializers.DictField(), required=False)