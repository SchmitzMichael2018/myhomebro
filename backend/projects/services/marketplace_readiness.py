from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import Contractor, PublicContractorLead
from projects.models_contractor_discovery import AUTOMATIC_MATCHING_TRADES, ContractorDirectoryEntry, ContractorDirectoryListing, ContractorDiscoveryInvite, MarketplaceAutomaticMatchingApproval, MarketplaceLocation
from projects.models_project_intake import ProjectIntake
from projects.models_customer_portal import CustomerRequest, PropertyWorkOrder
from projects.services.contractor_opportunities import create_or_update_opportunity_from_selection
from projects.services.customer_lifecycle import upsert_customer_for_public_lead
from projects.services.marketplace_permissions import contractor_marketplace_action_block_reason
from projects.services.public_lead_pipeline import ensure_public_profile_for_contractor
from projects.services.workflow_notifications import notify_customer_bid_received, notify_marketplace_request_routed


DEFAULT_MIN_CLAIMED_CONTRACTORS = 20
DEFAULT_MIN_VERIFIED_CONTRACTORS = 10
DEFAULT_MIN_STRIPE_READY_CONTRACTORS = 5
DEFAULT_MIN_TRADE_CATEGORIES = 6
DEFAULT_MAX_BIDS_PER_REQUEST = 5
LOCATION_MISSING_STATUS = "location_needed"

CORE_TRADE_CATEGORIES = set(AUTOMATIC_MATCHING_TRADES)
_UNSET = object()


@dataclass(frozen=True)
class MarketplaceThresholds:
    min_claimed_contractors: int
    min_verified_contractors: int
    min_stripe_ready_contractors: int
    min_trade_categories: int
    max_bids_per_request: int


def marketplace_capabilities(readiness: dict[str, Any]) -> dict[str, bool]:
    """Describe location policy without conflating participation with routing."""
    return {
        "can_participate": True,
        "can_search": True,
        "can_direct_invite": True,
        "can_auto_route": bool(readiness.get("enabled")),
    }


def _with_marketplace_capabilities(readiness: dict[str, Any]) -> dict[str, Any]:
    capabilities = marketplace_capabilities(readiness)
    return {
        **readiness,
        "capabilities": capabilities,
        **capabilities,
        "can_save_request": True,
        "can_search_contractors": capabilities["can_search"],
        "request_saved": True,
        "saved_for_future_matching": not capabilities["can_auto_route"],
        "automatic_matching_available": capabilities["can_auto_route"],
    }


def customer_safe_marketplace_capability(
    readiness: dict[str, Any],
    *,
    automatic_routed_count: int = 0,
    direct_invitation_count: int = 0,
    archived: bool = False,
    terminal_reason: str = "",
) -> dict[str, Any]:
    """Return the additive Marketplace contract safe for customer-facing APIs."""
    automatic_routed_count = max(0, int(automatic_routed_count or 0))
    direct_invitation_count = max(0, int(direct_invitation_count or 0))
    automatic_matching_available = bool(readiness.get("can_auto_route")) and not archived and not terminal_reason
    status = str(readiness.get("status") or "")

    if archived or terminal_reason:
        reason_code = terminal_reason or "request_archived"
        status_label = "Request unavailable" if terminal_reason else "Request archived"
        message = "This request is no longer available for contractor search or invitations."
        routing_outcome = "archived" if reason_code == "request_archived" else "terminal"
    elif automatic_routed_count:
        reason_code = "automatically_routed"
        status_label = "Sent for automatic matching"
        message = (
            "Your request was sent to eligible contractors for consideration. "
            "You can also search for or invite a contractor directly."
        )
        routing_outcome = "automatic_routed"
    elif direct_invitation_count:
        reason_code = "contractor_invited"
        status_label = "Contractor invited"
        message = "A contractor was invited directly. Your request remains saved, and you can invite another eligible contractor."
        routing_outcome = "direct_invited"
    elif status == "active":
        reason_code = "automatic_matching_available"
        status_label = "Automatic matching available"
        message = (
            "Automatic matching is available, but this saved request has not been sent. "
            "Search for or invite a contractor directly, or continue through the existing matching workflow."
        )
        routing_outcome = "not_routed"
    elif status == "service_needed":
        reason_code = "trade_classification_needed"
        status_label = "Trade classification needed"
        message = (
            "Your request is saved, but MyHomeBro needs a clear service category before automatic matching "
            "can be evaluated. You can still search for or invite a contractor directly."
        )
        routing_outcome = "not_routed"
    elif status == "building_coverage" and readiness.get("manual_enabled"):
        reason_code = "no_eligible_contractors"
        status_label = "Manual contractor selection needed"
        message = (
            "Your request is saved. No eligible contractor is currently available for automatic matching, "
            "so manual contractor selection is needed."
        )
        routing_outcome = "not_routed"
    else:
        reason_code = "building_local_coverage"
        status_label = "Manual contractor selection needed"
        message = (
            "We're building contractor coverage for this service in your area. Your request is saved, but it "
            "will not be automatically sent to contractors. Choose a contractor below or invite one you already know."
        )
        routing_outcome = "not_routed"

    manual_selection_required = bool(
        not archived and not terminal_reason
        and not automatic_routed_count
        and not direct_invitation_count
        and not automatic_matching_available
    )
    can_search_contractors = not archived and not terminal_reason
    can_direct_invite = not archived and not terminal_reason
    next_actions = []
    if can_search_contractors:
        next_actions.append("search_contractors")
    if can_direct_invite:
        next_actions.append("direct_invite")

    return {
        "can_save_request": True,
        "can_search_contractors": can_search_contractors,
        "can_direct_invite": can_direct_invite,
        "automatic_matching_available": automatic_matching_available,
        "automatic_matching_status": reason_code,
        "automatic_matching_status_label": status_label,
        "manual_selection_required": manual_selection_required,
        "routing_outcome": routing_outcome,
        "automatic_routed_count": automatic_routed_count,
        "direct_invitation_count": direct_invitation_count,
        "customer_safe_reason_code": reason_code,
        "customer_safe_message": message,
        "customer_safe_next_actions": next_actions,
    }


