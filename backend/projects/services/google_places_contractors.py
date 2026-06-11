from __future__ import annotations

import math
import logging
from typing import Any

import requests
from django.conf import settings
from projects.services.project_titles import is_home_addition_description
from projects.services.contractor_trade_relevance import contractor_entity_excluded, project_trade_intent

logger = logging.getLogger(__name__)


PROJECT_TYPE_QUERY_MAP = {
    "pool": "pool contractor pool builder pool service company",
    "appliance": "appliance repair contractor",
    "roofing": "roofing contractor",
    "plumbing": "plumber",
    "electrical": "electrician",
    "hvac": "hvac contractor",
    "painting": "painter",
    "flooring": "flooring contractor",
    "drywall": "drywall contractor",
    "remodeling": "remodeling contractor",
    "general": "general contractor",
    "patio": "patio contractor",
    "concrete": "concrete contractor",
    "hardscape": "hardscape contractor",
    "masonry": "masonry contractor",
    "driveway": "concrete contractor",
    "walkway": "concrete contractor",
}

PROJECT_CONTEXT_QUERY_HINTS = [
    (("patio", "concrete slab", "slab", "driveway", "walkway", "hardscape", "masonry", "paver", "pavers"), "concrete contractor"),
    (("patio", "patio extension", "patio repair", "paver", "pavers"), "patio contractor"),
    (("masonry", "brick", "stone", "block"), "masonry contractor"),
    (("hardscape", "retaining wall", "outdoor living"), "hardscape contractor"),
    (("kitchen", "remodel", "renovation"), "kitchen remodeling contractor"),
    (("cabinet", "cabinets", "cabinetry"), "cabinet installer"),
    (("countertop", "countertops", "quartz", "granite"), "countertop installer"),
    (("bathroom", "vanity", "shower", "tub"), "bathroom remodel contractor"),
    (("roof", "roofing", "shingle", "leak"), "roofing contractor"),
    (("floor", "flooring", "tile", "hardwood", "laminate"), "flooring contractor"),
    (("paint", "painting", "painter"), "painter"),
    (("electrical", "electrician", "panel", "wire", "wiring"), "electrician"),
    (("plumbing", "plumber", "pipe", "drain", "sewer"), "plumber"),
    (("hvac", "air conditioning", "ac ", " furnace", "cooling", "heating"), "hvac contractor"),
    (("drywall", "sheetrock"), "drywall contractor"),
    (("remodel", "renovation", "renovate"), "remodeling contractor"),
]

EXCLUDED_CONTRACTOR_KEYWORDS = {
    "electrician",
    "electrical",
    "plumbing",
    "plumber",
    "hvac",
    "heating",
    "air conditioning",
    "air_conditioning",
    "roofing",
    "roofer",
    "solar",
}

CONCRETE_PATIO_KEYWORDS = {
    "patio",
    "concrete",
    "masonry",
    "hardscape",
    "driveway",
    "walkway",
    "paver",
    "pavers",
    "slab",
}

PROJECT_RADIUS_MAP = {
    "handyman": 10,
    "small": 10,
    "repair": 15,
    "consultation": 20,
    "inspection": 20,
    "roofing": 35,
    "foundation": 40,
    "specialist": 40,
    "commercial": 50,
}


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def google_places_api_key() -> str:
    return (
        getattr(settings, "GOOGLE_PLACES_API_KEY", "").strip()
        or getattr(settings, "GOOGLE_MAPS_API_KEY", "").strip()
    )


def project_type_to_places_query(project_type: Any, project_subtype: Any = "") -> str:
    text = _safe_text(project_type).lower()
    subtype = _safe_text(project_subtype).lower()
    intent = project_trade_intent(text, subtype)
    if intent:
        return intent.query
    if "outdoor living" in text and any(term in subtype for term in ["patio", "hardscape", "paver"]):
        return "patio contractor concrete contractor hardscape contractor"
    for key, query in PROJECT_TYPE_QUERY_MAP.items():
        if key in text or key in subtype:
            return query
    if text and len(text.split()) <= 4:
        return f"{text} contractor"
    if subtype:
        return f"{subtype} contractor"
    return "contractor"


