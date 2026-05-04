from __future__ import annotations

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from projects.models_support import (
    SupportMessage,
    SupportMessageSenderRole,
    SupportTicket,
)
from projects.serializers.support_ticket import (
    SupportTicketDetailSerializer,
    SupportTicketReplySerializer,
    SupportTicketSerializer,
    infer_support_user_role,
)
from projects.services.support_tickets import (
    send_support_ticket_notifications,
    send_support_ticket_reply_notification,
)


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
        qs = (
            SupportTicket.objects.select_related("submitted_by", "assigned_to")
            .prefetch_related(
                Prefetch(
                    "messages",
                    queryset=SupportMessage.objects.select_related("sender").order_by("created_at", "id"),
                )
            )
            .order_by("-created_at", "-id")
        )
        user = getattr(self.request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return qs.none()

        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return qs

        return qs.filter(submitted_by=user)

    def retrieve(self, request, *args, **kwargs):
        ticket = self.get_object()
        serializer = SupportTicketDetailSerializer(ticket, context=self.get_serializer_context())
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = self.perform_create(serializer)
        detail = SupportTicketDetailSerializer(ticket, context=self.get_serializer_context())
        headers = self.get_success_headers(detail.data)
        return Response(detail.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        user = self.request.user
        email = (serializer.validated_data.get("email") or "").strip() or getattr(user, "email", "")
        ticket = serializer.save(
            submitted_by=user if getattr(user, "is_authenticated", False) else None,
            email=email,
            user_role=infer_support_user_role(user),
        )

        SupportMessage.objects.create(
            ticket=ticket,
            sender=user if getattr(user, "is_authenticated", False) else None,
            sender_type=(
                SupportMessageSenderRole.SUPPORT
                if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)
                else SupportMessageSenderRole.USER
            ),
            sender_email=ticket.email or getattr(user, "email", "") or "",
            message=ticket.message or "",
            sent_at=timezone.now(),
            is_internal=False,
        )

        transaction.on_commit(lambda: send_support_ticket_notifications(ticket, request=self.request))
        return ticket

    @action(detail=True, methods=["post"], url_path="reply")
    def reply(self, request, *args, **kwargs):
        ticket = self.get_object()
        serializer = SupportTicketReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        sender_role = (
            SupportMessageSenderRole.SUPPORT
            if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)
            else SupportMessageSenderRole.USER
        )
        message = SupportMessage.objects.create(
            ticket=ticket,
            sender=user if getattr(user, "is_authenticated", False) else None,
            sender_type=sender_role,
            sender_email=getattr(user, "email", "") or ticket.email or "",
            message=serializer.validated_data["message"],
            sent_at=timezone.now(),
            is_internal=bool(serializer.validated_data.get("is_internal", False)),
        )

        ticket.save(update_fields=["updated_at"])
        transaction.on_commit(lambda: send_support_ticket_reply_notification(ticket, message, request=self.request))

        ticket = self.get_queryset().get(pk=ticket.pk)
        return Response(
            SupportTicketDetailSerializer(ticket, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )
