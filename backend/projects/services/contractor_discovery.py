from __future__ import annotations

import json
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Contractor, ContractorPublicProfile, PublicContractorLead
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite
from projects.services.contractor_matching import score_contractor_project_match
from projects.services.google_places_contractors import (
    calculate_distance_miles,
    project_type_to_places_query,
    search_google_places_contractors,
    suggest_radius_miles,
)
from projects.services.notification_center import create_notification
from projects.services.public_lead_pipeline import ensure_public_profile_for_contractor
from projects.services.invites_delivery import send_postmark_email, send_twilio_sms


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _parse_jsonish(value: Any, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return default
    try:
        parsed = json.loads(value)
    except Exception:
        return default
    return parsed if isinstance(parsed, type(default)) else default


def _normalize_project_payload(intake=None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(payload or {})
    ai_analysis = _safe_dict(getattr(intake, "ai_analysis_payload", None))
    milestones = _safe_list(payload.get("milestones")) or _safe_list(getattr(intake, "ai_milestones", None))
    if not milestones:
        milestones = _safe_list(ai_analysis.get("milestones"))

    return {
        "project_mode": _safe_text(
            payload.get("project_mode")
            or getattr(intake, "project_mode", "")
            or ai_analysis.get("project_mode")
            or "full_service"
        ),
        "payment_preference": _safe_text(
            payload.get("payment_preference")
            or getattr(intake, "payment_preference", "")
            or ai_analysis.get("payment_preference")
            or "escrow"
        ),
        "project_type": _safe_text(
            payload.get("project_type")
            or getattr(intake, "ai_project_type", "")
            or ai_analysis.get("project_type")
            or getattr(intake, "accomplishment_text", "")
        ),
        "project_subtype": _safe_text(
            payload.get("project_subtype")
            or getattr(intake, "ai_project_subtype", "")
            or ai_analysis.get("project_subtype")
        ),
        "project_title": _safe_text(
            payload.get("project_title")
            or getattr(intake, "ai_project_title", "")
            or ai_analysis.get("project_title")
        ),
        "description": _safe_text(
            payload.get("description")
            or getattr(intake, "ai_description", "")
            or getattr(intake, "accomplishment_text", "")
            or ai_analysis.get("project_scope_summary")
        ),
        "project_scope_summary": _safe_text(
            payload.get("project_scope_summary")
            or ai_analysis.get("project_scope_summary")
            or getattr(intake, "ai_description", "")
            or getattr(intake, "accomplishment_text", "")
        ),
        "project_city": _safe_text(payload.get("project_city") or getattr(intake, "project_city", "")),
        "project_state": _safe_text(payload.get("project_state") or getattr(intake, "project_state", "")),
        "project_postal_code": _safe_text(payload.get("project_postal_code") or getattr(intake, "project_postal_code", "")),
        "project_class": _safe_text(payload.get("project_class") or getattr(intake, "project_class", "")),
        "homeowner_participation_notes": _safe_text(
            payload.get("homeowner_participation_notes") or getattr(intake, "homeowner_participation_notes", "")
        ),
        "homeowner_started_work": bool(
            payload.get("homeowner_started_work")
            if "homeowner_started_work" in payload
            else getattr(intake, "homeowner_started_work", False)
        ),
        "homeowner_task_summary": _safe_text(payload.get("homeowner_task_summary") or getattr(intake, "homeowner_task_summary", "")),
        "homeowner_assistance_summary": _safe_text(
            payload.get("homeowner_assistance_summary") or getattr(intake, "homeowner_assistance_summary", "")
        ),
        "project_budget": payload.get("project_budget") or getattr(intake, "ai_project_budget", None),
        "milestones": milestones,
    }


def _iter_contractors_for_public_profiles():
    qs = Contractor.objects.select_related("public_profile", "user").prefetch_related("skills")
    for contractor in qs:
        profile = getattr(contractor, "public_profile", None)
        if profile is None:
            continue
        if not bool(getattr(profile, "is_public", False)) and not bool(getattr(profile, "allow_public_intake", False)):
            continue
        yield contractor, profile


def _trade_keywords(project: dict[str, Any]) -> set[str]:
    text = " ".join(
        [
            project.get("project_type", ""),
            project.get("project_subtype", ""),
            project.get("project_title", ""),
            project.get("description", ""),
            project.get("project_scope_summary", ""),
        ]
    ).lower()
    tokens = set()
    for part in text.replace("/", " ").replace(",", " ").split():
        cleaned = "".join(ch for ch in part if ch.isalnum())
        if len(cleaned) >= 3:
            tokens.add(cleaned)
    return tokens


def _shim_skill(name: str):
    return SimpleNamespace(name=name)


class _ShimSkillRelation:
    def __init__(self, names: list[str]):
        self._names = [name for name in names if name]

    def all(self):
        return [_shim_skill(name) for name in self._names]


def _build_listing_shim(listing: ContractorDirectoryListing):
    trade_names = list(listing.trade_categories or [])
    if listing.primary_trade and listing.primary_trade not in trade_names:
        trade_names.insert(0, listing.primary_trade)
    return SimpleNamespace(
        id=listing.id,
        name=listing.business_name or listing.normalized_business_name or "",
        business_name=listing.business_name or "",
        city=listing.city or "",
        state=listing.state or "",
        license_number="",
        skills=_ShimSkillRelation(trade_names),
        public_profile=None,
        accepts_diy_assistance=False,
        accepts_consultation_only=False,
        accepts_hourly_help=False,
        accepts_inspection_only=False,
        accepts_homeowner_participation=False,
        service_radius_miles=25,
    )


def upsert_directory_listing_from_google(place: dict[str, Any]) -> ContractorDirectoryListing | None:
    google_place_id = _safe_text(place.get("google_place_id"))
    business_name = _safe_text(place.get("business_name"))
    if not business_name:
        return None
    phone_number = _safe_text(place.get("phone_number"))
    city = _safe_text(place.get("city"))
    lookup = {}
    if google_place_id:
        lookup["google_place_id"] = google_place_id
    elif phone_number:
        lookup["phone_number"] = phone_number
    else:
        lookup["normalized_business_name"] = _safe_text(business_name).lower()
        lookup["city"] = city

    defaults = {
        "source": place.get("source") or ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
        "business_name": business_name,
        "phone_number": phone_number,
        "email": _safe_text(place.get("email")),
        "website_url": _safe_text(place.get("website_url")),
        "google_maps_url": _safe_text(place.get("google_maps_url")),
        "formatted_address": _safe_text(place.get("formatted_address")),
        "city": city,
        "state": _safe_text(place.get("state")),
        "zip_code": _safe_text(place.get("zip_code")),
        "latitude": place.get("latitude"),
        "longitude": place.get("longitude"),
        "primary_trade": _safe_text(place.get("primary_trade")),
        "trade_categories": _safe_list(place.get("trade_categories")),
        "google_rating": place.get("google_rating"),
        "google_review_count": int(place.get("google_review_count") or 0),
        "business_status": _safe_text(place.get("business_status")),
        "last_synced_at": timezone.now(),
    }

    listing, _created = ContractorDirectoryListing.objects.update_or_create(defaults=defaults, **lookup)
    return listing


def _score_listing(project: dict[str, Any], listing: ContractorDirectoryListing) -> dict[str, Any]:
    score = 0
    reasons: list[str] = []
    project_tokens = _trade_keywords(project)
    listing_tokens = _trade_keywords(
        {
            "project_type": listing.primary_trade,
            "project_subtype": " ".join(listing.trade_categories or []),
            "project_title": listing.business_name,
            "description": listing.formatted_address,
            "project_scope_summary": listing.business_name,
        }
    )

    overlap = len(project_tokens.intersection(listing_tokens))
    if overlap:
        score += min(24, overlap * 6)
        reasons.append("Relevant trade keywords overlap.")

    if listing.city and project.get("project_city") and listing.city.strip().lower() == project.get("project_city", "").strip().lower():
        score += 12
        reasons.append("Matches the project city.")
    elif listing.state and project.get("project_state") and listing.state.strip().lower() == project.get("project_state", "").strip().lower():
        score += 6
        reasons.append("Matches the project state.")

    if listing.google_rating:
        score += min(10, int(float(listing.google_rating)))
        reasons.append("Has public review history.")

    if listing.google_review_count:
        score += min(8, listing.google_review_count // 10)
        reasons.append("Has local review volume.")

    mode = project.get("project_mode", "full_service")
    if mode == "assisted_diy":
        score += 6
        reasons.append("Could fit a collaborative project.")
    elif mode == "consultation":
        score += 6
        reasons.append("Could fit a consultation or planning request.")
    elif mode == "inspection_only":
        score += 4
        reasons.append("Could fit an inspection-focused request.")

    payment_preference = project.get("payment_preference", "escrow")
    if payment_preference == "escrow":
        score += 4
        reasons.append("Escrow milestone payments remain workable.")

    if listing.primary_trade and listing.primary_trade.lower() in project_tokens:
        score += 14
        reasons.append("Primary trade aligns with the request.")

    score = max(0, min(score, 100))
    if score >= 75:
        tier = "Strong Match"
    elif score >= 45:
        tier = "Good Match"
    else:
        tier = "Limited Match"

    supported_modes = ["full_service"]
    if mode in {"assisted_diy", "consultation", "inspection_only"} and score >= 40:
        supported_modes.append(mode)

    return {
        "score": score,
        "tier": tier,
        "reasons": list(dict.fromkeys(reasons))[:6],
        "supported_modes": list(dict.fromkeys(supported_modes)),
        "escrow_friendly": payment_preference == "escrow" or score >= 55,
        "assisted_diy_friendly": mode == "assisted_diy" or score >= 50,
        "inspection_capable": mode == "inspection_only" or score >= 55,
        "rescue_project_friendly": any(term in _safe_text(listing.business_name).lower() for term in ["repair", "finish", "remodel", "service"]),
    }


def _build_card_from_contractors(contractor: Contractor, profile: ContractorPublicProfile, project: dict[str, Any]) -> dict[str, Any]:
    match = score_contractor_project_match(contractor, project, profile=profile)
    claimed = True
    distance_miles = None
    try:
        if project.get("project_city") and contractor.city and contractor.city.strip().lower() == project.get("project_city", "").strip().lower():
            distance_miles = 0.0
        elif project.get("project_state") and contractor.state and contractor.state.strip().lower() == project.get("project_state", "").strip().lower():
            distance_miles = 0.0
    except Exception:
        distance_miles = None

    badges = list(match.get("badges") or [])
    return {
        "id": f"contractor:{contractor.id}",
        "source": ContractorDirectoryListing.SOURCE_MYHOMEBRO,
        "business_name": profile.business_name_public or contractor.business_name or contractor.name or "",
        "claimed": claimed,
        "label": "MyHomeBro Verified",
        "rating": round(float(getattr(contractor, "average_rating", 0) or 0), 2) if getattr(contractor, "review_count", 0) else None,
        "review_count": int(getattr(contractor, "review_count", 0) or 0),
        "website_url": _safe_text(getattr(profile, "website_url", "")),
        "city": profile.city or contractor.city or "",
        "state": profile.state or contractor.state or "",
        "distance_miles": distance_miles,
        "phone_available": bool(getattr(profile, "show_phone_public", False) and _safe_text(profile.phone_public)),
        "email_available": bool(getattr(profile, "show_email_public", False) and _safe_text(profile.email_public)),
        "invite_available": True,
        "recommendation_tier": match.get("tier", "Limited Match"),
        "compatibility_score": match.get("score", 0),
        "recommendation_reasons": list(match.get("reasons") or []),
        "supported_project_modes": [
            "full_service",
            *(
                ["assisted_diy"]
                if getattr(contractor, "accepts_diy_assistance", False)
                else []
            ),
            *(
                ["consultation"]
                if getattr(contractor, "accepts_consultation_only", False)
                else []
            ),
            *(
                ["inspection_only"]
                if getattr(contractor, "accepts_inspection_only", False)
                else []
            ),
        ],
        "escrow_friendly": bool(match.get("compatibility_profile", {}).get("escrow_friendly", False) or getattr(profile, "show_quote_cta", False)),
        "assisted_diy_friendly": bool(getattr(contractor, "accepts_diy_assistance", False) or getattr(contractor, "accepts_homeowner_participation", False)),
        "inspection_capable": bool(getattr(contractor, "accepts_inspection_only", False) or match.get("compatibility_profile", {}).get("inspection_capable")),
        "rescue_project_friendly": bool(match.get("compatibility_profile", {}).get("rescue_project_friendly", False)),
        "compatibility_profile": match.get("compatibility_profile", {}),
        "source_priority": 300,
        "directory_listing_id": None,
        "contractor_id": contractor.id,
    }


def _build_card_from_listing(listing: ContractorDirectoryListing, project: dict[str, Any]) -> dict[str, Any]:
    if listing.claimed_profile and listing.claimed_contractor_id:
        contractor = listing.claimed_contractor
        profile = getattr(contractor, "public_profile", None) if contractor else None
        if contractor is not None and profile is not None:
            card = _build_card_from_contractors(contractor, profile, project)
            card["id"] = f"listing:{listing.id}"
            card["source"] = listing.source
            card["label"] = "MyHomeBro Verified"
            card["claimed"] = True
            card["directory_listing_id"] = listing.id
            card["source_priority"] = 250
            return card

    match = _score_listing(project, listing)
    distance_miles = None
    if project.get("latitude") is not None and project.get("longitude") is not None:
        distance_miles = calculate_distance_miles(
            origin_latitude=project.get("latitude"),
            origin_longitude=project.get("longitude"),
            destination_latitude=listing.latitude,
            destination_longitude=listing.longitude,
        )

    supported_modes = list(match.get("supported_modes") or ["full_service"])
    if listing.source == ContractorDirectoryListing.SOURCE_MYHOMEBRO and "full_service" not in supported_modes:
        supported_modes.append("full_service")

    return {
        "id": f"listing:{listing.id}",
        "source": listing.source,
        "business_name": listing.business_name or listing.normalized_business_name or "",
        "claimed": bool(listing.claimed_profile and listing.claimed_contractor_id),
        "label": "MyHomeBro Verified" if listing.claimed_profile and listing.claimed_contractor_id else "Local Business Listing",
        "rating": listing.google_rating,
        "review_count": int(listing.google_review_count or 0),
        "website_url": _safe_text(listing.website_url),
        "city": listing.city or "",
        "state": listing.state or "",
        "distance_miles": distance_miles,
        "phone_available": bool(_safe_text(listing.phone_number)),
        "email_available": bool(_safe_text(listing.email)),
        "invite_available": bool(_safe_text(listing.phone_number) or _safe_text(listing.email) or bool(listing.claimed_contractor_id)),
        "recommendation_tier": match.get("tier", "Limited Match"),
        "compatibility_score": match.get("score", 0),
        "recommendation_reasons": list(match.get("reasons") or []),
        "supported_project_modes": supported_modes,
        "escrow_friendly": bool(match.get("escrow_friendly", False)),
        "assisted_diy_friendly": bool(match.get("assisted_diy_friendly", False)),
        "inspection_capable": bool(match.get("inspection_capable", False)),
        "rescue_project_friendly": bool(match.get("rescue_project_friendly", False)),
        "compatibility_profile": {
            "tier": match.get("tier", "Limited Match"),
            "summary": "Local business listing discovered through MyHomeBro.",
            "badges": [
                "Escrow Friendly" if match.get("escrow_friendly") else None,
                "Inspection Services" if match.get("inspection_capable") else None,
            ],
            "ways_i_work": [],
            "reasons": match.get("reasons", []),
        },
        "directory_listing_id": listing.id,
        "contractor_id": listing.claimed_contractor_id,
        "source_priority": 200 if listing.claimed_profile else 150 if listing.source == ContractorDirectoryListing.SOURCE_CACHED_DIRECTORY else 100,
    }


def build_contractor_recommendations(
    *,
    intake=None,
    payload: dict[str, Any] | None = None,
    query: str = "",
    latitude: Any = None,
    longitude: Any = None,
    radius_miles: Any = None,
    limit: int = 5,
) -> dict[str, Any]:
    project = _normalize_project_payload(intake=intake, payload=payload)
    search_query = _safe_text(query) or project_type_to_places_query(project.get("project_type"), project.get("project_subtype"))
    radius = int(radius_miles or suggest_radius_miles(project.get("project_type"), project.get("project_subtype"), project.get("project_mode")))
    if latitude not in (None, "", []) and longitude not in (None, "", []):
        project["latitude"] = latitude
        project["longitude"] = longitude

    results: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for contractor, profile in _iter_contractors_for_public_profiles():
        card = _build_card_from_contractors(contractor, profile, project)
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    for listing in ContractorDirectoryListing.objects.all().order_by("-claimed_profile", "-google_review_count", "-google_rating", "business_name")[:100]:
        card = _build_card_from_listing(listing, project)
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    google_places = search_google_places_contractors(
        project_type=project.get("project_type"),
        project_subtype=project.get("project_subtype"),
        query=search_query,
        latitude=latitude,
        longitude=longitude,
        radius_miles=radius,
        limit=max(limit, 5),
    )
    for place in google_places:
        listing = upsert_directory_listing_from_google(place)
        if listing is None:
            continue
        card = _build_card_from_listing(listing, project)
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    results.sort(
        key=lambda row: (
            -int(bool(row.get("claimed"))),
            -int(row.get("source_priority", 0)),
            -int(row.get("compatibility_score", 0)),
            -(float(row.get("rating") or 0) * 10),
            float(row.get("distance_miles") or 9999),
            row.get("business_name", ""),
        )
    )
    results = results[: max(limit, 1)]

    summary = {
        "search_query": search_query,
        "radius_miles": radius,
        "project_mode": project.get("project_mode", "full_service"),
        "payment_preference": project.get("payment_preference", "escrow"),
        "results_count": len(results),
    }

    return {"summary": summary, "results": results}


@transaction.atomic
def create_discovery_invites(*, intake, selected_targets: list[dict[str, Any]], preferred_channel: str = "") -> dict[str, Any]:
    if intake is None:
        raise ValueError("Missing intake.")
    if not isinstance(selected_targets, list) or not selected_targets:
        raise ValueError("Select at least one contractor.")

    created_rows: list[dict[str, Any]] = []
    summary = _normalize_project_payload(intake=intake)
    project_brief = summary.get("project_scope_summary") or summary.get("description") or summary.get("project_title")
    claim_link_base = f"/contractors/claim"

    for raw_target in selected_targets:
        if not isinstance(raw_target, dict):
            continue
        source = _safe_text(raw_target.get("source")).strip()
        target_id = _safe_text(raw_target.get("id")).strip()
        channel = _safe_text(raw_target.get("channel") or preferred_channel or ContractorDiscoveryInvite.CHANNEL_SMS).lower()
        if channel not in dict(ContractorDiscoveryInvite.CHANNEL_CHOICES):
            channel = ContractorDiscoveryInvite.CHANNEL_SMS

        contractor = None
        profile = None
        listing = None
        target_key = target_id.split(":", 1)
        target_type = target_key[0] if len(target_key) == 2 else source
        target_value = target_key[1] if len(target_key) == 2 else target_id

        if target_type == "contractor":
            contractor = Contractor.objects.select_related("public_profile").prefetch_related("skills").filter(pk=target_value).first()
            if contractor is None:
                continue
            profile = getattr(contractor, "public_profile", None) or ensure_public_profile_for_contractor(contractor)
        else:
            listing = ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__public_profile").filter(pk=target_value).first()
            if listing is None:
                continue
            contractor = getattr(listing, "claimed_contractor", None)
            profile = getattr(contractor, "public_profile", None) if contractor is not None else None

        duplicate = ContractorDiscoveryInvite.objects.filter(
            public_intake=intake,
            contractor=contractor,
            directory_listing=listing,
        ).order_by("-created_at").first()
        if duplicate is not None and (timezone.now() - duplicate.created_at).total_seconds() < 1800:
            created_rows.append(
                {
                    "id": duplicate.id,
                    "invite_token": str(duplicate.invite_token),
                    "status": duplicate.status,
                    "channel": duplicate.channel,
                    "target_id": target_id,
                    "target_type": target_type,
                    "source": source,
                    "claim_url": duplicate.invite_url_path,
                    "claimed": bool(duplicate.claimed_at),
                }
            )
            continue

        invite = ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            contractor=contractor,
            directory_listing=listing,
            channel=channel,
            destination_phone=_safe_text(getattr(contractor, "phone", "")) or _safe_text(getattr(listing, "phone_number", "")),
            destination_email=_safe_text(getattr(contractor, "email", "")) or _safe_text(getattr(listing, "email", "")),
        )

        invite_message = (
            f"MyHomeBro: A homeowner near {summary.get('project_city') or summary.get('project_state') or 'your area'} selected "
            f"{getattr(contractor, 'business_name', '') or getattr(listing, 'business_name', '')} to review a "
            f"{summary.get('project_type') or 'project'} project."
        )
        claim_url = claim_link_base + f"/{invite.invite_token}"
        invite_url = claim_url
        note = ""

        if contractor is not None:
            lead = PublicContractorLead.objects.create(
                contractor=contractor,
                public_profile=profile or ensure_public_profile_for_contractor(contractor),
                source=PublicContractorLead.SOURCE_PUBLIC_PROFILE,
                full_name=(intake.customer_name or "Project Lead").strip(),
                email=(intake.customer_email or "").strip(),
                phone=(intake.customer_phone or "").strip(),
                project_address=" ".join(
                    part for part in [
                        intake.project_address_line1 or "",
                        intake.project_address_line2 or "",
                    ]
                    if part
                ).strip(),
                city=(intake.project_city or "").strip(),
                state=(intake.project_state or "").strip(),
                zip_code=(intake.project_postal_code or "").strip(),
                project_type=summary.get("project_type") or intake.accomplishment_text or "",
                project_description=project_brief or "",
                preferred_timeline=_safe_text(getattr(intake, "desired_timing_text", "")),
                budget_text=_safe_text(getattr(intake, "budget_range_text", "")),
                status=PublicContractorLead.STATUS_READY_FOR_REVIEW,
                ai_analysis={
                    **_safe_dict(getattr(intake, "ai_analysis_payload", None)),
                    "project_mode": summary.get("project_mode"),
                    "payment_preference": summary.get("payment_preference"),
                    "project_scope_summary": project_brief,
                },
            )
            create_notification(
                contractor=contractor,
                public_lead=lead,
                category="quote_request_received",
                title="New project request selected you",
                body=f"A homeowner selected your business to review a {summary.get('project_type') or 'project'} project.",
                link=f"/app/bids",
            )
            if contractor.email:
                send_postmark_email(
                    to_email=contractor.email,
                    subject="New project request near you on MyHomeBro",
                    text_body=(
                        f"A homeowner near {summary.get('project_city') or summary.get('project_state') or 'your area'} selected "
                        f"{getattr(contractor, 'business_name', '') or contractor.name or 'your profile'} to review a "
                        f"{summary.get('project_type') or 'project'} project.\n\n"
                        "Your business profile has been selected by a homeowner on MyHomeBro.\n"
                        f"Review the project:\n{invite_url}"
                    ),
                )
            if contractor.phone:
                send_twilio_sms(
                    to_phone=contractor.phone,
                    body=invite_message + f" View project details: {invite_url}",
                )
            invite.touch_sent()
            note = "claimed-contractor"
            claim_url = f"/app/bids"
        else:
            body_text = (
                f"A homeowner near {summary.get('project_city') or summary.get('project_state') or 'your area'} selected "
                f"{getattr(listing, 'business_name', '') or 'a local business'} to review a "
                f"{summary.get('project_type') or 'project'} project.\n\n"
                f"Claim your MyHomeBro profile:\n{claim_url}\n\n"
                "Reply STOP to opt out of SMS."
            )
            if channel == ContractorDiscoveryInvite.CHANNEL_SMS and listing.phone_number and not listing.sms_opt_out:
                ok, msg = send_twilio_sms(to_phone=listing.phone_number, body=body_text)
                invite.error_message = "" if ok else msg
                invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                invite.destination_phone = listing.phone_number
                invite.destination_email = ""
                invite.sent_at = timezone.now() if ok else None
            elif channel == ContractorDiscoveryInvite.CHANNEL_EMAIL and listing.email and not listing.email_opt_out:
                ok, msg = send_postmark_email(
                    to_email=listing.email,
                    subject="New project request near you on MyHomeBro",
                    text_body=body_text,
                )
                invite.error_message = "" if ok else msg
                invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                invite.destination_email = listing.email
                invite.destination_phone = ""
                invite.sent_at = timezone.now() if ok else None
            else:
                invite.status = ContractorDiscoveryInvite.STATUS_PENDING
                invite.error_message = "No supported contact channel available."
            invite.save(update_fields=["status", "error_message", "destination_phone", "destination_email", "sent_at", "updated_at"])
            note = "listing"

        created_rows.append(
            {
                "id": invite.id,
                "invite_token": str(invite.invite_token),
                "status": invite.status,
                "channel": invite.channel,
                "target_id": target_id,
                "target_type": target_type,
                "source": source,
                "claim_url": invite.invite_url_path,
                "claimed": bool(invite.claimed_at),
                "mode": note,
            }
        )

    return {
        "detail": "Invites sent." if created_rows else "No invites were created.",
        "created": created_rows,
        "invite_count": len(created_rows),
    }


def claim_discovery_invite(invite: ContractorDiscoveryInvite, *, contractor: Contractor | None = None) -> dict[str, Any]:
    if invite.directory_listing is None:
        return {
            "detail": "This invite does not map to a local listing.",
            "claimed": False,
        }

    listing = invite.directory_listing
    if contractor is None:
        contractor = listing.claimed_contractor
    if contractor is None:
        return {
            "detail": "A contractor account is required to claim this listing.",
            "claimed": False,
        }

    profile = ensure_public_profile_for_contractor(contractor)
    if not contractor.business_name and listing.business_name:
        contractor.business_name = listing.business_name
    if not contractor.phone and listing.phone_number:
        contractor.phone = listing.phone_number
    if not contractor.city and listing.city:
        contractor.city = listing.city
    if not contractor.state and listing.state:
        contractor.state = listing.state
    contractor.save(update_fields=["business_name", "phone", "city", "state", "updated_at"])

    listing.claimed_profile = True
    listing.claimed_contractor = contractor
    listing.save(update_fields=["claimed_profile", "claimed_contractor", "updated_at"])
    invite.contractor = contractor
    invite.response_at = timezone.now()
    invite.touch_claimed()

    intake = invite.public_intake
    attached_lead = None
    if intake is not None:
        attached_lead = PublicContractorLead.objects.create(
            contractor=contractor,
            public_profile=profile,
            source=PublicContractorLead.SOURCE_PUBLIC_PROFILE,
            full_name=(intake.customer_name or "Project Lead").strip(),
            email=(intake.customer_email or "").strip(),
            phone=(intake.customer_phone or "").strip(),
            project_address=" ".join(
                part for part in [
                    intake.project_address_line1 or "",
                    intake.project_address_line2 or "",
                ]
                if part
            ).strip(),
            city=(intake.project_city or "").strip(),
            state=(intake.project_state or "").strip(),
            zip_code=(intake.project_postal_code or "").strip(),
            project_type=_safe_text(intake.ai_project_type or intake.accomplishment_text),
            project_description=_safe_text(intake.ai_description or intake.accomplishment_text),
            preferred_timeline=_safe_text(getattr(intake, "desired_timing_text", "")),
            budget_text=_safe_text(getattr(intake, "budget_range_text", "")),
            status=PublicContractorLead.STATUS_READY_FOR_REVIEW,
            ai_analysis=_safe_dict(getattr(intake, "ai_analysis_payload", None)),
        )
        create_notification(
            contractor=contractor,
            public_lead=attached_lead,
            category="quote_request_received",
            title="You claimed a project request",
            body=f"You claimed {listing.business_name or 'a local business listing'} and can review the attached project.",
            link="/app/bids",
        )

    return {
        "detail": "Listing claimed successfully.",
        "claimed": True,
        "contractor_id": contractor.id,
        "listing_id": listing.id,
        "lead_id": getattr(attached_lead, "id", None),
        "onboarding_url": "/app/onboarding",
        "public_profile_url": contractor.public_profile_url,
    }
