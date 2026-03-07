from __future__ import annotations

from rest_framework import serializers

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone


class ProjectTemplateMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectTemplateMilestone
        fields = [
            "id",
            "title",
            "description",
            "sort_order",
            "recommended_days_from_start",
            "recommended_duration_days",
            "suggested_amount_percent",
            "suggested_amount_fixed",
            "materials_hint",
            "is_optional",
        ]


class ProjectTemplateListSerializer(serializers.ModelSerializer):
    milestone_count = serializers.SerializerMethodField()
    owner_type = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "description",
            "estimated_days",
            "default_scope",
            "default_clarifications",
            "is_system",
            "is_active",
            "milestone_count",
            "owner_type",
            "created_at",
            "updated_at",
        ]

    def get_milestone_count(self, obj):
        annotated = getattr(obj, "template_milestone_count", None)
        if annotated is not None:
            return int(annotated)
        try:
            return obj.milestones.count()
        except Exception:
            return 0

    def get_owner_type(self, obj):
        return "system" if obj.is_system else "contractor"


class ProjectTemplateDetailSerializer(serializers.ModelSerializer):
    milestones = ProjectTemplateMilestoneSerializer(many=True, read_only=True)
    milestone_count = serializers.SerializerMethodField()
    owner_type = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "description",
            "estimated_days",
            "default_scope",
            "default_clarifications",
            "is_system",
            "is_active",
            "owner_type",
            "milestone_count",
            "milestones",
            "created_at",
            "updated_at",
        ]

    def get_milestone_count(self, obj):
        annotated = getattr(obj, "template_milestone_count", None)
        if annotated is not None:
            return int(annotated)
        try:
            return obj.milestones.count()
        except Exception:
            return 0

    def get_owner_type(self, obj):
        return "system" if obj.is_system else "contractor"


class ProjectTemplateCreateUpdateSerializer(serializers.ModelSerializer):
    milestones = ProjectTemplateMilestoneSerializer(many=True, required=False)

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "description",
            "estimated_days",
            "default_scope",
            "default_clarifications",
            "is_active",
            "milestones",
        ]

    def create(self, validated_data):
        milestones_data = validated_data.pop("milestones", [])
        template = ProjectTemplate.objects.create(**validated_data)

        for idx, row in enumerate(milestones_data, start=1):
            ProjectTemplateMilestone.objects.create(
                template=template,
                sort_order=row.get("sort_order") or idx,
                title=row["title"],
                description=row.get("description", ""),
                recommended_days_from_start=row.get("recommended_days_from_start"),
                recommended_duration_days=row.get("recommended_duration_days"),
                suggested_amount_percent=row.get("suggested_amount_percent"),
                suggested_amount_fixed=row.get("suggested_amount_fixed"),
                materials_hint=row.get("materials_hint", ""),
                is_optional=row.get("is_optional", False),
            )

        return template

    def update(self, instance, validated_data):
        milestones_data = validated_data.pop("milestones", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if milestones_data is not None:
            instance.milestones.all().delete()
            for idx, row in enumerate(milestones_data, start=1):
                ProjectTemplateMilestone.objects.create(
                    template=instance,
                    sort_order=row.get("sort_order") or idx,
                    title=row["title"],
                    description=row.get("description", ""),
                    recommended_days_from_start=row.get("recommended_days_from_start"),
                    recommended_duration_days=row.get("recommended_duration_days"),
                    suggested_amount_percent=row.get("suggested_amount_percent"),
                    suggested_amount_fixed=row.get("suggested_amount_fixed"),
                    materials_hint=row.get("materials_hint", ""),
                    is_optional=row.get("is_optional", False),
                )

        return instance


class ApplyTemplateSerializer(serializers.Serializer):
    template_id = serializers.IntegerField()
    overwrite_existing = serializers.BooleanField(default=True)
    copy_text_fields = serializers.BooleanField(default=True)


class SaveAgreementAsTemplateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)