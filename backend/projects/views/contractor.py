import logging
import stripe  # type: ignore

from django.conf import settings
from django.shortcuts import get_object_or_404

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser

from ..models import Contractor
from ..serializers import ContractorDetailSerializer, ContractorWriteSerializer


class ContractorViewSet(viewsets.ModelViewSet):
    """
    /api/projects/contractors/...
      - GET /projects/contractors/me/       -> retrieve current contractor
      - PUT/PATCH /projects/contractors/me/ -> update current contractor
      - POST /projects/contractors/onboard/ -> create/update + Stripe onboarding link
    """
    permission_classes = [permissions.IsAuthenticated]
    # ✅ accept JSON and multipart (logo uploads from the same endpoint)
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_serializer_class(self):
        # For create/update or me-update, use write serializer; otherwise read serializer
        if self.action in ("create", "update", "partial_update", "me"):
            return (
                ContractorWriteSerializer
                if self.request.method in ("PUT", "PATCH", "POST")
                else ContractorDetailSerializer
            )
        return ContractorDetailSerializer

    def get_queryset(self):
        """
        Limit to the authenticated user's contractor row (staff can see all).
        """
        qs = Contractor.objects.select_related("user")
        user = self.request.user
        if user.is_staff or user.is_superuser:
            return qs
        try:
            return qs.filter(pk=user.contractor_profile_id)
        except Exception:
            return qs.none()

    def get_object(self):
        obj = get_object_or_404(self.get_queryset())
        self.check_object_permissions(self.request, obj)
        return obj

    @action(detail=False, methods=["get", "put", "patch"], url_path="me")
    def me(self, request):
        """
        GET    /api/projects/contractors/me/
        PUT    /api/projects/contractors/me/
        PATCH  /api/projects/contractors/me/
        """
        contractor = self.get_object()
        if request.method == "GET":
            return Response(ContractorDetailSerializer(contractor, context={"request": request}).data)

        partial = request.method == "PATCH"
        ser = ContractorWriteSerializer(contractor, data=request.data, partial=partial, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ContractorDetailSerializer(contractor, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="onboard")
    def onboard(self, request):
        """
        Handles initial creation/updating of a contractor's profile
        and generates a Stripe onboarding link if applicable.
        """
        contractor, created = Contractor.objects.get_or_create(user=request.user)
        # Allow partial updates via onboard
        ser = ContractorWriteSerializer(contractor, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        updated = ser.save()

        onboarding_url = None
        if updated.stripe_account_id:
            try:
                link = stripe.AccountLink.create(
                    account=updated.stripe_account_id,
                    refresh_url=f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/stripe/refresh",
                    return_url=f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/stripe/return",
                    type="account_onboarding",
                )
                onboarding_url = link.url
            except stripe.error.StripeError as e:
                logging.error("Stripe onboarding error for contractor %s: %s", updated.id, e)

        return Response(
            {
                "onboarding_url": onboarding_url,
                "profile": ContractorDetailSerializer(updated, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )


class ContractorLicenseUploadView(viewsets.ViewSet):
    """
    Allows authenticated contractors to upload a license file (PDF or image).
    """
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def create(self, request):
        file = request.FILES.get("license")
        if not file:
            return Response({"error": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)

        contractor = getattr(request.user, "contractor_profile", None)
        if not contractor:
            return Response({"error": "No contractor profile found."}, status=status.HTTP_404_NOT_FOUND)

        contractor.license_file = file
        contractor.save()
        url = ""
        try:
            url = contractor.license_file.url
        except Exception:
            pass
        return Response({"success": True, "license_file": url}, status=status.HTTP_200_OK)
