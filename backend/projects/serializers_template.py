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
            "normalized_milestone_type",
            "suggested_amount_low",
            "suggested_amount_high",
            "pricing_confidence",
            "pricing_source_note",
            "materials_hint",
            "is_optional",
        ]


class ProjectTemplateListSerializer(serializers.ModelSerializer):
    milestone_count = serializers.SerializerMethodField()
    owner_type = serializers.SerializerMethodField()
    source_label = serializers.SerializerMethodField()
    discoverable = serializers.SerializerMethodField()
    usage_count = serializers.SerializerMethodField()
    completed_project_count = serializers.SerializerMethodField()
    avg_duration_days = serializers.SerializerMethodField()
    avg_final_total = serializers.SerializerMethodField()
    has_seeded_benchmark = serializers.SerializerMethodField()
    has_learned_benchmark = serializers.SerializerMethodField()
    created_from_system_template = serializers.SerializerMethodField()
    rank_score = serializers.SerializerMethodField()
    rank_reasons = serializers.SerializerMethodField()
    region_match_scope = serializers.SerializerMethodField()
    benchmark_support_label = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "description",
            "estimated_days",
            "payment_structure",
            "retainage_percent",
            "default_scope",
            "default_clarifications",
            "project_materials_hint",
            "is_system",
            "is_active",
            "visibility",
            "allow_discovery",
            "discoverable",
            "normalized_region_key",
            "region_tags",
            "published_at",
            "benchmark_match_key",
            "benchmark_profile",
            "milestone_count",
            "owner_type",
            "source_label",
            "usage_count",
            "completed_project_count",
            "avg_duration_days",
            "avg_final_total",
            "has_seeded_benchmark",
            "has_learned_benchmark",
            "created_from_system_template",
            "rank_score",
            "rank_reasons",
            "region_match_scope",
            "benchmark_support_label",
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

    def get_source_label(self, obj):
        if obj.is_system or obj.visibility == ProjectTemplate.Visibility.SYSTEM:
            return "system"
        return obj.visibility or "private"

    def get_discoverable(self, obj):
        return bool(obj.is_system or obj.allow_discovery)

    def get_usage_count(self, obj):
        return int(getattr(obj, "usage_count", 0) or 0)

    def get_completed_project_count(self, obj):
        annotated = getattr(obj, "completed_project_count", None)
        if annotated is not None:
            return int(annotated or 0)
        return int(getattr(obj, "_completed_project_count", 0) or 0)

    def get_avg_duration_days(self, obj):
        value = getattr(obj, "avg_duration_days", None)
        if value is None:
            value = getattr(obj, "_avg_duration_days", None)
        return str(value) if value not in (None, "") else ""

    def get_avg_final_total(self, obj):
        value = getattr(obj, "avg_final_total", None)
        if value is None:
            value = getattr(obj, "_avg_final_total", None)
        return str(value) if value not in (None, "") else ""

    def get_has_seeded_benchmark(self, obj):
        return bool(getattr(obj, "benchmark_profile_id", None) or getattr(obj, "benchmark_match_key", ""))

    def get_has_learned_benchmark(self, obj):
        return self.get_completed_project_count(obj) > 0

    def get_created_from_system_template(self, obj):
        return bool(getattr(obj, "source_system_template_id", None))

    def get_rank_score(self, obj):
        return float(getattr(obj, "rank_score", 0) or 0)

    def get_rank_reasons(self, obj):
        return list(getattr(obj, "rank_reasons", []) or [])

    def get_region_match_scope(self, obj):
        return getattr(obj, "region_match_scope", "") or ""

    def get_benchmark_support_label(self, obj):
        if self.get_has_seeded_benchmark(obj) and self.get_has_learned_benchmark(obj):
            return "seeded_and_learned"
        if self.get_has_learned_benchmark(obj):
            return "learned"
        if self.get_has_seeded_benchmark(obj):
            return "seeded"
        return "none"


