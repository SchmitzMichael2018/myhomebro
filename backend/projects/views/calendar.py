# projects/views/calendar.py

from django.db.models import Min, Max
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Milestone, Agreement
from ..serializers import MilestoneCalendarSerializer, AgreementCalendarSerializer


class MilestoneCalendarView(APIView):
    """
    Returns a list of milestones for calendar display,
    filtered to the requesting contractor's projects.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user
        
        # --- FIX: Simplified and corrected the query to look up through the contractor's user. ---
        queryset = Milestone.objects.filter(
            agreement__project__contractor__user=user
        ).select_related('agreement__project').distinct()

        serializer = MilestoneCalendarSerializer(queryset, many=True)
        return Response(serializer.data)


class AgreementCalendarView(APIView):
    """
    Returns annotated agreement start/end dates for calendar display,
    filtered to the requesting contractor's projects.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user
        
        # --- FIX: Simplified and corrected the query to look up through the contractor's user. ---
        queryset = Agreement.objects.filter(
            project__contractor__user=user
        ).annotate(
            start=Min('milestones__start_date'),
            end=Max('milestones__completion_date')
        ).filter(
            start__isnull=False,
            end__isnull=False
        ).select_related('project')

        serializer = AgreementCalendarSerializer(queryset, many=True)
        return Response(serializer.data)