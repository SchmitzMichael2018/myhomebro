from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.crew_recommendations import (
    build_crew_recommendation_preview,
    resolve_source_context,
)
from projects.utils.accounts import get_contractor_for_user


class CrewRecommendationPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context required."}, status=status.HTTP_403_FORBIDDEN)

        source_type = str(request.data.get("source_type") or "").strip().lower()
        source_id = request.data.get("source_id")
        if source_type not in {"opportunity", "agreement"}:
            return Response({"detail": "source_type must be opportunity or agreement."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            source_id = int(source_id)
        except (TypeError, ValueError):
            return Response({"detail": "source_id must be a valid integer."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            context = resolve_source_context(contractor=contractor, source_type=source_type, source_id=source_id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        return Response(build_crew_recommendation_preview(context), status=status.HTTP_200_OK)
