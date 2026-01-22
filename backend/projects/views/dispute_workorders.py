# backend/projects/views/dispute_workorders.py
# v2026-01-18
#
# This module exists because projects/urls.py imports:
#   from .views.dispute_workorders import DisputeWorkOrderViewSet
#
# We support BOTH patterns:
#  1) If DisputeWorkOrderViewSet already exists in views/dispute.py, we re-export it.
#  2) Otherwise, we provide a minimal ModelViewSet backed by DisputeWorkOrder (if present).
#
# This prevents the entire site from crashing due to a missing module during URL import.

from rest_framework import permissions, viewsets
from rest_framework.exceptions import NotFound

# 1) If you already defined the viewset inside views/dispute.py, re-export it.
try:
    from .dispute import DisputeWorkOrderViewSet  # type: ignore
except Exception:
    DisputeWorkOrderViewSet = None  # fallback below

if DisputeWorkOrderViewSet is None:
    # 2) Fallback: Provide a minimal ViewSet if a model exists.
    try:
        from ..models import DisputeWorkOrder  # type: ignore
    except Exception:
        DisputeWorkOrder = None  # pragma: no cover

    if DisputeWorkOrder is None:
        # Final fallback so Django can boot (router will still mount, but endpoints will 404)
        class DisputeWorkOrderViewSet(viewsets.ViewSet):
            permission_classes = [permissions.IsAuthenticated]

            def list(self, request):
                raise NotFound("DisputeWorkOrder is not installed on this backend.")

            def retrieve(self, request, pk=None):
                raise NotFound("DisputeWorkOrder is not installed on this backend.")

    else:
        # Try to locate a serializer. If not found, define an inline one.
        try:
            from ..serializers.dispute import DisputeWorkOrderSerializer  # type: ignore
        except Exception:
            try:
                from ..serializers import DisputeWorkOrderSerializer  # type: ignore
            except Exception:
                from rest_framework import serializers

                class DisputeWorkOrderSerializer(serializers.ModelSerializer):
                    class Meta:
                        model = DisputeWorkOrder
                        fields = "__all__"

        class DisputeWorkOrderViewSet(viewsets.ModelViewSet):
            permission_classes = [permissions.IsAuthenticated]
            serializer_class = DisputeWorkOrderSerializer

            def get_queryset(self):
                qs = DisputeWorkOrder.objects.all().order_by("-id")
                user = getattr(self.request, "user", None)
                if not user or not getattr(user, "is_authenticated", False):
                    return DisputeWorkOrder.objects.none()

                # Attempt contractor scoping. If your model doesn't have these relations,
                # it will safely fall back to empty (secure default).
                contractor = getattr(user, "contractor", None) or getattr(
                    user, "contractor_profile", None
                )
                contractor_id = getattr(contractor, "id", None)

                if contractor_id and hasattr(DisputeWorkOrder, "contractor_id"):
                    return qs.filter(contractor_id=contractor_id)

                # Common relation path: workorder -> dispute -> agreement -> contractor
                try:
                    if contractor_id:
                        return qs.filter(dispute__agreement__contractor_id=contractor_id)
                except Exception:
                    return DisputeWorkOrder.objects.none()

                return DisputeWorkOrder.objects.none()
