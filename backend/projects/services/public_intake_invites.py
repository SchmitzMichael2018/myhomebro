from __future__ import annotations

from contextlib import nullcontext
import hashlib
import threading
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import connection

from projects.models import Contractor
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
)
from projects.models_invite import ContractorInvite
from projects.services.recipient_validation import normalize_valid_email
from projects.services.sms_service import normalize_phone_to_e164


_SQLITE_IDENTITY_LOCKS = tuple(threading.Lock() for _ in range(64))


def normalize_invite_email(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    email = normalize_valid_email(raw)
    if not email:
        raise ValueError("Enter a valid contractor email address.")
    return email


def normalize_invite_phone(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    phone = normalize_phone_to_e164(raw)
    digits = phone[1:] if phone.startswith("+") else ""
    if not digits.isdigit() or not 8 <= len(digits) <= 15:
        raise ValueError("Enter a valid contractor phone number.")
    return phone


def normalize_invite_website(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        candidate = raw if "://" in raw else f"https://{raw}"
        URLValidator(schemes=["http", "https"])(candidate)
        parsed = urlsplit(candidate)
        host = (parsed.hostname or "").lower()
        port = f":{parsed.port}" if parsed.port else ""
    except (ValidationError, ValueError):
        raise ValueError("Enter a valid contractor website URL.") from None
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return ""
    path = "/" + "/".join(part for part in parsed.path.split("/") if part)
    return f"{host}{port}{'' if path == '/' else path}".rstrip("/")


def _positive_integer(value, label: str) -> int:
    text = str(value or "").strip()
    if not text.isdigit() or int(text) <= 0:
        raise ValueError(f"Choose a valid {label}.")
    return int(text)


def _matches_destination(record, *, email: str, phone: str, website: str) -> bool:
    record_email = normalize_valid_email(
        getattr(record, "public_email", "")
        or getattr(record, "email", "")
        or getattr(getattr(record, "user", None), "email", "")
    )
    record_phone_raw = (
        getattr(record, "phone", "")
        or getattr(record, "phone_number", "")
    )
    try:
        record_phone = normalize_invite_phone(record_phone_raw)
    except ValueError:
        record_phone = ""
    try:
        record_website = normalize_invite_website(
            getattr(record, "website", "")
            or getattr(record, "website_url", "")
        )
    except ValueError:
        record_website = ""

    return (
        (not email or email == record_email)
        and (not phone or phone == record_phone)
        and (not website or website == record_website)
    )


def _resolved_stable_identity(
    row: dict,
    *,
    email: str,
    phone: str,
    website: str,
) -> tuple[str, str]:
    contractor_id = str(row.get("contractor_id") or "").strip()
    directory_entry_id = str(row.get("directory_entry_id") or "").strip()
    listing_id = ""
    google_place_id = str(
        row.get("google_place_id") or row.get("place_id") or ""
    ).strip()
    unsupported_contact_id = str(row.get("contact_id") or "").strip()
    opaque_id = str(row.get("id") or "").strip()
    if ":" in opaque_id:
        kind, value = opaque_id.split(":", 1)
        normalized_kind = kind.lower()
        if normalized_kind == "contractor" and not contractor_id:
            contractor_id = value
        elif normalized_kind in {"directory", "directory_entry"} and not directory_entry_id:
            directory_entry_id = value
        elif normalized_kind == "listing":
            listing_id = value
        elif normalized_kind in {"place", "contact"}:
            raise ValueError("Choose a contractor from a verified search result.")
        elif normalized_kind:
            raise ValueError("Choose a contractor from a verified search result.")
    elif opaque_id:
        raise ValueError("Choose a contractor from a verified search result.")

    if unsupported_contact_id:
        raise ValueError("Choose a contractor from a verified search result.")

    contractor = None
    if contractor_id:
        parsed_id = _positive_integer(contractor_id, "contractor account")
        contractor = Contractor.objects.filter(pk=parsed_id).first()
        if contractor is None:
            raise ValueError("Choose a valid contractor account.")

    directory_entry = None
    if directory_entry_id:
        parsed_id = _positive_integer(directory_entry_id, "contractor directory entry")
        directory_entry = ContractorDirectoryEntry.objects.filter(pk=parsed_id).first()
        if directory_entry is None:
            raise ValueError("Choose a valid contractor directory entry.")

    listing = None
    if listing_id:
        parsed_id = _positive_integer(listing_id, "contractor directory listing")
        listing = ContractorDirectoryListing.objects.filter(pk=parsed_id).first()
        if listing is None:
            raise ValueError("Choose a valid contractor directory listing.")

    if contractor and directory_entry and directory_entry.claimed_by_contractor_id != contractor.id:
        raise ValueError("The contractor account does not match the directory entry.")
    if contractor and listing and listing.claimed_contractor_id != contractor.id:
        raise ValueError("The contractor account does not match the directory listing.")
    if contractor and not _matches_destination(
        contractor,
        email=email,
        phone=phone,
        website="",
    ):
        raise ValueError("The contractor contact does not match the contractor account.")
    if directory_entry and not _matches_destination(
        directory_entry,
        email=email,
        phone=phone,
        website=website,
    ):
        raise ValueError("The contractor contact does not match the directory entry.")
    if listing and not _matches_destination(
        listing,
        email=email,
        phone=phone,
        website=website,
    ):
        raise ValueError("The contractor contact does not match the directory listing.")

    if google_place_id:
        if directory_entry and directory_entry.google_place_id != google_place_id:
            raise ValueError("The place record does not match the directory entry.")
        if listing and listing.google_place_id != google_place_id:
            raise ValueError("The place record does not match the directory listing.")
        place_entries = ContractorDirectoryEntry.objects.filter(
            google_place_id=google_place_id
        )
        place_listings = ContractorDirectoryListing.objects.filter(
            google_place_id=google_place_id
        )
        trusted_place = (
            directory_entry
            or listing
            or place_entries.exists()
            or place_listings.exists()
        )
        if not trusted_place:
            raise ValueError("Choose a valid contractor place record.")
        if contractor and not (
            place_entries.filter(claimed_by_contractor=contractor).exists()
            or place_listings.filter(claimed_contractor=contractor).exists()
        ):
            raise ValueError("The contractor account does not match the place record.")
        if not directory_entry and not listing:
            matching_place = any(
                _matches_destination(
                    record,
                    email=email,
                    phone=phone,
                    website=website,
                )
                for record in [*place_entries, *place_listings]
            )
            if not matching_place:
                raise ValueError("The contractor contact does not match the place record.")

    if contractor:
        return "contractor", str(contractor.id)
    if directory_entry:
        return "directory", str(directory_entry.id)
    if listing:
        return "listing", str(listing.id)
    if google_place_id:
        return "place", google_place_id

    return "", ""


def _fit_identity(identity: str) -> str:
    if len(identity) <= 255:
        return identity
    kind = identity.partition(":")[0]
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return f"{kind}:sha256:{digest}"


def canonical_invite_contact(row: dict) -> dict[str, str]:
    email = normalize_invite_email(row.get("email") or row.get("contractor_email"))
    phone = normalize_invite_phone(row.get("phone") or row.get("contractor_phone"))
    website = normalize_invite_website(
        row.get("website_url") or row.get("website") or row.get("contact_url")
    )
    stable_kind, stable_value = _resolved_stable_identity(
        row,
        email=email,
        phone=phone,
        website=website,
    )

    if stable_value:
        identity = f"{stable_kind}:{stable_value}"
    elif email:
        identity = f"email:{email}"
    elif phone:
        identity = f"phone:{phone}"
    else:
        identity = ""

    return {
        "identity": _fit_identity(identity),
        "email": email,
        "phone": phone,
        "website": website,
    }


def validate_public_intake_invite_contacts(rows) -> list[dict[str, str]]:
    if not isinstance(rows, list):
        raise ValueError("Contractor contacts must be submitted as a list.")

    contacts = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each contractor contact must be an object.")
        contact = canonical_invite_contact(row)
        if not contact["email"] and not contact["phone"]:
            raise ValueError("Add a valid email or phone number for each contractor contact.")
        if not contact["identity"]:
            raise ValueError("A valid contractor contact identity is required.")
        contacts.append({**row, "_validated_contact": contact})
    return contacts[:5]


def get_or_create_public_intake_invite(
    *,
    intake,
    row: dict,
    homeowner_name: str,
    homeowner_email: str,
    homeowner_phone: str,
    invite_message: str,
) -> tuple[ContractorInvite, bool]:
    contact = row.get("_validated_contact") or canonical_invite_contact(row)
    if not contact["email"] and not contact["phone"]:
        raise ValueError("Add an email or phone number for each contractor contact.")
    if not contact["identity"]:
        raise ValueError("A contractor contact identity is required.")

    contractor_name = str(row.get("name") or row.get("contractor_name") or "").strip()
    contractor_message = str(row.get("message") or invite_message or "").strip()
    defaults = {
        "homeowner_name": homeowner_name or "Customer",
        "homeowner_email": normalize_invite_email(homeowner_email),
        "homeowner_phone": str(homeowner_phone or "").strip(),
        "contractor_email": contact["email"],
        "contractor_phone": contact["phone"],
        "message": "\n".join(
            part
            for part in [
                contractor_name and f"Contact: {contractor_name}",
                contractor_message,
            ]
            if part
        ),
    }

    lock = nullcontext()
    if connection.vendor == "sqlite":
        # SQLite permits only one writer; this avoids same-process lock-upgrade
        # failures while the database constraint remains authoritative.
        lock = _SQLITE_IDENTITY_LOCKS[
            hash((intake.pk, contact["identity"])) % len(_SQLITE_IDENTITY_LOCKS)
        ]
    with lock:
        return ContractorInvite.objects.get_or_create(
            source_intake=intake,
            contact_identity=contact["identity"],
            defaults=defaults,
        )
