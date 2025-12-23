# backend/projects/views/homeowner.py
from __future__ import annotations

from django.db.models import Count, Q
from rest_framework import viewsets, filters, permissions, status
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from rest_framework.request import Request

from projects.models import Homeowner
from projects.serializers import HomeownerSerializer, HomeownerWriteSerializer
from core.pagination import DefaultPageNumberPagination


def _get_contractor_for_user(user):
    """Support current and legacy relationships without crashing."""
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


class IsContractorOnly(permissions.BasePermission):
    """
    Only users with an attached contractor profile may access this ViewSet.
    """

    message = "Your account must be linked to a Contractor profile to access customers."

    def has_permission(self, request: Request, view) -> bool:
        if not (request.user and request.user.is_authenticated):
            return False
        contractor = _get_contractor_for_user(request.user)
        return contractor is not None

    def has_object_permission(self, request: Request, view, obj) -> bool:
        contractor = _get_contractor_for_user(request.user)
        # Enforce ownership: the object's created_by must be this contractor
        return contractor is not None and getattr(obj, "created_by_id", None) == getattr(contractor, "id", None)


class HomeownerViewSet(viewsets.ModelViewSet):
    """
    Contractor-scoped customers endpoint.

    Base URL is registered under:
      /api/projects/homeowners/            (primary)
    And core/urls.py aliases:
      /api/homeowners/  → /api/projects/homeowners/   (302/307 redirect)

    Supports:
      - Pagination: ?page=1&page_size=20
      - Search:     ?q=smith   (name/email/phone if present on model)
      - Ordering:   ?ordering=-created_at (falls back safely)
      - Status:     ?status=active|prospect|archived (optional)
    """

    permission_classes = [IsContractorOnly]
    pagination_class = DefaultPageNumberPagination
    filter_backends = [filters.OrderingFilter]  # simple ordering via ?ordering=

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return HomeownerWriteSerializer
        return HomeownerSerializer

    # ---------- Queryset strictly scoped to the signed-in contractor ----------
    def get_queryset(self):
        user = self.request.user
        contractor = _get_contractor_for_user(user)
        if contractor is None:
            # Deny with a clear code (UI can redirect to onboarding)
            raise PermissionDenied(detail={
                "detail": "Your account must be linked to a Contractor profile to access customers.",
                "code": "contractor_required",
            })

        # Calculate active projects if you expose it on the list (adjust related_name/statuses if needed)
        active_statuses = ["signed", "funded", "in_progress"]

        qs = (
            Homeowner.objects.filter(created_by=contractor)
            .annotate(
                active_projects_count=Count(
                    "projects",
                    filter=Q(projects__status__in=active_statuses),
                )
            )
            .distinct()
        )

        # Optional status filter (safe)
        status_val = (self.request.query_params.get("status") or "").strip()
        if status_val and "status" in {f.name for f in Homeowner._meta.get_fields()}:
            qs = qs.filter(status__iexact=status_val)

        # Optional search across best-effort fields
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            model_fields = {f.name for f in Homeowner._meta.get_fields()}
            search_candidates = ("name", "full_name", "first_name", "last_name", "email", "phone", "phone_number")
            search_fields = [f for f in search_candidates if f in model_fields]
            if search_fields:
                cond = Q()
                for f in search_fields:
                    cond |= Q(**{f"{f}__icontains": q})
                qs = qs.filter(cond)

        # Safe ordering (fallback to -created_at then -id)
        ordering = (self.request.query_params.get("ordering") or "-created_at").strip()
        model_fields = {f.name for f in Homeowner._meta.get_fields()}
        if ordering.lstrip("-") in model_fields:
            if ordering.lstrip("-") == "id":
                qs = qs.order_by(ordering)
            else:
                qs = qs.order_by(ordering, "-id")
        else:
            qs = qs.order_by("-created_at", "-id")

        return qs

    # ---------- Create / Update / Destroy enforce contractor ownership ----------
    def perform_create(self, serializer):
        contractor = _get_contractor_for_user(self.request.user)
        if contractor is None:
            raise PermissionDenied(detail={
                "detail": "Your account must be linked to a Contractor profile to add customers.",
                "code": "contractor_required",
            })
        # Force ownership; ignore any incoming created_by attempt
        serializer.save(created_by=contractor)

    def perform_update(self, serializer):
        instance: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(self.request.user)
        if contractor is None or instance.created_by_id != contractor.id:
            raise PermissionDenied(detail={
                "detail": "You do not have permission to modify this customer.",
                "code": "forbidden_not_owner",
            })
        serializer.save(created_by=contractor)

    def destroy(self, request: Request, *args, **kwargs):
        instance: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(self.request.user)
        if contractor is None or instance.created_by_id != contractor.id:
            raise PermissionDenied(detail={
                "detail": "You do not have permission to delete this customer.",
                "code": "forbidden_not_owner",
            })
        return super().destroy(request, *args, **kwargs)
