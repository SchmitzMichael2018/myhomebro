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
            "post_submit_flow",
            "post_submit_flow_selected_at",

            "customer_name",
            "customer_email",
            "customer_phone",

            "customer_address_line1",
            "customer_address_line2",
            "customer_city",
            "customer_state",
            "customer_postal_code",
            "preferred_contact_method",
            "contact_consent",

            "same_as_customer_address",
            "project_class",
            "project_mode",
            "property_type",
            "budget_range_text",
            "desired_timing_text",
            "tentative_start_date",
            "payment_preference",
            "homeowner_participation_notes",
            "homeowner_started_work",
            "homeowner_task_summary",
            "homeowner_assistance_summary",

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
            "ai_project_timeline_days",
            "ai_project_budget",
            "measurement_handling",
            "ai_recommended_template_id",
            "ai_recommendation_confidence",
            "ai_recommendation_reason",
            "ai_milestones",
            "ai_clarification_questions",
            "ai_clarification_answers",
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
            "post_submit_flow_selected_at",
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
    project_timeline_days = serializers.IntegerField(required=False, allow_null=True)
    project_budget = serializers.DecimalField(required=False, max_digits=12, decimal_places=2, allow_null=True)
    payment_preference = serializers.ChoiceField(
        choices=[
            ("escrow", "Escrow milestone payments"),
            ("direct", "Direct payment to contractor"),
            ("discuss", "Discuss payment options"),
        ],
        required=False,
        allow_blank=True,
    )
    milestones = serializers.ListField(child=serializers.DictField(), required=False)
    clarification_questions = serializers.ListField(child=serializers.DictField(), required=False)
    clarification_answers = serializers.DictField(required=False)
    clarification_assumptions = serializers.ListField(child=serializers.CharField(), required=False)
    safety_warnings = serializers.ListField(child=serializers.CharField(), required=False)
    restricted_trade_categories = serializers.ListField(child=serializers.CharField(), required=False)
    payment_protection = serializers.DictField(required=False)
    contractor_match = serializers.DictField(required=False)
    measurement_handling = serializers.ChoiceField(
        choices=[
            ("provided", "Provided"),
            ("site_visit_required", "Site Visit Required"),
            ("not_sure", "Not Sure"),
        ],
        required=False,
        allow_blank=True,
    )
