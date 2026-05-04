from __future__ import annotations

from rest_framework import serializers
from django.utils import timezone

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.services.template_apply import sequence_template_milestone_dicts


class ProjectTemplateMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectTemplateMilestone
        fields = [
            "id",
            "title",
            "description",
            "sort_order",
            "start_offset",
            "duration_days",
            "recommended_days_from_start",
            "recommended_duration_days",
            "suggested_amount_percent",
            "suggested_amount_fixed",
            "pricing_advisory",
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
            "exclusions_text",
            "assumptions_text",
            "default_clarifications",
            "project_materials_hint",
            "is_system",
            "is_system_template",
            "is_published",
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
        return "system" if obj.is_system_template or obj.is_system else "contractor"

    def get_source_label(self, obj):
        if obj.is_system_template or obj.is_system or obj.visibility == ProjectTemplate.Visibility.SYSTEM:
            return "system"
        return obj.visibility or "private"

    def get_discoverable(self, obj):
        return bool((obj.is_system_template and obj.is_published) or obj.allow_discovery)

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
            "exclusions_text",
            "assumptions_text",
            "default_clarifications",
            "project_materials_hint",
            "is_system",
            "is_system_template",
            "is_published",
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
        return "system" if obj.is_system_template or obj.is_system else "contractor"

    def get_source_label(self, obj):
        if obj.is_system_template or obj.is_system or obj.visibility == ProjectTemplate.Visibility.SYSTEM:
            return "system"
        return obj.visibility or "private"

    def get_discoverable(self, obj):
        return bool((obj.is_system_template and obj.is_published) or obj.allow_discovery)

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
    source_template_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    is_system = serializers.BooleanField(required=False, write_only=True, default=False)
    is_published = serializers.BooleanField(required=False, write_only=True, default=False)

    @staticmethod
    def _clean_int(value):
        if value in ("", None):
            return None
        return value

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
            "is_system",
            "is_published",
            "source_template_id",
            "milestones",
        ]

    def _is_admin_request(self) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))

    def create(self, validated_data):
        milestones_data = validated_data.pop("milestones", [])
        source_template_id = validated_data.pop("source_template_id", None)
        is_system_requested = bool(validated_data.pop("is_system", False))
        is_published = bool(validated_data.pop("is_published", False))
        contractor = validated_data.get("contractor")
        is_admin = self._is_admin_request()

        if is_admin:
            is_system_requested = True

        if source_template_id:
            from projects.services.template_apply import duplicate_template_for_contractor

            try:
                source_template = ProjectTemplate.objects.prefetch_related("milestones").get(pk=source_template_id)
            except ProjectTemplate.DoesNotExist:
                raise serializers.ValidationError({"source_template_id": "Template not found."})

            if source_template.is_system_template and not source_template.is_published:
                raise serializers.ValidationError({"source_template_id": "Template not found."})

            if not source_template.is_system:
                if not is_system_requested and (
                    contractor is None or source_template.contractor_id != getattr(contractor, "id", None)
                ):
                    raise serializers.ValidationError({"source_template_id": "You cannot duplicate this template."})
                if is_system_requested and not is_admin:
                    raise serializers.ValidationError({"source_template_id": "You cannot duplicate this template."})

            template = duplicate_template_for_contractor(
                contractor=None if is_system_requested else contractor,
                source_template=source_template,
                template_data={**validated_data, "milestones": sequence_template_milestone_dicts(milestones_data)},
                is_active=validated_data.get("is_active", True),
                is_system=is_system_requested,
                is_published=is_published,
            )
            if is_system_requested and is_published and getattr(template, "published_by_id", None) is None:
                template.published_by = self.context.get("request").user
                template.save(update_fields=["published_by", "published_at", "updated_at"])
            return template

        if is_system_requested and not is_admin:
            raise serializers.ValidationError({"is_system": "Only admins can create system templates."})

        if is_system_requested:
            validated_data["contractor"] = None
            validated_data["is_system"] = True
            validated_data["is_system_template"] = True
            validated_data["is_published"] = is_published
            validated_data["visibility"] = ProjectTemplate.Visibility.SYSTEM
            validated_data["allow_discovery"] = is_published
            validated_data["published_at"] = timezone.now() if is_published else None
            validated_data["published_by"] = self.context.get("request").user if is_published else None

        template = ProjectTemplate.objects.create(**validated_data)
        milestones_data = sequence_template_milestone_dicts(milestones_data)

        for idx, row in enumerate(milestones_data, start=1):
            start_offset = row.get("start_offset")
            duration_days = row.get("duration_days")
            recommended_days_from_start = row.get("recommended_days_from_start")
            recommended_duration_days = row.get("recommended_duration_days")
            ProjectTemplateMilestone.objects.create(
                template=template,
                sort_order=row.get("sort_order") or idx,
                title=row["title"],
                description=row.get("description", ""),
                start_offset=self._clean_int(start_offset if start_offset not in ("", None) else recommended_days_from_start),
                duration_days=self._clean_int(duration_days if duration_days not in ("", None) else recommended_duration_days),
                recommended_days_from_start=self._clean_int(recommended_days_from_start if recommended_days_from_start not in ("", None) else start_offset),
                recommended_duration_days=self._clean_int(recommended_duration_days if recommended_duration_days not in ("", None) else duration_days),
                suggested_amount_percent=row.get("suggested_amount_percent"),
                suggested_amount_fixed=row.get("suggested_amount_fixed"),
                pricing_advisory=bool(row.get("pricing_advisory", False)),
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
        validated_data.pop("source_template_id", None)
        is_system_requested = bool(validated_data.pop("is_system", False))
        is_published_requested = validated_data.pop("is_published", None)
        is_admin = self._is_admin_request()

        if is_system_requested and not is_admin:
            validated_data.pop("is_system", None)
        if is_published_requested is not None and not is_admin:
            validated_data.pop("is_published", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if instance.is_system_template:
            if is_published_requested is not None:
                instance.is_published = bool(is_published_requested)
                instance.allow_discovery = bool(is_published_requested)
                if instance.is_published:
                    instance.published_at = timezone.now()
                    request = self.context.get("request")
                    instance.published_by = getattr(request, "user", None)
                else:
                    instance.published_at = None
                    instance.published_by = None
            instance.visibility = ProjectTemplate.Visibility.SYSTEM
            instance.is_system = True
            instance.is_system_template = True
            if instance.contractor_id is not None and is_admin:
                instance.contractor = None

        instance.save()

        if milestones_data is not None:
            instance.milestones.all().delete()
            milestones_data = sequence_template_milestone_dicts(milestones_data)
            for idx, row in enumerate(milestones_data, start=1):
                start_offset = row.get("start_offset")
                duration_days = row.get("duration_days")
                recommended_days_from_start = row.get("recommended_days_from_start")
                recommended_duration_days = row.get("recommended_duration_days")
                ProjectTemplateMilestone.objects.create(
                    template=instance,
                    sort_order=row.get("sort_order") or idx,
                    title=row["title"],
                    description=row.get("description", ""),
                    start_offset=self._clean_int(start_offset if start_offset not in ("", None) else recommended_days_from_start),
                    duration_days=self._clean_int(duration_days if duration_days not in ("", None) else recommended_duration_days),
                    recommended_days_from_start=self._clean_int(recommended_days_from_start if recommended_days_from_start not in ("", None) else start_offset),
                    recommended_duration_days=self._clean_int(recommended_duration_days if recommended_duration_days not in ("", None) else duration_days),
                    suggested_amount_percent=row.get("suggested_amount_percent"),
                    suggested_amount_fixed=row.get("suggested_amount_fixed"),
                    pricing_advisory=bool(row.get("pricing_advisory", False)),
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
    scope_description = serializers.CharField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)
