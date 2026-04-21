from __future__ import annotations

from rest_framework import serializers

from projects.services.workspace_context import normalize_project_family


class WorkspaceFamilySerializer(serializers.Serializer):
    key = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    label = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def to_representation(self, instance):
        return normalize_project_family(instance)


class WorkspaceContextSerializer(serializers.Serializer):
    project_family = WorkspaceFamilySerializer(required=False)
    source = serializers.CharField(required=False, allow_blank=True)
    updated_at = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def to_representation(self, instance):
        payload = instance or {}
        family = normalize_project_family(payload.get("project_family") or payload)
        return {
            "project_family": family,
            "source": payload.get("source") or "server",
            "updated_at": payload.get("updated_at"),
        }
