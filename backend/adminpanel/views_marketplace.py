from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import Http404
from django.utils import timezone

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from .permissions import IsAdminUserRole
from .utils import safe_get
from projects.models import Contractor, ContractorPublicProfile
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite, MarketplaceLocation
from projects.services.marketplace_readiness import location_readiness, normalize_location_value
from projects.services.contractor_discovery import build_contractor_recommendations
from projects.services.google_places_contractors import (
    project_type_to_places_query,
    suggest_radius_miles,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value)))
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        next_value = float(str(value))
    except Exception:
        return default
    return next_value if next_value == next_value else default


def _normalize_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _format_money(value: Any) -> str:
    try:
        return f"{Decimal(str(value or 0)).quantize(Decimal('0.01')):.2f}"
    except Exception:
        return "0.00"


def _query_listings(request):
    qs = ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user")
    q = _safe_text(request.query_params.get("q"))
    trade = _safe_text(request.query_params.get("trade"))
    city = _safe_text(request.query_params.get("city"))
    state = _safe_text(request.query_params.get("state"))
    source = _safe_text(request.query_params.get("source"))
    claimed = _safe_text(request.query_params.get("claimed"))
    invited = _safe_text(request.query_params.get("invited"))
    opted_out = _safe_text(request.query_params.get("opted_out"))
    reviewed = _safe_text(request.query_params.get("reviewed"))
    enriched = _safe_text(request.query_params.get("enriched"))
    assisted = _safe_text(request.query_params.get("assisted_diy"))
    escrow = _safe_text(request.query_params.get("escrow_friendly"))
    inspection = _safe_text(request.query_params.get("inspection_capable"))
    rescue = _safe_text(request.query_params.get("rescue_project_friendly"))
    has_phone = _safe_text(request.query_params.get("has_phone"))
    has_email = _safe_text(request.query_params.get("has_email"))
    min_rating = _safe_float(request.query_params.get("min_rating"), 0.0)

    if q:
        qs = qs.filter(
            Q(business_name__icontains=q)
            | Q(normalized_business_name__icontains=q)
            | Q(city__icontains=q)
            | Q(state__icontains=q)
            | Q(primary_trade__icontains=q)
            | Q(phone_number__icontains=q)
        )
    if trade:
        qs = qs.filter(Q(primary_trade__icontains=trade) | Q(trade_categories__contains=[trade]))
    if city:
        qs = qs.filter(city__icontains=city)
    if state:
        qs = qs.filter(state__icontains=state)
    if source:
        qs = qs.filter(source=source)
    if claimed in {"1", "true", "yes"}:
        qs = qs.filter(claimed_profile=True)
    elif claimed in {"0", "false", "no"}:
        qs = qs.filter(claimed_profile=False)
    if invited in {"1", "true", "yes"}:
        qs = qs.filter(discovery_invites__isnull=False).distinct()
    elif invited in {"0", "false", "no"}:
        qs = qs.filter(discovery_invites__isnull=True)
    if opted_out in {"1", "true", "yes"}:
        qs = qs.filter(Q(sms_opt_out=True) | Q(email_opt_out=True))
    elif opted_out in {"0", "false", "no"}:
        qs = qs.filter(sms_opt_out=False, email_opt_out=False)
    if reviewed in {"1", "true", "yes"}:
        qs = qs.filter(manually_reviewed=True)
    elif reviewed in {"0", "false", "no"}:
        qs = qs.filter(manually_reviewed=False)
    if enriched in {"1", "true", "yes"}:
        qs = qs.filter(manually_enriched=True)
    elif enriched in {"0", "false", "no"}:
        qs = qs.filter(manually_enriched=False)
    if assisted in {"1", "true", "yes"}:
        qs = qs.filter(assisted_diy_friendly=True)
    if escrow in {"1", "true", "yes"}:
        qs = qs.filter(escrow_friendly=True)
    if inspection in {"1", "true", "yes"}:
        qs = qs.filter(inspection_capable=True)
    if rescue in {"1", "true", "yes"}:
        qs = qs.filter(rescue_project_friendly=True)
    if has_phone in {"1", "true", "yes"}:
        qs = qs.exclude(phone_number="")
    elif has_phone in {"0", "false", "no"}:
        qs = qs.filter(phone_number="")
    if has_email in {"1", "true", "yes"}:
        qs = qs.exclude(email="")
    elif has_email in {"0", "false", "no"}:
        qs = qs.filter(email="")
    if min_rating:
        qs = qs.filter(google_rating__gte=min_rating)

    return qs.order_by("-claimed_profile", "-google_review_count", "-google_rating", "business_name")


