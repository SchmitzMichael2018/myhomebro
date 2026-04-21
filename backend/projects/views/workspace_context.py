from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.serializers.workspace_context import WorkspaceContextSerializer
from projects.services.template_apply import get_request_contractor
from projects.services.workspace_context import (
    get_workspace_context,
    normalize_project_family,
    update_workspace_context,
)


class WorkspaceContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        payload = get_workspace_context(contractor)
        return Response(WorkspaceContextSerializer(payload).data)

    def patch(self, request, *args, **kwargs):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        family_payload = request.data.get("project_family")
        if family_payload is None:
            family_payload = request.data

        normalized_family = normalize_project_family(family_payload)
        result = update_workspace_context(contractor, project_family=normalized_family)
        payload = result.payload if result is not None else get_workspace_context(contractor)
        return Response(WorkspaceContextSerializer(payload).data)