def infer_project_places_query(
    *,
    project_type: Any = "",
    project_subtype: Any = "",
    project_title: Any = "",
    description: Any = "",
    project_scope_summary: Any = "",
) -> str:
    base_query = project_type_to_places_query(project_type, project_subtype)
    text = " ".join(
        [
            _safe_text(project_type),
            _safe_text(project_subtype),
            _safe_text(project_title),
            _safe_text(description),
            _safe_text(project_scope_summary),
        ]
    ).lower()
    if not text.strip():
        return base_query

    if is_home_addition_description(description, project_scope_summary):
        return "home addition contractor"
    intent = project_trade_intent(project_type, project_subtype, project_title, description, project_scope_summary)
    if intent:
        return intent.query
    if any(term in text for term in ["floor", "flooring", "hardwood", "laminate", "vinyl", "tile"]):
        return "flooring installation contractor" if any(term in text for term in ["install", "installation"]) else "flooring contractor"
    if any(term in text for term in ["electrical", "electrician", "panel", "wiring"]):
        return "electrician"
    if any(term in text for term in ["plumbing", "plumber", "pipe", "drain", "sewer"]):
        return "plumber"
    if any(term in text for term in ["roof", "roofing", "shingle", "leak"]):
        return "roofing contractor"
    if any(term in text for term in ["patio", "concrete", "slab", "driveway", "walkway", "masonry", "hardscape", "paver"]):
        if any(term in text for term in ["masonry", "brick", "stone", "block"]):
            return "masonry contractor"
        if "patio" in text and any(term in text for term in ["concrete", "slab", "driveway", "walkway", "cement"]):
            return "concrete contractor patio contractor hardscape contractor"
        if "patio" in text:
            return "patio contractor concrete contractor hardscape contractor"
        if any(term in text for term in ["hardscape", "paver", "pavers", "retaining wall"]):
            return "hardscape contractor patio contractor masonry contractor"
        return "concrete contractor"
    if any(term in text for term in ["kitchen", "cabinet", "countertop", "quartz", "granite"]):
        if any(term in text for term in ["countertop", "quartz", "granite"]):
            return "countertop installer"
        if "cabinet" in text:
            return "cabinet installer"
        return "kitchen remodeling contractor"

    hints: list[str] = []
    for keywords, query in PROJECT_CONTEXT_QUERY_HINTS:
        if any(keyword in text for keyword in keywords):
            if query not in hints:
                hints.append(query)

    if not hints:
        return base_query

    if base_query and base_query != "contractor" and base_query not in hints:
        hints.insert(0, base_query)

    return " ".join(hints[:3]).strip() or base_query


def suggest_radius_miles(project_type: Any = "", project_subtype: Any = "", project_mode: Any = "") -> int:
    text = " ".join([_safe_text(project_type), _safe_text(project_subtype), _safe_text(project_mode)]).lower()
    for key, radius in PROJECT_RADIUS_MAP.items():
        if key in text:
            return radius
    return 25


def _radius_meters(radius_miles: Any) -> int:
    try:
        miles = max(float(radius_miles or 0), 1.0)
    except Exception:
        miles = 25.0
    return int(round(miles * 1609.34))


def _haversine_miles(lat1, lng1, lat2, lng2) -> float | None:
    try:
        lat1 = float(lat1)
        lng1 = float(lng1)
        lat2 = float(lat2)
        lng2 = float(lng2)
    except Exception:
        return None

    r = 3958.8
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(r * c, 1)


def is_concrete_or_patio_context(*values: Any) -> bool:
    text = " ".join(_safe_text(value).lower() for value in values)
    return any(keyword in text for keyword in CONCRETE_PATIO_KEYWORDS)