def marketplace_request_action_block_reason(*, intake=None, customer_request=None, work_order=None) -> str:
    """One fail-closed lifecycle rule for customer and PM marketplace actions."""
    if customer_request is not None:
        if customer_request.converted_project_id or customer_request.status in {
            CustomerRequest.STATUS_CANCELLED, CustomerRequest.STATUS_CLOSED,
            CustomerRequest.STATUS_CONVERTED_TO_PROJECT,
        }:
            return "request_closed"
        intake = intake or getattr(customer_request, "source_intake", None)
    if work_order is not None:
        if work_order.status in {
            PropertyWorkOrder.STATUS_COMPLETED, PropertyWorkOrder.STATUS_CLOSED,
            PropertyWorkOrder.STATUS_CANCELLED,
        } or work_order.linked_agreement_id or work_order.marketplace_status == PropertyWorkOrder.MARKETPLACE_ACCEPTED:
            return "request_closed"
    if intake is not None:
        if intake.marketplace_archived_at or intake.traffic_classification == "archived":
            return "request_archived"
        if intake.traffic_classification == "spam_fraud":
            return "request_closed"
        if intake.status == "converted" or intake.converted_at or intake.agreement_id:
            return "request_closed"
        if CustomerRequest.objects.filter(source_intake=intake).filter(
            Q(converted_project__isnull=False)
            | Q(status__in=[CustomerRequest.STATUS_CANCELLED, CustomerRequest.STATUS_CLOSED, CustomerRequest.STATUS_CONVERTED_TO_PROJECT])
        ).exists():
            return "request_closed"
    return ""


def automatic_invite_ids_for_intake(intake: ProjectIntake) -> set[int]:
    """Automatic invites are linked from their marketplace lead, not inferred from opportunities."""
    return {
        analysis["marketplace_invite_id"]
        for analysis in PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).values_list("ai_analysis", flat=True)
        if isinstance(analysis, dict) and analysis.get("marketplace_request") and isinstance(analysis.get("marketplace_invite_id"), int)
    }


def normalize_location_value(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def automatic_matching_location_keys(city: Any, state: Any) -> tuple[str, str]:
    return normalize_location_value(city).casefold(), normalize_location_value(state).upper()


def intake_marketplace_location(intake: ProjectIntake) -> tuple[str, str, str]:
    # A project and customer address must not be spliced into a fictitious location.
    for prefix in ("project", "customer"):
        if prefix == "customer" and not intake.same_as_customer_address:
            continue
        city = normalize_location_value(getattr(intake, f"{prefix}_city", ""))
        state = normalize_location_value(getattr(intake, f"{prefix}_state", ""))
        if city and state:
            return city, state, normalize_location_value(getattr(intake, f"{prefix}_postal_code", ""))
    project_zip = normalize_location_value(intake.project_postal_code)
    customer_zip = normalize_location_value(intake.customer_postal_code) if intake.same_as_customer_address else ""
    return "", "", project_zip or customer_zip


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
        max_bids_per_request=max(
            1,
            min(
                int(getattr(location, "max_bids_per_request", 0) or _setting_int("MYHOMEBRO_MARKETPLACE_MAX_BIDS_PER_REQUEST", DEFAULT_MAX_BIDS_PER_REQUEST)),
                DEFAULT_MAX_BIDS_PER_REQUEST,
            ),
        ),
    )


