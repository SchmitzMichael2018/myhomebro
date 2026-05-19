from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from django.db import transaction

from projects.models_contractor_discovery import ContractorDirectoryDiscovery, ContractorDirectoryEntry
from projects.services.contractor_service_taxonomy import (
    clean_raw_services,
    normalize_contractor_services,
    normalize_taxonomy_text,
)


COMMON_SUFFIXES = {"llc", "inc", "co", "company", "ltd"}
STATE_ABBREVIATIONS = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _null_if_blank(value: Any) -> str | None:
    text = _safe_text(value)
    return text or None


def normalize_business_name(value: Any) -> str:
    text = _safe_text(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    parts = [part for part in text.split() if part and part not in COMMON_SUFFIXES]
    return " ".join(parts)


def normalize_phone(value: Any) -> str:
    return "".join(ch for ch in _safe_text(value) if ch.isdigit())


def normalize_website_domain(value: Any) -> str:
    text = _safe_text(value).lower()
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    parsed = urlparse(text)
    domain = (parsed.netloc or parsed.path).split("/")[0].strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def normalize_zip(value: Any) -> str:
    digits = "".join(ch for ch in _safe_text(value) if ch.isdigit())
    return digits[:5] if digits else _safe_text(value)[:5]


def normalize_state(value: Any) -> str:
    text = _safe_text(value)
    if not text:
        return ""
    compact = re.sub(r"[^A-Za-z]", "", text).upper()
    if len(compact) == 2:
        return compact
    return STATE_ABBREVIATIONS.get(text.lower(), text[:2].upper() if len(text) >= 2 else text.upper())


def _display_name(place: dict[str, Any]) -> str:
    display_name = place.get("displayName")
    if isinstance(display_name, dict):
        return _safe_text(display_name.get("text"))
    return _safe_text(display_name or place.get("business_name") or place.get("name"))


def _place_location(place: dict[str, Any]) -> dict[str, Any]:
    location = place.get("location") if isinstance(place.get("location"), dict) else {}
    return {
        "latitude": place.get("latitude", location.get("latitude")),
        "longitude": place.get("longitude", location.get("longitude")),
    }


def _component_text(component: dict[str, Any], prefer_short: bool = False) -> str:
    if prefer_short:
        return _safe_text(component.get("shortText") or component.get("short_name") or component.get("longText") or component.get("long_name"))
    return _safe_text(component.get("longText") or component.get("long_name") or component.get("shortText") or component.get("short_name"))


def _address_from_components(place: dict[str, Any]) -> dict[str, str]:
    components = place.get("address_components") or place.get("addressComponents") or []
    if not isinstance(components, list):
        return {}

    by_type: dict[str, dict[str, Any]] = {}
    for component in components:
        if not isinstance(component, dict):
            continue
        for item_type in component.get("types") or []:
            by_type.setdefault(_safe_text(item_type), component)

    street_number = _component_text(by_type.get("street_number", {}))
    route = _component_text(by_type.get("route", {}), prefer_short=True)
    subpremise = _component_text(by_type.get("subpremise", {}), prefer_short=True)
    line1 = " ".join(part for part in [street_number, route] if part).strip()
    if subpremise:
        suffix = subpremise if subpremise.startswith("#") else f"#{subpremise}"
        line1 = f"{line1} {suffix}".strip() if line1 else suffix

    city = (
        _component_text(by_type.get("locality", {}))
        or _component_text(by_type.get("postal_town", {}))
        or _component_text(by_type.get("sublocality", {}))
        or _component_text(by_type.get("administrative_area_level_3", {}))
    )
    state = normalize_state(_component_text(by_type.get("administrative_area_level_1", {}), prefer_short=True))
    zip_code = normalize_zip(_component_text(by_type.get("postal_code", {}), prefer_short=True))

    return {
        "address_line1": line1,
        "city": city,
        "state": state,
        "zip_code": zip_code,
    }


def _address_from_formatted_address(value: Any) -> dict[str, str]:
    formatted = _safe_text(value)
    if not formatted:
        return {}
    parts = [part.strip() for part in formatted.split(",") if part.strip()]
    line1 = parts[0] if parts else ""
    if len(parts) >= 4 and re.match(r"^(suite|ste|unit|apt|#)\b", parts[1], flags=re.IGNORECASE):
        line1 = f"{line1}, {parts[1]}".strip(", ")
    parsed = {"address_line1": line1, "city": "", "state": "", "zip_code": ""}
    has_country = bool(parts and parts[-1].lower() in {"usa", "us", "united states", "united states of america"})
    if len(parts) >= 4 and has_country:
        parsed["city"] = parts[-3]
        state_zip = parts[-2]
    elif len(parts) >= 3:
        parsed["city"] = parts[-2]
        state_zip = parts[-1]
    elif len(parts) == 2:
        state_zip = parts[-1]
    else:
        state_zip = ""

    match = re.search(r"\b([A-Za-z]{2}|[A-Za-z][A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)\b", state_zip)
    if match:
        parsed["state"] = normalize_state(match.group(1))
        parsed["zip_code"] = normalize_zip(match.group(2))
    else:
        tokens = state_zip.split()
        if tokens:
            parsed["state"] = normalize_state(tokens[0])
        zip_match = re.search(r"\b\d{5}(?:-\d{4})?\b", formatted)
        if zip_match:
            parsed["zip_code"] = normalize_zip(zip_match.group(0))
    return parsed


def parse_google_formatted_address(value: Any) -> dict[str, str]:
    return _address_from_formatted_address(value)


def parse_place_address(place: dict[str, Any]) -> dict[str, str]:
    formatted_address = _safe_text(place.get("formatted_address") or place.get("formattedAddress") or place.get("address"))
    component_address = _address_from_components(place)
    formatted = _address_from_formatted_address(formatted_address)
    explicit = {
        "address_line1": _safe_text(place.get("address_line1")),
        "city": _safe_text(place.get("city")),
        "state": normalize_state(place.get("state")),
        "zip_code": normalize_zip(place.get("zip_code") or place.get("postal_code") or place.get("postalCode")),
    }
    return {
        field: explicit.get(field) or component_address.get(field) or formatted.get(field) or ""
        for field in ["address_line1", "city", "state", "zip_code"]
    }


def _place_services(place: dict[str, Any]) -> list[str]:
    services: list[str] = []
    for value in [place.get("primary_trade"), place.get("primaryType")]:
        text = _safe_text(value)
        if text and text not in services:
            services.append(text)
    for raw in [place.get("trade_categories"), place.get("types"), place.get("services")]:
        if isinstance(raw, list):
            for item in raw:
                text = _safe_text(item)
                if text and text not in services:
                    services.append(text)
    return services


def normalize_service_label(value: Any) -> str:
    return normalize_taxonomy_text(value)


def normalize_services(values: Any) -> list[str]:
    return clean_raw_services(values)


def normalize_place_result(place: dict[str, Any]) -> dict[str, Any]:
    location = _place_location(place)
    business_name = _display_name(place)
    website = _safe_text(place.get("website_url") or place.get("websiteUri") or place.get("website"))
    phone = _safe_text(
        place.get("phone_number")
        or place.get("phone")
        or place.get("nationalPhoneNumber")
        or place.get("internationalPhoneNumber")
    )
    email = _safe_text(place.get("public_email") or place.get("email"))
    if email.lower() in {"email not listed", "not listed", "none", "null"}:
        email = ""
    address = parse_place_address(place)
    services = _place_services(place)
    taxonomy = normalize_contractor_services(
        business_name=business_name,
        website_domain=normalize_website_domain(website),
        raw_services=services,
        search_term=place.get("search_term"),
        project_type=place.get("project_type"),
        project_subtype=place.get("project_subtype"),
    )
    normalized_services = taxonomy["normalized_services"]
    return {
        "business_name": business_name,
        "normalized_name": normalize_business_name(business_name),
        "website": _null_if_blank(website),
        "website_domain": _null_if_blank(normalize_website_domain(website)),
        "phone": _null_if_blank(phone),
        "normalized_phone": _null_if_blank(normalize_phone(phone)),
        "public_email": _null_if_blank(email),
        "address_line1": _null_if_blank(address.get("address_line1")),
        "city": _null_if_blank(address.get("city")),
        "state": _null_if_blank(address.get("state")),
        "zip_code": _null_if_blank(address.get("zip_code")),
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "service_radius_miles": place.get("service_radius_miles") or 25,
        "service_city": _null_if_blank(place.get("service_city") or address.get("city")),
        "service_state": _null_if_blank(normalize_state(place.get("service_state") or address.get("state"))),
        "service_zip": _null_if_blank(normalize_zip(place.get("service_zip") or address.get("zip_code"))),
        "primary_service": _null_if_blank(place.get("primary_service") or taxonomy["primary_service"]),
        "normalized_services": normalized_services,
        "raw_services": taxonomy["raw_services"],
        "service_normalization_status": taxonomy["status"],
        "google_place_id": _null_if_blank(place.get("google_place_id") or place.get("id") or place.get("place_id")),
        "rating": place.get("rating") if place.get("rating") is not None else place.get("google_rating"),
        "review_count": place.get("review_count") if place.get("review_count") is not None else place.get("google_review_count"),
        "services": services,
        "source": _safe_text(place.get("source")) or ContractorDirectoryEntry.SOURCE_GOOGLE_PLACES,
    }


def _has_complete_location(data: dict[str, Any] | None) -> bool:
    if not data:
        return False
    return all(_safe_text(data.get(field)) for field in ["city", "state", "zip_code"])


def _entry_has_complete_location(entry: ContractorDirectoryEntry | None) -> bool:
    if entry is None:
        return False
    return bool(entry.city and entry.state and entry.zip_code)


def _merge_place_details(base_place: dict[str, Any], details: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base_place or {})
    for field in ["addressComponents", "address_components", "formattedAddress", "formatted_address", "location"]:
        value = details.get(field)
        if value not in (None, "", []):
            merged[field] = value
    if details.get("id") and not _safe_text(merged.get("google_place_id") or merged.get("id") or merged.get("place_id")):
        merged["id"] = details.get("id")
    if details.get("displayName") and not _display_name(merged):
        merged["displayName"] = details.get("displayName")
    return merged


def _place_with_context(place: dict[str, Any], context: dict[str, Any] | None) -> dict[str, Any]:
    if not context:
        return place
    enriched = dict(place or {})
    for source_key, target_key in [
        ("search_term", "search_term"),
        ("project_type", "project_type"),
        ("project_subtype", "project_subtype"),
    ]:
        if context.get(source_key) and not enriched.get(target_key):
            enriched[target_key] = context.get(source_key)
    return enriched


def _enrich_place_location_if_needed(
    place: dict[str, Any],
    data: dict[str, Any],
    entry: ContractorDirectoryEntry | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if _has_complete_location(data) or _entry_has_complete_location(entry):
        return place, data
    google_place_id = _safe_text(data.get("google_place_id") or place.get("google_place_id") or place.get("id") or place.get("place_id"))
    if not google_place_id:
        return place, data
    try:
        from projects.services.google_places_contractors import fetch_google_place_details

        details_payload = fetch_google_place_details(google_place_id)
    except Exception:
        return place, data
    details = details_payload.get("place") if isinstance(details_payload, dict) else {}
    if not isinstance(details, dict) or not details:
        return place, data
    enriched_place = _merge_place_details(place, details)
    enriched_data = normalize_place_result(enriched_place)
    return enriched_place, enriched_data


def find_existing_directory_entry(normalized_data: dict[str, Any]) -> ContractorDirectoryEntry | None:
    google_place_id = _safe_text(normalized_data.get("google_place_id"))
    if google_place_id:
        found = ContractorDirectoryEntry.objects.filter(google_place_id=google_place_id).first()
        if found:
            return found

    website_domain = _safe_text(normalized_data.get("website_domain"))
    if website_domain:
        found = ContractorDirectoryEntry.objects.filter(website_domain=website_domain).first()
        if found:
            return found

    normalized_phone = _safe_text(normalized_data.get("normalized_phone"))
    if normalized_phone:
        found = ContractorDirectoryEntry.objects.filter(normalized_phone=normalized_phone).first()
        if found:
            return found

    normalized_name = _safe_text(normalized_data.get("normalized_name"))
    zip_code = _safe_text(normalized_data.get("zip_code"))
    if normalized_name and zip_code:
        found = ContractorDirectoryEntry.objects.filter(normalized_name=normalized_name, zip_code=zip_code).first()
        if found:
            return found
        return None

    city = _safe_text(normalized_data.get("city"))
    state = _safe_text(normalized_data.get("state"))
    if normalized_name and city and state:
        return ContractorDirectoryEntry.objects.filter(
            normalized_name=normalized_name,
            city__iexact=city,
            state__iexact=state,
        ).first()

    return None


def _merge_services(existing: list[str], incoming: list[str]) -> list[str]:
    merged: list[str] = []
    for value in [*(existing or []), *(incoming or [])]:
        text = _safe_text(value)
        if text and text not in merged:
            merged.append(text)
    return merged


def record_directory_discovery(entry: ContractorDirectoryEntry, context: dict[str, Any] | None = None) -> ContractorDirectoryDiscovery:
    context = context or {}
    return ContractorDirectoryDiscovery.objects.create(
        directory_entry=entry,
        source_type=_safe_text(context.get("source_type")) or ContractorDirectoryDiscovery.SOURCE_UNKNOWN,
        search_term=_null_if_blank(context.get("search_term")),
        project_type=_null_if_blank(context.get("project_type")),
        project_subtype=_null_if_blank(context.get("project_subtype")),
        search_city=_null_if_blank(context.get("search_city") or context.get("city")),
        search_state=_null_if_blank(context.get("search_state") or context.get("state")),
        search_zip=_null_if_blank(normalize_zip(context.get("search_zip") or context.get("zip"))),
        radius_miles=context.get("radius_miles") or None,
        intake_request=context.get("intake_request"),
        admin_user=context.get("admin_user"),
        selected_by_homeowner=bool(context.get("selected_by_homeowner", False)),
    )


@transaction.atomic
def upsert_directory_entry_from_place(
    place: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> ContractorDirectoryEntry | None:
    place = _place_with_context(place or {}, context)
    data = normalize_place_result(place)
    if not data.get("business_name") or not data.get("normalized_name"):
        return None

    entry = find_existing_directory_entry(data)
    place, data = _enrich_place_location_if_needed(place, data, entry)
    if entry is None:
        entry = find_existing_directory_entry(data)
    if entry is None:
        entry = ContractorDirectoryEntry.objects.create(**data)
    else:
        update_fields = []
        for field in [
            "business_name",
            "website",
            "website_domain",
            "phone",
            "normalized_phone",
            "public_email",
            "address_line1",
            "city",
            "state",
            "zip_code",
            "service_radius_miles",
            "service_city",
            "service_state",
            "service_zip",
            "latitude",
            "longitude",
            "google_place_id",
            "rating",
            "review_count",
            "source",
        ]:
            value = data.get(field)
            if value not in (None, "") and getattr(entry, field) != value:
                setattr(entry, field, value)
                update_fields.append(field)
        merged_services = _merge_services(entry.services, data.get("services") or [])
        if merged_services != (entry.services or []):
            entry.services = merged_services
            update_fields.append("services")
        incoming_normalized = data.get("normalized_services") or []
        merged_normalized_services = _merge_services(entry.normalized_services or [], incoming_normalized)
        can_auto_update_services = entry.service_normalization_status != ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
        if can_auto_update_services and merged_normalized_services != (entry.normalized_services or []):
            entry.normalized_services = merged_normalized_services
            update_fields.append("normalized_services")
        if can_auto_update_services and data.get("primary_service") and not entry.primary_service:
            entry.primary_service = data.get("primary_service")
            update_fields.append("primary_service")
        if can_auto_update_services and incoming_normalized and entry.service_normalization_status != ContractorDirectoryEntry.SERVICE_NORMALIZATION_AUTO:
            entry.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_AUTO
            update_fields.append("service_normalization_status")
        merged_raw_services = normalize_services([*(entry.raw_services or []), *(data.get("raw_services") or [])])
        if merged_raw_services != (entry.raw_services or []):
            entry.raw_services = merged_raw_services
            update_fields.append("raw_services")
        entry.save(update_fields=[*set(update_fields), "last_seen_at"] if update_fields else ["last_seen_at"])

    record_directory_discovery(entry, context)
    return entry
