from __future__ import annotations

from django.db import transaction
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from projects.models_support import SupportTicket
from projects.serializers.support_ticket import SupportTicketSerializer, infer_support_user_role
from projects.services.support_tickets import send_support_ticket_notifications


class SupportTicketViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]
    serializer_class = SupportTicketSerializer
    lookup_field = "ticket_number"
    lookup_url_kwarg = "ticket_number"

    def get_queryset(self):
        qs = SupportTicket.objects.select_related("submitted_by", "assigned_to").order_by("-created_at", "-id")
        user = getattr(self.request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return qs.none()

        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return qs

        return qs.filter(submitted_by=user)

    def perform_create(self, serializer):
        user = self.request.user
        email = (serializer.validated_data.get("email") or "").strip() or getattr(user, "email", "")
        ticket = serializer.save(
            submitted_by=user if getattr(user, "is_authenticated", False) else None,
            email=email,
            user_role=infer_support_user_role(user),
        )

        transaction.on_commit(lambda: send_support_ticket_notifications(ticket, request=self.request))