def matching_marketplace_locations(city: str, state: str) -> list[MarketplaceLocation]:
    city_key, state_key = automatic_matching_location_keys(city, state)
    if not city_key or not state_key:
        return []
    candidates = MarketplaceLocation.objects.filter(
        city__icontains=city_key.split()[0], state__icontains=state_key,
    ).order_by("id")
    return [
        row for row in candidates
        if automatic_matching_location_keys(row.city, row.state) == (city_key, state_key)
    ]


def get_marketplace_location(city: str, state: str) -> MarketplaceLocation | None:
    return next(iter(matching_marketplace_locations(city, state)), None)


def _location_listings(city: str, state: str):
    city_key, state_key = automatic_matching_location_keys(city, state)
    if not city_key or not state_key:
        return []
    # Directory imports can retain whitespace and casing from their source.
    # Narrow in SQL, then apply the same authoritative key as approvals.
    candidates = ContractorDirectoryListing.objects.select_related("claimed_contractor").filter(
        city__icontains=city_key.split()[0], state__icontains=state_key,
    )
    return [
        row for row in candidates
        if automatic_matching_location_keys(row.city, row.state) == (city_key, state_key)
    ]


def _location_entries(city: str, state: str):
    city_key, state_key = automatic_matching_location_keys(city, state)
    if not city_key or not state_key:
        return []
    candidates = ContractorDirectoryEntry.objects.select_related("claimed_by_contractor").filter(
        Q(city__icontains=city_key.split()[0], state__icontains=state_key)
        | Q(service_city__icontains=city_key.split()[0], service_state__icontains=state_key)
    )
    return [
        row for row in candidates
        if (city_key, state_key) in {
            automatic_matching_location_keys(row.city, row.state),
            automatic_matching_location_keys(row.service_city, row.service_state),
        }
    ]


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
    return bool(
        contractor
        and (
            getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_SUSPENDED
            or (user and not getattr(user, "is_active", True))
        )
    )


def _contractor_marketplace_verified(contractor: Contractor | None) -> bool:
    return bool(contractor and getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED)


def _contractor_marketplace_preferred(contractor: Contractor | None) -> bool:
    return bool(
        contractor
        and getattr(contractor, "marketplace_preferred", False)
        and _contractor_marketplace_verified(contractor)
        and not _contractor_suspended(contractor)
    )


def _listing_verified(listing: ContractorDirectoryListing) -> bool:
    return bool(
        listing.claimed_profile
        and listing.claimed_contractor_id
        and listing.manually_reviewed
        and _contractor_marketplace_verified(listing.claimed_contractor)
        and not _contractor_suspended(listing.claimed_contractor)
    )


def _request_trades(intake: ProjectIntake) -> set[str]:
    def from_text(source_text: str) -> set[str]:
        source_text = source_text.lower()
        trades = {trade for trade in CORE_TRADE_CATEGORIES if trade in source_text}
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

    # Only classified fields may authorize an automatic match. A title or
    # description mentioning a trade is not an authoritative classification.
    return from_text(" ".join(
        str(value or "") for value in (intake.ai_project_type, intake.ai_project_subtype)
    ))


def marketplace_request_trade_signature(intake: ProjectIntake) -> tuple[str, ...]:
    return tuple(sorted(_request_trades(intake)))


