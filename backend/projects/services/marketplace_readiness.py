from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import Contractor, PublicContractorLead
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorDirectoryListing, ContractorDiscoveryInvite, MarketplaceLocation
from projects.models_project_intake import ProjectIntake


DEFAULT_MIN_CLAIMED_CONTRACTORS = 20
DEFAULT_MIN_VERIFIED_CONTRACTORS = 10
DEFAULT_MIN_STRIPE_READY_CONTRACTORS = 5
DEFAULT_MIN_TRADE_CATEGORIES = 6
DEFAULT_MAX_BIDS_PER_REQUEST = 5

CORE_TRADE_CATEGORIES = {
    "carpentry",
    "concrete",
    "drywall",
    "electrical",
    "flooring",
    "gutters",
    "hvac",
    "painting",
    "plumbing",
    "remodeling",
    "roofing",
    "siding",
    "windows",
}


@dataclass(frozen=True)
class MarketplaceThresholds:
    min_claimed_contractors: int
    min_verified_contractors: int
    min_stripe_ready_contractors: int
    min_trade_categories: int
    max_bids_per_request: int


def normalize_location_value(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_trade(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = " ".join(text.split())
    aliases = {
        "roofer": "roofing",
        "roof repair": "roofing",
        "floor": "flooring",
        "floor installation": "flooring",
        "painter": "painting",
        "paint": "painting",
        "electrician": "electrical",
        "plumber": "plumbing",
        "bathroom remodel": "remodeling",
        "kitchen remodel": "remodeling",
        "home addition": "remodeling",
        "gutter": "gutters",
        "gutter installation": "gutters",
        "window": "windows",
        "window repair": "windows",
    }
    return aliases.get(text, text)


def _setting_int(name: str, default: int) -> int:
    try:
        return int(getattr(settings, name, default))
    except Exception:
        return default


def marketplace_thresholds(location: MarketplaceLocation | None = None) -> MarketplaceThresholds:
    return MarketplaceThresholds(
        min_claimed_contractors=int(location.min_claimed_contractors or _setting_int("MYHOMEBRO_MARKETPLACE_MIN_CLAIMED_CONTRACTORS", DEFAULT_MIN_CLAIMED_CONTRACTORS))
        if location
        else _setting_int("MYHOMEBRO_MARKETPLACE_MIN_CLAIMED_CONTRACTORS", DEFAULT_MIN_CLAIMED_CONTRACTORS),
        min_verified_contractors=int(location.min_verified_contractors or _setting_int("MYHOMEBRO_MARKETPLACE_MIN_VERIFIED_CONTRACTORS", DEFAULT_MIN_VERIFIED_CONTRACTORS))
        if location
        else _setting_int("MYHOMEBRO_MARKETPLACE_MIN_VERIFIED_CONTRACTORS", DEFAULT_MIN_VERIFIED_CONTRACTORS),
        min_stripe_ready_contractors=int(location.min_stripe_ready_contractors or _setting_int("MYHOMEBRO_MARKETPLACE_MIN_STRIPE_READY_CONTRACTORS", DEFAULT_MIN_STRIPE_READY_CONTRACTORS))
        if location
        else _setting_int("MYHOMEBRO_MARKETPLACE_MIN_STRIPE_READY_CONTRACTORS", DEFAULT_MIN_STRIPE_READY_CONTRACTORS),
        min_trade_categories=int(location.min_trade_categories or _setting_int("MYHOMEBRO_MARKETPLACE_MIN_TRADE_CATEGORIES", DEFAULT_MIN_TRADE_CATEGORIES))
        if location
        else _setting_int("MYHOMEBRO_MARKETPLACE_MIN_TRADE_CATEGORIES", DEFAULT_MIN_TRADE_CATEGORIES),
        max_bids_per_request=max(1, min(int(getattr(location, "max_bids_per_request", 0) or _setting_int("MYHOMEBRO_MARKETPLACE_MAX_BIDS_PER_REQUEST", DEFAULT_MAX_BIDS_PER_REQUEST)), 10)),
    )


def get_marketplace_location(city: str, state: str) -> MarketplaceLocation | None:
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    if not city or not state:
        return None
    return MarketplaceLocation.objects.filter(city__iexact=city, state__iexact=state).first()


def _location_listing_qs(city: str, state: str):
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    return ContractorDirectoryListing.objects.select_related("claimed_contractor").filter(city__iexact=city, state__iexact=state)


def _location_entry_qs(city: str, state: str):
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    return ContractorDirectoryEntry.objects.select_related("claimed_by_contractor").filter(
        Q(city__iexact=city, state__iexact=state) | Q(service_city__iexact=city, service_state__iexact=state)
    )


def _listing_trades(listing: ContractorDirectoryListing) -> set[str]:
    trades = {normalize_trade(listing.primary_trade)}
    for item in listing.trade_categories or []:
        trades.add(normalize_trade(item))
    return {item for item in trades if item}


def _entry_trades(entry: ContractorDirectoryEntry) -> set[str]:
    trades = {normalize_trade(entry.primary_service)}
    for item in (entry.normalized_services or []) + (entry.services or []) + (entry.raw_services or []):
        trades.add(normalize_trade(item))
    return {item for item in trades if item}


def _contractor_stripe_ready(contractor: Contractor | None) -> bool:
    return bool(contractor and contractor.charges_enabled and contractor.payouts_enabled and not contractor.stripe_deauthorized_at)


def _contractor_suspended(contractor: Contractor | None) -> bool:
    user = getattr(contractor, "user", None)
    return bool(contractor and user and not getattr(user, "is_active", True))


def _listing_verified(listing: ContractorDirectoryListing) -> bool:
    return bool(listing.claimed_profile and listing.claimed_contractor_id and listing.manually_reviewed)


def _request_trades(intake: ProjectIntake) -> set[str]:
    source_text = " ".join(
        str(value or "")
        for value in [
            intake.ai_project_type,
            intake.ai_project_subtype,
            intake.ai_project_title,
            intake.accomplishment_text,
            intake.ai_description,
        ]
    ).lower()
    trades = set()
    for trade in CORE_TRADE_CATEGORIES:
        if trade in source_text:
            trades.add(trade)
    if "paint" in source_text:
        trades.add("painting")
    if "floor" in source_text:
        trades.add("flooring")
    if "roof" in source_text:
        trades.add("roofing")
    if "gutter" in source_text or "downspout" in source_text:
        trades.add("gutters")
    if "window" in source_text:
        trades.add("windows")
    if "carpenter" in source_text or "wood" in source_text or "trim" in source_text:
        trades.add("carpentry")
    if "remodel" in source_text or "renovation" in source_text:
        trades.add("remodeling")
    return {normalize_trade(trade) for trade in trades if normalize_trade(trade)}


def location_readiness(city: str, state: str) -> dict[str, Any]:
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    location = get_marketplace_location(city, state)
    thresholds = marketplace_thresholds(location)
    listings = list(_location_listing_qs(city, state))
    entries = list(_location_entry_qs(city, state))
    discovered_count = len(listings) + len(entries)
    claimed = [row for row in listings if row.claimed_profile and row.claimed_contractor_id]
    claimed_entries = [row for row in entries if row.claimed and row.claimed_by_contractor_id]
    verified = [row for row in claimed if _listing_verified(row)]
    verified_entries = [
        row
        for row in claimed_entries
        if row.profile_status == ContractorDirectoryEntry.PROFILE_REVIEWED
    ]
    stripe_ready = [row for row in verified if _contractor_stripe_ready(row.claimed_contractor)]
    stripe_ready_entries = [row for row in verified_entries if _contractor_stripe_ready(row.claimed_by_contractor)]
    trades = sorted(
        {trade for row in listings for trade in _listing_trades(row)}
        | {trade for row in entries for trade in _entry_trades(row)}
    )
    missing_trade_coverage = sorted(CORE_TRADE_CATEGORIES - set(trades))

    request_qs = ProjectIntake.objects.filter(project_city__iexact=city, project_state__iexact=state)
    request_count = request_qs.count()
    lead_count = PublicContractorLead.objects.filter(city__iexact=city, state__iexact=state).count()
    avg_bids = round(lead_count / request_count, 2) if request_count else 0.0

    checks = {
        "claimed_contractors": len(claimed) + len(claimed_entries) >= thresholds.min_claimed_contractors,
        "verified_contractors": len(verified) + len(verified_entries) >= thresholds.min_verified_contractors,
        "stripe_ready_contractors": len(stripe_ready) + len(stripe_ready_entries) >= thresholds.min_stripe_ready_contractors,
        "trade_categories": len(trades) >= thresholds.min_trade_categories,
        "manual_enabled": bool(location and location.is_enabled),
    }
    operationally_ready = all(checks[key] for key in ["claimed_contractors", "verified_contractors", "stripe_ready_contractors", "trade_categories"])
    if operationally_ready and checks["manual_enabled"]:
        status = MarketplaceLocation.STATUS_ENABLED
    elif operationally_ready:
        status = MarketplaceLocation.STATUS_READY
    elif (
        len(claimed) + len(claimed_entries) >= max(1, thresholds.min_claimed_contractors // 2)
        or len(verified) + len(verified_entries) >= max(1, thresholds.min_verified_contractors // 2)
        or len(trades) >= max(1, thresholds.min_trade_categories // 2)
    ):
        status = MarketplaceLocation.STATUS_NEARING_READY
    else:
        status = MarketplaceLocation.STATUS_NOT_READY

    return {
        "city": city,
        "state": state,
        "status": status,
        "enabled": status == MarketplaceLocation.STATUS_ENABLED,
        "manual_enabled": checks["manual_enabled"],
        "manual_approval_required": True,
        "thresholds": thresholds.__dict__,
        "counts": {
            "total_discovered": discovered_count,
            "claimed_contractors": len(claimed) + len(claimed_entries),
            "verified_contractors": len(verified) + len(verified_entries),
            "stripe_ready_contractors": len(stripe_ready) + len(stripe_ready_entries),
            "trade_categories": len(trades),
            "request_volume": request_count,
            "avg_bids_per_request": avg_bids,
        },
        "checks": checks,
        "trades_represented": trades,
        "missing_trade_coverage": missing_trade_coverage,
        "max_bids_per_request": thresholds.max_bids_per_request,
        "location_id": location.id if location else None,
        "admin_notes": location.admin_notes if location else "",
    }


def marketplace_enabled_for_intake(intake: ProjectIntake) -> dict[str, Any]:
    city = intake.project_city or intake.customer_city
    state = intake.project_state or intake.customer_state
    if not normalize_location_value(city) or not normalize_location_value(state):
        return {
            "city": normalize_location_value(city),
            "state": normalize_location_value(state),
            "status": MarketplaceLocation.STATUS_NOT_READY,
            "enabled": False,
            "message": "We need a project city and state before routing this request to vetted contractors.",
        }
    readiness = location_readiness(city, state)
    if readiness["enabled"]:
        readiness["message"] = f"Marketplace routing is enabled in {readiness['city']}, {readiness['state']}. We can invite up to {readiness['max_bids_per_request']} vetted contractors."
    else:
        readiness["message"] = f"Marketplace matching is not yet enabled in {readiness['city']}, {readiness['state']}. Your request is saved and can be routed when local coverage is ready."
    return readiness


def eligible_marketplace_listings(intake: ProjectIntake):
    city = intake.project_city or intake.customer_city
    state = intake.project_state or intake.customer_state
    request_trades = _request_trades(intake)
    qs = _location_listing_qs(city, state).filter(claimed_profile=True, claimed_contractor__isnull=False, manually_reviewed=True)
    rows = []
    for listing in qs:
        contractor = listing.claimed_contractor
        if _contractor_suspended(contractor) or not _contractor_stripe_ready(contractor):
            continue
        listing_trades = _listing_trades(listing)
        if request_trades and listing_trades and not (request_trades & listing_trades):
            continue
        rows.append(
            {
                "listing": listing,
                "trade_match": bool(request_trades & listing_trades) if request_trades and listing_trades else False,
                "stripe_ready": _contractor_stripe_ready(contractor),
            }
        )
    return [
        row["listing"]
        for row in sorted(
            rows,
            key=lambda item: (
                not item["trade_match"],
                -int(item["stripe_ready"]),
                -int(item["listing"].google_review_count or 0),
                item["listing"].business_name.lower(),
            ),
        )
    ]


@transaction.atomic
def create_marketplace_invites_for_intake(intake_id: int) -> dict[str, Any]:
    intake = ProjectIntake.objects.select_for_update().get(pk=intake_id)
    readiness = marketplace_enabled_for_intake(intake)
    max_bids = int(readiness.get("max_bids_per_request") or DEFAULT_MAX_BIDS_PER_REQUEST)
    open_statuses = [
        ContractorDiscoveryInvite.STATUS_PENDING,
        ContractorDiscoveryInvite.STATUS_SENT,
        ContractorDiscoveryInvite.STATUS_DELIVERED,
        ContractorDiscoveryInvite.STATUS_CLICKED,
        ContractorDiscoveryInvite.STATUS_CLAIMED,
        ContractorDiscoveryInvite.STATUS_RESPONDED,
    ]
    existing_qs = ContractorDiscoveryInvite.objects.select_for_update().filter(public_intake=intake, status__in=open_statuses)
    existing_count = existing_qs.count()
    if not readiness.get("enabled"):
        return {
            "created": [],
            "created_count": 0,
            "skipped_count": 0,
            "cap": max_bids,
            "cap_reached": existing_count >= max_bids,
            "marketplace": readiness,
        }
    if existing_count >= max_bids:
        return {
            "created": [],
            "created_count": 0,
            "skipped_count": 0,
            "cap": max_bids,
            "cap_reached": True,
            "marketplace": readiness,
        }

    existing_contractors = set(existing_qs.exclude(contractor__isnull=True).values_list("contractor_id", flat=True))
    created = []
    for listing in eligible_marketplace_listings(intake):
        if len(created) + existing_count >= max_bids:
            break
        if listing.claimed_contractor_id in existing_contractors:
            continue
        invite = ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            directory_listing=listing,
            contractor=listing.claimed_contractor,
            channel=ContractorDiscoveryInvite.CHANNEL_IN_APP,
            status=ContractorDiscoveryInvite.STATUS_PENDING,
            destination_email=getattr(listing.claimed_contractor, "email", "") or listing.email or "",
            destination_phone=getattr(listing.claimed_contractor, "phone", "") or listing.phone_number or "",
        )
        created.append(
            {
                "id": invite.id,
                "contractor_id": listing.claimed_contractor_id,
                "listing_id": listing.id,
                "business_name": listing.business_name,
            }
        )
        existing_contractors.add(listing.claimed_contractor_id)

    return {
        "created": created,
        "created_count": len(created),
        "skipped_count": max(0, len(eligible_marketplace_listings(intake)) - len(created)),
        "cap": max_bids,
        "cap_reached": len(created) + existing_count >= max_bids,
        "marketplace": readiness,
        "created_at": timezone.now().isoformat(),
    }
