from __future__ import annotations

from rest_framework import viewsets, permissions
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.request import Request
from rest_framework.response import Response

from projects.models_attachments import AgreementAttachment
from projects.serializers.attachment import AgreementAttachmentSerializer


class IsAuthenticatedContractorOrStaff(permissions.BasePermission):
    def has_permission(self, request: Request, view) -> bool:
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request: Request, view, obj: AgreementAttachment) -> bool:
        user = request.user
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True
        try:
            return obj.agreement.project.contractor.user_id == user.id
        except Exception:
            return False


class AgreementAttachmentViewSet(viewsets.ModelViewSet):
    """
    Flat endpoints:
      GET    /api/projects/attachments/?agreement=<id>
      POST   /api/projects/attachments/
      GET    /api/projects/attachments/<id>/
      DELETE /api/projects/attachments/<id>/
    """
    permission_classes = [IsAuthenticatedContractorOrStaff]
    serializer_class = AgreementAttachmentSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    queryset = AgreementAttachment.objects.select_related("agreement", "agreement__project", "uploaded_by").all()

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not (getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
            try:
                qs = qs.filter(agreement__project__contractor__user_id=user.id)
            except Exception:
                return qs.none()
        agid = self.request.query_params.get("agreement")
        if agid:
            try:
                qs = qs.filter(agreement_id=int(agid))
            except Exception:
                return qs.none()
        return qs.order_by("-uploaded_at", "-id")

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    def destroy(self, request: Request, *args, **kwargs):
        instance: AgreementAttachment = self.get_object()
        f = getattr(instance, "file", None)
        try:
            if f and hasattr(f, "delete"):
                f.delete(save=False)
        except Exception:
            pass
        return super().destroy(request, *args, **kwargs)