def automatic_matching_readiness(
    city: str,
    state: str,
    trade: str,
    *,
    listings: list[ContractorDirectoryListing] | None = None,
    location_matches: list[MarketplaceLocation] | None = None,
    approval: MarketplaceAutomaticMatchingApproval | None | object = _UNSET,
) -> dict[str, Any]:
    """Fail-closed location-and-trade gate backed only by routable supply."""
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    trade = normalize_trade(trade)
    if location_matches is None:
        location_matches = matching_marketplace_locations(city, state)
    location = location_matches[0] if len(location_matches) == 1 else None
    thresholds = marketplace_thresholds(location)
    claimed_ids: set[int] = set()
    verified_ids: set[int] = set()
    payment_ready_ids: set[int] = set()
    if city and state and trade in CORE_TRADE_CATEGORIES:
        if listings is None:
            listings = _location_listings(city, state)
        for listing in listings:
            if not (listing.claimed_profile and listing.claimed_contractor_id and listing.manually_reviewed):
                continue
            if trade not in _listing_trades(listing):
                continue
            contractor = listing.claimed_contractor
            if contractor_marketplace_action_block_reason(contractor):
                continue
            claimed_ids.add(contractor.id)
            if _listing_verified(listing):
                verified_ids.add(contractor.id)
                if _contractor_stripe_ready(contractor):
                    payment_ready_ids.add(contractor.id)
    checks = {
        "claimed_contractors": len(claimed_ids) >= thresholds.min_claimed_contractors,
        "verified_contractors": len(verified_ids) >= thresholds.min_verified_contractors,
        "stripe_ready_contractors": len(payment_ready_ids) >= thresholds.min_stripe_ready_contractors,
    }
    supply_ready = bool(payment_ready_ids) and all(checks.values())
    if approval is _UNSET and city and state and trade in CORE_TRADE_CATEGORIES:
        city_key, state_key = automatic_matching_location_keys(city, state)
        approval = MarketplaceAutomaticMatchingApproval.objects.filter(
            city_key=city_key, state_key=state_key, trade=trade,
        ).first()
    elif approval is _UNSET:
        approval = None
    approved = bool(approval and approval.is_approved)
    paused = bool(approval and not approval.is_approved)
    if not city or not state or trade not in CORE_TRADE_CATEGORIES:
        status = LOCATION_MISSING_STATUS if not city or not state else "service_needed"
    elif len(location_matches) > 1:
        status = "location_review_needed"
    elif paused:
        status = "paused"
    elif not supply_ready:
        status = "building_coverage"
    elif not approved:
        status = "awaiting_approval"
    else:
        status = "active"
    return _with_marketplace_capabilities({
        "city": city, "state": state, "trade": trade,
        "status": status, "enabled": status == "active",
        "manual_enabled": approved, "manual_approval_required": True,
        "thresholds": thresholds.__dict__,
        "counts": {
            "claimed_contractors": len(claimed_ids),
            "verified_contractors": len(verified_ids),
            "stripe_ready_contractors": len(payment_ready_ids),
        },
        "checks": checks,
        "coverage_gaps": [name for name, passed in checks.items() if not passed],
        "max_bids_per_request": thresholds.max_bids_per_request,
        "location_id": location.id if location else None,
        "routing_paused_at": approval.updated_at.isoformat() if paused else None,
    })


def automatic_matching_readiness_rows(
    city: str,
    state: str,
    *,
    listings: list[ContractorDirectoryListing] | None = None,
    entries: list[ContractorDirectoryEntry] | None = None,
    location_matches: list[MarketplaceLocation] | None = None,
    approvals: dict[str, MarketplaceAutomaticMatchingApproval] | None = None,
) -> list[dict[str, Any]]:
    """Show services represented by supply or explicitly reviewed by admins."""
    city_key, state_key = automatic_matching_location_keys(city, state)
    if approvals is None:
        approvals = {
            row.trade: row
            for row in MarketplaceAutomaticMatchingApproval.objects.filter(
                city_key=city_key,
                state_key=state_key,
            )
        }
    trades = set(approvals)
    if listings is None:
        listings = _location_listings(city, state)
    for listing in listings:
        trades.update(_listing_trades(listing))
    if entries is None:
        entries = _location_entries(city, state)
    for entry in entries:
        trades.update(_entry_trades(entry))
    return [
        automatic_matching_readiness(
            city,
            state,
            trade,
            listings=listings,
            location_matches=location_matches,
            approval=approvals.get(trade),
        )
        for trade in sorted(trades & CORE_TRADE_CATEGORIES)
    ]


