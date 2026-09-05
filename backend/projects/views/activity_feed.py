from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone

from projects.models import ContractorActivityEvent
from projects.services.activity_feed import build_dashboard_activity_payload


def _contractor_for_user(user):
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


class ContractorActivityFeedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"results": [], "next_best_action": {}}, status=200)
        try:
            limit = int(request.query_params.get("limit") or 12)
        except Exception:
            limit = 12
        return Response(build_dashboard_activity_payload(contractor, limit=limit), status=200)


class ContractorActivityEventStateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, event_id: int, action: str):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Not found."}, status=404)
        event = ContractorActivityEvent.objects.filter(id=event_id, contractor=contractor).first()
        if event is None:
            return Response({"detail": "Not found."}, status=404)

        now = timezone.now()
        if action == "read":
            if event.read_at is None:
                event.read_at = now
                event.save(update_fields=["read_at"])
        elif action == "dismiss":
            event.read_at = event.read_at or now
            event.dismissed_at = now
            event.save(update_fields=["read_at", "dismissed_at"])
        else:
            return Response({"detail": "Unsupported activity action."}, status=400)

        return Response({
            "id": event.id,
            "read_at": event.read_at.isoformat() if event.read_at else None,
            "dismissed": event.dismissed_at is not None,
        })
