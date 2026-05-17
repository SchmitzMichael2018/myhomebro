from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_contractor_discovery import ContractorDirectoryDiscovery, ContractorDirectoryEntry, ContractorDiscoveryInvite
from projects.models import Contractor
from projects.models_project_intake import ProjectIntake
from projects.services.contractor_directory import upsert_directory_entry_from_place
from projects.services.contractor_discovery import (
    build_contractor_recommendations,
    claim_discovery_invite,
    create_discovery_invites,
)
from projects.services.google_places_contractors import geocode_project_location, search_google_places_contractors_with_diagnostics


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
        try:
            limit = max(1, min(int(limit or 40), 50))
        except (TypeError, ValueError):
            limit = 40
        try:
            radius_miles = int(float(radius_miles or 25))
        except (TypeError, ValueError):
            radius_miles = 25
        radius_miles = radius_miles if radius_miles in {5, 10, 15, 25, 50, 100} else 25
        project_context = {
            "project_type": request.query_params.get("project_type"),
            "project_subtype": request.query_params.get("project_subtype"),
            "project_title": request.query_params.get("project_title"),
            "description": request.query_params.get("description"),
            "project_scope_summary": request.query_params.get("project_scope_summary"),
            "project_city": request.query_params.get("city") or request.query_params.get("project_city"),
            "project_state": request.query_params.get("state") or request.query_params.get("project_state"),
            "project_postal_code": request.query_params.get("zip") or request.query_params.get("project_postal_code"),
            "project_address_line1": request.query_params.get("address") or request.query_params.get("project_address_line1"),
            "project_class": request.query_params.get("project_class"),
            "project_mode": request.query_params.get("project_mode"),
            "payment_preference": request.query_params.get("payment_preference"),
        }

        result = build_contractor_recommendations(
            intake=intake,
            payload=project_context,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius_miles,
            limit=limit,
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


def _directory_entry_payload(entry: ContractorDirectoryEntry) -> dict:
    return {
        "id": entry.id,
        "business_name": entry.business_name,
        "website": entry.website,
        "phone": entry.phone,
        "public_email": entry.public_email,
        "city": entry.city,
        "state": entry.state,
        "zip_code": entry.zip_code,
        "rating": entry.rating,
        "review_count": entry.review_count,
        "services": entry.services or [],
        "source": entry.source,
        "claimed": entry.claimed,
        "profile_status": entry.profile_status,
        "enrichment_status": entry.enrichment_status,
        "first_seen_at": entry.first_seen_at,
        "last_seen_at": entry.last_seen_at,
    }


class AdminContractorSearchView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, *args, **kwargs):
        query = _safe_text(request.query_params.get("query"))
        city = _safe_text(request.query_params.get("city"))
        state_value = _safe_text(request.query_params.get("state"))
        zip_code = _safe_text(request.query_params.get("zip") or request.query_params.get("postal_code"))
        latitude = request.query_params.get("lat")
        longitude = request.query_params.get("lng")
        try:
            radius_miles = int(float(request.query_params.get("radius_miles") or 25))
        except (TypeError, ValueError):
            radius_miles = 25
        radius_miles = radius_miles if radius_miles in {5, 10, 15, 25, 50, 100} else 25
        try:
            limit = max(1, min(int(request.query_params.get("limit") or 20), 50))
        except (TypeError, ValueError):
            limit = 20

        if not latitude or not longitude:
            geocode = geocode_project_location(city=city, state=state_value, postal_code=zip_code)
            latitude = geocode.get("latitude")
            longitude = geocode.get("longitude")

        google_result = search_google_places_contractors_with_diagnostics(
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius_miles,
            limit=limit,
            enforce_radius=True,
        )
        context = {
            "source_type": ContractorDirectoryDiscovery.SOURCE_ADMIN_SEARCH,
            "search_term": query,
            "search_city": city,
            "search_state": state_value,
            "search_zip": zip_code,
            "radius_miles": radius_miles,
            "admin_user": request.user,
        }
        entries = []
        for place in google_result.get("results") or []:
            entry = upsert_directory_entry_from_place(place, context=context)
            if entry is not None:
                entries.append(_directory_entry_payload(entry))

        return Response(
            {
                "summary": {
                    "search_query": query,
                    "radius_miles": radius_miles,
                    "results_count": len(google_result.get("results") or []),
                    "directory_entries_count": len(entries),
                    "external_search": google_result.get("diagnostic") or {},
                },
                "results": google_result.get("results") or [],
                "directory_entries": entries,
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorDirectoryView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, *args, **kwargs):
        qs = ContractorDirectoryEntry.objects.all().order_by("-last_seen_at", "business_name")
        if _safe_text(request.query_params.get("missing_email")).lower() == "true":
            qs = qs.filter(public_email__isnull=True)
        if _safe_text(request.query_params.get("has_website")).lower() == "true":
            qs = qs.exclude(website__isnull=True).exclude(website="")
        for param, field in [
            ("city", "city__iexact"),
            ("state", "state__iexact"),
            ("source", "source"),
            ("profile_status", "profile_status"),
            ("enrichment_status", "enrichment_status"),
        ]:
            value = _safe_text(request.query_params.get(param))
            if value:
                qs = qs.filter(**{field: value})
        claimed = _safe_text(request.query_params.get("claimed")).lower()
        if claimed in {"true", "false"}:
            qs = qs.filter(claimed=claimed == "true")
        try:
            limit = max(1, min(int(request.query_params.get("limit") or 100), 250))
        except (TypeError, ValueError):
            limit = 100
        return Response({"results": [_directory_entry_payload(entry) for entry in qs[:limit]]}, status=status.HTTP_200_OK)


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
