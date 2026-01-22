# backend/projects/serializers/employee_profile.py
from __future__ import annotations

from rest_framework import serializers
from projects.models import EmployeeProfile


class EmployeeProfileSerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()
    drivers_license_file_url = serializers.SerializerMethodField()
    professional_license_file_url = serializers.SerializerMethodField()

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
