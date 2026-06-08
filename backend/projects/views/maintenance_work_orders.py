from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement
from projects.models_maintenance import MaintenanceWorkOrder
from projects.serializers.maintenance import MaintenanceWorkOrderSerializer
from projects.services.maintenance_work_orders import complete_work_order, ensure_work_orders_for_agreement
from projects.utils.accounts import get_contractor_for_user


class MaintenanceWorkOrderViewSet(viewsets.ModelViewSet):
    serializer_class = MaintenanceWorkOrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = MaintenanceWorkOrder.objects.select_related(
            "maintenance_agreement",
            "maintenance_agreement__project",
            "maintenance_agreement__contractor",
            "maintenance_agreement__homeowner",
            "contractor",
            "contractor__user",
            "homeowner",
            "property_profile",
            "source_milestone",
        ).prefetch_related("attachments")
        if user and (user.is_staff or user.is_superuser):
            return qs
        contractor = get_contractor_for_user(user)
        if contractor is None:
            return qs.none()
        return qs.filter(contractor=contractor)

    def perform_update(self, serializer):
        serializer.save()

    @action(detail=False, methods=["post"], url_path="generate")
    def generate(self, request):
        agreement_id = request.data.get("agreement_id")
        agreement = get_object_or_404(
            Agreement.objects.select_related("contractor", "project", "homeowner"),
            pk=agreement_id,
        )
        user = request.user
        contractor = get_contractor_for_user(user)
        if not (user.is_staff or user.is_superuser or (contractor and agreement.contractor_id == contractor.id)):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            horizon = int(request.data.get("horizon") or 1)
        except Exception:
            horizon = 1
        work_orders = ensure_work_orders_for_agreement(agreement, horizon=max(1, min(horizon, 12)))
        return Response(
            {
                "count": len(work_orders),
                "results": MaintenanceWorkOrderSerializer(work_orders, many=True, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        work_order = self.get_object()
        notes = request.data.get("notes") or ""
        updated = complete_work_order(work_order, completed_by=request.user, notes=notes)
        return Response(MaintenanceWorkOrderSerializer(updated, context={"request": request}).data)