class ProjectTemplateDetailSerializer(serializers.ModelSerializer):
    milestones = ProjectTemplateMilestoneSerializer(many=True, read_only=True)
    milestone_count = serializers.SerializerMethodField()
    owner_type = serializers.SerializerMethodField()
    source_label = serializers.SerializerMethodField()
    discoverable = serializers.SerializerMethodField()
    created_from_system_template = serializers.SerializerMethodField()
    usage_count = serializers.SerializerMethodField()
    completed_project_count = serializers.SerializerMethodField()
    avg_duration_days = serializers.SerializerMethodField()
    avg_final_total = serializers.SerializerMethodField()
    benchmark_support_label = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "description",
            "estimated_days",
            "payment_structure",
            "retainage_percent",
            "default_scope",
            "default_clarifications",
            "project_materials_hint",
            "is_system",
            "is_active",
            "visibility",
            "allow_discovery",
            "discoverable",
            "normalized_region_key",
            "region_tags",
            "published_at",
            "benchmark_match_key",
            "benchmark_profile",
            "source_system_template",
            "created_from_system_template",
            "owner_type",
            "source_label",
            "usage_count",
            "completed_project_count",
            "avg_duration_days",
            "avg_final_total",
            "benchmark_support_label",
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

    def get_source_label(self, obj):
        if obj.is_system or obj.visibility == ProjectTemplate.Visibility.SYSTEM:
            return "system"
        return obj.visibility or "private"

    def get_discoverable(self, obj):
        return bool(obj.is_system or obj.allow_discovery)

    def get_created_from_system_template(self, obj):
        return bool(getattr(obj, "source_system_template_id", None))

    def get_usage_count(self, obj):
        return int(getattr(obj, "usage_count", 0) or 0)

    def get_completed_project_count(self, obj):
        return int(getattr(obj, "_completed_project_count", 0) or 0)

    def get_avg_duration_days(self, obj):
        value = getattr(obj, "_avg_duration_days", None)
        return str(value) if value not in (None, "") else ""

    def get_avg_final_total(self, obj):
        value = getattr(obj, "_avg_final_total", None)
        return str(value) if value not in (None, "") else ""

    def get_benchmark_support_label(self, obj):
        has_seeded = bool(getattr(obj, "benchmark_profile_id", None) or getattr(obj, "benchmark_match_key", ""))
        has_learned = int(getattr(obj, "_completed_project_count", 0) or 0) > 0
        if has_seeded and has_learned:
            return "seeded_and_learned"
        if has_learned:
            return "learned"
        if has_seeded:
            return "seeded"
        return "none"


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
            "payment_structure",
            "retainage_percent",
            "default_scope",
            "exclusions_text",
            "assumptions_text",
            "default_clarifications",
            "project_materials_hint",
            "is_active",
            "normalized_region_key",
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
                normalized_milestone_type=row.get("normalized_milestone_type", "") or "",
                suggested_amount_low=row.get("suggested_amount_low"),
                suggested_amount_high=row.get("suggested_amount_high"),
                pricing_confidence=row.get("pricing_confidence", "") or "",
                pricing_source_note=row.get("pricing_source_note", "") or "",
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
                    normalized_milestone_type=row.get("normalized_milestone_type", "") or "",
                    suggested_amount_low=row.get("suggested_amount_low"),
                    suggested_amount_high=row.get("suggested_amount_high"),
                    pricing_confidence=row.get("pricing_confidence", "") or "",
                    pricing_source_note=row.get("pricing_source_note", "") or "",
                    materials_hint=row.get("materials_hint", ""),
                    is_optional=row.get("is_optional", False),
                )

        return instance


class ApplyTemplateSerializer(serializers.Serializer):
    template_id = serializers.IntegerField()
    overwrite_existing = serializers.BooleanField(default=True)
    copy_text_fields = serializers.BooleanField(default=True)

    # Frontend already sends these during apply; keep serializer aligned
    # so the view layer can safely accept them now and the service layer can
    # use them later without dropping them at validation time.
    estimated_days = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    auto_schedule = serializers.BooleanField(required=False, default=False)
    spread_enabled = serializers.BooleanField(required=False, default=False)
    spread_total = serializers.DecimalField(
        required=False,
        allow_null=True,
        max_digits=12,
        decimal_places=2,
        min_value=0,
    )

    def validate(self, attrs):
        spread_enabled = bool(attrs.get("spread_enabled", False))
        spread_total = attrs.get("spread_total", None)

        if spread_enabled and spread_total is None:
            raise serializers.ValidationError(
                {"spread_total": "Spread total is required when spread is enabled."}
            )

        if spread_enabled and spread_total <= 0:
            raise serializers.ValidationError(
                {"spread_total": "Spread total must be greater than 0 when spread is enabled."}
            )

        return attrs


class SaveAgreementAsTemplateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)
