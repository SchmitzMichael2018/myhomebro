# backend/projects/serializers/employee_profile.py
from __future__ import annotations

import json

from rest_framework import serializers
from projects.models import EmployeeCapability, EmployeeProfile, EmployeeSkillLevel, Skill
from projects.serializers.workforce import EmployeeCapabilitySerializer


class EmployeeProfileSerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()
    drivers_license_file_url = serializers.SerializerMethodField()
    professional_license_file_url = serializers.SerializerMethodField()
    capabilities = EmployeeCapabilitySerializer(source="subaccount.capabilities", many=True, read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "first_name",
            "last_name",
            "phone_number",
            "home_address_line1",
            "home_address_line2",
            "home_city",
            "home_state",
            "home_postal_code",
            "drivers_license_number",
            "drivers_license_state",
            "drivers_license_expiration",
            "drivers_license_file",
            "drivers_license_file_url",
            "professional_license_type",
            "professional_license_number",
            "professional_license_expiration",
            "professional_license_file",
            "professional_license_file_url",
            "photo",
            "photo_url",
            "assigned_work_schedule",
            "day_off_requests",
            "capabilities",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "photo_url",
            "drivers_license_file_url",
            "professional_license_file_url",
            "capabilities",
        ]

    def _abs(self, request, url: str | None):
        if not url:
            return None
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url

    def get_photo_url(self, obj):
        request = self.context.get("request")
        if not request or not getattr(obj, "photo", None):
            return None
        return self._abs(request, obj.photo.url)

    def get_drivers_license_file_url(self, obj):
        request = self.context.get("request")
        if not request or not getattr(obj, "drivers_license_file", None):
            return None
        return self._abs(request, obj.drivers_license_file.url)

    def get_professional_license_file_url(self, obj):
        request = self.context.get("request")
        if not request or not getattr(obj, "professional_license_file", None):
            return None
        return self._abs(request, obj.professional_license_file.url)

    def _incoming_capabilities(self):
        data = getattr(self, "initial_data", None)
        if not data:
            return None
        value = data.get("capabilities", None)
        if value is None:
            value = data.get("capabilities_json", None)
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return []
            try:
                return json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError({"capabilities": "Capabilities must be valid JSON."}) from exc
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        incoming = self._incoming_capabilities()
        if incoming is None:
            return attrs
        if not isinstance(incoming, list):
            raise serializers.ValidationError({"capabilities": "Capabilities must be a list."})

        skill_ids = set()
        valid_levels = {value for value, _label in EmployeeSkillLevel.choices}
        for index, item in enumerate(incoming):
            if not isinstance(item, dict):
                raise serializers.ValidationError({"capabilities": f"Capability #{index + 1} must be an object."})
            skill_id = item.get("skill_id") or item.get("skill")
            if not skill_id:
                raise serializers.ValidationError({"capabilities": f"Capability #{index + 1} requires skill_id."})
            try:
                skill_id = int(skill_id)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError({"capabilities": f"Capability #{index + 1} has an invalid skill_id."}) from exc
            if skill_id in skill_ids:
                raise serializers.ValidationError({"capabilities": "Duplicate capabilities are not allowed."})
            skill_ids.add(skill_id)
            level = str(item.get("skill_level") or "").strip().lower()
            if level not in valid_levels:
                raise serializers.ValidationError({"capabilities": f"Capability #{index + 1} has an invalid skill level."})

        existing_ids = set(Skill.objects.filter(id__in=skill_ids).values_list("id", flat=True))
        missing = sorted(skill_ids - existing_ids)
        if missing:
            raise serializers.ValidationError({"capabilities": f"Unknown skill id(s): {', '.join(map(str, missing))}."})
        attrs["_capabilities_payload"] = incoming
        return attrs

    def update(self, instance, validated_data):
        capabilities_payload = validated_data.pop("_capabilities_payload", None)
        instance = super().update(instance, validated_data)
        if capabilities_payload is not None:
            subaccount = instance.subaccount
            wanted = {}
            for item in capabilities_payload:
                skill_id = int(item.get("skill_id") or item.get("skill"))
                wanted[skill_id] = str(item.get("skill_level") or "").strip().lower()

            EmployeeCapability.objects.filter(subaccount=subaccount).exclude(skill_id__in=wanted.keys()).delete()
            for skill_id, level in wanted.items():
                EmployeeCapability.objects.update_or_create(
                    subaccount=subaccount,
                    skill_id=skill_id,
                    defaults={"skill_level": level},
                )
        return instance