def _compatibility_reasons(listing: ContractorDirectoryListing) -> list[str]:
    reasons = []
    tags = [str(tag).strip() for tag in (listing.compatibility_tags or []) if str(tag).strip()]
    if listing.assisted_diy_friendly:
        reasons.append("Assisted DIY friendly")
    if listing.escrow_friendly:
        reasons.append("Escrow friendly")
    if listing.inspection_capable:
        reasons.append("Inspection capable")
    if listing.rescue_project_friendly:
        reasons.append("Rescue-project friendly")
    if listing.collaboration_score is not None:
        reasons.append(f"Collaboration score {int(round(float(listing.collaboration_score)))}")
    for tag in tags[:3]:
        reasons.append(tag)
    if listing.claimed_profile:
        reasons.append("MyHomeBro verified")
    return list(dict.fromkeys(reasons))


def _recommendation_tier(listing: ContractorDirectoryListing) -> str:
    score = 0
    if listing.claimed_profile:
        score += 25
    if listing.assisted_diy_friendly:
        score += 20
    if listing.escrow_friendly:
        score += 15
    if listing.inspection_capable:
        score += 15
    if listing.rescue_project_friendly:
        score += 10
    if listing.google_review_count:
        score += min(15, int(listing.google_review_count // 20))
    if listing.google_rating:
        score += min(10, int(float(listing.google_rating)))
    if score >= 60:
        return "Strong Match"
    if score >= 35:
        return "Good Match"
    return "Limited Match"


def _serialize_listing(listing: ContractorDirectoryListing, *, include_invites: bool = False) -> dict[str, Any]:
    profile = getattr(listing, "claimed_contractor", None)
    invites = list(getattr(listing, "discovery_invites", []).all().order_by("-created_at")[:5]) if include_invites and hasattr(listing, "discovery_invites") else []
    recommendation_reasons = _compatibility_reasons(listing)
    supported_modes = ["full_service"]
    if listing.assisted_diy_friendly:
        supported_modes.append("assisted_diy")
    if listing.inspection_capable:
        supported_modes.append("inspection_only")
    if listing.escrow_friendly:
        supported_modes.append("consultation")

    return {
        "id": listing.id,
        "source": listing.source,
        "google_place_id": listing.google_place_id,
        "business_name": listing.business_name,
        "normalized_business_name": listing.normalized_business_name,
        "phone_number": listing.phone_number,
        "email": listing.email,
        "website_url": listing.website_url,
        "google_maps_url": listing.google_maps_url,
        "formatted_address": listing.formatted_address,
        "city": listing.city,
        "state": listing.state,
        "zip_code": listing.zip_code,
        "latitude": listing.latitude,
        "longitude": listing.longitude,
        "primary_trade": listing.primary_trade,
        "trade_categories": listing.trade_categories or [],
        "google_rating": listing.google_rating,
        "google_review_count": int(listing.google_review_count or 0),
        "business_status": listing.business_status,
        "claimed_profile": bool(listing.claimed_profile),
        "claimed_contractor_id": listing.claimed_contractor_id,
        "claimed_contractor_name": safe_get(profile, ["business_name", "name"], None) if profile else None,
        "sms_opt_out": bool(listing.sms_opt_out),
        "email_opt_out": bool(listing.email_opt_out),
        "manually_reviewed": bool(listing.manually_reviewed),
        "manually_enriched": bool(listing.manually_enriched),
        "admin_notes": listing.admin_notes,
        "assisted_diy_friendly": bool(listing.assisted_diy_friendly),
        "escrow_friendly": bool(listing.escrow_friendly),
        "inspection_capable": bool(listing.inspection_capable),
        "rescue_project_friendly": bool(listing.rescue_project_friendly),
        "collaboration_score": listing.collaboration_score,
        "compatibility_tags": listing.compatibility_tags or [],
        "compatibility_reasons": recommendation_reasons,
        "recommendation_tier": _recommendation_tier(listing),
        "recommended_score": min(100, int(round((listing.collaboration_score or 0) if listing.collaboration_score is not None else len(recommendation_reasons) * 10))),
        "supported_project_modes": list(dict.fromkeys(supported_modes)),
        "invite_count": ContractorDiscoveryInvite.objects.filter(directory_listing=listing).count(),
        "latest_invite_at": ContractorDiscoveryInvite.objects.filter(directory_listing=listing).aggregate(latest=Max("created_at")).get("latest"),
        "last_synced_at": listing.last_synced_at.isoformat() if listing.last_synced_at else None,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
        "updated_at": listing.updated_at.isoformat() if listing.updated_at else None,
        "label": "MyHomeBro Verified" if listing.claimed_profile else "Local Business Listing",
        "claimed": bool(listing.claimed_profile),
        "invite_available": bool(listing.phone_number or listing.email or listing.claimed_contractor_id),
        "phone_available": bool(listing.phone_number),
        "email_available": bool(listing.email),
        "compatibility_profile": {
            "tier": _recommendation_tier(listing),
            "summary": "Admin-managed marketplace listing.",
            "badges": [
                "DIY Assistance Available" if listing.assisted_diy_friendly else None,
                "Escrow Friendly" if listing.escrow_friendly else None,
                "Inspection Services" if listing.inspection_capable else None,
                "Rescue Project Assistance" if listing.rescue_project_friendly else None,
            ],
            "ways_i_work": [
                {
                    "key": "assisted_diy",
                    "label": "DIY Assistance Available",
                    "description": "Comfortable supporting homeowner participation.",
                }
                if listing.assisted_diy_friendly
                else None,
                {
                    "key": "escrow",
                    "label": "Escrow Friendly",
                    "description": "Works with milestone-based protection.",
                }
                if listing.escrow_friendly
                else None,
            ],
            "reasons": recommendation_reasons,
        },
        "recent_invites": [
            {
                "id": invite.id,
                "status": invite.status,
                "channel": invite.channel,
                "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
                "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
                "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
                "response_at": invite.response_at.isoformat() if invite.response_at else None,
                "destination_phone": invite.destination_phone,
                "destination_email": invite.destination_email,
                "error_message": invite.error_message,
                "claim_url": invite.invite_url_path,
            }
            for invite in invites
        ],
    }


class AdminMarketplaceOverview(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        listings = ContractorDirectoryListing.objects.all()
        invites = ContractorDiscoveryInvite.objects.all()

        by_trade = defaultdict(lambda: {"total": 0, "claimed": 0, "assisted": 0, "escrow": 0, "inspection": 0})
        by_city = defaultdict(lambda: {"total": 0, "claimed": 0})
        by_state = defaultdict(lambda: {"total": 0, "claimed": 0})
        gaps = []

        for listing in listings:
            trade = _safe_text(listing.primary_trade) or "Unknown"
            by_trade[trade]["total"] += 1
            by_trade[trade]["claimed"] += int(bool(listing.claimed_profile))
            by_trade[trade]["assisted"] += int(bool(listing.assisted_diy_friendly))
            by_trade[trade]["escrow"] += int(bool(listing.escrow_friendly))
            by_trade[trade]["inspection"] += int(bool(listing.inspection_capable))

            city = _safe_text(listing.city) or "Unknown"
            state = _safe_text(listing.state) or "Unknown"
            by_city[city]["total"] += 1
            by_city[city]["claimed"] += int(bool(listing.claimed_profile))
            by_state[state]["total"] += 1
            by_state[state]["claimed"] += int(bool(listing.claimed_profile))

        for trade, stats in sorted(by_trade.items(), key=lambda item: (-item[1]["total"], item[0])):
            if stats["total"] and stats["claimed"] == 0:
                gaps.append({
                    "title": f"{trade} has no claimed contractors",
                    "detail": f"{stats['total']} directory listing(s) are still unclaimed for this trade.",
                    "trade": trade,
                    "claimed": stats["claimed"],
                    "total": stats["total"],
                    "tone": "warn",
                })

        invite_analytics = ContractorDiscoveryInvite.analytics()
        claimed_count = listings.filter(claimed_profile=True).count()
        unclaimed_count = listings.filter(claimed_profile=False).count()
        opted_out_count = listings.filter(Q(sms_opt_out=True) | Q(email_opt_out=True)).count()
        location_keys = {
            (normalize_location_value(city), normalize_location_value(state))
            for city, state in listings.exclude(city="", state="").values_list("city", "state")
        }
        location_keys.update(
            {
                (normalize_location_value(city), normalize_location_value(state))
                for city, state in MarketplaceLocation.objects.values_list("city", "state")
            }
        )
        location_rows = [
            location_readiness(city, state)
            for city, state in location_keys
            if city and state
        ]
        status_order = {"enabled": 0, "ready": 1, "nearing_ready": 2, "not_ready": 3}
        location_rows.sort(
            key=lambda row: (
                status_order.get(row["status"], 9),
                -int(row["counts"]["claimed_contractors"]),
                row["state"],
                row["city"],
            )
        )

        return Response(
            {
                "generated_at": timezone.now().isoformat(),
                "summary": {
                    "total_listings": listings.count(),
                    "claimed_listings": claimed_count,
                    "unclaimed_listings": unclaimed_count,
                    "opted_out_listings": opted_out_count,
                    "manual_reviewed_listings": listings.filter(manually_reviewed=True).count(),
                    "manual_enriched_listings": listings.filter(manually_enriched=True).count(),
                    "total_invites": invite_analytics["total"],
                    "sent_invites": invite_analytics["sent"],
                    "claimed_invites": invite_analytics["claimed"],
                    "claim_rate": invite_analytics["claim_rate"],
                    "response_rate": invite_analytics["response_rate"],
                    "agreement_conversion": invite_analytics["agreement_conversion"],
                    "escrow_conversion": invite_analytics["escrow_conversion"],
                },
                "coverage": {
                    "trades": [
                        {
                            "trade": trade,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                            "claim_rate": round((stats["claimed"] / stats["total"]) * 100.0, 2) if stats["total"] else 0.0,
                            "assisted_diy": stats["assisted"],
                            "escrow_friendly": stats["escrow"],
                            "inspection_capable": stats["inspection"],
                        }
                        for trade, stats in sorted(by_trade.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "cities": [
                        {
                            "city": city,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                        }
                        for city, stats in sorted(by_city.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "states": [
                        {
                            "state": state,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                        }
                        for state, stats in sorted(by_state.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "gaps": gaps[:10],
                    "location_readiness": location_rows[:50],
                },
                "invite_analytics": invite_analytics,
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceLocationStatus(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request):
        city = normalize_location_value(request.data.get("city"))
        state = normalize_location_value(request.data.get("state"))
        if not city or not state:
            return Response({"detail": "City and state are required."}, status=status.HTTP_400_BAD_REQUEST)

        enabled = _safe_bool(request.data.get("enabled"))
        location, _created = MarketplaceLocation.objects.get_or_create(
            city=city,
            state=state,
            defaults={"updated_by": request.user},
        )
        location.is_enabled = enabled
        location.updated_by = request.user
        location.admin_notes = _safe_text(request.data.get("admin_notes")) or location.admin_notes
        if enabled:
            location.enabled_at = timezone.now()
            location.disabled_at = None
        else:
            location.disabled_at = timezone.now()
        for field in [
            "min_claimed_contractors",
            "min_verified_contractors",
            "min_stripe_ready_contractors",
            "min_trade_categories",
            "max_bids_per_request",
        ]:
            if field in request.data:
                value = _safe_int(request.data.get(field), 0)
                setattr(location, field, value or None if field != "max_bids_per_request" else max(1, min(value or 5, 10)))
        location.save()
        return Response(location_readiness(city, state), status=status.HTTP_200_OK)


class AdminMarketplaceContractors(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        qs = _query_listings(request)
        limit = max(1, min(_safe_int(request.query_params.get("limit"), 100), 500))
        offset = max(0, _safe_int(request.query_params.get("offset"), 0))
        page = list(qs[offset : offset + limit])
        recent_invites = {}
        invite_rows = ContractorDiscoveryInvite.objects.filter(directory_listing_id__in=[row.id for row in page]).order_by("-created_at")[:300]
        for invite in invite_rows:
            recent_invites.setdefault(invite.directory_listing_id, []).append(invite)

        results = []
        for listing in page:
            payload = _serialize_listing(listing)
            payload["recent_invites"] = [
                {
                    "id": invite.id,
                    "status": invite.status,
                    "channel": invite.channel,
                    "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
                    "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
                    "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
                }
                for invite in recent_invites.get(listing.id, [])[:3]
            ]
            results.append(payload)

        return Response(
            {
                "count": qs.count(),
                "offset": offset,
                "limit": limit,
                "results": results,
                "filters": {
                    "q": _safe_text(request.query_params.get("q")),
                    "trade": _safe_text(request.query_params.get("trade")),
                    "city": _safe_text(request.query_params.get("city")),
                    "state": _safe_text(request.query_params.get("state")),
                    "claimed": _safe_text(request.query_params.get("claimed")),
                    "source": _safe_text(request.query_params.get("source")),
                    "reviewed": _safe_text(request.query_params.get("reviewed")),
                    "enriched": _safe_text(request.query_params.get("enriched")),
                    "invited": _safe_text(request.query_params.get("invited")),
                    "assisted_diy": _safe_text(request.query_params.get("assisted_diy")),
                    "escrow_friendly": _safe_text(request.query_params.get("escrow_friendly")),
                    "inspection_capable": _safe_text(request.query_params.get("inspection_capable")),
                    "rescue_project_friendly": _safe_text(request.query_params.get("rescue_project_friendly")),
                    "has_phone": _safe_text(request.query_params.get("has_phone")),
                    "has_email": _safe_text(request.query_params.get("has_email")),
                    "min_rating": _safe_text(request.query_params.get("min_rating")),
                },
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceImport(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        payload = {
            "project_type": _safe_text(request.query_params.get("project_type")),
            "project_subtype": _safe_text(request.query_params.get("project_subtype")),
            "project_mode": _safe_text(request.query_params.get("project_mode")),
            "payment_preference": _safe_text(request.query_params.get("payment_preference")),
            "project_city": _safe_text(request.query_params.get("city")),
            "project_state": _safe_text(request.query_params.get("state")),
            "project_postal_code": _safe_text(request.query_params.get("zip")),
        }
        query = _safe_text(request.query_params.get("query")) or project_type_to_places_query(payload["project_type"], payload["project_subtype"])
        radius = _safe_int(request.query_params.get("radius_miles"), suggest_radius_miles(payload["project_type"], payload["project_subtype"], payload["project_mode"]))
        limit = max(1, min(_safe_int(request.query_params.get("limit"), 10), 25))
        latitude = request.query_params.get("lat")
        longitude = request.query_params.get("lng")

        recommendations = build_contractor_recommendations(
            payload=payload,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius,
            limit=limit,
        )
        return Response(recommendations, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request):
        selected = request.data.get("selected_contractors") or request.data.get("selected_results") or []
        if not isinstance(selected, list) or not selected:
            return Response({"detail": "Select at least one contractor listing."}, status=status.HTTP_400_BAD_REQUEST)

        admin_notes = _safe_text(request.data.get("admin_notes"))
        compatibility_tags = _normalize_list(request.data.get("compatibility_tags"))
        updated_rows = []
        for item in selected:
            if not isinstance(item, dict):
                continue
            listing_id = item.get("directory_listing_id") or item.get("id")
            if isinstance(listing_id, str) and ":" in listing_id:
                listing_id = listing_id.split(":", 1)[1]
            try:
                listing = ContractorDirectoryListing.objects.get(id=int(listing_id))
            except Exception:
                continue
            listing.manually_reviewed = True
            if admin_notes:
                listing.admin_notes = admin_notes
            if compatibility_tags:
                listing.compatibility_tags = list(dict.fromkeys((listing.compatibility_tags or []) + compatibility_tags))
                listing.manually_enriched = True
            if _safe_bool(item.get("assisted_diy_friendly")):
                listing.assisted_diy_friendly = True
            if _safe_bool(item.get("escrow_friendly")):
                listing.escrow_friendly = True
            if _safe_bool(item.get("inspection_capable")):
                listing.inspection_capable = True
            if _safe_bool(item.get("rescue_project_friendly")):
                listing.rescue_project_friendly = True
            if item.get("primary_trade"):
                listing.primary_trade = _safe_text(item.get("primary_trade"))
            if isinstance(item.get("trade_categories"), list):
                listing.trade_categories = _normalize_list(item.get("trade_categories"))
            if _safe_text(item.get("email")):
                listing.email = _safe_text(item.get("email"))
            if _safe_text(item.get("phone_number")):
                listing.phone_number = _safe_text(item.get("phone_number"))
            listing.save()
            updated_rows.append(_serialize_listing(listing))

        return Response(
            {
                "detail": "Listings imported.",
                "updated_count": len(updated_rows),
                "results": updated_rows,
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceListingDetail(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get_object(self, listing_id: int) -> ContractorDirectoryListing:
        try:
            return ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user").get(id=listing_id)
        except ContractorDirectoryListing.DoesNotExist as exc:
            raise Http404("Directory listing not found.") from exc

    def get(self, request, listing_id: int):
        listing = self.get_object(listing_id)
        payload = _serialize_listing(listing, include_invites=True)
        payload["recommendation_snapshot"] = build_contractor_recommendations(
            payload={
                "project_type": listing.primary_trade,
                "project_subtype": " ".join(listing.trade_categories or []),
                "project_title": listing.business_name,
                "description": listing.formatted_address or listing.business_name,
                "project_scope_summary": listing.business_name,
                "project_city": listing.city,
                "project_state": listing.state,
                "project_mode": "assisted_diy" if listing.assisted_diy_friendly else "full_service",
                "payment_preference": "escrow" if listing.escrow_friendly else "direct",
            },
            query=listing.business_name or listing.primary_trade,
            latitude=listing.latitude,
            longitude=listing.longitude,
            radius_miles=25,
            limit=3,
        ).get("results", [])
        return Response(payload, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, listing_id: int):
        listing = self.get_object(listing_id)
        mutable_fields = {
            "business_name",
            "phone_number",
            "email",
            "website_url",
            "google_maps_url",
            "formatted_address",
            "city",
            "state",
            "zip_code",
            "primary_trade",
            "google_rating",
            "google_review_count",
            "business_status",
            "admin_notes",
            "assisted_diy_friendly",
            "escrow_friendly",
            "inspection_capable",
            "rescue_project_friendly",
            "manually_reviewed",
            "manually_enriched",
            "claimed_profile",
            "sms_opt_out",
            "email_opt_out",
            "collaboration_score",
        }

        for key in mutable_fields:
            if key in request.data:
                setattr(listing, key, request.data.get(key))

        if "trade_categories" in request.data:
            listing.trade_categories = _normalize_list(request.data.get("trade_categories"))
        if "compatibility_tags" in request.data:
            listing.compatibility_tags = _normalize_list(request.data.get("compatibility_tags"))

        listing.save()
        return Response(_serialize_listing(listing, include_invites=True), status=status.HTTP_200_OK)


class AdminMarketplaceListingInvite(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, listing_id: int):
        try:
            listing = ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user").get(id=listing_id)
        except ContractorDirectoryListing.DoesNotExist as exc:
            raise Http404("Directory listing not found.") from exc

        if listing.claimed_profile and listing.claimed_contractor_id:
            return Response(
                {"detail": "This listing is already claimed.", "claimed": True},
                status=status.HTTP_400_BAD_REQUEST,
            )

        channel = _safe_text(request.data.get("preferred_channel") or request.data.get("channel") or "").lower() or ContractorDiscoveryInvite.CHANNEL_SMS
        if channel not in dict(ContractorDiscoveryInvite.CHANNEL_CHOICES):
            channel = ContractorDiscoveryInvite.CHANNEL_SMS

        invite = ContractorDiscoveryInvite.objects.filter(directory_listing=listing).order_by("-created_at").first()
        if invite is not None and invite.status in {ContractorDiscoveryInvite.STATUS_SENT, ContractorDiscoveryInvite.STATUS_DELIVERED, ContractorDiscoveryInvite.STATUS_CLICKED}:
            return Response(
                {"detail": "An invite has already been sent recently.", "invite": _invite_payload(invite)},
                status=status.HTTP_200_OK,
            )

        invite = ContractorDiscoveryInvite.objects.create(
            directory_listing=listing,
            channel=channel,
            destination_phone=listing.phone_number if channel == ContractorDiscoveryInvite.CHANNEL_SMS else "",
            destination_email=listing.email if channel == ContractorDiscoveryInvite.CHANNEL_EMAIL else "",
        )

        claim_link = request.build_absolute_uri(f"/contractors/claim/{invite.invite_token}")
        city = listing.city or "your area"
        project_type = listing.primary_trade or "project"
        message = (
            f"MyHomeBro: Your business was selected for local contractor discovery on MyHomeBro. "
            f"Claim your profile to review project opportunities in your area: {claim_link} "
            "Reply STOP to opt out."
        )
        email_subject = "Claim your contractor profile on MyHomeBro"
        email_body = (
            "Your business has been added as a local contractor listing on MyHomeBro using publicly available business information.\n\n"
            "Claim your contractor profile to:\n"
            "- receive project requests\n"
            "- manage your profile\n"
            "- participate in escrow-protected projects\n"
            "- review Assisted DIY opportunities\n"
            "- receive collaborative project matches\n\n"
            f"Claim profile:\n{claim_link}\n\n"
            f"Opt out:\n{claim_link}?opt_out=1\n"
        )

        if channel == ContractorDiscoveryInvite.CHANNEL_SMS:
            if listing.sms_opt_out or not listing.phone_number:
                invite.status = ContractorDiscoveryInvite.STATUS_OPTED_OUT if listing.sms_opt_out else ContractorDiscoveryInvite.STATUS_FAILED
                invite.error_message = "SMS unavailable or opted out."
            else:
                try:
                    from projects.services.invites_delivery import send_twilio_sms

                    ok, msg = send_twilio_sms(to_phone=listing.phone_number, body=message)
                    invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                    invite.sent_at = timezone.now() if ok else None
                    invite.error_message = "" if ok else msg
                except Exception as exc:
                    invite.status = ContractorDiscoveryInvite.STATUS_FAILED
                    invite.error_message = str(exc)
        elif channel == ContractorDiscoveryInvite.CHANNEL_EMAIL:
            if listing.email_opt_out or not listing.email:
                invite.status = ContractorDiscoveryInvite.STATUS_OPTED_OUT if listing.email_opt_out else ContractorDiscoveryInvite.STATUS_FAILED
                invite.error_message = "Email unavailable or opted out."
            else:
                try:
                    from projects.services.invites_delivery import send_postmark_email

                    ok, msg = send_postmark_email(to_email=listing.email, subject=email_subject, text_body=email_body)
                    invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                    invite.sent_at = timezone.now() if ok else None
                    invite.error_message = "" if ok else msg
                except Exception as exc:
                    invite.status = ContractorDiscoveryInvite.STATUS_FAILED
                    invite.error_message = str(exc)
        else:
            invite.status = ContractorDiscoveryInvite.STATUS_PENDING
            invite.error_message = "Invite created for manual follow-up."

        invite.save(update_fields=["status", "sent_at", "error_message", "destination_phone", "destination_email", "updated_at"])
        return Response(
            {
                "detail": "Invite created.",
                "claim_link": claim_link,
                "invite": _invite_payload(invite),
                "message": message,
                "email_subject": email_subject,
                "email_body": email_body,
            },
            status=status.HTTP_200_OK,
        )


def _invite_payload(invite: ContractorDiscoveryInvite) -> dict[str, Any]:
    return {
        "id": invite.id,
        "invite_token": str(invite.invite_token),
        "status": invite.status,
        "channel": invite.channel,
        "destination_phone": invite.destination_phone,
        "destination_email": invite.destination_email,
        "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
        "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
        "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
        "response_at": invite.response_at.isoformat() if invite.response_at else None,
        "error_message": invite.error_message,
        "claim_url": invite.invite_url_path,
    }
