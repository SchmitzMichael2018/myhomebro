# projects/views/milestone_views.py
from rest_framework import viewsets, permissions
from projects.models import Milestone
from projects.serializers import MilestoneSerializer

class MilestoneViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Milestone.objects.all().select_related("agreement")
    serializer_class = MilestoneSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Milestone.objects.filter(
            agreement__contractor__user=user
        ).distinct()
