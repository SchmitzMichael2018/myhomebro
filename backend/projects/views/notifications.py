from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Notification
from projects.serializers.notifications import NotificationSerializer
from projects.services.notification_center import get_notification_queryset_for_user


def _parse_limit(value, default: int = 20, maximum: int = 100) -> int:
    try:
        parsed = int(str(value).strip())
    except Exception:
        return default
    return max(1, min(maximum, parsed))


def _filter_queryset(qs, filter_value: str):
    normalized = str(filter_value or "").strip().lower()
    if normalized == "unread":
        return qs.filter(is_read=False)
    if normalized in {"action-needed", "action_needed"}:
        return qs.filter(
            Q(category=Notification.EVENT_QUOTE_REQUEST_RECEIVED)
            | Q(category=Notification.EVENT_MILESTONE_PENDING_APPROVAL)
            | Q(event_type=Notification.EVENT_QUOTE_REQUEST_RECEIVED)
            | Q(event_type=Notification.EVENT_MILESTONE_PENDING_APPROVAL)
        )
    return qs


def _notification_queryset(request):
    qs, contractor = get_notification_queryset_for_user(getattr(request, "user", None))
    return qs, contractor


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs, _contractor = _notification_queryset(request)
        qs = _filter_queryset(qs, request.query_params.get("filter"))
        limit = _parse_limit(request.query_params.get("limit"), default=20, maximum=100)
        rows = qs.order_by("-created_at", "-id")[:limit]
        return Response(NotificationSerializer(rows, many=True, context={"request": request}).data)


class NotificationUnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs, _contractor = _notification_queryset(request)
        unread_count = qs.filter(is_read=False).count()
        return Response({"count": unread_count})


class NotificationMarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        qs, _contractor = _notification_queryset(request)
        notification = get_object_or_404(qs, pk=pk)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification, context={"request": request}).data)


class NotificationMarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        qs, _contractor = _notification_queryset(request)
        with transaction.atomic():
            updated = qs.filter(is_read=False).update(is_read=True)
        return Response({"ok": True, "updated": updated})

