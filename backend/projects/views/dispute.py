from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models_dispute import Dispute, DisputeAttachment
from ..serializers.dispute import (
    DisputeSerializer,
    DisputeCreateSerializer,
    DisputeAttachmentSerializer,
)


class DisputeViewSet(viewsets.ModelViewSet):
    """
    CRUD for Disputes.

    Routes (via router):
      - POST   /api/projects/disputes/                     -> create
      - GET    /api/projects/disputes/                     -> list
      - GET    /api/projects/disputes/{id}/                -> retrieve
      - PATCH  /api/projects/disputes/{id}/                -> partial update
      - PUT    /api/projects/disputes/{id}/                -> update
      - DELETE /api/projects/disputes/{id}/                -> destroy
      - POST   /api/projects/disputes/{id}/attachments/    -> upload attachment
    """
    queryset = Dispute.objects.all().order_by("-created_at")
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return DisputeCreateSerializer
        return DisputeSerializer

    def perform_create(self, serializer):
        """
        Auto-set created_by from the requesting user.
        (Serializer.create also handles this; keeping here is fine.)
        """
        try:
            serializer.save(created_by=self.request.user)
        except TypeError:
            serializer.save()

    @action(detail=True, methods=["post"], url_path="attachments")
    def upload_attachment(self, request, pk=None):
        """
        Upload a file/note to a dispute.
        Accepts multipart/form-data: file (optional), note (optional), kind (optional).
        """
        dispute = self.get_object()
        data = request.data.copy()
        data["dispute"] = dispute.pk

        # If your model has uploaded_by, set it automatically
        if "uploaded_by" not in data and hasattr(DisputeAttachment, "uploaded_by_id"):
            data["uploaded_by"] = request.user.pk

        serializer = DisputeAttachmentSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