def _place_text(place: dict[str, Any]) -> str:
    display_name = place.get("displayName") or {}
    name = display_name.get("text") if isinstance(display_name, dict) else display_name
    types = place.get("types") if isinstance(place.get("types"), list) else []
    values = [
        name,
        place.get("formattedAddress"),
        place.get("primaryType"),
        " ".join(types),
    ]
    return " ".join(_safe_text(value).lower().replace("_", " ") for value in values)


def should_exclude_place_for_context(place: dict[str, Any], *, concrete_or_patio_context: bool = False) -> bool:
    text = _place_text(place)
    if contractor_entity_excluded(text):
        return True
    if not concrete_or_patio_context:
        return False
    return any(keyword in text for keyword in EXCLUDED_CONTRACTOR_KEYWORDS)


def geocode_project_location(
    *,
    address_line1: Any = "",
    city: Any = "",
    state: Any = "",
    postal_code: Any = "",
) -> dict[str, Any]:
    api_key = google_places_api_key()
    normalized_postal_code = "".join(ch for ch in _safe_text(postal_code) if ch.isdigit())[:5] or _safe_text(postal_code)
    address = ", ".join(
        part
        for part in [_safe_text(address_line1), _safe_text(city), _safe_text(state), normalized_postal_code]
        if part
    )
    diagnostic = {
        "configured": bool(api_key),
        "requested": False,
        "http_status": None,
        "status": None,
        "error": "",
        "error_message": "",
        "candidate": address,
        "normalized_zip": normalized_postal_code,
        "from_cache": False,
        "error_type": "",
    }
    if not api_key or not address:
        diagnostic["error"] = "google_geocode_api_key_missing" if not api_key else "missing_address"
        diagnostic["status"] = diagnostic["error"]
        diagnostic["error_type"] = "system" if not api_key else "user"
        return {"latitude": None, "longitude": None, "diagnostic": diagnostic}

    try:
        diagnostic["requested"] = True
        logger.info(
            "Google geocode candidate attempted.",
            extra={"candidate": address, "normalized_zip": normalized_postal_code, "from_cache": False},
        )
        response = requests.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": address, "key": api_key},
            timeout=10,
        )
        diagnostic["http_status"] = response.status_code
        if not (200 <= response.status_code < 300):
            diagnostic["error"] = f"geocode_http_{response.status_code}"
            diagnostic["status"] = diagnostic["error"]
            diagnostic["error_type"] = "system"
            logger.warning(
                "Google geocode HTTP request failed.",
                extra={"http_status": response.status_code, "candidate": address, "normalized_zip": normalized_postal_code},
            )
            return {"latitude": None, "longitude": None, "diagnostic": diagnostic}
        payload = response.json() if response.content else {}
        google_status = _safe_text(payload.get("status") or "UNKNOWN_ERROR")
        error_message = _safe_text(payload.get("error_message"))
        diagnostic["status"] = google_status
        diagnostic["error_message"] = error_message
        logger.info(
            "Google geocode response received.",
            extra={
                "candidate": address,
                "normalized_zip": normalized_postal_code,
                "google_status": google_status,
                "google_error_message": error_message,
                "from_cache": False,
            },
        )
        if google_status != "OK":
            diagnostic["error"] = google_status
            diagnostic["error_type"] = "user" if google_status in {"ZERO_RESULTS", "INVALID_REQUEST"} else "system"
            return {"latitude": None, "longitude": None, "diagnostic": diagnostic}
        first = (payload.get("results") or [None])[0] or {}
        location = ((first.get("geometry") or {}).get("location") or {})
        return {
            "latitude": location.get("lat"),
            "longitude": location.get("lng"),
            "diagnostic": diagnostic,
        }
    except Exception:
        diagnostic["error"] = "geocode_exception"
        diagnostic["status"] = "geocode_exception"
        diagnostic["error_type"] = "system"
        logger.exception("Google geocode request raised an exception.")
        return {"latitude": None, "longitude": None, "diagnostic": diagnostic}


