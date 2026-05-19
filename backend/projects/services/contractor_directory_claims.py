from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from projects.models import Contractor, Skill
from projects.models_contractor_discovery import ContractorDirectoryClaimToken, ContractorDirectoryEntry
from projects.services.contractor_directory import normalize_services
from projects.services.public_lead_pipeline import ensure_public_profile_for_contractor


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _coerce_radius(value: Any) -> int:
    try:
        radius = int(value)
    except (TypeError, ValueError):
        return 25
    return radius if radius in {5, 10, 15, 25, 50, 100} else 25


def generate_directory_claim_token(entry: ContractorDirectoryEntry, *, generated_by=None) -> ContractorDirectoryClaimToken:
    existing = entry.claim_tokens.filter(status=ContractorDirectoryClaimToken.STATUS_PENDING).order_by("-created_at").first()
    if existing:
        return existing
    return ContractorDirectoryClaimToken.objects.create(directory_entry=entry, generated_by=generated_by)


def directory_entry_prefill_payload(entry: ContractorDirectoryEntry) -> dict[str, Any]:
    return {
        "business_name": entry.business_name,
        "website": entry.website or "",
        "phone": entry.phone or "",
        "public_email": entry.public_email or "",
        "address_line1": entry.address_line1 or "",
        "city": entry.city or entry.service_city or "",
        "state": entry.state or entry.service_state or "",
        "zip_code": entry.zip_code or entry.service_zip or "",
        "latitude": entry.latitude,
        "longitude": entry.longitude,
        "primary_service": entry.primary_service or "",
        "normalized_services": entry.normalized_services or [],
        "services": entry.services or [],
        "service_radius_miles": int(entry.service_radius_miles or 25),
        "claimed": entry.claimed,
        "claimed_contractor_id": entry.claimed_by_contractor_id,
    }


def _ensure_contractor_for_user(user, entry: ContractorDirectoryEntry) -> Contractor:
    contractor = getattr(user, "contractor_profile", None)
    if contractor is not None:
        return contractor
    return Contractor.objects.create(
        user=user,
        business_name=entry.business_name or "My Contractor",
        phone=entry.phone or "",
        address=entry.address_line1 or "",
        city=entry.city or entry.service_city or "",
        state=entry.state or entry.service_state or "",
        zip=entry.zip_code or entry.service_zip or "",
        service_radius_miles=int(entry.service_radius_miles or 25),
        activation_type=Contractor.ACTIVATION_PREFILLED_DIRECTORY,
    )


def _prefill_profile_from_entry(contractor: Contractor, entry: ContractorDirectoryEntry, payload: dict[str, Any] | None = None) -> Contractor:
    payload = payload or {}
    if not contractor.business_name and entry.business_name:
        contractor.business_name = entry.business_name
    if not contractor.phone and entry.phone:
        contractor.phone = entry.phone
    if not contractor.address and entry.address_line1:
        contractor.address = entry.address_line1
    if not contractor.city and (entry.city or entry.service_city):
        contractor.city = entry.city or entry.service_city or ""
    if not contractor.state and (entry.state or entry.service_state):
        contractor.state = entry.state or entry.service_state or ""
    if not contractor.zip and (entry.zip_code or entry.service_zip):
        contractor.zip = entry.zip_code or entry.service_zip or ""
    if "service_radius_miles" in payload:
        contractor.service_radius_miles = _coerce_radius(payload.get("service_radius_miles"))
    elif not contractor.service_radius_miles:
        contractor.service_radius_miles = int(entry.service_radius_miles or 25)
    if not contractor.activation_type:
        contractor.activation_type = Contractor.ACTIVATION_PREFILLED_DIRECTORY
    contractor.save()

    service_names = normalize_services(entry.normalized_services or entry.services or [entry.primary_service])
    for service_name in service_names:
        skill, _ = Skill.objects.get_or_create(name=service_name.title(), defaults={"slug": service_name.replace(" ", "-")})
        contractor.skills.add(skill)

    profile = ensure_public_profile_for_contractor(contractor)
    changed = []
    if not profile.business_name_public and entry.business_name:
        profile.business_name_public = entry.business_name
        changed.append("business_name_public")
    if not profile.website_url and entry.website:
        profile.website_url = entry.website
        changed.append("website_url")
    if not profile.phone_public and entry.phone:
        profile.phone_public = entry.phone
        changed.append("phone_public")
    if entry.public_email and profile.email_public != entry.public_email:
        profile.email_public = entry.public_email
        changed.append("email_public")
    if not profile.city and (entry.city or entry.service_city):
        profile.city = entry.city or entry.service_city or ""
        changed.append("city")
    if not profile.state and (entry.state or entry.service_state):
        profile.state = entry.state or entry.service_state or ""
        changed.append("state")
    if service_names and not profile.specialties:
        profile.specialties = service_names
        changed.append("specialties")
    if changed:
        profile.save(update_fields=[*changed, "updated_at"])
    return contractor


@transaction.atomic
def claim_directory_entry_with_token(token: ContractorDirectoryClaimToken, *, user, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if token.status == ContractorDirectoryClaimToken.STATUS_REVOKED:
        raise PermissionError("This claim link is no longer active.")
    entry = token.directory_entry
    contractor = _ensure_contractor_for_user(user, entry)
    if entry.claimed_by_contractor_id and entry.claimed_by_contractor_id != contractor.id:
        raise PermissionError("This directory profile has already been claimed.")

    contractor = _prefill_profile_from_entry(contractor, entry, payload)
    entry.claimed = True
    entry.claimed_by_contractor = contractor
    if payload and "service_radius_miles" in payload:
        entry.service_radius_miles = _coerce_radius(payload.get("service_radius_miles"))
    entry.save(update_fields=["claimed", "claimed_by_contractor", "service_radius_miles", "last_seen_at"])
    token.status = ContractorDirectoryClaimToken.STATUS_CLAIMED
    token.claimed_by_contractor = contractor
    token.claimed_at = timezone.now()
    token.save(update_fields=["status", "claimed_by_contractor", "claimed_at", "updated_at"])
    return {
        "claimed": True,
        "directory_entry_id": entry.id,
        "contractor_id": contractor.id,
        "onboarding_url": "/app/onboarding",
        "profile_url": "/app/profile",
    }


@transaction.atomic
def manually_mark_directory_entry_claimed(entry: ContractorDirectoryEntry, *, contractor_id: Any = None) -> ContractorDirectoryEntry:
    contractor = None
    raw_id = _safe_text(contractor_id)
    if raw_id.isdigit():
        contractor = Contractor.objects.filter(pk=int(raw_id)).first()
    entry.claimed = True
    if contractor is not None:
        entry.claimed_by_contractor = contractor
        _prefill_profile_from_entry(contractor, entry)
    entry.save(update_fields=["claimed", "claimed_by_contractor", "last_seen_at"])
    return entry
