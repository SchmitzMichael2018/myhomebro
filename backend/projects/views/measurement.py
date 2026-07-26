from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import MeasurementSession
from projects.serializers.measurement import MeasurementSessionSerializer
from projects.services.capture_permissions import can_create_project_capture


class MeasurementSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        if not getattr(settings, "CAPTURE_MEASUREMENT_ENABLED", False):
            return Response({"detail": "Measurement Capture is unavailable."}, status=status.HTTP_404_NOT_FOUND)
        session = get_object_or_404(
            MeasurementSession.objects.select_related(
                "project", "proposal", "customer", "captured_by", "source_capture"
            ).prefetch_related(
                "entries__measured_by", "adjustments", "calculated_results",
                "attachments__artifact", "attachments__annotations", "events__actor",
            ),
            pk=session_id,
        )
        if not can_create_project_capture(request.user, session.project):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(MeasurementSessionSerializer(session, context={"request": request}).data)