def _places_headers() -> dict[str, str]:
    return {
        "X-Goog-Api-Key": google_places_api_key(),
        "Content-Type": "application/json",
        "X-Goog-FieldMask": ",".join(
            [
                "places.id",
                "places.displayName",
                "places.formattedAddress",
                "places.location",
                "places.nationalPhoneNumber",
                "places.internationalPhoneNumber",
                "places.websiteUri",
                "places.rating",
                "places.userRatingCount",
                "places.businessStatus",
                "places.primaryType",
                "places.types",
                "places.googleMapsUri",
            ]
        ),
    }


def _place_details_headers() -> dict[str, str]:
    return {
        "X-Goog-Api-Key": google_places_api_key(),
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents,location",
    }


def _debug_headers(headers: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in (headers or {}).items() if key.lower() != "x-goog-api-key"}


def _response_body_debug(response: Any) -> Any:
    text = _safe_text(getattr(response, "text", ""))
    if text:
        return text[:4000]
    try:
        return response.json()
    except Exception:
        return ""


def fetch_google_place_details(place_id: Any) -> dict[str, Any]:
    api_key = google_places_api_key()
    place_name = _safe_text(place_id)
    diagnostic = {
        "configured": bool(api_key),
        "requested": False,
        "http_status": None,
        "error": "",
        "response_body": "",
    }
    if not api_key or not place_name:
        diagnostic["error"] = "google_places_api_key_missing" if not api_key else "missing_place_id"
        return {"place": {}, "diagnostic": diagnostic}

    resource_name = place_name if place_name.startswith("places/") else f"places/{place_name}"
    url = f"https://places.googleapis.com/v1/{resource_name}"
    headers = _place_details_headers()
    diagnostic["requested"] = True
    diagnostic["request_url"] = url
    diagnostic["request_headers_debug"] = _debug_headers(headers)
    try:
        logger.info(
            "Google Place Details request prepared.",
            extra={"request_url": url, "request_headers": _debug_headers(headers), "place_id_present": bool(place_name)},
        )
        response = requests.get(url, headers=headers, timeout=10)
        diagnostic["http_status"] = response.status_code
        if not (200 <= response.status_code < 300):
            diagnostic["error"] = f"place_details_http_{response.status_code}"
            diagnostic["response_body"] = _response_body_debug(response)
            logger.warning(
                "Google Place Details request failed.",
                extra={"request_url": url, "status_code": response.status_code, "response_body": diagnostic["response_body"]},
            )
            return {"place": {}, "diagnostic": diagnostic}
        payload = response.json() if response.content else {}
        return {"place": payload if isinstance(payload, dict) else {}, "diagnostic": diagnostic}
    except Exception:
        diagnostic["error"] = "place_details_exception"
        logger.exception("Google Place Details request raised an exception.")
        return {"place": {}, "diagnostic": diagnostic}


