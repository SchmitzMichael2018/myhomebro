# projects/views/contractor.py

import logging
import stripe  # type: ignore

from django.conf import settings
from django.shortcuts import get_object_or_404

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser

from ..models import Contractor
from ..serializers import ContractorDetailSerializer, ContractorWriteSerializer


class ContractorViewSet(viewsets.ModelViewSet):
    """
    Manages the Contractor profile for the authenticated user.
    Supports retrieving/updating 'me' and onboarding.
    """
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action in ('onboard', 'me_update'):
            return ContractorWriteSerializer
        return ContractorDetailSerializer

    def get_queryset(self):
        # Only allow access to the contractor profile linked to the user
        return Contractor.objects.filter(user=self.request.user)

    def get_object(self):
        obj = get_object_or_404(self.get_queryset())
        self.check_object_permissions(self.request, obj)
        return obj

    @action(detail=False, methods=['get'], url_path='me')
    def me(self, request):
        """Retrieve the contractor profile for the current user."""
        contractor = self.get_object()
        serializer = self.get_serializer(contractor)
        return Response(serializer.data)

    @action(detail=False, methods=['put'], url_path='me')
    def me_update(self, request):
        """Update the contractor profile for the current user."""
        contractor = self.get_object()
        serializer = self.get_serializer(contractor, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='onboard')
    def onboard(self, request):
        """
        Handles initial creation/updating of a contractor's profile
        and generates a Stripe onboarding link if applicable.
        """
        contractor, created = Contractor.objects.get_or_create(user=request.user)
        serializer = self.get_serializer(contractor, data=request.data, partial=not created)
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()

        onboarding_url = None
        if updated.stripe_account_id:
            try:
                link = stripe.AccountLink.create(
                    account=updated.stripe_account_id,
                    refresh_url=f"{settings.FRONTEND_URL}/stripe/refresh",
                    return_url=f"{settings.FRONTEND_URL}/stripe/return",
                    type='account_onboarding'
                )
                onboarding_url = link.url
            except stripe.error.StripeError as e:
                logging.error(f"Stripe onboarding error for contractor {updated.id}: {e}")

        return Response(
            {'onboarding_url': onboarding_url, 'profile': ContractorDetailSerializer(updated).data},
            status=status.HTTP_200_OK
        )


class ContractorLicenseUploadView(APIView):
    """
    Allows authenticated contractors to upload a license file (PDF or image).
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        file = request.FILES.get("license")
        if not file:
            return Response({"error": "No file uploaded."}, status=400)

        contractor = getattr(request.user, 'contractor_profile', None)
        if not contractor:
            return Response({"error": "No contractor profile found."}, status=404)

        contractor.license_file = file
        contractor.save()
        return Response({"success": True, "license_file": contractor.license_file.url})
