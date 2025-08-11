# projects/views/project.py

import logging
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied

from ..models import Project
from ..serializers import ProjectSerializer, ProjectDetailSerializer

class ProjectViewSet(viewsets.ModelViewSet):
    """
    List, retrieve, create, update and delete Projects.
    Contractors see only their own projects; homeowners see only projects
    they’re assigned to.
    """
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        --- FIX: Queryset correctly filters Projects where the contractor's
        related user is the request.user. ---
        """
        user = self.request.user
        # This queryset will not work for homeowners unless they are also a user, which they are not in this model.
        # This view is now implicitly for contractors only.
        return (
            Project.objects
                   .filter(contractor__user=user)
                   .select_related('contractor__user', 'homeowner')
                   .prefetch_related('agreement')
                   .distinct()
        )

    def get_serializer_class(self):
        # use the “detailed” serializer for list/retrieve,
        # and the full write serializer for create/update
        if self.action in ['list', 'retrieve']:
            return ProjectDetailSerializer
        return ProjectSerializer

    def perform_create(self, serializer):
        """
        --- FIX: Automatically set the contractor to the current user's
        Contractor Profile, not the User object itself. ---
        """
        try:
            contractor_profile = self.request.user.contractor_profile
            serializer.save(contractor=contractor_profile)
        except AttributeError:
            raise PermissionDenied("You must have a contractor profile to create a project.")

    def perform_update(self, serializer):
        """
        --- FIX: Correctly compares the request.user with the
        contractor's related user. ---
        """
        project = self.get_object()
        if project.contractor.user != self.request.user:
            raise PermissionDenied("Only the assigned contractor can update this project.")
        serializer.save()