from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import Contractor, ContractorPublicProfile, PublicContractorLead
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite
from projects.services.contractor_capabilities import get_contractor_capability_flags
from projects.services.contractor_matching import score_contractor_project_match
from projects.services.google_places_contractors import (
    calculate_distance_miles,
    geocode_project_location,
    infer_project_places_query,
    search_google_places_contractors_with_diagnostics,
    suggest_radius_miles,
)
from projects.services.contractor_directory import upsert_directory_entry_from_place
from projects.services.project_titles import is_home_addition_description, normalize_project_classification
from projects.services.notification_center import create_notification
from projects.services.public_lead_pipeline import ensure_public_profile_for_contractor
from projects.services.invites_delivery import send_postmark_email, send_twilio_sms

logger = logging.getLogger(__name__)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _has_value(value: Any) -> bool:
    return value not in (None, "", [])


def _normalize_postal_code(value: Any) -> str:
    text = _safe_text(value)
    if not text:
        return ""
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 5:
        return digits[:5]
    return text


def _location_metadata(
    *,
    project: dict[str, Any],
    latitude: Any = None,
    longitude: Any = None,
    source: str = "missing",
    status: str = "missing_project_location",
    reason: str = "",
    geocode_diagnostic: dict[str, Any] | None = None,
    geocode_attempt_count: int = 0,
    geocode_fallback_attempted: bool = False,
) -> dict[str, Any]:
    diagnostic = geocode_diagnostic or {}
    return {
        "location_filter_applied": _has_value(latitude) and _has_value(longitude),
        "location_resolution_status": status,
        "location_source": source,
        "project_lat_present": _has_value(latitude),
        "project_lng_present": _has_value(longitude),
        "search_center_city": project.get("project_city", ""),
        "search_center_state": project.get("project_state", ""),
        "search_center_zip": _normalize_postal_code(project.get("project_postal_code", "")),
        "search_center_zip_original": project.get("project_postal_code_original", project.get("project_postal_code", "")),
        "reason": reason,
        "geocode_status": diagnostic.get("status") or "",
        "geocode_error_message": diagnostic.get("error_message") or "",
        "geocode_candidate_used": diagnostic.get("candidate") or "",
        "geocode_from_cache": bool(diagnostic.get("from_cache")),
        "geocode_attempt_count": geocode_attempt_count,
        "geocode_fallback_attempted": geocode_fallback_attempted,
    }


