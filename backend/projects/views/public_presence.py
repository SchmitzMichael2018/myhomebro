from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Contractor, ContractorPublicProfile
from projects.serializers.public_presence import (
    ContractorGalleryItemSerializer,
    ContractorPublicLeadSerializer,
    ContractorPublicProfileSerializer,
    ContractorReviewSerializer,
    PublicContractorLeadCreateSerializer,
    PublicContractorProfileSerializer,
    PublicContractorReviewSerializer,
    PublicGalleryItemSerializer,
    make_qr_svg_data,
)
from projects.services.agreements.project_create import resolve_contractor_for_user


def _resolve_contractor(user):
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionDenied("Only contractors can manage public presence.")
    return contractor


def _profile_defaults(contractor):
    return {
        "business_name_public": contractor.business_name or contractor.name or "",
        "city": contractor.city or "",
        "state": contractor.state or "",
        "phone_public": contractor.phone or "",
        "email_public": contractor.email or "",
        "specialties": [skill.name for skill in contractor.skills.all()],
    }


def _get_or_create_profile(contractor):
    profile = getattr(contractor, "public_profile", None)
    if profile is not None:
        return profile
    return ContractorPublicProfile.objects.create(
        contractor=contractor,
        **_profile_defaults(contractor),
    )


def _public_profile_qs():
    return ContractorPublicProfile.objects.select_related("contractor", "contractor__user")


def _public_profile_or_404(slug: str):
    profile = get_object_or_404(_public_profile_qs(), slug=slug, is_public=True)
    return profile


def _legacy_public_profile_or_404(contractor_id: int):
    return get_object_or_404(_public_profile_qs(), contractor_id=contractor_id, is_public=True)


def _public_profile_payload(request, profile):
    return PublicContractorProfileSerializer(profile, context={"request": request}).data


def _qr_payload(request, profile):
    public_url = request.build_absolute_uri(profile.public_url_path)
    return {
        "slug": profile.slug,
        "public_url": public_url,
        "qr_svg": make_qr_svg_data(public_url),
        "download_filename": f"{profile.slug}-public-profile-qr.svg",
    }


class ContractorPublicProfileManageView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        return Response(ContractorPublicProfileSerializer(profile, context={"request": request}).data)

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = getattr(contractor, "public_profile", None)
        if profile is not None:
            serializer = ContractorPublicProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = ContractorPublicProfileSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        create_data = dict(serializer.validated_data)
        for key, value in _profile_defaults(contractor).items():
            create_data.setdefault(key, value)
        profile = ContractorPublicProfile.objects.create(contractor=contractor, **create_data)
        return Response(
            ContractorPublicProfileSerializer(profile, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorPublicProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ContractorGalleryListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_gallery_items.select_related("public_profile").order_by("-is_featured", "sort_order", "-created_at")
        return Response({"results": ContractorGalleryItemSerializer(rows, many=True, context={"request": request}).data})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorGalleryItemSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(contractor=contractor, public_profile=profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ContractorGalleryDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, item_id: int):
        contractor = _resolve_contractor(request.user)
        item = get_object_or_404(contractor.public_gallery_items.all(), pk=item_id)
        serializer = ContractorGalleryItemSerializer(item, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, item_id: int):
        contractor = _resolve_contractor(request.user)
        item = get_object_or_404(contractor.public_gallery_items.all(), pk=item_id)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContractorReviewListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_reviews.select_related("agreement").order_by("-is_verified", "-submitted_at", "-created_at")
        return Response({"results": ContractorReviewSerializer(rows, many=True).data})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        agreement = serializer.validated_data.get("agreement")
        if agreement is not None and agreement.project.contractor_id != contractor.id:
            return Response({"agreement": ["Agreement must belong to your business."]}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(contractor=contractor, public_profile=profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ContractorReviewDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, review_id: int):
        contractor = _resolve_contractor(request.user)
        review = get_object_or_404(contractor.public_reviews.all(), pk=review_id)
        serializer = ContractorReviewSerializer(review, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        agreement = serializer.validated_data.get("agreement")
        if agreement is not None and agreement.project.contractor_id != contractor.id:
            return Response({"agreement": ["Agreement must belong to your business."]}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data)


class ContractorPublicLeadListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_leads.select_related("public_profile").order_by("-created_at", "-id")
        return Response({"results": ContractorPublicLeadSerializer(rows, many=True).data})


class ContractorPublicLeadDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        return Response(ContractorPublicLeadSerializer(lead).data)

    def patch(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        serializer = ContractorPublicLeadSerializer(lead, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ContractorPublicProfileQrView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        return Response(_qr_payload(request, profile))


class PublicContractorProfileView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        return Response(_public_profile_payload(request, profile))


class LegacyPublicContractorProfileByIdView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        profile = _legacy_public_profile_or_404(pk)
        return Response(_public_profile_payload(request, profile))


class PublicContractorGalleryView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        rows = profile.gallery_items.filter(is_public=True).order_by("-is_featured", "sort_order", "-created_at")
        return Response({"results": PublicGalleryItemSerializer(rows, many=True, context={"request": request}).data})


class PublicContractorReviewsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        if not profile.allow_public_reviews:
            return Response({"results": []})
        rows = profile.reviews.filter(is_public=True).order_by("-is_verified", "-submitted_at", "-created_at")
        return Response({"results": PublicContractorReviewSerializer(rows, many=True).data})


class PublicContractorIntakeView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        if not profile.allow_public_intake:
            return Response({"detail": "Public intake is not enabled for this contractor."}, status=status.HTTP_404_NOT_FOUND)
        serializer = PublicContractorLeadCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(contractor=profile.contractor, public_profile=profile)
        return Response({"ok": True, "message": "Your project request was submitted."}, status=status.HTTP_201_CREATED)


class PublicContractorQrView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        return Response(_qr_payload(request, profile))
