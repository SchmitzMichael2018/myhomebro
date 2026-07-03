from __future__ import annotations

from rest_framework import serializers

from projects.models import EmployeeCapability, EmployeeSkillLevel, Skill


class WorkforceSkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = Skill
        fields = ["id", "name", "slug"]
        read_only_fields = fields


class EmployeeCapabilitySerializer(serializers.ModelSerializer):
    skill_id = serializers.IntegerField(source="skill.id", read_only=True)
    skill_name = serializers.CharField(source="skill.name", read_only=True)
    skill_slug = serializers.CharField(source="skill.slug", read_only=True)
    skill_level_label = serializers.CharField(source="get_skill_level_display", read_only=True)

    class Meta:
        model = EmployeeCapability
        fields = [
            "id",
            "skill_id",
            "skill_name",
            "skill_slug",
            "skill_level",
            "skill_level_label",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


def skill_level_options() -> list[dict]:
    return [{"value": value, "label": label} for value, label in EmployeeSkillLevel.choices]
