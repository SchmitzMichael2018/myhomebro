from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta
from typing import Any

from django.db.models import Q
from django.utils import timezone

from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
    ContractorOpportunity,
)
from projects.services.marketplace_readiness import (
    automatic_matching_location_keys,
    automatic_matching_readiness_rows_for_locations,
    intake_marketplace_location,
    marketplace_request_trade_signature,
    normalize_location_value,
    normalize_trade,
)
from projects.services.marketplace_request_lifecycle import (
    meaningful_response_intake_ids,
    qualifying_marketplace_requests,
    request_started_at,
)


CONTRACTOR_DEMAND_PRIVACY_THRESHOLD = 3
PAGE_SIZES = {25, 50, 100}
DEFAULT_PAGE_SIZE = 25
SORTS = {
    "strongest_demand",
    "newest_demand",
    "largest_coverage_gap",
    "closest_to_readiness",
    "area_name",
}
RELATIONSHIPS = {
    "in_service_area",
    "expansion_opportunity",
    "readiness_needed",
    "outside_current_coverage",
}
RELATIONSHIP_LABELS = {
    "in_service_area": "In your service area",
    "expansion_opportunity": "Expansion opportunity",
    "readiness_needed": "Readiness needed",
    "outside_current_coverage": "Outside your current coverage",
}
TIME_WINDOWS = {"30d": 30, "90d": 90, "12m": 365}


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _location_parts(value: Any, fallback_state: str) -> tuple[str, str]:
    text = normalize_location_value(value)
    if not text:
        return "", ""
    city, separator, state = text.rpartition(",")
    if separator:
        return normalize_location_value(city), normalize_location_value(state).upper()
    return text, fallback_state


def _contractor_context(contractor) -> dict[str, Any]:
    profile = getattr(contractor, "public_profile", None)
    base_city = normalize_location_value(contractor.city)
    base_state = normalize_location_value(contractor.state).upper()
    service_locations = set()
    if base_city and base_state:
        service_locations.add(automatic_matching_location_keys(base_city, base_state))

    if profile:
        profile_city = normalize_location_value(profile.city)
        profile_state = normalize_location_value(profile.state).upper() or base_state
        if profile_city and profile_state:
            service_locations.add(
                automatic_matching_location_keys(profile_city, profile_state)
            )
        for value in profile.service_cities or []:
            city, state = _location_parts(value, profile_state)
            if city and state:
                service_locations.add(automatic_matching_location_keys(city, state))

    entries = ContractorDirectoryEntry.objects.filter(
        claimed_by_contractor=contractor,
        is_archived=False,
    ).values_list("city", "state", "service_city", "service_state")
    for city, state, service_city, service_state in entries:
        for location_city, location_state in (
            (city, state),
            (service_city, service_state),
        ):
            if location_city and location_state:
                service_locations.add(
                    automatic_matching_location_keys(location_city, location_state)
                )

    listings = ContractorDirectoryListing.objects.filter(
        claimed_contractor=contractor,
    ).exclude(
        business_status__iexact="CLOSED_PERMANENTLY"
    ).values_list("city", "state")
    for city, state in listings:
        if city and state:
            service_locations.add(automatic_matching_location_keys(city, state))

    offered_trades = {
        normalize_trade(value)
        for value in (
            list(contractor.skills.values_list("name", flat=True))
            + list(contractor.custom_services or [])
            + ([profile.primary_trade] if profile else [])
            + (list(profile.specialties or []) if profile else [])
            + (list(profile.work_types or []) if profile else [])
        )
        if normalize_trade(value)
    }
    claimed = bool(profile) or ContractorDirectoryEntry.objects.filter(
        claimed_by_contractor=contractor,
        claimed=True,
        is_archived=False,
    ).exists() or ContractorDirectoryListing.objects.filter(
        claimed_contractor=contractor,
        claimed_profile=True,
    ).exists()
    payment_ready = bool(
        contractor.charges_enabled
        and contractor.payouts_enabled
        and not contractor.stripe_deauthorized_at
    )
    verified = (
        contractor.marketplace_verification_status
        == contractor.MARKETPLACE_VERIFIED
    )
    return {
        "base_state": base_state,
        "service_locations": service_locations,
        "offered_trades": offered_trades,
        "claimed": claimed,
        "verified": verified,
        "payment_ready": payment_ready,
    }


def _authorized_opportunity_count(contractor) -> int:
    return (
        ContractorOpportunity.objects.filter(
            Q(directory_entry__claimed_by_contractor=contractor)
            | Q(accepted_by_contractor=contractor)
        )
        .distinct()
        .count()
    )