def _normalize_place(place: dict[str, Any], *, source: str = "google_places") -> dict[str, Any]:
    display_name = place.get("displayName") or {}
    location = place.get("location") or {}
    primary_type = _safe_text(place.get("primaryType"))
    types = place.get("types") if isinstance(place.get("types"), list) else []
    categories = [primary_type] if primary_type else []
    for item in types:
        text = _safe_text(item)
        if text and text not in categories:
            categories.append(text)

    return {
        "source": source,
        "google_place_id": _safe_text(place.get("id")),
        "business_name": _safe_text(display_name.get("text") if isinstance(display_name, dict) else display_name),
        "formatted_address": _safe_text(place.get("formattedAddress")),
        "addressComponents": place.get("addressComponents") if isinstance(place.get("addressComponents"), list) else [],
        "city": "",
        "state": "",
        "zip_code": "",
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "primary_trade": primary_type,
        "trade_categories": categories,
        "google_rating": place.get("rating"),
        "google_review_count": place.get("userRatingCount") or 0,
        "business_status": _safe_text(place.get("businessStatus")),
        "website_url": _safe_text(place.get("websiteUri")),
        "google_maps_url": _safe_text(place.get("googleMapsUri")),
        "phone_number": _safe_text(place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber")),
        "email": "",
        "match_badges": [],
        "match_reason": "",
    }


def search_google_places_contractors(
    *,
    project_type: Any = "",
    project_subtype: Any = "",
    query: Any = "",
    latitude: Any = None,
    longitude: Any = None,
    radius_miles: Any = None,
    limit: int = 5,
    enforce_radius: bool = True,
) -> list[dict[str, Any]]:
    return search_google_places_contractors_with_diagnostics(
        project_type=project_type,
        project_subtype=project_subtype,
        query=query,
        latitude=latitude,
        longitude=longitude,
        radius_miles=radius_miles,
        limit=limit,
        enforce_radius=enforce_radius,
    )["results"]


def search_google_places_contractors_with_diagnostics(
    *,
    project_type: Any = "",
    project_subtype: Any = "",
    query: Any = "",
    latitude: Any = None,
    longitude: Any = None,
    radius_miles: Any = None,
    limit: int = 5,
    enforce_radius: bool = True,
) -> dict[str, Any]:
    api_key = google_places_api_key()
    diagnostic: dict[str, Any] = {
        "configured": bool(api_key),
        "requested": False,
        "text_status": None,
        "nearby_status": None,
        "error": "",
        "results_count": 0,
        "radius_miles": 25,
        "location_filter_applied": False,
        "filtered_out_of_radius_count": 0,
        "filtered_unknown_location_count": 0,
        "pre_distance_filter_count": 0,
        "google_raw_count": 0,
        "after_distance_filter_count": 0,
        "missing_coordinates_count": 0,
        "empty_reason": "",
    }
    if not api_key:
        diagnostic["error"] = "google_places_api_key_missing"
        logger.info("Google Places contractor search skipped: API key is not configured.")
        return {"results": [], "diagnostic": diagnostic}

    search_text = _safe_text(query) or project_type_to_places_query(project_type, project_subtype)
    max_results = min(max(int(limit or 5), 1), 20)
    headers = _places_headers()
    text_search_url = "https://places.googleapis.com/v1/places:searchText"
    diagnostic["requested"] = True
    diagnostic["query"] = search_text
    diagnostic["request_url"] = text_search_url
    diagnostic["request_headers_debug"] = _debug_headers(headers)
    diagnostic["request_payload_debug"] = {}
    diagnostic["http_status"] = None
    diagnostic["response_body"] = ""
    concrete_or_patio_context = is_concrete_or_patio_context(project_type, project_subtype, query)
    try:
        radius_limit = max(float(radius_miles or 25), 1.0)
    except (TypeError, ValueError):
        radius_limit = 25.0
    radius = _radius_meters(radius_limit)
    diagnostic["radius_miles"] = radius_limit
    has_search_center = latitude not in (None, "", []) and longitude not in (None, "", [])
    diagnostic["location_filter_applied"] = bool(enforce_radius and has_search_center)
    if enforce_radius and not has_search_center:
        diagnostic["error"] = "missing_project_location"
        logger.info(
            "Google Places contractor search skipped: missing usable project location.",
            extra={"has_latitude": latitude not in (None, "", []), "has_longitude": longitude not in (None, "", [])},
        )
        return {"results": [], "diagnostic": diagnostic}

    try:
        center = {"latitude": float(latitude), "longitude": float(longitude)} if has_search_center else None
    except (TypeError, ValueError):
        diagnostic["error"] = "missing_project_location"
        logger.info(
            "Google Places contractor search skipped: invalid project location.",
            extra={"has_latitude": latitude not in (None, "", []), "has_longitude": longitude not in (None, "", [])},
        )
        return {"results": [], "diagnostic": diagnostic}

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        request_payload = {
            "textQuery": search_text,
            "maxResultCount": max_results,
            **(
                {
                    "locationBias": {
                        "circle": {
                            "center": center,
                            "radius": float(radius),
                        }
                    }
                }
                if center
                else {}
            ),
        }
        diagnostic["request_payload_debug"] = request_payload
        logger.info(
            "Google Places Text Search contractor request prepared.",
            extra={
                "request_url": text_search_url,
                "request_payload": request_payload,
                "request_headers": _debug_headers(headers),
                "query": search_text,
                "location_filter_applied": diagnostic["location_filter_applied"],
            },
        )
        response = requests.post(
            text_search_url,
            headers=headers,
            json=request_payload,
            timeout=10,
        )
        diagnostic["text_status"] = response.status_code
        diagnostic["http_status"] = response.status_code
        if 200 <= response.status_code < 300:
            payload = response.json() if response.content else {}
            places = payload.get("places", [])[:max_results]
            diagnostic["google_raw_count"] += len(places)
            for place in places:
                if should_exclude_place_for_context(place, concrete_or_patio_context=concrete_or_patio_context):
                    continue
                diagnostic["pre_distance_filter_count"] += 1
                normalized = _normalize_place(place)
                distance = calculate_distance_miles(
                    origin_latitude=latitude,
                    origin_longitude=longitude,
                    destination_latitude=normalized.get("latitude"),
                    destination_longitude=normalized.get("longitude"),
                )
                normalized["distance_miles"] = distance
                if enforce_radius and distance is None:
                    diagnostic["filtered_unknown_location_count"] += 1
                    diagnostic["missing_coordinates_count"] += 1
                    continue
                if enforce_radius and distance > radius_limit:
                    diagnostic["filtered_out_of_radius_count"] += 1
                    continue
                if concrete_or_patio_context:
                    normalized["match_badges"] = ["Patio/concrete related"]
                    normalized["match_reason"] = "Matched patio, concrete, masonry, or hardscape project context."
                place_id = normalized.get("google_place_id")
                if place_id and place_id in seen:
                    continue
                if place_id:
                    seen.add(place_id)
                results.append(normalized)
        else:
            diagnostic["error"] = f"text_search_http_{response.status_code}"
            if response.status_code == 400:
                diagnostic["http_error_type"] = "bad_request"
            elif response.status_code == 403:
                diagnostic["http_error_type"] = "permission_denied"
            elif response.status_code == 429:
                diagnostic["http_error_type"] = "rate_limited"
            else:
                diagnostic["http_error_type"] = "http_error"
            diagnostic["response_body"] = _response_body_debug(response)
            logger.warning(
                "Google Places Text Search contractor request failed.",
                extra={
                    "request_url": text_search_url,
                    "request_payload": request_payload,
                    "request_headers": _debug_headers(headers),
                    "status_code": response.status_code,
                    "response_body": diagnostic["response_body"],
                    "query": search_text,
                },
            )
    except Exception:
        diagnostic["error"] = "text_search_exception"
        logger.exception("Google Places text contractor search raised an exception.")
        diagnostic["results_count"] = len(results)
        return {"results": results[:max_results], "diagnostic": diagnostic}

    if enforce_radius and not results:
        logger.info(
            "Google Places broad contractor fallback skipped because radius enforcement is active.",
            extra={
                "has_latitude": bool(center),
                "has_longitude": bool(center),
                "pre_distance_filter_count": diagnostic["pre_distance_filter_count"],
                "results_after_distance_filter": len(results),
            },
        )
    elif latitude not in (None, "", []) and longitude not in (None, "", []) and not results:
        try:
            nearby_response = requests.post(
                "https://places.googleapis.com/v1/places:searchNearby",
                headers=headers,
                json={
                    "languageCode": "en",
                    "maxResultCount": max_results,
                    "locationRestriction": {
                        "circle": {
                            "center": {"latitude": float(latitude), "longitude": float(longitude)},
                            "radius": radius,
                        }
                    },
                },
                timeout=10,
            )
            diagnostic["nearby_status"] = nearby_response.status_code
            if 200 <= nearby_response.status_code < 300:
                payload = nearby_response.json() if nearby_response.content else {}
                places = payload.get("places", [])[:max_results]
                diagnostic["google_raw_count"] += len(places)
                for place in places:
                    if should_exclude_place_for_context(place, concrete_or_patio_context=concrete_or_patio_context):
                        continue
                    diagnostic["pre_distance_filter_count"] += 1
                    normalized = _normalize_place(place)
                    distance = calculate_distance_miles(
                        origin_latitude=latitude,
                        origin_longitude=longitude,
                        destination_latitude=normalized.get("latitude"),
                        destination_longitude=normalized.get("longitude"),
                    )
                    normalized["distance_miles"] = distance
                    if enforce_radius and distance is None:
                        diagnostic["filtered_unknown_location_count"] += 1
                        diagnostic["missing_coordinates_count"] += 1
                        continue
                    if enforce_radius and distance > radius_limit:
                        diagnostic["filtered_out_of_radius_count"] += 1
                        continue
                    if concrete_or_patio_context:
                        normalized["match_badges"] = ["Patio/concrete related"]
                        normalized["match_reason"] = "Matched patio, concrete, masonry, or hardscape project context."
                    place_id = normalized.get("google_place_id")
                    if place_id and place_id in seen:
                        continue
                    if place_id:
                        seen.add(place_id)
                    results.append(normalized)
            else:
                diagnostic["error"] = diagnostic["error"] or f"nearby_search_http_{nearby_response.status_code}"
                logger.warning(
                    "Google Places nearby contractor search failed",
                    extra={"status_code": nearby_response.status_code, "query": search_text},
                )
        except Exception:
            diagnostic["error"] = diagnostic["error"] or "nearby_search_exception"
            logger.exception("Google Places nearby contractor search raised an exception.")
            diagnostic["results_count"] = len(results)
            return {"results": results[:max_results], "diagnostic": diagnostic}

    if enforce_radius:
        before = len(results)
        results = [
            row
            for row in results
            if row.get("distance_miles") is not None and float(row.get("distance_miles")) <= radius_limit
        ]
        diagnostic["filtered_out_of_radius_count"] += before - len(results)
        logger.info(
            "Google Places contractor radius filter applied.",
            extra={
                "has_project_location": bool(center),
                "pre_distance_filter_count": diagnostic["pre_distance_filter_count"],
                "results_after_distance_filter": len(results),
                "filtered_out_of_radius_count": diagnostic["filtered_out_of_radius_count"],
                "filtered_unknown_location_count": diagnostic["filtered_unknown_location_count"],
            },
        )
        diagnostic["after_distance_filter_count"] = len(results)

    if enforce_radius and not results:
        if diagnostic["google_raw_count"] <= 0:
            diagnostic["empty_reason"] = "google_returned_zero"
        elif diagnostic["missing_coordinates_count"] >= diagnostic["google_raw_count"]:
            diagnostic["empty_reason"] = "all_results_missing_coordinates"
        elif diagnostic["filtered_out_of_radius_count"] > 0:
            diagnostic["empty_reason"] = "all_results_outside_radius"

    results.sort(
        key=lambda row: (
            float(row.get("distance_miles") if row.get("distance_miles") is not None else 9999),
            -(float(row.get("rating") or 0) * 10),
            -int(row.get("review_count") or 0),
            row.get("business_name", ""),
        )
    )

    diagnostic["results_count"] = len(results[:max_results])
    return {"results": results[:max_results], "diagnostic": diagnostic}


def calculate_distance_miles(
    *,
    origin_latitude: Any = None,
    origin_longitude: Any = None,
    destination_latitude: Any = None,
    destination_longitude: Any = None,
) -> float | None:
    if origin_latitude in (None, "", []) or origin_longitude in (None, "", []):
        return None
    if destination_latitude in (None, "", []) or destination_longitude in (None, "", []):
        return None
    return _haversine_miles(origin_latitude, origin_longitude, destination_latitude, destination_longitude)
