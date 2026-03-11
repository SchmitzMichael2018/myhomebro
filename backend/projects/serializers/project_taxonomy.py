from __future__ import annotations

from rest_framework import serializers

from projects.models_project_taxonomy import (
    ProjectType,
    ProjectSubtype,
    normalize_taxonomy_name,
    normalized_key,
)


def contractor_id_from_obj(contractor) -> int | None:
    try:
        return getattr(contractor, "id", None)
    except Exception:
        return None


class ProjectSubtypeSerializer(serializers.ModelSerializer):
    owner_type = serializers.ReadOnlyField()
    project_type_name = serializers.CharField(source="project_type.name", read_only=True)
    merged_into_name = serializers.CharField(source="merged_into.name", read_only=True)
    is_merged = serializers.ReadOnlyField()
    value = serializers.SerializerMethodField()
    label = serializers.SerializerMethodField()

    class Meta:
        model = ProjectSubtype
        fields = [
            "id",
            "project_type",
            "project_type_name",
            "contractor",
            "name",
            "normalized_name",
            "value",
            "label",
            "is_system",
            "is_active",
            "merged_into",
            "merged_into_name",
            "is_merged",
            "owner_type",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "normalized_name",
            "owner_type",
            "is_merged",
            "created_at",
            "updated_at",
        ]

    def get_value(self, obj):
        return obj.name

    def get_label(self, obj):
        return obj.name

    def validate_name(self, value):
        value = normalize_taxonomy_name(value)
        if not value:
            raise serializers.ValidationError("Subtype name is required.")
        return value

    def validate_project_type(self, value):
        if value.merged_into_id:
            raise serializers.ValidationError("Cannot use a merged project type.")
        return value

    def validate(self, attrs):
        instance = getattr(self, "instance", None)

        project_type = attrs.get("project_type", getattr(instance, "project_type", None))
        contractor = attrs.get("contractor", getattr(instance, "contractor", None))
        is_system = attrs.get("is_system", getattr(instance, "is_system", False))
        name = attrs.get("name", getattr(instance, "name", ""))

        if not project_type:
            raise serializers.ValidationError({"project_type": "Project type is required."})

        normalized = normalized_key(name)

        qs = ProjectSubtype.objects.filter(
            project_type=project_type,
            contractor=contractor,
            normalized_name=normalized,
        )

        if instance:
            qs = qs.exclude(pk=instance.pk)

        if qs.exists():
            raise serializers.ValidationError(
                {"name": "A subtype with this name already exists under this type."}
            )

        if is_system and contractor_id_from_obj(contractor):
            raise serializers.ValidationError(
                {"is_system": "System subtypes cannot be contractor-owned."}
            )

        if project_type.is_system and not is_system:
            raise serializers.ValidationError(
                {"project_type": "Subtypes under a system type must also be system-owned."}
            )

        return attrs


class ProjectTypeSerializer(serializers.ModelSerializer):
    owner_type = serializers.ReadOnlyField()
    merged_into_name = serializers.CharField(source="merged_into.name", read_only=True)
    subtypes = serializers.SerializerMethodField()
    is_merged = serializers.ReadOnlyField()
    value = serializers.SerializerMethodField()
    label = serializers.SerializerMethodField()

    class Meta:
        model = ProjectType
        fields = [
            "id",
            "contractor",
            "name",
            "normalized_name",
            "value",
            "label",
            "is_system",
            "is_active",
            "merged_into",
            "merged_into_name",
            "is_merged",
            "owner_type",
            "sort_order",
            "subtypes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "normalized_name",
            "owner_type",
            "is_merged",
            "created_at",
            "updated_at",
        ]

    def get_value(self, obj):
        return obj.name

    def get_label(self, obj):
        return obj.name

    def get_subtypes(self, obj):
        request = self.context.get("request")
        include_inactive = False
        include_merged = False

        if request:
            include_inactive = str(request.query_params.get("include_inactive", "")).lower() in {
                "1",
                "true",
                "yes",
            }
            include_merged = str(request.query_params.get("include_merged", "")).lower() in {
                "1",
                "true",
                "yes",
            }

        qs = obj.subtypes.all().order_by("sort_order", "name")

        if not include_inactive:
            qs = qs.filter(is_active=True)

        if not include_merged:
            qs = qs.filter(merged_into__isnull=True)

        return ProjectSubtypeSerializer(qs, many=True, context=self.context).data

    def validate_name(self, value):
        value = normalize_taxonomy_name(value)
        if not value:
            raise serializers.ValidationError("Type name is required.")
        return value

    def validate(self, attrs):
        instance = getattr(self, "instance", None)

        contractor = attrs.get("contractor", getattr(instance, "contractor", None))
        is_system = attrs.get("is_system", getattr(instance, "is_system", False))
        name = attrs.get("name", getattr(instance, "name", ""))

        normalized = normalized_key(name)

        qs = ProjectType.objects.filter(
            contractor=contractor,
            normalized_name=normalized,
        )

        if instance:
            qs = qs.exclude(pk=instance.pk)

        if qs.exists():
            raise serializers.ValidationError(
                {"name": "A project type with this name already exists."}
            )

        if is_system and contractor_id_from_obj(contractor):
            raise serializers.ValidationError(
                {"is_system": "System project types cannot be contractor-owned."}
            )

        return attrs


class ProjectTypeOptionSerializer(serializers.ModelSerializer):
    value = serializers.SerializerMethodField()
    label = serializers.SerializerMethodField()
    owner_type = serializers.ReadOnlyField()

    class Meta:
        model = ProjectType
        fields = [
            "id",
            "value",
            "label",
            "name",
            "owner_type",
            "is_system",
            "is_active",
        ]

    def get_value(self, obj):
        return obj.name

    def get_label(self, obj):
        return obj.name


class ProjectSubtypeOptionSerializer(serializers.ModelSerializer):
    value = serializers.SerializerMethodField()
    label = serializers.SerializerMethodField()
    owner_type = serializers.ReadOnlyField()
    project_type_name = serializers.CharField(source="project_type.name", read_only=True)

    class Meta:
        model = ProjectSubtype
        fields = [
            "id",
            "project_type",
            "project_type_name",
            "value",
            "label",
            "name",
            "owner_type",
            "is_system",
            "is_active",
        ]

    def get_value(self, obj):
        return obj.name

    def get_label(self, obj):
        return obj.name


class ArchiveTaxonomySerializer(serializers.Serializer):
    is_active = serializers.BooleanField(default=False)


class MergeProjectTypeSerializer(serializers.Serializer):
    target_type_id = serializers.IntegerField()

    def validate_target_type_id(self, value):
        if value <= 0:
            raise serializers.ValidationError("A valid target type is required.")
        return value


class MergeProjectSubtypeSerializer(serializers.Serializer):
    target_subtype_id = serializers.IntegerField()

    def validate_target_subtype_id(self, value):
        if value <= 0:
            raise serializers.ValidationError("A valid target subtype is required.")
        return value