def _recommended_action(readiness: dict[str, bool], relationship: str) -> dict[str, str]:
    if not readiness["claimed_profile"]:
        return {"label": "Complete profile", "url": "/app/marketing"}
    if not readiness["approved_verification"]:
        return {"label": "Complete verification", "url": "/app/profile"}
    if not readiness["payment_ready"]:
        return {"label": "Complete payment setup", "url": "/app/onboarding/stripe"}
    if not readiness["matching_trade"]:
        return {"label": "Add an offered trade", "url": "/app/profile"}
    if not readiness["matching_service_area"]:
        return {"label": "Add or edit service area", "url": "/app/profile"}
    if relationship == "in_service_area":
        return {"label": "Review authorized opportunities", "url": "/app/opportunities"}
    return {"label": "Review service area", "url": "/app/profile"}


def build_contractor_service_area_opportunities(contractor, params) -> dict[str, Any]:
    context = _contractor_context(contractor)
    requests = qualifying_marketplace_requests()
    time_window = normalize_location_value(params.get("time_window")).lower()
    if time_window not in TIME_WINDOWS:
        time_window = "all"
    now = timezone.now()
    cutoffs = {
        name: now - timedelta(days=days)
        for name, days in TIME_WINDOWS.items()
    }

    # The lifecycle's responded state is no longer open demand. Routed but
    # unanswered requests remain eligible; a meaningful response does not.
    responded_ids = meaningful_response_intake_ids(
        requests.values_list("id", flat=True)
    )
    if responded_ids:
        requests = requests.exclude(pk__in=responded_ids)

    groups: dict[tuple[str, str, str, str], dict[str, Any]] = defaultdict(
        lambda: {"counts": {"all": 0, **dict.fromkeys(TIME_WINDOWS, 0)}, "newest": None}
    )
    for intake in requests.only(
        "id",
        "project_city",
        "project_state",
        "project_postal_code",
        "customer_city",
        "customer_state",
        "customer_postal_code",
        "same_as_customer_address",
        "ai_project_type",
        "ai_project_subtype",
        "submitted_at",
        "post_submit_flow_selected_at",
        "created_at",
        "marketplace_restored_at",
    ).iterator(chunk_size=500):
        started_at = request_started_at(intake)
        trades = marketplace_request_trade_signature(intake)
        if len(trades) != 1:
            continue
        city, state, zip_code = intake_marketplace_location(intake)
        city = normalize_location_value(city)
        state = normalize_location_value(state).upper()
        zip_code = normalize_location_value(zip_code).split("-")[0][:5]
        if not state or not (city or zip_code):
            continue
        # Keep ZIP in the signature even when city is populated so ZIP
        # drill-down can find ordinary records without double-counting them.
        key = (state, city.casefold(), zip_code, trades[0])
        group = groups[key]
        group["counts"]["all"] += 1
        for window, cutoff in cutoffs.items():
            if started_at >= cutoff:
                group["counts"][window] += 1
        if (time_window == "all" or started_at >= cutoffs[time_window]) and (
            not group["newest"] or started_at > group["newest"]
        ):
            group["newest"] = started_at
        group["city"] = city

    location_keys = sorted(
        {
            (group["city"], state)
            for (state, _city_key, _zip_code, _trade), group in groups.items()
            if group["city"] and group["counts"][time_window]
        }
    )
    market_rows = automatic_matching_readiness_rows_for_locations(location_keys)
    market_by_key = {
        (*automatic_matching_location_keys(row["city"], row["state"]), row["trade"]): row
        for row in market_rows
    }

    rows = []
    for (state, city_key, zip_code, trade), group in groups.items():
        count = group["counts"][time_window]
        if not count:
            continue
        city = group["city"]
        location_key = automatic_matching_location_keys(city, state) if city else ("", state)
        in_service_area = location_key in context["service_locations"]
        matching_trade = trade in context["offered_trades"]
        market = market_by_key.get((*location_key, trade), {})
        market_enabled = bool(market.get("enabled"))
        location_trade_approved = bool(market.get("manual_enabled"))
        readiness = {
            "claimed_profile": context["claimed"],
            "approved_verification": context["verified"],
            "payment_ready": context["payment_ready"],
            "matching_trade": matching_trade,
            "matching_service_area": in_service_area,
        }
        account_ready = all(
            readiness[key]
            for key in (
                "claimed_profile",
                "approved_verification",
                "payment_ready",
                "matching_trade",
            )
        )
        if in_service_area and not account_ready:
            relationship = "readiness_needed"
        elif in_service_area:
            relationship = "in_service_area"
        elif context["base_state"] and state == context["base_state"] and matching_trade:
            relationship = "expansion_opportunity"
        else:
            relationship = "outside_current_coverage"
        # Overlapping windows must not let an exact count disclose a one- or
        # two-request difference by subtraction. Only a count that is stable
        # across every nonempty window can be returned exactly.
        positive_counts = {value for value in group["counts"].values() if value}
        exact_count = count if count >= CONTRACTOR_DEMAND_PRIVACY_THRESHOLD and len(positive_counts) == 1 else None
        rows.append(
            {
                "area": f"{city}, {state} {zip_code}" if city and zip_code else f"{city}, {state}" if city else f"{zip_code}, {state}",
                "state": state,
                "city": city,
                "zip": zip_code,
                "trade": trade,
                "demand_signal": str(exact_count) if exact_count is not None else (
                    "Established demand" if count >= CONTRACTOR_DEMAND_PRIVACY_THRESHOLD
                    else "Emerging demand"
                ),
                "demand_count": exact_count,
                "relationship": relationship,
                "relationship_label": RELATIONSHIP_LABELS[relationship],
                "market_readiness": {
                    "status": market.get("status", "building_coverage"),
                    "coverage_ready": market.get("status") in {
                        "awaiting_approval",
                        "active",
                    },
                },
                "automatic_matching_approval": location_trade_approved,
                "automatic_matching_available": market_enabled,
                "contractor_readiness": readiness,
                "recommended_action": _recommended_action(readiness, relationship),
                # Exact request timestamps must not escape an aggregate API.
                "_newest_demand_at": group["newest"],
            }
        )

    state_filter = normalize_location_value(params.get("state")).upper()
    area_filter = normalize_location_value(params.get("city")).casefold()
    zip_filter = normalize_location_value(params.get("zip")).casefold()
    trade_filter = normalize_trade(params.get("trade"))
    relationship_filter = normalize_location_value(params.get("relationship")).lower()
    readiness_filter = normalize_location_value(params.get("readiness")).lower()
    rows = [
        row
        for row in rows
        if (not state_filter or row["state"] == state_filter)
        and (
            not area_filter
            or row["city"].casefold() == area_filter
            or row["zip"].casefold() == area_filter
        )
        and (not zip_filter or row["zip"].casefold() == zip_filter)
        and (not trade_filter or row["trade"] == trade_filter)
        and (
            relationship_filter not in RELATIONSHIPS
            or row["relationship"] == relationship_filter
        )
        and (
            readiness_filter not in {"ready", "action_needed"}
            or (
                readiness_filter == "ready"
                and all(row["contractor_readiness"].values())
            )
            or (
                readiness_filter == "action_needed"
                and not all(row["contractor_readiness"].values())
            )
        )
    ]

    identity = lambda row: (
        row["state"].casefold(),
        row["city"].casefold(),
        row["zip"],
        row["trade"],
    )
    sort = normalize_location_value(params.get("sort")).lower()
    if sort not in SORTS:
        sort = "strongest_demand"
    if sort == "newest_demand":
        # Treat all sub-threshold groups alike, including their sort position.
        # Otherwise request recency becomes a side channel for small groups.
        rows.sort(
            key=lambda row: (
                row["demand_count"] is None,
                -row["_newest_demand_at"].timestamp()
                if row["demand_count"] is not None else 0,
                identity(row),
            )
        )
    elif sort == "largest_coverage_gap":
        rows.sort(
            key=lambda row: (
                -sum(not value for value in row["contractor_readiness"].values()),
                identity(row),
            )
        )
    elif sort == "closest_to_readiness":
        rows.sort(
            key=lambda row: (
                sum(not value for value in row["contractor_readiness"].values()),
                identity(row),
            )
        )
    elif sort == "area_name":
        rows.sort(key=identity)
    else:
        rows.sort(
            key=lambda row: (
                -(row["demand_count"] or 0),
                row["demand_count"] is None,
                identity(row),
            )
        )

    total = len(rows)
    page_size = _positive_int(params.get("page_size"), DEFAULT_PAGE_SIZE)
    if page_size not in PAGE_SIZES:
        page_size = DEFAULT_PAGE_SIZE
    page_count = max(1, math.ceil(total / page_size))
    page = min(_positive_int(params.get("page"), 1), page_count)
    start = (page - 1) * page_size
    authorized_count = _authorized_opportunity_count(contractor)
    summary = {
        "current_service_area_signals": sum(
            row["relationship"] in {"in_service_area", "readiness_needed"}
            for row in rows
        ),
        "trades_with_demand": len({row["trade"] for row in rows}),
        "expansion_opportunities": sum(
            row["relationship"] == "expansion_opportunity" for row in rows
        ),
        "readiness_actions": sum(
            not value
            for value in (
                context["claimed"],
                context["verified"],
                context["payment_ready"],
                bool(context["offered_trades"]),
                bool(context["service_locations"]),
            )
        ),
        "authorized_individual_opportunities": authorized_count,
    }
    page_rows = rows[start : start + page_size]
    for row in page_rows:
        row.pop("_newest_demand_at")
    return {
        "results": page_rows,
        "summary": summary,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "page_count": page_count,
            "has_next": page < page_count,
            "has_previous": page > 1,
        },
        "filters": {
            "state": state_filter,
            "city_or_zip": area_filter,
            "zip": zip_filter,
            "trade": trade_filter,
            "relationship": relationship_filter,
            "readiness": readiness_filter,
            "time_window": time_window,
            "sort": sort,
        },
        "privacy": {
            "minimum_group_size": CONTRACTOR_DEMAND_PRIVACY_THRESHOLD,
            "suppressed_label": "Emerging demand",
        },
        "property_management_included": False,
    }
