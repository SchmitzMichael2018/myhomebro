# backend/projects/views/calendar.py
# v2026-01-07 — Calendar endpoints (fixed for real Milestone fields)

from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Milestone, Agreement
from ..serializers_calendar import CalendarMilestoneSerializer


def _get_contractor_from_user(user):
    contractor = getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)
    if contractor:
        return contractor

    sub = getattr(user, "subaccount", None)
    if sub is not None:
        return getattr(sub, "contractor", None) or getattr(sub, "parent_contractor", None)

    return None


class MilestoneCalendarView(APIView):
    """
    GET /api/projects/milestones/calendar/
    Returns milestones enriched with escrow/invoice truth.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _get_contractor_from_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context not found."}, status=403)

        qs = (
            Milestone.objects.filter(agreement__contractor=contractor)
            .select_related("agreement", "agreement__homeowner", "invoice")
            .order_by("start_date", "order", "id")
        )

        return Response(CalendarMilestoneSerializer(qs, many=True).data)


class AgreementCalendarView(APIView):
    """
    GET /api/projects/agreements/calendar/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _get_contractor_from_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context not found."}, status=403)

        qs = Agreement.objects.filter(contractor=contractor).order_by("-id")[:500]

        results = []
        for a in qs:
            escrow_funded = bool(
                getattr(a, "escrow_funded", False) or getattr(a, "escrow_funded_at", None)
            )
            results.append(
                {
                    "id": a.id,
                    "agreement_number": getattr(a, "agreement_number", None) or a.id,
                    "project_title": getattr(a, "project_title", "") or getattr(a, "title", "") or "",
                    "escrow_funded": escrow_funded,
                }
            )

        return Response({"results": results})
