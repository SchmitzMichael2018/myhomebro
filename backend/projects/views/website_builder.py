from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.website_builder import (
    build_contractor_website_payload,
    build_contractor_website_preview_payload,
)


class ContractorWebsiteView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can access Website Builder readiness."}, status=403)
        return Response(build_contractor_website_payload(contractor, request=request))


class ContractorWebsitePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can preview Website Builder data."}, status=403)
        return Response(build_contractor_website_preview_payload(contractor, request=request))
