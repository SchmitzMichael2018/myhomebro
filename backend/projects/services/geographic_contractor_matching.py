from __future__ import annotations

import math
from typing import Any

from projects.models import Contractor
from projects.models_contractor_discovery import ContractorDirectoryEntry
from projects.services.contractor_directory import normalize_service_label


def _safe_float(value: Any) -> float | None:
    try:
        if value in (None, "", []):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def distance_miles(lat1: Any, lng1: Any, lat2: Any, lng2: Any) -> float | None:
    lat1 = _safe_float(lat1)
    lng1 = _safe_float(lng1)
    lat2 = _safe_float(lat2)
    lng2 = _safe_float(lng2)
    if None in {lat1, lng1, lat2, lng2}:
        return None
    earth_radius_miles = 3958.8
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(earth_radius_miles * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def _entry_for_contractor(contractor: Contractor) -> ContractorDirectoryEntry | None:
    return contractor.directory_entries.filter(latitude__isnull=False, longitude__isnull=False).order_by("-claimed", "-last_seen_at").first()


def _lat_lng_radius(contractor_or_entry: Contractor | ContractorDirectoryEntry) -> tuple[Any, Any, int]:
    if isinstance(contractor_or_entry, ContractorDirectoryEntry):
        return (
            contractor_or_entry.latitude,
            contractor_or_entry.longitude,
            int(contractor_or_entry.service_radius_miles or 25),
        )
    entry = _entry_for_contractor(contractor_or_entry)
    radius = int(getattr(contractor_or_entry, "service_radius_miles", 25) or 25)
    if entry is None:
        return None, None, radius
    return entry.latitude, entry.longitude, radius


def contractor_serves_location(contractor_or_entry: Contractor | ContractorDirectoryEntry, project_lat: Any, project_lng: Any) -> bool:
    contractor_lat, contractor_lng, radius = _lat_lng_radius(contractor_or_entry)
    distance = distance_miles(contractor_lat, contractor_lng, project_lat, project_lng)
    return bool(distance is not None and distance <= radius)


def _matches_service(entry: ContractorDirectoryEntry, service_category: Any) -> bool:
    requested = normalize_service_label(service_category)
    if not requested:
        return True
    haystack = [entry.primary_service or "", *(entry.normalized_services or []), *(entry.services or [])]
    normalized_haystack = [normalize_service_label(value) for value in haystack]
    return any(requested in value or value in requested for value in normalized_haystack if value)


def match_contractors_for_project(project_location: dict[str, Any], service_category: Any = "") -> list[dict[str, Any]]:
    project_lat = project_location.get("latitude") or project_location.get("lat")
    project_lng = project_location.get("longitude") or project_location.get("lng")
    matches: list[dict[str, Any]] = []
    qs = ContractorDirectoryEntry.objects.exclude(latitude__isnull=True).exclude(longitude__isnull=True)
    for entry in qs:
        if not _matches_service(entry, service_category):
            continue
        miles = distance_miles(entry.latitude, entry.longitude, project_lat, project_lng)
        if miles is None or miles > int(entry.service_radius_miles or 25):
            continue
        matches.append(
            {
                "directory_entry_id": entry.id,
                "contractor_id": entry.claimed_by_contractor_id,
                "business_name": entry.business_name,
                "latitude": entry.latitude,
                "longitude": entry.longitude,
                "address_line1": entry.address_line1,
                "city": entry.city,
                "state": entry.state,
                "zip_code": entry.zip_code,
                "claimed": entry.claimed,
                "service_radius_miles": entry.service_radius_miles,
                "primary_service": entry.primary_service,
                "normalized_services": entry.normalized_services or [],
                "distance_miles": miles,
            }
        )
    return sorted(matches, key=lambda row: (row["distance_miles"], row["business_name"]))