def _resolve_project_location(*, intake=None, project: dict[str, Any], latitude: Any = None, longitude: Any = None) -> dict[str, Any]:
    if _has_value(latitude) and _has_value(longitude):
        return {
            **_location_metadata(
                project=project,
                latitude=latitude,
                longitude=longitude,
                source="intake_lat_lng",
                status="resolved",
                geocode_diagnostic={"from_cache": False},
            ),
            "latitude": latitude,
            "longitude": longitude,
        }

    saved_location = {}
    try:
        saved_location = (getattr(intake, "ai_analysis_payload", None) or {}).get("contractor_discovery_location") or {}
    except Exception:
        saved_location = {}
    saved_lat = saved_location.get("latitude")
    saved_lng = saved_location.get("longitude")
    if _has_value(saved_lat) and _has_value(saved_lng):
        return {
            **_location_metadata(
                project=project,
                latitude=saved_lat,
                longitude=saved_lng,
                source="intake_lat_lng",
                status="resolved",
                geocode_diagnostic={
                    "from_cache": True,
                    "status": "OK",
                    "candidate": saved_location.get("candidate", ""),
                    "error_message": "",
                },
            ),
            "latitude": saved_lat,
            "longitude": saved_lng,
        }

    candidates = []
    address_line1 = _safe_text(project.get("project_address_line1"))
    city = _safe_text(project.get("project_city"))
    state = _safe_text(project.get("project_state"))
    original_postal_code = _safe_text(project.get("project_postal_code"))
    postal_code = _normalize_postal_code(original_postal_code)
    if postal_code:
        project["project_postal_code"] = postal_code
        project["project_postal_code_original"] = original_postal_code
    if address_line1 and (city or state or postal_code):
        candidates.append(("project_address", {"address_line1": address_line1, "city": city, "state": state, "postal_code": postal_code}))
    if city and state and postal_code:
        candidates.append(("city_state_zip", {"address_line1": "", "city": city, "state": state, "postal_code": postal_code}))
    if city and state:
        candidates.append(("city_state", {"address_line1": "", "city": city, "state": state, "postal_code": ""}))
    if postal_code:
        candidates.append(("zip_only", {"address_line1": "", "city": "", "state": "", "postal_code": postal_code}))

    if not candidates:
        return {
            **_location_metadata(project=project, source="missing", status="missing_project_location", reason="missing_project_location"),
            "latitude": None,
            "longitude": None,
        }

    last_diagnostic: dict[str, Any] = {}
    attempt_count = 0
    for source, kwargs in candidates:
        attempt_count += 1
        geocoded = geocode_project_location(**kwargs)
        last_diagnostic = geocoded.get("diagnostic") or {}
        logger.info(
            "Contractor discovery geocode candidate result.",
            extra={
                "candidate": last_diagnostic.get("candidate"),
                "normalized_zip": last_diagnostic.get("normalized_zip"),
                "google_status": last_diagnostic.get("status"),
                "google_error_message": last_diagnostic.get("error_message"),
                "from_cache": bool(last_diagnostic.get("from_cache")),
                "fallback_candidates_attempted": attempt_count - 1,
            },
        )
        lat = geocoded.get("latitude")
        lng = geocoded.get("longitude")
        if _has_value(lat) and _has_value(lng):
            if intake is not None:
                try:
                    analysis = dict(getattr(intake, "ai_analysis_payload", None) or {})
                    analysis["contractor_discovery_location"] = {
                        "latitude": lat,
                        "longitude": lng,
                        "source": source,
                        "candidate": last_diagnostic.get("candidate", ""),
                    }
                    intake.ai_analysis_payload = analysis
                    intake.save(update_fields=["ai_analysis_payload", "updated_at"])
                except Exception:
                    logger.exception("Could not persist contractor discovery geocode result.")
            return {
                **_location_metadata(
                    project=project,
                    latitude=lat,
                    longitude=lng,
                    source=source,
                    status="resolved",
                    geocode_diagnostic={**last_diagnostic, "from_cache": False},
                    geocode_attempt_count=attempt_count,
                    geocode_fallback_attempted=attempt_count > 1,
                ),
                "latitude": lat,
                "longitude": lng,
            }

    failed_status = _safe_text(last_diagnostic.get("status"))
    failed_error_type = _safe_text(last_diagnostic.get("error_type"))
    failed_reason = "geocode_failed"
    if failed_status in {"ZERO_RESULTS", "INVALID_REQUEST", "REQUEST_DENIED", "OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "UNKNOWN_ERROR"}:
        failed_reason = failed_status
    elif failed_error_type == "system" and failed_status:
        failed_reason = failed_status
    return {
        **_location_metadata(
            project=project,
            source=candidates[-1][0],
            status="geocode_failed",
            reason=failed_reason,
            geocode_diagnostic=last_diagnostic,
            geocode_attempt_count=attempt_count,
            geocode_fallback_attempted=attempt_count > 1,
        ),
        "latitude": None,
        "longitude": None,
    }


def _broader_contractor_queries(query: str) -> list[str]:
    text = _safe_text(query).lower()
    if "floor" in text:
        return ["flooring contractor", "floor installation contractor", "flooring company"]
    if "concrete" in text or "patio" in text:
        return ["concrete contractor", "patio contractor", "hardscape contractor", "masonry contractor"]
    if "cabinet" in text or "countertop" in text or "kitchen" in text:
        return ["kitchen remodeling contractor", "cabinet installer", "countertop installer"]
    first = _safe_text(query)
    return [first] if first else []


CONCRETE_PATIO_PROJECT_TERMS = {
    "patio",
    "concrete",
    "slab",
    "driveway",
    "walkway",
    "hardscape",
    "masonry",
    "paver",
    "pavers",
    "cement",
}

CONCRETE_PATIO_MATCH_TERMS = {
    "patio",
    "concrete",
    "cement",
    "slab",
    "driveway",
    "walkway",
    "hardscape",
    "masonry",
    "mason",
    "paver",
    "pavers",
    "outdoor living",
    "deck",
    "decking",
}

ROOFING_TRADE_TERMS = {
    "roof",
    "roofing",
    "roofer",
    "shingle",
    "shingles",
    "flashing",
    "underlayment",
}


def _contains_any(text: str, terms: set[str]) -> bool:
    normalized = _safe_text(text).lower().replace("_", " ")
    for term in terms:
        cleaned = _safe_text(term).lower().replace("_", " ")
        if not cleaned:
            continue
        if " " in cleaned:
            if cleaned in normalized:
                return True
            continue
        if re.search(rf"\b{re.escape(cleaned)}\b", normalized):
            return True
    return False


def _project_trade_family(project: dict[str, Any]) -> str:
    text = " ".join(
        _safe_text(value).lower().replace("_", " ")
        for value in [
            project.get("project_type"),
            project.get("project_subtype"),
            project.get("project_title"),
            project.get("description"),
            project.get("project_scope_summary"),
        ]
        if _safe_text(value)
    )
    has_roof = _contains_any(text, ROOFING_TRADE_TERMS)
    has_concrete_patio = _contains_any(text, CONCRETE_PATIO_PROJECT_TERMS)
    # "concrete tile roof" and actual roofing scopes should stay roofing. Patio
    # slabs, driveway/walkway, hardscape, and masonry should not drift to roofing.
    if has_roof and not has_concrete_patio:
        return "roofing"
    if has_concrete_patio:
        return "concrete_patio"
    if has_roof:
        return "roofing"
    if "exterior" in text:
        return "broad_exterior"
    return ""


def _score_trade_family_alignment(project: dict[str, Any], contractor_text: str) -> tuple[int, list[str]]:
    family = _project_trade_family(project)
    text = _safe_text(contractor_text).lower().replace("_", " ")
    if family == "concrete_patio":
        if _contains_any(text, CONCRETE_PATIO_MATCH_TERMS):
            return 35, ["Patio, concrete, hardscape, or outdoor-living trade aligns with the request."]
        if _contains_any(text, ROOFING_TRADE_TERMS):
            return -75, ["Roofing trade does not match this patio/concrete request."]
    if family == "roofing":
        if _contains_any(text, ROOFING_TRADE_TERMS):
            return 28, ["Roofing trade aligns with the request."]
        if _contains_any(text, CONCRETE_PATIO_MATCH_TERMS):
            return -18, ["Concrete/patio trade is adjacent but not a roofing match."]
    return 0, []


def _sanitize_search_query_for_project(query: str, project: dict[str, Any]) -> str:
    classification = " ".join(
        _safe_text(project.get(key)).lower()
        for key in ["project_type", "project_subtype", "project_title"]
        if _safe_text(project.get(key))
    )
    full_text = " ".join(
        _safe_text(value).lower()
        for value in [
            classification,
            project.get("description"),
            project.get("project_scope_summary"),
            query,
        ]
        if _safe_text(value)
    )
    description_text = " ".join(
        _safe_text(value).lower()
        for value in [project.get("description"), project.get("project_scope_summary")]
        if _safe_text(value)
    )
    if is_home_addition_description(description_text):
        return "home addition contractor"
    source = classification or full_text
    if any(term in source for term in ["floor", "flooring", "hardwood", "laminate", "vinyl", "tile"]):
        return "flooring installation contractor" if any(term in full_text for term in ["install", "installation"]) else "flooring contractor"
    if any(term in source for term in ["patio", "concrete", "slab", "driveway", "walkway", "masonry", "hardscape", "paver"]):
        if any(term in full_text for term in ["masonry", "brick", "stone", "block"]):
            return "masonry contractor"
        if "patio" in full_text and any(term in full_text for term in ["concrete", "slab", "driveway", "walkway", "cement"]):
            return "concrete contractor patio contractor hardscape contractor"
        if "patio" in full_text:
            return "patio contractor concrete contractor hardscape contractor"
        if any(term in full_text for term in ["hardscape", "paver", "pavers", "retaining wall"]):
            return "hardscape contractor patio contractor masonry contractor"
        return "concrete contractor"
    if any(term in source for term in ["kitchen", "cabinet", "countertop", "quartz", "granite"]):
        if "cabinet" in full_text:
            return "cabinet installer"
        if any(term in full_text for term in ["countertop", "quartz", "granite"]):
            return "countertop installer"
        return "kitchen remodeling contractor"
    if any(term in source for term in ["electrical", "electrician", "panel", "wiring"]):
        return "electrician"
    if any(term in source for term in ["plumbing", "plumber", "pipe", "drain", "sewer"]):
        return "plumber"
    if any(term in source for term in ["hvac", "air conditioning", "cooling", "heating", "furnace"]):
        return "hvac contractor"
    return _safe_text(query)


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
        "project_city": _safe_text(payload.get("project_city") or getattr(intake, "project_city", "") or getattr(intake, "customer_city", "")),
        "project_state": _safe_text(payload.get("project_state") or getattr(intake, "project_state", "") or getattr(intake, "customer_state", "")),
        "project_postal_code": _safe_text(payload.get("project_postal_code") or getattr(intake, "project_postal_code", "") or getattr(intake, "customer_postal_code", "")),
        "project_address_line1": _safe_text(payload.get("project_address_line1") or getattr(intake, "project_address_line1", "") or getattr(intake, "customer_address_line1", "")),
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
        accepts_inspection_only=False,
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
    listing_text = " ".join(
        [
            _safe_text(listing.primary_trade),
            " ".join(listing.trade_categories or []),
            _safe_text(listing.business_name),
            _safe_text(listing.formatted_address),
        ]
    )
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

    family_delta, family_reasons = _score_trade_family_alignment(project, listing_text)
    score += family_delta
    reasons.extend(family_reasons)

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
    capability_flags = get_contractor_capability_flags(contractor)
    match = score_contractor_project_match(contractor, project, profile=profile)
    contractor_text = " ".join(
        [
            _safe_text(getattr(contractor, "business_name", "")),
            _safe_text(getattr(contractor, "name", "")),
            _safe_text(getattr(profile, "tagline", "")),
            _safe_text(getattr(profile, "bio", "")),
            _safe_text(getattr(profile, "service_area_text", "")),
            " ".join(getattr(profile, "specialties", []) or []),
            " ".join(getattr(profile, "work_types", []) or []),
            " ".join(getattr(skill, "name", "") for skill in getattr(contractor, "skills", []).all()),
        ]
    )
    family_delta, family_reasons = _score_trade_family_alignment(project, contractor_text)
    if family_delta:
        adjusted_score = max(0, min(100, int(match.get("score", 0) or 0) + family_delta))
        match = {
            **match,
            "score": adjusted_score,
            "reasons": list(dict.fromkeys([*(match.get("reasons") or []), *family_reasons])),
            "tier": "Strong Match" if adjusted_score >= 75 else "Good Match" if adjusted_score >= 45 else "Limited Match",
        }
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
    phone = ""
    if getattr(profile, "show_phone_public", False):
        phone = _safe_text(profile.phone_public or getattr(contractor, "phone", ""))
    email = ""
    if getattr(profile, "show_email_public", False):
        email = _safe_text(profile.email_public or getattr(contractor, "email", "") or getattr(getattr(contractor, "user", None), "email", ""))
    address_parts = [
        _safe_text(profile.city or contractor.city),
        _safe_text(profile.state or contractor.state),
    ]
    is_verified = getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED
    is_preferred = bool(getattr(contractor, "marketplace_preferred", False) and is_verified)
    return {
        "id": f"contractor:{contractor.id}",
        "source": ContractorDirectoryListing.SOURCE_MYHOMEBRO,
        "business_name": profile.business_name_public or contractor.business_name or contractor.name or "",
        "claimed": claimed,
        "label": "Profile Reviewed" if is_verified else "Claimed Contractor",
        "source_label": "Profile Reviewed" if is_verified else "Claimed Contractor",
        "contractor_verified": is_verified,
        "contractor_preferred": is_preferred,
        "rating": round(float(getattr(contractor, "average_rating", 0) or 0), 2) if getattr(contractor, "review_count", 0) else None,
        "review_count": int(getattr(contractor, "review_count", 0) or 0),
        "website_url": _safe_text(getattr(profile, "website_url", "")),
        "phone": phone,
        "email": email,
        "public_email": email,
        "city": profile.city or contractor.city or "",
        "state": profile.state or contractor.state or "",
        "zip_code": "",
        "address": ", ".join(part for part in address_parts if part),
        "formatted_address": ", ".join(part for part in address_parts if part),
        "location": {
            "city": profile.city or contractor.city or "",
            "state": profile.state or contractor.state or "",
            "zip_code": "",
            "latitude": None,
            "longitude": None,
        },
        "distance_miles": distance_miles,
        "phone_available": bool(phone),
        "email_available": bool(email),
        "invite_available": True,
        "recommendation_tier": match.get("tier", "Limited Match"),
        "compatibility_score": match.get("score", 0),
        "recommendation_reasons": list(match.get("reasons") or []),
        "match_reason": "; ".join(list(match.get("reasons") or [])[:2]),
        "match_badges": list(match.get("badges") or [])[:4],
        "supported_project_modes": [
            "full_service",
            *(
                ["assisted_diy"]
                if capability_flags["accepts_diy_assistance"]
                else []
            ),
            *(
                ["consultation"]
                if capability_flags["accepts_consultation"]
                else []
            ),
            *(
                ["inspection_only"]
                if capability_flags["accepts_inspection_only"]
                else []
            ),
        ],
        "escrow_friendly": bool(match.get("compatibility_profile", {}).get("escrow_friendly", False) or getattr(profile, "show_quote_cta", False)),
        "assisted_diy_friendly": bool(capability_flags["accepts_diy_assistance"]),
        "inspection_capable": bool(capability_flags["accepts_inspection_only"] or match.get("compatibility_profile", {}).get("inspection_capable")),
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
            card["label"] = "Profile Reviewed" if card.get("contractor_verified") else "Claimed Contractor"
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
    phone = _safe_text(listing.phone_number)
    email = _safe_text(listing.email)
    address = _safe_text(listing.formatted_address) or ", ".join(
        part for part in [_safe_text(listing.city), _safe_text(listing.state), _safe_text(listing.zip_code)] if part
    )

    return {
        "id": f"listing:{listing.id}",
        "source": listing.source,
        "business_name": listing.business_name or listing.normalized_business_name or "",
        "claimed": bool(listing.claimed_profile and listing.claimed_contractor_id),
        "label": "Local Business Listing",
        "source_label": "Local Business Listing",
        "contractor_verified": False,
        "contractor_preferred": False,
        "rating": listing.google_rating,
        "review_count": int(listing.google_review_count or 0),
        "website_url": _safe_text(listing.website_url),
        "phone": phone,
        "email": email,
        "public_email": email,
        "city": listing.city or "",
        "state": listing.state or "",
        "zip_code": listing.zip_code or "",
        "address": address,
        "formatted_address": address,
        "location": {
            "city": listing.city or "",
            "state": listing.state or "",
            "zip_code": listing.zip_code or "",
            "latitude": listing.latitude,
            "longitude": listing.longitude,
        },
        "distance_miles": distance_miles,
        "phone_available": bool(phone),
        "email_available": bool(email),
        "invite_available": bool(phone or email or bool(listing.claimed_contractor_id)),
        "recommendation_tier": match.get("tier", "Limited Match"),
        "compatibility_score": match.get("score", 0),
        "recommendation_reasons": list(match.get("reasons") or []),
        "match_reason": "; ".join(list(match.get("reasons") or [])[:2]),
        "match_badges": list(match.get("reasons") or [])[:4],
        "supported_project_modes": supported_modes,
        "escrow_friendly": bool(match.get("escrow_friendly", False)),
        "assisted_diy_friendly": bool(match.get("assisted_diy_friendly", False)),
        "inspection_capable": bool(match.get("inspection_capable", False)),
        "rescue_project_friendly": bool(match.get("rescue_project_friendly", False)),
        "compatibility_profile": {
            "tier": match.get("tier", "Limited Match"),
            "summary": "Local business listing discovered through MyHomeBro.",
            "badges": [
                "Escrow Workflow Compatible" if match.get("escrow_friendly") else None,
                "Inspection Services Available" if match.get("inspection_capable") else None,
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
    limit: int = 40,
) -> dict[str, Any]:
    project = _normalize_project_payload(intake=intake, payload=payload)
    normalized_classification = normalize_project_classification(
        project_type=project.get("project_type"),
        project_subtype=project.get("project_subtype"),
        description=project.get("description"),
        refined_description=project.get("project_scope_summary"),
    )
    if normalized_classification.get("project_type"):
        project["project_type"] = normalized_classification["project_type"]
        project["project_subtype"] = normalized_classification.get("project_subtype", "")
    search_query = _safe_text(query) or infer_project_places_query(
        project_type=project.get("project_type"),
        project_subtype=project.get("project_subtype"),
        project_title=project.get("project_title"),
        description=project.get("description"),
        project_scope_summary=project.get("project_scope_summary"),
    )
    search_query = _sanitize_search_query_for_project(search_query, project)
    try:
        requested_radius = int(float(radius_miles or 25))
    except Exception:
        requested_radius = 25
    radius = requested_radius if requested_radius in {5, 10, 15, 25, 50, 100} else 25
    location_meta = _resolve_project_location(intake=intake, project=project, latitude=latitude, longitude=longitude)
    latitude = location_meta.get("latitude")
    longitude = location_meta.get("longitude")
    if _has_value(latitude) and _has_value(longitude):
        project["latitude"] = latitude
        project["longitude"] = longitude
    project_state = _safe_text(project.get("project_state")).lower()

    has_project_location = _has_value(latitude) and _has_value(longitude)
    logger.info(
        "Contractor discovery location context.",
        extra={
            "intake_id": getattr(intake, "id", None),
            "intake_token": str(getattr(intake, "share_token", ""))[:8] if getattr(intake, "share_token", "") else "",
            "query": search_query,
            "location_source": location_meta.get("location_source"),
            "project_city": project.get("project_city"),
            "project_state": project.get("project_state"),
            "project_postal_code": project.get("project_postal_code"),
            "has_latitude": _has_value(latitude),
            "has_longitude": _has_value(longitude),
        },
    )
    if not has_project_location:
        summary = {
            "search_query": search_query,
            "radius_miles": radius,
            **{key: value for key, value in location_meta.items() if key not in {"latitude", "longitude"}},
            "filtered_out_of_radius_count": 0,
            "google_raw_count": 0,
            "after_distance_filter_count": 0,
            "missing_coordinates_count": 0,
            "project_mode": project.get("project_mode", "full_service"),
            "payment_preference": project.get("payment_preference", "escrow"),
            "results_count": 0,
            "external_results_count": 0,
            "external_search": {
                "source": "google_places",
                "configured": bool(getattr(settings, "GOOGLE_PLACES_API_KEY", "") or getattr(settings, "GOOGLE_MAPS_API_KEY", "")),
                "requested": False,
                "results_count": 0,
                "error": location_meta.get("reason") or location_meta.get("location_resolution_status"),
            },
        }
        logger.info(
            "Contractor discovery returned no results before search.",
            extra={
                "intake_id": getattr(intake, "id", None),
                "query": search_query,
                "location_source": location_meta.get("location_source"),
                "empty_reason": summary.get("reason"),
            },
        )
        return {"summary": summary, "results": []}

    results: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    # Build keyword stems from search_query for trade-relevance filtering of cached listings.
    # We use 4-char stems so "electrician"→"elec" matches "electrical", "plumb" matches "plumbing", etc.
    _search_stems: list[str] = []
    if search_query:
        for _w in search_query.lower().replace("_", " ").split():
            _w = "".join(ch for ch in _w if ch.isalnum())
            if len(_w) >= 4:
                _search_stems.append(_w[:4])

    for contractor, profile in _iter_contractors_for_public_profiles():
        card = _build_card_from_contractors(contractor, profile, project)
        if project_state and _safe_text(card.get("state")).lower() and _safe_text(card.get("state")).lower() != project_state:
            continue
        if card.get("distance_miles") is not None and float(card.get("distance_miles")) > radius:
            continue
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    for listing in ContractorDirectoryListing.objects.all().order_by("-claimed_profile", "-google_review_count", "-google_rating", "business_name")[:100]:
        card = _build_card_from_listing(listing, project)
        if project_state and _safe_text(card.get("state")).lower() and _safe_text(card.get("state")).lower() != project_state:
            continue
        if not card.get("claimed") and card.get("distance_miles") is None:
            continue
        if card.get("distance_miles") is not None and float(card.get("distance_miles")) > radius:
            continue
        # Filter unclaimed cached listings by trade relevance to the search query.
        if not card.get("claimed") and _search_stems:
            _trade_text = " ".join([
                _safe_text(listing.primary_trade).replace("_", " "),
                " ".join(listing.trade_categories or []).replace("_", " "),
                _safe_text(listing.business_name),
            ]).lower()
            if not any(stem in _trade_text for stem in _search_stems):
                continue
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    google_search = search_google_places_contractors_with_diagnostics(
        project_type=project.get("project_type"),
        project_subtype=project.get("project_subtype"),
        query=search_query,
        latitude=latitude,
        longitude=longitude,
        radius_miles=radius,
        limit=max(limit, 20),
        enforce_radius=True,
    )
    google_diag = google_search.get("diagnostic") or {}
    if not google_search.get("results") and int(google_diag.get("google_raw_count") or 0) <= 0:
        attempted_queries = {_safe_text(search_query).lower()}
        retried = False
        for fallback_query in _broader_contractor_queries(search_query):
            if not fallback_query or fallback_query.lower() in attempted_queries:
                continue
            if retried:
                break
            retried = True
            attempted_queries.add(fallback_query.lower())
            retry_search = search_google_places_contractors_with_diagnostics(
                project_type=project.get("project_type"),
                project_subtype=project.get("project_subtype"),
                query=fallback_query,
                latitude=latitude,
                longitude=longitude,
                radius_miles=radius,
                limit=max(limit, 20),
                enforce_radius=True,
            )
            retry_diag = retry_search.get("diagnostic") or {}
            google_diag["google_raw_count"] = int(google_diag.get("google_raw_count") or 0) + int(retry_diag.get("google_raw_count") or 0)
            google_diag["pre_distance_filter_count"] = int(google_diag.get("pre_distance_filter_count") or 0) + int(retry_diag.get("pre_distance_filter_count") or 0)
            google_diag["filtered_out_of_radius_count"] = int(google_diag.get("filtered_out_of_radius_count") or 0) + int(retry_diag.get("filtered_out_of_radius_count") or 0)
            google_diag["filtered_unknown_location_count"] = int(google_diag.get("filtered_unknown_location_count") or 0) + int(retry_diag.get("filtered_unknown_location_count") or 0)
            google_diag["missing_coordinates_count"] = int(google_diag.get("missing_coordinates_count") or 0) + int(retry_diag.get("missing_coordinates_count") or 0)
            google_diag["after_distance_filter_count"] = int(google_diag.get("after_distance_filter_count") or 0) + int(retry_diag.get("after_distance_filter_count") or 0)
            if retry_search.get("results"):
                google_search = retry_search
                google_diag = {**google_diag, **(retry_search.get("diagnostic") or {}), "fallback_query": fallback_query}
                break
    google_places = google_search.get("results") or []
    capture_context = {
        "source_type": "public_intake" if intake is not None else "unknown",
        "search_term": search_query,
        "project_type": project.get("project_type"),
        "project_subtype": project.get("project_subtype"),
        "search_city": project.get("project_city"),
        "search_state": project.get("project_state"),
        "search_zip": project.get("project_postal_code"),
        "radius_miles": radius,
        "intake_request": intake,
        "selected_by_homeowner": False,
    }
    for place in google_places:
        if place.get("distance_miles") is None:
            continue
        upsert_directory_entry_from_place(place, context=capture_context)
        listing = upsert_directory_listing_from_google(place)
        if listing is None:
            continue
        card = _build_card_from_listing(listing, project)
        if card.get("distance_miles") is None or float(card.get("distance_miles")) > radius:
            continue
        key = card["id"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(card)

    results.sort(
        key=lambda row: (
            -int(row.get("compatibility_score", 0)),
            -int(bool(row.get("claimed"))),
            -int(row.get("source_priority", 0)),
            float(row.get("distance_miles") if row.get("distance_miles") is not None else 9999),
            -(float(row.get("rating") or 0) * 10),
            row.get("business_name", ""),
        )
    )
    max_results = max(limit, 1)
    local_results = [row for row in results if row.get("label") == "Local Business Listing"]
    sliced_results = results[:max_results]
    if local_results and not any(row.get("label") == "Local Business Listing" for row in sliced_results) and max_results > 1:
        sliced_results = sliced_results[: max_results - 1] + [local_results[0]]
    results = sliced_results
    google_diag = google_diag or google_search.get("diagnostic") or {}
    google_raw_count = int(google_diag.get("google_raw_count") or google_diag.get("pre_distance_filter_count") or 0)
    after_distance_filter_count = int(google_diag.get("after_distance_filter_count") or google_diag.get("results_count") or 0)
    missing_coordinates_count = int(google_diag.get("missing_coordinates_count") or google_diag.get("filtered_unknown_location_count") or 0)
    filtered_out_of_radius_count = int(google_diag.get("filtered_out_of_radius_count") or 0)
    empty_reason = ""
    if not results:
        if google_diag.get("error") == "missing_project_location":
            empty_reason = "missing_project_location"
        elif google_raw_count <= 0:
            empty_reason = "google_returned_zero"
        elif missing_coordinates_count >= google_raw_count:
            empty_reason = "all_results_missing_coordinates"
        elif filtered_out_of_radius_count > 0:
            empty_reason = "all_results_outside_radius"
        else:
            empty_reason = google_diag.get("empty_reason") or "google_returned_zero"

    summary = {
        "search_query": search_query,
        "radius_miles": radius,
        **{key: value for key, value in location_meta.items() if key not in {"latitude", "longitude"}},
        "google_raw_count": google_raw_count,
        "after_distance_filter_count": after_distance_filter_count,
        "filtered_out_of_radius_count": filtered_out_of_radius_count,
        "missing_coordinates_count": missing_coordinates_count,
        "reason": empty_reason,
        "project_mode": project.get("project_mode", "full_service"),
        "payment_preference": project.get("payment_preference", "escrow"),
        "results_count": len(results),
        "external_results_count": len(local_results),
        "external_search": {
            "source": "google_places",
            "configured": bool(google_diag.get("configured")),
            "requested": bool(google_diag.get("requested")),
            "results_count": int(google_diag.get("results_count") or 0),
            "error": google_diag.get("error") or "",
            "http_status": google_diag.get("http_status") or google_diag.get("text_status"),
            "response_body": google_diag.get("response_body") or "",
            "request_payload_debug": google_diag.get("request_payload_debug") or {},
        },
    }
    logger.info(
        "Contractor discovery search completed.",
        extra={
            "intake_id": getattr(intake, "id", None),
            "intake_token": str(getattr(intake, "share_token", ""))[:8] if getattr(intake, "share_token", "") else "",
            "query": search_query,
            "location_source": summary.get("location_source"),
            "has_latitude": summary.get("project_lat_present"),
            "has_longitude": summary.get("project_lng_present"),
            "google_raw_count": google_raw_count,
            "after_distance_filter_count": after_distance_filter_count,
            "filtered_out_of_radius_count": filtered_out_of_radius_count,
            "missing_coordinates_count": missing_coordinates_count,
            "empty_reason": empty_reason,
        },
    )
    if getattr(settings, "DEBUG", False):
        summary["external_search_diagnostic"] = google_search.get("diagnostic") or {}

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
