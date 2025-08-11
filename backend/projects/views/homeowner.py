from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied

from ..models import Homeowner
from ..serializers import HomeownerSerializer, HomeownerWriteSerializer

class HomeownerViewSet(viewsets.ModelViewSet):
    """
    Manages Homeowner profiles for the authenticated contractor.
    """
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return HomeownerWriteSerializer
        return HomeownerSerializer

    def get_queryset(self):
        user = self.request.user

        # Define "active" to include the new "in_progress" status
        active_project_statuses = ['signed', 'funded', 'in_progress'] # <-- ADJUST THIS LIST

        return Homeowner.objects.filter(
            created_by__user=user
        ).annotate(
            active_projects_count=Count(
                'projects',
                filter=Q(projects__status__in=active_project_statuses)
            )
        ).order_by('-created_at').distinct()

    def perform_create(self, serializer):
        """
        When creating a new Homeowner, automatically assign the logged-in
        contractor's profile to the 'created_by' field.
        """
        try:
            contractor_profile = self.request.user.contractor_profile
            serializer.save(created_by=contractor_profile)
        except AttributeError:
            raise PermissionDenied("You must have a contractor profile to create customers.")