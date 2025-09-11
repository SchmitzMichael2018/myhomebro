# backend/backend/projects/views/calendar.py
from __future__ import annotations

from typing import Iterable, Any
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..serializers_calendar import MilestoneCalendarSerializer

try:
    from ..models import Milestone
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore


class MilestoneCalendarView(APIView):
    """
    Returns milestone events only, suitable for a calendar UI.
    """
    permission_classes = [IsAuthenticated]

    def get_queryset(self, request) -> Iterable[Any]:
        if Milestone is None:
            return []
        qs = Milestone.objects.all().order_by("id")

        contractor = getattr(getattr(request, "user", None), "contractor", None)
        if contractor and hasattr(Milestone, "agreement"):
            try:
                qs = qs.filter(agreement__contractor=contractor)
            except Exception:
                pass

        return qs

    def get(self, request):
        qs = self.get_queryset(request)
        data = MilestoneCalendarSerializer(qs, many=True).data
        return Response(data)


class AgreementCalendarView(APIView):
    """
    You don't want agreement events on the calendar; keep endpoint but return [].
    """
    permission_classes = [IsAuthenticated]

    def get(self, _request):
        return Response([])
