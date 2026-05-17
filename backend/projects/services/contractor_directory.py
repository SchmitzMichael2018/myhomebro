from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from django.db import transaction

from projects.models_contractor_discovery import ContractorDirectoryDiscovery, ContractorDirectoryEntry


COMMON_SUFFIXES = {"llc", "inc", "co", "company", "ltd"}


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
    formatted_address = _safe_text(place.get("formatted_address") or place.get("formattedAddress") or place.get("address"))
    address_line1 = _safe_text(place.get("address_line1"))
    if not address_line1 and formatted_address:
        address_line1 = formatted_address.split(",")[0].strip()
    zip_code = normalize_zip(place.get("zip_code") or place.get("postal_code") or place.get("postalCode"))
    return {
        "business_name": business_name,
        "normalized_name": normalize_business_name(business_name),
        "website": _null_if_blank(website),
        "website_domain": _null_if_blank(normalize_website_domain(website)),
        "phone": _null_if_blank(phone),
        "normalized_phone": _null_if_blank(normalize_phone(phone)),
        "public_email": _null_if_blank(email),
        "address_line1": _null_if_blank(address_line1),
        "city": _null_if_blank(place.get("city")),
        "state": _null_if_blank(place.get("state")),
        "zip_code": _null_if_blank(zip_code),
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "google_place_id": _null_if_blank(place.get("google_place_id") or place.get("id") or place.get("place_id")),
        "rating": place.get("rating") if place.get("rating") is not None else place.get("google_rating"),
        "review_count": place.get("review_count") if place.get("review_count") is not None else place.get("google_review_count"),
        "services": _place_services(place),
        "source": _safe_text(place.get("source")) or ContractorDirectoryEntry.SOURCE_GOOGLE_PLACES,
    }


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
    data = normalize_place_result(place or {})
    if not data.get("business_name") or not data.get("normalized_name"):
        return None

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
        entry.save(update_fields=[*set(update_fields), "last_seen_at"] if update_fields else ["last_seen_at"])

    record_directory_discovery(entry, context)
    return entry
