# backend/projects/views/milestone.py
from __future__ import annotations

from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Milestone
from projects.serializers.milestone import MilestoneSerializer


class MilestoneViewSet(viewsets.ModelViewSet):
    queryset = Milestone.objects.select_related("agreement").all()
    serializer_class = MilestoneSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request, *args, **kwargs):
        """
        POST { agreement, start_date, completion_date|due_date, id? }
        -> { overlaps: bool, conflicts: [{id,title,start_date,completion_date,due_date}] }
        """
        agreement = request.data.get("agreement")
        start = request.data.get("start_date")
        end = request.data.get("completion_date") or request.data.get("due_date")
        milestone_id = request.data.get("id")

        if not (agreement and start and end):
            return Response({"detail": "agreement, start_date and completion_date/due_date are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        qs = Milestone.objects.filter(agreement_id=agreement)
        if milestone_id:
            qs = qs.exclude(pk=milestone_id)

        conflicts = list(qs.filter(
            Q(start_date__lte=end) &
            (Q(completion_date__gte=start) | Q(due_date__gte=start))
        ).values("id", "title", "start_date", "completion_date", "due_date"))

        return Response({"overlaps": bool(conflicts), "conflicts": conflicts}, status=200)
