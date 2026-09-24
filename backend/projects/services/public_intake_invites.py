from __future__ import annotations

from contextlib import nullcontext
import hashlib
import threading
from urllib.parse import urlsplit

from django.db import connection

from projects.models_invite import ContractorInvite
from projects.services.sms_service import normalize_phone_to_e164


_SQLITE_IDENTITY_LOCKS = tuple(threading.Lock() for _ in range(64))


def normalize_invite_email(value) -> str:
    return str(value or "").strip().lower()


def normalize_invite_phone(value) -> str:
    phone = normalize_phone_to_e164(value)
    return phone if phone.startswith("+") and phone[1:].isdigit() else str(value or "").strip()


def normalize_invite_website(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").lower()
        port = f":{parsed.port}" if parsed.port else ""
    except ValueError:
        return ""
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return ""
    path = "/" + "/".join(part for part in parsed.path.split("/") if part)
    return f"{host}{port}{'' if path == '/' else path}".rstrip("/")


def _stable_identifier(row: dict) -> tuple[str, str]:
    identifier_fields = (
        ("contractor", "contractor_id"),
        ("directory", "directory_entry_id"),
        ("place", "google_place_id"),
        ("place", "place_id"),
        ("contact", "contact_id"),
    )
    for kind, field in identifier_fields:
        value = str(row.get(field) or "").strip()
        if value:
            return kind, value

    opaque_id = str(row.get("id") or "").strip()
    if ":" in opaque_id:
        kind, value = opaque_id.split(":", 1)
        normalized_kind = kind.lower()
        if normalized_kind in {
            "contractor",
            "directory",
            "directory_entry",
            "listing",
            "place",
            "contact",
        } and value:
            return normalized_kind, value
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
    stable_kind, stable_value = _stable_identifier(row)

    if stable_value:
        identity = f"{stable_kind}:{stable_value}"
    elif email:
        identity = f"email:{email}"
    elif phone:
        identity = f"phone:{phone}"
    elif website:
        identity = f"website:{website}"
    else:
        identity = ""

    return {
        "identity": _fit_identity(identity),
        "email": email,
        "phone": phone,
        "website": website,
    }


def get_or_create_public_intake_invite(
    *,
    intake,
    row: dict,
    homeowner_name: str,
    homeowner_email: str,
    homeowner_phone: str,
    invite_message: str,
) -> tuple[ContractorInvite, bool]:
    contact = canonical_invite_contact(row)
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