def automatic_matching_readiness_rows_for_locations(
    location_keys: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    """Build all readiness rows before slicing so filtered totals stay authoritative.

    Query count is fixed, but CPU and memory still scale with the full listing,
    entry, location, and approval populations. Reassess this batch aggregation
    against production volume before substantially expanding the directory.
    """
    normalized_locations = {
        automatic_matching_location_keys(city, state): (city, state)
        for city, state in location_keys
        if city and state
    }
    listings_by_location = defaultdict(list)
    listings = ContractorDirectoryListing.objects.select_related(
        "claimed_contractor",
        "claimed_contractor__user",
    )
    for listing in listings.iterator(chunk_size=500):
        key = automatic_matching_location_keys(listing.city, listing.state)
        if key in normalized_locations:
            listings_by_location[key].append(listing)

    entries_by_location = defaultdict(list)
    entries = ContractorDirectoryEntry.objects.all()
    for entry in entries.iterator(chunk_size=500):
        for key in {
            automatic_matching_location_keys(entry.city, entry.state),
            automatic_matching_location_keys(
                entry.service_city,
                entry.service_state,
            ),
        }:
            if key in normalized_locations:
                entries_by_location[key].append(entry)

    configured_locations = defaultdict(list)
    for location in MarketplaceLocation.objects.all().order_by("id"):
        key = automatic_matching_location_keys(location.city, location.state)
        if key in normalized_locations:
            configured_locations[key].append(location)

    approvals_by_location = defaultdict(dict)
    for approval in MarketplaceAutomaticMatchingApproval.objects.all().order_by("id"):
        key = (approval.city_key, approval.state_key)
        if key in normalized_locations:
            approvals_by_location[key][approval.trade] = approval

    return [
        row
        for key, (city, state) in sorted(normalized_locations.items())
        for row in automatic_matching_readiness_rows(
            city,
            state,
            listings=listings_by_location[key],
            entries=entries_by_location[key],
            location_matches=configured_locations[key],
            approvals=approvals_by_location[key],
        )
    ]


def location_readiness(city: str, state: str) -> dict[str, Any]:
    """Legacy citywide coverage metrics; never an automatic-routing decision."""
    city = normalize_location_value(city)
    state = normalize_location_value(state)
    if not city or not state:
        thresholds = marketplace_thresholds()
        return _with_marketplace_capabilities({
            "city": city, "state": state, "status": LOCATION_MISSING_STATUS,
            "enabled": False, "manual_enabled": False, "manual_approval_required": True,
            "thresholds": thresholds.__dict__,
            "counts": {
                "total_discovered": 0, "claimed_contractors": 0,
                "verified_contractors": 0, "stripe_ready_contractors": 0,
                "trade_categories": 0, "request_volume": 0, "avg_bids_per_request": 0.0,
            },
            "checks": {
                "claimed_contractors": False, "verified_contractors": False,
                "stripe_ready_contractors": False, "trade_categories": False,
                "manual_enabled": False,
            },
            "trades_represented": [], "missing_trade_coverage": sorted(CORE_TRADE_CATEGORIES),
            "max_bids_per_request": thresholds.max_bids_per_request,
            "location_id": None, "admin_notes": "",
            "activated_at": None, "routing_paused_at": None,
        })
    location = get_marketplace_location(city, state)
    thresholds = marketplace_thresholds(location)
    listings = _location_listings(city, state)
    entries = _location_entries(city, state)
    discovered_count = len(listings) + len(entries)
    claimed = [row for row in listings if row.claimed_profile and row.claimed_contractor_id]
    claimed_entries = [row for row in entries if row.claimed and row.claimed_by_contractor_id]
    verified = [row for row in claimed if _listing_verified(row)]
    verified_entries = [
        row
        for row in claimed_entries
        if row.profile_status == ContractorDirectoryEntry.PROFILE_REVIEWED
        and _contractor_marketplace_verified(row.claimed_by_contractor)
        and not _contractor_suspended(row.claimed_by_contractor)
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
    if operationally_ready:
        status = MarketplaceLocation.STATUS_READY
    elif (
        len(claimed) + len(claimed_entries) >= max(1, thresholds.min_claimed_contractors // 2)
        or len(verified) + len(verified_entries) >= max(1, thresholds.min_verified_contractors // 2)
        or len(trades) >= max(1, thresholds.min_trade_categories // 2)
    ):
        status = MarketplaceLocation.STATUS_NEARING_READY
    else:
        status = MarketplaceLocation.STATUS_NOT_READY

    return _with_marketplace_capabilities({
        "city": city,
        "state": state,
        "status": status,
        "enabled": False,
        "legacy_city_switch_enabled": checks["manual_enabled"],
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
        "activated_at": location.enabled_at.isoformat() if location and location.enabled_at else None,
        "routing_paused_at": location.disabled_at.isoformat() if location and location.disabled_at else None,
    })


def marketplace_enabled_for_intake(intake: ProjectIntake) -> dict[str, Any]:
    city, state, _zip_code = intake_marketplace_location(intake)
    signature = marketplace_request_trade_signature(intake)
    # Multi-trade and unclassified requests require manual selection until an
    # explicit service can be chosen. No city approval may override this.
    readiness = automatic_matching_readiness(city, state, signature[0] if len(signature) == 1 else "")
    if readiness["can_auto_route"]:
        readiness["message"] = f"Automatic matching is available for {readiness['trade']} in {readiness['city']}, {readiness['state']}."
        readiness["coverage_message"] = "Service coverage is ready"
        readiness["automatic_matching_message"] = "Automatic matching is available for this service and location."
    else:
        readiness["message"] = "Your request is saved. Automatic matching is not yet available for this service and location; contractor search and direct invitations remain available until eligible supply is sufficient and approved."
        readiness["coverage_message"] = "Building local coverage"
        readiness["automatic_matching_message"] = "Automatic matching is not yet available for this service and location."
    readiness["direct_invitation_message"] = "Direct contractor invitations are available."
    readiness.update(customer_safe_marketplace_capability(readiness))
    return readiness


def eligible_marketplace_listings(intake: ProjectIntake):
    city, state, _zip_code = intake_marketplace_location(intake)
    if not city or not state:
        return []
    request_trades = _request_trades(intake)
    if len(request_trades) != 1:
        return []
    listings = _location_listings(city, state)
    rows = []
    for listing in listings:
        if not (listing.claimed_profile and listing.claimed_contractor_id and listing.manually_reviewed):
            continue
        contractor = listing.claimed_contractor
        if contractor_marketplace_action_block_reason(contractor) or not _listing_verified(listing) or not _contractor_stripe_ready(contractor):
            continue
        listing_trades = _listing_trades(listing)
        if not (request_trades & listing_trades):
            continue
        rows.append(
            {
                "listing": listing,
                "trade_match": bool(request_trades & listing_trades) if request_trades and listing_trades else False,
                "stripe_ready": _contractor_stripe_ready(contractor),
                "preferred": _contractor_marketplace_preferred(contractor),
            }
        )
    return [
        row["listing"]
        for row in sorted(
            rows,
            key=lambda item: (
                not item["trade_match"],
                -int(item["preferred"]),
                -int(item["stripe_ready"]),
                -int(item["listing"].google_review_count or 0),
                item["listing"].business_name.lower(),
            ),
        )
    ]


def _project_address_from_intake(intake: ProjectIntake) -> str:
    return ", ".join(
        part
        for part in [
            normalize_location_value(getattr(intake, "project_address_line1", "")),
            normalize_location_value(getattr(intake, "project_address_line2", "")),
        ]
        if part
    )


def _marketplace_selection_payload(intake: ProjectIntake, listing: ContractorDirectoryListing, readiness: dict[str, Any]) -> dict[str, Any]:
    analysis = getattr(intake, "ai_analysis_payload", None) or {}
    return {
        **analysis,
        "homeowner_name": normalize_location_value(getattr(intake, "customer_name", "")),
        "homeowner_email": normalize_location_value(getattr(intake, "customer_email", "")),
        "homeowner_phone": normalize_location_value(getattr(intake, "customer_phone", "")),
        "project_title": normalize_location_value(getattr(intake, "ai_project_title", "")),
        "project_type": normalize_location_value(getattr(intake, "ai_project_type", "")) or normalize_location_value(listing.primary_trade),
        "project_subtype": normalize_location_value(getattr(intake, "ai_project_subtype", "")),
        "project_description": normalize_location_value(getattr(intake, "accomplishment_text", "")),
        "description": normalize_location_value(getattr(intake, "ai_description", "")) or normalize_location_value(getattr(intake, "accomplishment_text", "")),
        "project_address": _project_address_from_intake(intake),
        "project_address_line1": normalize_location_value(getattr(intake, "project_address_line1", "")),
        "project_city": normalize_location_value(getattr(intake, "project_city", "")),
        "project_state": normalize_location_value(getattr(intake, "project_state", "")),
        "project_postal_code": normalize_location_value(getattr(intake, "project_postal_code", "")),
        "timeline": normalize_location_value(getattr(intake, "desired_timing_text", "")),
        "marketplace": {
            "city": readiness.get("city"),
            "state": readiness.get("state"),
            "cap": readiness.get("max_bids_per_request"),
            "listing_id": listing.id,
            "business_name": listing.business_name,
        },
    }


def _sync_opportunity_for_invite(
    *,
    intake: ProjectIntake,
    listing: ContractorDirectoryListing,
    invite: ContractorDiscoveryInvite,
    readiness: dict[str, Any],
):
    contractor = listing.claimed_contractor
    opportunity = create_or_update_opportunity_from_selection(
        {
            "selection": {"id": f"contractor:{contractor.id}"},
            "intake_request": intake,
            "payload": _marketplace_selection_payload(intake, listing, readiness),
            "suppress_contractor_notification": True,
        }
    )
    entry = getattr(opportunity, "directory_entry", None)
    if isinstance(entry, ContractorDirectoryEntry):
        update_fields = []
        listing_updates = {
            "business_name": listing.business_name,
            "city": listing.city,
            "state": listing.state,
            "zip_code": listing.zip_code,
            "primary_service": listing.primary_trade,
            "normalized_services": [normalize_trade(item) for item in (listing.trade_categories or []) if normalize_trade(item)],
            "services": listing.trade_categories or [],
            "profile_status": ContractorDirectoryEntry.PROFILE_REVIEWED,
            "claimed": True,
            "claimed_by_contractor": contractor,
        }
        for field, value in listing_updates.items():
            if value in (None, "", []):
                continue
            if getattr(entry, field) != value:
                setattr(entry, field, value)
                update_fields.append(field)
        if update_fields:
            update_fields.append("last_seen_at")
            entry.save(update_fields=list(dict.fromkeys(update_fields)))
    return opportunity


def _lead_analysis_for_marketplace(
    *,
    intake: ProjectIntake,
    listing: ContractorDirectoryListing,
    invite: ContractorDiscoveryInvite,
    opportunity,
    readiness: dict[str, Any],
) -> dict[str, Any]:
    analysis = getattr(intake, "ai_analysis_payload", None) or {}
    original_description = normalize_location_value(getattr(intake, "accomplishment_text", ""))
    refined_description = normalize_location_value(getattr(intake, "ai_description", ""))
    return {
        **analysis,
        "marketplace_request": True,
        "source_intake_id": intake.id,
        "marketplace_invite_id": invite.id,
        "contractor_opportunity_id": getattr(opportunity, "id", None),
        "marketplace_status": "opportunity_sent",
        "marketplace_city": readiness.get("city"),
        "marketplace_state": readiness.get("state"),
        "marketplace_bid_cap": readiness.get("max_bids_per_request"),
        "directory_listing_id": listing.id,
        "business_name": listing.business_name,
        "original_description": original_description,
        "refined_description": refined_description,
        "project_scope_summary": refined_description or original_description or analysis.get("project_scope_summary", ""),
        "project_type": normalize_location_value(getattr(intake, "ai_project_type", "")) or normalize_location_value(listing.primary_trade),
        "project_subtype": normalize_location_value(getattr(intake, "ai_project_subtype", "")),
        "request_path_label": "Marketplace Request",
    }


def _sync_public_lead_for_marketplace(
    *,
    intake: ProjectIntake,
    listing: ContractorDirectoryListing,
    invite: ContractorDiscoveryInvite,
    opportunity,
    readiness: dict[str, Any],
) -> PublicContractorLead:
    contractor = listing.claimed_contractor
    profile = ensure_public_profile_for_contractor(contractor)
    analysis = _lead_analysis_for_marketplace(
        intake=intake,
        listing=listing,
        invite=invite,
        opportunity=opportunity,
        readiness=readiness,
    )
    defaults = {
        "public_profile": profile,
        "source": PublicContractorLead.SOURCE_QUOTE_REQUEST,
        "full_name": normalize_location_value(getattr(intake, "customer_name", "")) or "Marketplace Request",
        "email": normalize_location_value(getattr(intake, "customer_email", "")),
        "phone": normalize_location_value(getattr(intake, "customer_phone", "")),
        "project_address": _project_address_from_intake(intake),
        "city": normalize_location_value(getattr(intake, "project_city", "")),
        "state": normalize_location_value(getattr(intake, "project_state", "")),
        "zip_code": normalize_location_value(getattr(intake, "project_postal_code", "")),
        "project_type": analysis["project_type"],
        "project_description": normalize_location_value(getattr(intake, "accomplishment_text", "")) or analysis.get("project_scope_summary", ""),
        "preferred_timeline": normalize_location_value(getattr(intake, "desired_timing_text", "")),
        "budget_text": normalize_location_value(getattr(intake, "budget_range_text", "")),
        "status": PublicContractorLead.STATUS_READY_FOR_REVIEW,
        "internal_notes": f"Marketplace request routed from intake #{intake.id}.",
        "ai_analysis": analysis,
    }
    lead = PublicContractorLead.objects.filter(
        contractor=contractor,
        ai_analysis__source_intake_id=intake.id,
    ).first()
    if lead is None:
        lead = PublicContractorLead.objects.create(contractor=contractor, **defaults)
    else:
        for field, value in defaults.items():
            setattr(lead, field, value)
        lead.save(update_fields=[*defaults.keys(), "updated_at"])
    upsert_customer_for_public_lead(lead, source=lead.source or PublicContractorLead.SOURCE_QUOTE_REQUEST)
    return lead


@transaction.atomic
def create_marketplace_invites_for_intake(intake_id: int) -> dict[str, Any]:
    intake = ProjectIntake.objects.select_for_update().get(pk=intake_id)
    readiness = marketplace_enabled_for_intake(intake)
    max_bids = int(readiness.get("max_bids_per_request") or DEFAULT_MAX_BIDS_PER_REQUEST)
    block_reason = marketplace_request_action_block_reason(intake=intake)
    if block_reason:
        safe_capability = customer_safe_marketplace_capability(
            readiness,
            terminal_reason=block_reason,
        )
        return {
            **safe_capability,
            "created": [],
            "created_count": 0,
            "skipped_count": 0,
            "cap": max_bids,
            "cap_reached": False,
            "archived": block_reason == "request_archived",
            "terminal": block_reason != "request_archived",
            "marketplace": {**readiness, **safe_capability, "can_auto_route": False},
        }
    open_statuses = [
        ContractorDiscoveryInvite.STATUS_PENDING,
        ContractorDiscoveryInvite.STATUS_SENT,
        ContractorDiscoveryInvite.STATUS_DELIVERED,
        ContractorDiscoveryInvite.STATUS_CLICKED,
        ContractorDiscoveryInvite.STATUS_CLAIMED,
        ContractorDiscoveryInvite.STATUS_RESPONDED,
    ]
    existing_qs = ContractorDiscoveryInvite.objects.select_for_update().filter(
        public_intake=intake, pk__in=automatic_invite_ids_for_intake(intake), status__in=open_statuses,
    )
    existing_count = existing_qs.count()
    if not readiness.get("can_auto_route"):
        safe_capability = customer_safe_marketplace_capability(
            readiness,
            automatic_routed_count=existing_count,
        )
        return {
            **safe_capability,
            "created": [],
            "created_count": 0,
            "skipped_count": 0,
            "cap": max_bids,
            "cap_reached": existing_count >= max_bids,
            "marketplace": {**readiness, **safe_capability},
        }
    if existing_count >= max_bids:
        safe_capability = customer_safe_marketplace_capability(
            readiness,
            automatic_routed_count=existing_count,
        )
        return {
            **safe_capability,
            "created": [],
            "created_count": 0,
            "skipped_count": 0,
            "cap": max_bids,
            "cap_reached": True,
            "marketplace": {**readiness, **safe_capability},
        }

    existing_contractors = set(
        ContractorDiscoveryInvite.objects.filter(public_intake=intake, status__in=open_statuses)
        .exclude(contractor__isnull=True).values_list("contractor_id", flat=True)
    )
    created = []
    routed_leads = []
    eligible_listings = eligible_marketplace_listings(intake)
    for existing_invite in existing_qs.select_related("directory_listing", "contractor"):
        if existing_invite.contractor_id and existing_invite.directory_listing_id:
            opportunity = _sync_opportunity_for_invite(
                intake=intake,
                listing=existing_invite.directory_listing,
                invite=existing_invite,
                readiness=readiness,
            )
            lead = _sync_public_lead_for_marketplace(
                intake=intake,
                listing=existing_invite.directory_listing,
                invite=existing_invite,
                opportunity=opportunity,
                readiness=readiness,
            )
            routed_leads.append(lead)

    for listing in eligible_listings:
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
        opportunity = _sync_opportunity_for_invite(
            intake=intake,
            listing=listing,
            invite=invite,
            readiness=readiness,
        )
        lead = _sync_public_lead_for_marketplace(
            intake=intake,
            listing=listing,
            invite=invite,
            opportunity=opportunity,
            readiness=readiness,
        )
        routed_leads.append(lead)
        lead_id = lead.id
        transaction.on_commit(
            lambda lead_id=lead_id: notify_customer_bid_received(lead=PublicContractorLead.objects.get(pk=lead_id)),
            robust=True,
        )
        created.append(
            {
                "id": invite.id,
                "contractor_id": listing.claimed_contractor_id,
                "listing_id": listing.id,
                "contractor_opportunity_id": opportunity.id,
                "public_lead_id": lead.id,
                "business_name": listing.business_name,
            }
        )
        existing_contractors.add(listing.claimed_contractor_id)

    if routed_leads:
        intake_id_for_notice = intake.id
        lead_ids_for_notice = [lead.id for lead in routed_leads]
        transaction.on_commit(
            lambda: notify_marketplace_request_routed(
                intake=ProjectIntake.objects.get(pk=intake_id_for_notice),
                leads=list(PublicContractorLead.objects.filter(pk__in=lead_ids_for_notice)),
            ),
            robust=True,
        )

    safe_capability = customer_safe_marketplace_capability(
        readiness,
        automatic_routed_count=len(created) + existing_count,
    )
    return {
        **safe_capability,
        "created": created,
        "created_count": len(created),
        "skipped_count": max(0, len(eligible_listings) - len(created) - existing_count),
        "cap": max_bids,
        "cap_reached": len(created) + existing_count >= max_bids,
        "marketplace": {**readiness, **safe_capability},
        "created_at": timezone.now().isoformat(),
    }
