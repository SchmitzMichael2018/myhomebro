from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied

from projects.models import Homeowner
from projects.serializers import HomeownerSerializer, HomeownerWriteSerializer
from core.pagination import DefaultPageNumberPagination


class HomeownerViewSet(viewsets.ModelViewSet):
    """
    /api/homeowners/  (registered via projects.urls_homeowners and included in core/urls.py)

    Supports:
      - Pagination: ?page=1&page_size=20
      - Search:     ?q=smith          (name/email/phone if present on model)
      - Ordering:   ?ordering=-created_at  (falls back safely)
      - Status:     ?status=active|prospect|inactive  (optional)
    """
    permission_classes = [IsAuthenticated]
    pagination_class = DefaultPageNumberPagination

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return HomeownerWriteSerializer
        return HomeownerSerializer

    def _get_contractor(self):
        """Support either user.contractor (current) or user.contractor_profile (legacy)."""
        u = self.request.user
        return getattr(u, "contractor", None) or getattr(u, "contractor_profile", None)

    def get_queryset(self):
        contractor = self._get_contractor()
        if contractor is None:
            return Homeowner.objects.none()

        active_statuses = ["signed", "funded", "in_progress"]  # adjust if your enum changes

        qs = (
            Homeowner.objects.filter(created_by=contractor)
            .annotate(
                active_projects_count=Count(
                    "projects",  # change to your actual related_name if different
                    filter=Q(projects__status__in=active_statuses),
                )
            )
            .distinct()
        )

        # ---- Optional status filter
        status_val = (self.request.query_params.get("status") or "").strip().lower()
        if status_val:
            if "status" in {f.name for f in Homeowner._meta.get_fields()}:
                qs = qs.filter(status__iexact=status_val)

        # ---- Search (safe)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            model_fields = {f.name for f in Homeowner._meta.get_fields()}
            search_fields = [f for f in ("name", "full_name", "first_name", "last_name", "email", "phone") if f in model_fields]
            if search_fields:
                cond = Q()
                for f in search_fields:
                    cond |= Q(**{f"{f}__icontains": q})
                qs = qs.filter(cond)

        # ---- Ordering (safe)
        ordering = (self.request.query_params.get("ordering") or "-created_at").strip()
        model_fields = {f.name for f in Homeowner._meta.get_fields()}
        if ordering.lstrip("-") in model_fields:
            qs = qs.order_by(ordering, "-id") if ordering.lstrip("-") != "id" else qs.order_by(ordering)
        else:
            qs = qs.order_by("-created_at", "-id")

        return qs

    def perform_create(self, serializer):
        contractor = self._get_contractor()
        if contractor is None:
            raise PermissionDenied("You must have a contractor profile to create customers.")
        serializer.save(created_by=contractor)
