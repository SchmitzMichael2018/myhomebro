from __future__ import annotations

import math
from typing import Any

import requests
from django.conf import settings


PROJECT_TYPE_QUERY_MAP = {
    "roofing": "roofing contractor",
    "plumbing": "plumber",
    "electrical": "electrician",
    "hvac": "hvac contractor",
    "painting": "painter",
    "flooring": "flooring contractor",
    "drywall": "drywall contractor",
    "remodeling": "remodeling contractor",
    "general": "general contractor",
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
    for key, query in PROJECT_TYPE_QUERY_MAP.items():
        if key in text or key in subtype:
            return query
    if text:
        return f"{text} contractor"
    if subtype:
        return f"{subtype} contractor"
    return "contractor"


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


def _places_headers() -> dict[str, str]:
    return {
        "X-Goog-Api-Key": google_places_api_key(),
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
) -> list[dict[str, Any]]:
    api_key = google_places_api_key()
    if not api_key:
        return []

    search_text = _safe_text(query) or project_type_to_places_query(project_type, project_subtype)
    max_results = max(int(limit or 5), 1)
    headers = _places_headers()

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        response = requests.post(
            "https://places.googleapis.com/v1/places:searchText",
            headers=headers,
            json={
                "textQuery": search_text,
                "languageCode": "en",
                "regionCode": "us",
                "maxResultCount": max_results,
            },
            timeout=10,
        )
        if 200 <= response.status_code < 300:
            payload = response.json() if response.content else {}
            for place in payload.get("places", [])[:max_results]:
                normalized = _normalize_place(place)
                place_id = normalized.get("google_place_id")
                if place_id and place_id in seen:
                    continue
                if place_id:
                    seen.add(place_id)
                results.append(normalized)
    except Exception:
        return results

    if latitude not in (None, "", []) and longitude not in (None, "", []):
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
                            "radius": _radius_meters(radius_miles),
                        }
                    },
                },
                timeout=10,
            )
            if 200 <= nearby_response.status_code < 300:
                payload = nearby_response.json() if nearby_response.content else {}
                for place in payload.get("places", [])[:max_results]:
                    normalized = _normalize_place(place)
                    place_id = normalized.get("google_place_id")
                    if place_id and place_id in seen:
                        continue
                    if place_id:
                        seen.add(place_id)
                    results.append(normalized)
        except Exception:
            return results

    return results[:max_results]


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
