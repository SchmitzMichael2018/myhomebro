from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_contractor_discovery import ContractorDiscoveryInvite
from projects.models import Contractor
from projects.models_project_intake import ProjectIntake
from projects.services.contractor_discovery import (
    build_contractor_recommendations,
    claim_discovery_invite,
    create_discovery_invites,
)


def _safe_text(value) -> str:
    return "" if value is None else str(value).strip()


def _get_intake_from_request(request):
    token = _safe_text(request.query_params.get("token") or request.data.get("token"))
    if token:
        intake = ProjectIntake.objects.filter(share_token=token).first()
        if intake is None:
            return None, Response({"detail": "Intake link not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None
    intake_id = request.query_params.get("public_intake_id") or request.data.get("public_intake_id")
    if intake_id:
        intake = ProjectIntake.objects.filter(pk=intake_id).first()
        if intake is None:
            return None, Response({"detail": "Intake not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None
    return None, Response({"detail": "Missing intake token."}, status=status.HTTP_400_BAD_REQUEST)


class PublicIntakeContractorSearchView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        intake, error = _get_intake_from_request(request)
        if error:
            return error

        query = _safe_text(request.query_params.get("query"))
        latitude = request.query_params.get("lat")
        longitude = request.query_params.get("lng")
        radius_miles = request.query_params.get("radius_miles")
        limit = request.query_params.get("limit")

        result = build_contractor_recommendations(
            intake=intake,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius_miles,
            limit=int(limit or 5),
        )
        return Response(result, status=status.HTTP_200_OK)


class PublicIntakeSendContractorInvitesView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        intake, error = _get_intake_from_request(request)
        if error:
            return error

        selected = request.data.get("selected_contractors") or request.data.get("selected") or []
        if isinstance(selected, str):
            try:
                import json

                selected = json.loads(selected)
            except Exception:
                selected = []
        preferred_channel = _safe_text(request.data.get("preferred_channel"))

        try:
            result = create_discovery_invites(
                intake=intake,
                selected_targets=selected,
                preferred_channel=preferred_channel,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_200_OK)


class ContractorDiscoveryClaimView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str):
        invite = ContractorDiscoveryInvite.objects.select_related(
            "public_intake",
            "contractor",
            "directory_listing",
            "directory_listing__claimed_contractor",
        ).filter(invite_token=token).first()
        if invite is None:
            return Response({"detail": "Invite not found."}, status=status.HTTP_404_NOT_FOUND)

        invite.touch_clicked()
        listing = invite.directory_listing
        contractor = invite.contractor or getattr(listing, "claimed_contractor", None)
        return Response(
            {
                "id": invite.id,
                "invite_token": str(invite.invite_token),
                "status": invite.status,
                "claimed": bool(invite.claimed_at),
                "contractor_name": getattr(contractor, "business_name", "") or getattr(contractor, "name", "") or getattr(listing, "business_name", ""),
                "business_name": getattr(listing, "business_name", "") or getattr(contractor, "business_name", ""),
                "city": getattr(listing, "city", "") or getattr(contractor, "city", ""),
                "state": getattr(listing, "state", "") or getattr(contractor, "state", ""),
                "project_summary": getattr(invite.public_intake, "accomplishment_text", "") or getattr(invite.public_intake, "ai_description", ""),
                "project_mode": getattr(invite.public_intake, "project_mode", "full_service"),
                "payment_preference": getattr(invite.public_intake, "payment_preference", "escrow"),
                "public_intake_id": getattr(invite.public_intake, "id", None),
                "directory_listing_id": getattr(listing, "id", None),
                "claim_url": invite.invite_url_path,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request, token: str):
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Sign in to claim this listing."}, status=status.HTTP_401_UNAUTHORIZED)

        invite = ContractorDiscoveryInvite.objects.select_related(
            "public_intake",
            "contractor",
            "directory_listing",
            "directory_listing__claimed_contractor",
        ).filter(invite_token=token).first()
        if invite is None:
            return Response({"detail": "Invite not found."}, status=status.HTTP_404_NOT_FOUND)

        contractor = Contractor.objects.select_related("public_profile").filter(user=request.user).first()
        if contractor is None:
            return Response({"detail": "Only contractors can claim listings."}, status=status.HTTP_403_FORBIDDEN)

        result = claim_discovery_invite(invite, contractor=contractor)
        return Response(result, status=status.HTTP_200_OK)
