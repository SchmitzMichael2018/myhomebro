# backend/projects/views/attachments.py
from rest_framework import viewsets, mixins
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

from projects.models import Agreement
from projects.models_attachments import AgreementAttachment
from projects.serializers.attachment import AgreementAttachmentSerializer


def _kw_agreement_id(kwargs, fallback=None):
    """
    Accept both 'agreement_id' and 'agreement_pk' for nested routes.
    """
    return kwargs.get("agreement_id") or kwargs.get("agreement_pk") or fallback


@method_decorator(csrf_exempt, name="dispatch")
class AgreementAttachmentViewSet(viewsets.ModelViewSet):
    """
    FLAT route:

      - List   : /api/projects/attachments/?agreement=<id>   (required on list)
      - Detail : /api/projects/attachments/<pk>/

    Supports GET(list/retrieve), POST, PUT/PATCH, DELETE.

    Extremely permissive by design (to unblock deletes):
      - No auth requirement (AllowAny)
      - CSRF-exempt
      - Still filters list by ?agreement=<id> to avoid leakage
      - On create, we always record uploaded_by=request.user if available
    """
    queryset = AgreementAttachment.objects.select_related("agreement", "uploaded_by").all()
    serializer_class = AgreementAttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [AllowAny]
    authentication_classes = []  # no auth = no CSRF expectations from SessionAuth

    def get_queryset(self):
        qs = super().get_queryset()
        action = getattr(self, "action", None)
        if action in {"list", "create"}:
            agreement_id = self.request.query_params.get("agreement")
            if agreement_id:
                qs = qs.filter(agreement_id=agreement_id)
            else:
                # No agreement filter on collection -> return empty to avoid leakage
                qs = qs.none()
        return qs

    def perform_create(self, serializer):
        agreement_id = self.request.query_params.get("agreement")
        # Bind to agreement by query param if present, otherwise let serializer handle it
        if agreement_id:
            agreement = get_object_or_404(Agreement, pk=agreement_id)
            serializer.save(
                agreement=agreement,
                uploaded_by=getattr(self.request, "user", None) if getattr(self.request, "user", None) and getattr(self.request.user, "is_authenticated", False) else None,
            )
        else:
            serializer.save(
                uploaded_by=getattr(self.request, "user", None) if getattr(self.request, "user", None) and getattr(self.request.user, "is_authenticated", False) else None,
            )


@method_decorator(csrf_exempt, name="dispatch")
class AgreementAttachmentNestedView(mixins.ListModelMixin,
                                   mixins.CreateModelMixin,
                                   viewsets.GenericViewSet):
    """
    NESTED route:

      /api/projects/agreements/<agreement_id>/attachments/

    Supports:
      - GET(list)   : list all attachments for the agreement in the URL
      - POST(create): create and auto-bind attachment to that agreement
    """
    serializer_class = AgreementAttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [AllowAny]
    authentication_classes = []  # no auth

    def get_queryset(self):
        agreement_id = _kw_agreement_id(self.kwargs)
        return AgreementAttachment.objects.select_related("agreement", "uploaded_by").filter(agreement_id=agreement_id)

    def perform_create(self, serializer):
        agreement_id = _kw_agreement_id(self.kwargs)
        agreement = get_object_or_404(Agreement, pk=agreement_id)
        serializer.save(
            agreement=agreement,
            uploaded_by=getattr(self.request, "user", None) if getattr(self.request, "user", None) and getattr(self.request.user, "is_authenticated", False) else None,
        )
