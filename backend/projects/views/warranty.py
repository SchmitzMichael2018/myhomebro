from __future__ import annotations

from rest_framework import permissions, viewsets
from rest_framework.exceptions import PermissionDenied

from projects.models import Agreement, AgreementWarranty
from projects.serializers.warranty import AgreementWarrantySerializer
from projects.services.agreements.project_create import resolve_contractor_for_user


class AgreementWarrantyViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AgreementWarrantySerializer
    queryset = AgreementWarranty.objects.select_related(
        "agreement",
        "agreement__project",
        "contractor",
    ).order_by("-start_date", "-created_at", "-id")

    def get_queryset(self):
        qs = super().get_queryset()

        user = getattr(self.request, "user", None)
        if not user or not user.is_authenticated:
            return qs.none()

        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None:
                return qs.none()
            qs = qs.filter(contractor=contractor)

        agreement_id = (self.request.query_params.get("agreement") or "").strip()
        if agreement_id:
            qs = qs.filter(agreement_id=agreement_id)

        status_value = (self.request.query_params.get("status") or "").strip().lower()
        if status_value:
            qs = qs.filter(status=status_value)

        return qs

    def perform_create(self, serializer):
        agreement = serializer.validated_data["agreement"]
        contractor = agreement.contractor
        user = getattr(self.request, "user", None)

        if not contractor:
            raise PermissionDenied("Agreement is missing a contractor.")

        if not (user and (user.is_staff or user.is_superuser)):
            resolved = resolve_contractor_for_user(user)
            if resolved is None or resolved.id != contractor.id:
                raise PermissionDenied(
                    "You can only manage warranty records for your own agreements."
                )

        serializer.save(contractor=contractor)

    def perform_update(self, serializer):
        agreement = serializer.instance.agreement
        contractor = agreement.contractor
        user = getattr(self.request, "user", None)

        if not contractor:
            raise PermissionDenied("Agreement is missing a contractor.")

        if not (user and (user.is_staff or user.is_superuser)):
            resolved = resolve_contractor_for_user(user)
            if resolved is None or resolved.id != contractor.id:
                raise PermissionDenied(
                    "You can only manage warranty records for your own agreements."
                )

        serializer.save(contractor=contractor, agreement=agreement)
