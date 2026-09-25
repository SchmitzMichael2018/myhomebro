from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta
from typing import Any, Iterable

from django.db.models import Q
from django.utils import timezone

from projects.models import Contractor, PublicContractorLead
from projects.models_customer_portal import CustomerRequest
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
)
from projects.models_project_intake import ProjectIntake
from projects.services.marketplace_permissions import (
    contractor_marketplace_action_block_reason,
)
from projects.services.marketplace_readiness import (
    intake_marketplace_location,
    marketplace_request_trade_signature,
    normalize_location_value,
    normalize_trade,
)
from projects.services.marketplace_request_lifecycle import (
    meaningful_response_intake_ids,
    request_started_at,
)


POINT_LIMIT = 500
MIN_PUBLIC_BUSINESS_POINTS = 2
COVERAGE_PAGE_SIZES = {25, 50, 100}
COVERAGE_DEFAULT_PAGE_SIZE = 25
COVERAGE_SORTS = {
    "highest_demand",
    "lowest_demand",
    "highest_claimed_supply",
    "highest_directory_prospects",
    "largest_coverage_gap",
    "area_name",
}
DEFAULT_COVERAGE_SORT = "largest_coverage_gap"
CONTACT_READY_STATUSES = {
    ContractorDirectoryEntry.CONTACT_STATUS_CONTACT_READY,
    ContractorDirectoryEntry.CONTACT_STATUS_EMAIL_READY,
    ContractorDirectoryEntry.CONTACT_STATUS_PHONE_READY,
    ContractorDirectoryEntry.CONTACT_STATUS_WEBSITE_FORM_READY,
    ContractorDirectoryEntry.CONTACT_STATUS_WEBSITE_ONLY,
}

# State centers are public, coarse representative points. City and ZIP points
# require an active Directory business coordinate and never use request data.
STATE_CENTERS = {
    "AL": (32.8067, -86.7911), "AK": (61.3707, -152.4044),
    "AZ": (33.7298, -111.4312), "AR": (34.9697, -92.3731),
    "CA": (36.1162, -119.6816), "CO": (39.0598, -105.3111),
    "CT": (41.5978, -72.7554), "DE": (39.3185, -75.5071),
    "DC": (38.8974, -77.0268), "FL": (27.7663, -81.6868),
    "GA": (33.0406, -83.6431), "HI": (21.0943, -157.4983),
    "ID": (44.2405, -114.4788), "IL": (40.3495, -88.9861),
    "IN": (39.8494, -86.2583), "IA": (42.0115, -93.2105),
    "KS": (38.5266, -96.7265), "KY": (37.6681, -84.6701),
    "LA": (31.1695, -91.8678), "ME": (44.6939, -69.3819),
    "MD": (39.0639, -76.8021), "MA": (42.2302, -71.5301),
    "MI": (43.3266, -84.5361), "MN": (45.6945, -93.9002),
    "MS": (32.7416, -89.6787), "MO": (38.4561, -92.2884),
    "MT": (46.9219, -110.4544), "NE": (41.1254, -98.2681),
    "NV": (38.3135, -117.0554), "NH": (43.4525, -71.5639),
    "NJ": (40.2989, -74.5210), "NM": (34.8405, -106.2485),
    "NY": (42.1657, -74.9481), "NC": (35.6301, -79.8064),
    "ND": (47.5289, -99.7840), "OH": (40.3888, -82.7649),
    "OK": (35.5653, -96.9289), "OR": (44.5720, -122.0709),
    "PA": (40.5908, -77.2098), "RI": (41.6809, -71.5118),
    "SC": (33.8569, -80.9450), "SD": (44.2998, -99.4388),
    "TN": (35.7478, -86.6923), "TX": (31.0545, -97.5635),
    "UT": (40.1500, -111.8624), "VT": (44.0459, -72.7107),
    "VA": (37.7693, -78.1700), "WA": (47.4009, -121.4905),
    "WV": (38.4912, -80.9545), "WI": (44.2685, -89.6165),
    "WY": (42.7560, -107.3025),
}
STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "district of columbia": "DC", "florida": "FL",
    "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _state(value: Any) -> str:
    normalized = normalize_location_value(value)
    if len(normalized) == 2:
        code = normalized.upper()
    else:
        code = STATE_NAMES.get(normalized.casefold(), "")
    return code if code in STATE_CENTERS else ""


def _zip(value: Any) -> str:
    return _text(value).split("-")[0][:5]


def _trades(*values: Any) -> set[str]:
    result = set()
    for value in values:
        items = value if isinstance(value, list) else [value]
        for item in items:
            normalized = normalize_trade(item)
            if normalized:
                result.add(normalized)
    return result


def _marketplace_requests():
    cancelled_ids = CustomerRequest.objects.filter(
        status=CustomerRequest.STATUS_CANCELLED,
        source_intake_id__isnull=False,
    ).values("source_intake_id")
    return ProjectIntake.objects.filter(
        Q(post_submit_flow="multi_contractor")
        | Q(
            lead_source=PublicContractorLead.SOURCE_LANDING_PAGE,
            status__in=["submitted", "analyzed"],
            contractor__isnull=True,
        )
    ).filter(
        status__in=("submitted", "analyzed"),
        agreement_id__isnull=True,
        converted_at__isnull=True,
        marketplace_archived_at__isnull=True,
    ).exclude(
        traffic_classification__in=("test", "spam_fraud", "archived"),
    ).exclude(pk__in=cancelled_ids)


def _date_cutoff(value: str):
    now = timezone.now()
    return {
        "30d": now - timedelta(days=30),
        "90d": now - timedelta(days=90),
        "12m": now - timedelta(days=365),
    }.get(value)


def _aggregation_level(params) -> str:
    explicit = _text(params.get("aggregation_level")).lower()
    if explicit in {"state", "city", "zip"}:
        return explicit
    try:
        zoom = float(params.get("zoom", 4))
    except (TypeError, ValueError):
        zoom = 4
    if zoom >= 9:
        return "zip"
    if zoom >= 5:
        return "city"
    return "state"


def _point_key(level: str, state: str, city: str, zip_code: str):
    if level == "state":
        return state, "", ""
    if level == "city":
        return state, city, ""
    return state, city, zip_code


def _directory_centroids() -> dict[tuple[str, str, str], tuple[float, float]]:
    # Only independently published Google Places businesses may locate an
    # aggregate. A claimed/manual profile can contain a contractor's home.
    # Requiring distinct public businesses and coarsening the result prevents
    # a single directory coordinate from becoming a residential map pin.
    coordinates: dict[tuple[str, str, str], dict[str, tuple[float, float]]] = defaultdict(dict)
    entries = ContractorDirectoryEntry.objects.filter(
        is_archived=False,
        source=ContractorDirectoryEntry.SOURCE_GOOGLE_PLACES,
        latitude__isnull=False,
        longitude__isnull=False,
    ).exclude(google_place_id__isnull=True).exclude(google_place_id="").values_list(
        "google_place_id",
        "service_state", "service_city", "service_zip",
        "state", "city", "zip_code", "latitude", "longitude",
    )
    for place_id, _service_state, _service_city, _service_zip, state, city, zip_code, lat, lng in entries.iterator():
        state = _state(state)
        city = normalize_location_value(city)
        zip_code = _zip(zip_code)
        if state and city and -90 <= lat <= 90 and -180 <= lng <= 180:
            coordinates[(state, city, "")][place_id] = (lat, lng)
            if zip_code:
                coordinates[(state, city, zip_code)][place_id] = (lat, lng)
    listings = ContractorDirectoryListing.objects.exclude(
        business_status__iexact="CLOSED_PERMANENTLY",
    ).filter(
        source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
        latitude__isnull=False,
        longitude__isnull=False,
    ).exclude(google_place_id="").values_list(
        "google_place_id", "state", "city", "zip_code", "latitude", "longitude",
    )
    for place_id, state, city, zip_code, lat, lng in listings.iterator():
        state = _state(state)
        city = normalize_location_value(city)
        zip_code = _zip(zip_code)
        if state and city and -90 <= lat <= 90 and -180 <= lng <= 180:
            coordinates[(state, city, "")][place_id] = (lat, lng)
            if zip_code:
                coordinates[(state, city, zip_code)][place_id] = (lat, lng)
    return {
        key: (
            round(sum(lat for lat, _ in values.values()) / len(values), 2),
            round(sum(lng for _, lng in values.values()) / len(values), 2),
        )
        for key, values in coordinates.items()
        if len(values) >= MIN_PUBLIC_BUSINESS_POINTS
    }


def _representative_point(
    level: str,
    key: tuple[str, str, str],
    centroids: dict[tuple[str, str, str], tuple[float, float]],
):
    state, city, zip_code = key
    if level == "state":
        point = STATE_CENTERS.get(state)
        return (*point, "public_state_center") if point else None
    lookup = (state, city, zip_code if level == "zip" else "")
    point = centroids.get(lookup)
    return (*point, "public_directory_business_centroid") if point else None


def _matches_geo(state: str, city: str, zip_code: str, params) -> bool:
    return (
        (not _text(params.get("state")) or state.casefold() == _state(params.get("state")).casefold())
        and (not _text(params.get("city")) or city.casefold() == _text(params.get("city")).casefold())
        and (not _text(params.get("zip")) or zip_code == _zip(params.get("zip")))
    )


def _matches_bounds(latitude: float, longitude: float, params) -> bool:
    values = []
    for name in ("south", "west", "north", "east"):
        try:
            values.append(float(params.get(name)))
        except (TypeError, ValueError):
            return True
    south, west, north, east = values
    latitude_match = south <= latitude <= north
    longitude_match = west <= longitude <= east if west <= east else longitude >= west or longitude <= east
    return latitude_match and longitude_match


def _new_group(key):
    state, city, zip_code = key
    return {
        "state": state,
        "city": city,
        "zip": zip_code,
        "request_ids": set(),
        "responded_ids": set(),
        "claimed_ids": set(),
        "prospect_ids": set(),
        "contact_ready_ids": set(),
        "demand_trades": Counter(),
        "supply_trades": Counter(),
        "prospect_trades": Counter(),
        "demand_dates": [],
    }


def _add_trade_counts(counter: Counter, trades: Iterable[str]):
    for trade in trades or {"unclassified"}:
        counter[trade] += 1


def _classification(demand: int, supply: int) -> str:
    if demand and not supply:
        return "critical_gap"
    if demand > supply:
        return "limited_supply"
    if demand and supply >= demand:
        return "covered"
    if supply and not demand:
        return "supply_only"
    return "location_needed"


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _coverage_pagination(params, total: int) -> dict[str, int | bool]:
    requested_size = _positive_int(
        params.get("coverage_page_size"),
        COVERAGE_DEFAULT_PAGE_SIZE,
    )
    page_size = (
        requested_size
        if requested_size in COVERAGE_PAGE_SIZES
        else COVERAGE_DEFAULT_PAGE_SIZE
    )
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(_positive_int(params.get("coverage_page"), 1), total_pages)
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_previous": page > 1,
        "has_next": page < total_pages,
    }


def _coverage_sort_key(sort: str):
    identity = lambda row: (
        row["state"].casefold(),
        row["city"].casefold(),
        row["zip"].casefold(),
        row["id"],
    )
    if sort == "highest_demand":
        return lambda row: (-row["counts"]["active_demand"], *identity(row))
    if sort == "lowest_demand":
        return lambda row: (row["counts"]["active_demand"], *identity(row))
    if sort == "highest_claimed_supply":
        return lambda row: (
            -row["counts"]["eligible_claimed_supply"],
            *identity(row),
        )
    if sort == "highest_directory_prospects":
        return lambda row: (-row["counts"]["directory_prospects"], *identity(row))
    if sort == "area_name":
        return identity
    return lambda row: (
        -max(
            row["counts"]["active_demand"]
            - row["counts"]["eligible_claimed_supply"],
            0,
        ),
        -row["counts"]["active_demand"],
        *identity(row),
    )


def _coverage_status(classification: str, has_marker: bool) -> tuple[str, str]:
    if not has_marker:
        return "location_needed", "Map location unavailable"
    labels = {
        "critical_gap": "Critical gap",
        "limited_supply": "Limited supply",
        "covered": "Coverage ready",
        "supply_only": "Coverage ready",
    }
    return classification, labels.get(classification, "Coverage ready")


def build_marketplace_coverage_map(params) -> dict[str, Any]:
    level = _aggregation_level(params)
    trade_filter = normalize_trade(params.get("trade"))
    date_range = _text(params.get("date_range")).lower() or "90d"
    cutoff = _date_cutoff(date_range)
    selected_layers = {
        item.strip()
        for item in _text(params.get("layer")).split(",")
        if item.strip()
    }
    classification_filter = _text(params.get("classification"))
    groups = defaultdict(lambda: None)
    location_needed_ids = {
        "active_demand": set(),
        "eligible_claimed_supply": set(),
        "directory_prospects": set(),
    }
    ungrouped_location_needed_ids = {
        name: set() for name in location_needed_ids
    }
    all_states, all_cities, all_zips, all_trades = set(), set(), set(), set()
    centroids = _directory_centroids()

    def group_for(state, city, zip_code):
        state = _state(state)
        city = normalize_location_value(city)
        zip_code = _zip(zip_code)
        if state:
            all_states.add(state)
        if state and city:
            all_cities.add((state, city))
        if state and city and zip_code:
            all_zips.add((state, city, zip_code))
        if not _matches_geo(state, city, zip_code, params):
            return None
        key = _point_key(level, state, city, zip_code)
        if not key[0] or (level in {"city", "zip"} and not key[1]) or (level == "zip" and not key[2]):
            return None
        if groups[key] is None:
            groups[key] = _new_group(key)
        return groups[key]

    request_qs = _marketplace_requests()
    request_ids = list(request_qs.values_list("id", flat=True))
    responded_ids = meaningful_response_intake_ids(request_ids)
    request_fields = (
        "id", "project_city", "project_state", "project_postal_code",
        "customer_city", "customer_state", "customer_postal_code",
        "same_as_customer_address", "ai_project_type", "ai_project_subtype",
        "ai_project_title", "accomplishment_text", "ai_description", "status",
        "agreement_id", "converted_at", "submitted_at",
        "post_submit_flow_selected_at", "created_at", "analyzed_at",
        "first_marketplace_reminder_sent_at", "final_marketplace_reminder_sent_at",
        "marketplace_archived_at", "marketplace_archive_reason",
        "marketplace_last_archived_at", "marketplace_last_archive_reason",
        "marketplace_restored_at", "marketplace_hold_reason",
    )
    for intake in request_qs.only(*request_fields).iterator(chunk_size=500):
        started_at = request_started_at(intake)
        if cutoff and started_at < cutoff:
            continue
        trades = set(marketplace_request_trade_signature(intake)) or {"unclassified"}
        all_trades.update(trades)
        if trade_filter and trade_filter not in trades:
            continue
        city, state, zip_code = intake_marketplace_location(intake)
        group = group_for(state, city, zip_code)
        if group is None:
            if _matches_geo(_state(state), normalize_location_value(city), _zip(zip_code), params):
                ungrouped_location_needed_ids["active_demand"].add(intake.id)
            continue
        group["request_ids"].add(intake.id)
        if intake.id in responded_ids:
            group["responded_ids"].add(intake.id)
        _add_trade_counts(group["demand_trades"], trades)
        group["demand_dates"].append(started_at)

    seen_prospects = set()
    def add_directory_record(
        *,
        record_key,
        claimed,
        contractor,
        record_eligible,
        state,
        city,
        zip_code,
        trades,
        contact_ready,
    ):
        normalized_trades = trades or {"unclassified"}
        all_trades.update(normalized_trades)
        if trade_filter and trade_filter not in normalized_trades:
            return
        normalized_state = _state(state)
        normalized_city = normalize_location_value(city)
        normalized_zip = _zip(zip_code)
        if not _matches_geo(normalized_state, normalized_city, normalized_zip, params):
            return
        eligible_claimed = bool(
            claimed
            and contractor
            and record_eligible
            and contractor.is_active
            and not contractor_marketplace_action_block_reason(contractor)
        )
        if claimed:
            if not eligible_claimed:
                return
            group = group_for(state, city, zip_code)
            if group is None:
                ungrouped_location_needed_ids["eligible_claimed_supply"].add(contractor.id)
                return
            if contractor.id not in group["claimed_ids"]:
                group["claimed_ids"].add(contractor.id)
                _add_trade_counts(group["supply_trades"], normalized_trades)
            return
        if record_key in seen_prospects:
            return
        seen_prospects.add(record_key)
        group = group_for(state, city, zip_code)
        if group is None:
            ungrouped_location_needed_ids["directory_prospects"].add(record_key)
            return
        group["prospect_ids"].add(record_key)
        if contact_ready:
            group["contact_ready_ids"].add(record_key)
        _add_trade_counts(group["prospect_trades"], normalized_trades)

    entries = ContractorDirectoryEntry.objects.filter(is_archived=False).select_related(
        "claimed_by_contractor", "claimed_by_contractor__user",
    )
    for entry in entries.iterator(chunk_size=500):
        # Claimed entries without a reviewed Marketplace listing are not
        # routable supply under eligible_marketplace_listings().
        if entry.claimed:
            continue
        add_directory_record(
            record_key=f"place:{entry.google_place_id}" if entry.google_place_id else f"entry:{entry.id}",
            claimed=False,
            contractor=entry.claimed_by_contractor,
            record_eligible=False,
            state=entry.service_state or entry.state,
            city=entry.service_city or entry.city,
            zip_code=entry.service_zip or entry.zip_code,
            trades=_trades(entry.primary_service, entry.normalized_services, entry.services, entry.raw_services),
            contact_ready=entry.contact_status in CONTACT_READY_STATUSES,
        )

    listings = ContractorDirectoryListing.objects.exclude(
        business_status__iexact="CLOSED_PERMANENTLY",
    ).select_related("claimed_contractor", "claimed_contractor__user")
    for listing in listings.iterator(chunk_size=500):
        add_directory_record(
            record_key=f"place:{listing.google_place_id}" if listing.google_place_id else f"listing:{listing.id}",
            claimed=listing.claimed_profile,
            contractor=listing.claimed_contractor,
            record_eligible=listing.manually_reviewed,
            state=listing.state,
            city=listing.city,
            zip_code=listing.zip_code,
            trades=_trades(listing.primary_trade, listing.trade_categories),
            contact_ready=bool(listing.email or listing.phone_number or listing.website_url),
        )

    points = []
    coverage_areas = []
    totals = Counter()
    summary_claimed_ids = set()
    classification_totals = Counter()
    now = timezone.now()
    for key, group in groups.items():
        if group is None:
            continue
        representative = _representative_point(level, key, centroids)
        counts = {
            "active_demand": len(group["request_ids"]),
            "unanswered_demand": len(group["request_ids"] - group["responded_ids"]),
            "responded_demand": len(group["responded_ids"]),
            "eligible_claimed_supply": len(group["claimed_ids"]),
            "directory_prospects": len(group["prospect_ids"]),
            "contact_ready_prospects": len(group["contact_ready_ids"]),
        }
        classification = _classification(
            counts["active_demand"],
            counts["eligible_claimed_supply"],
        )
        if classification_filter and classification != classification_filter:
            continue
        if selected_layers:
            layer_has_data = {
                "demand": counts["active_demand"] > 0,
                "claimed_supply": counts["eligible_claimed_supply"] > 0,
                "directory_prospects": counts["directory_prospects"] > 0,
                "coverage_gaps": classification in {"critical_gap", "limited_supply"},
            }
            if not any(layer_has_data.get(layer, False) for layer in selected_layers):
                continue
        for name, value in counts.items():
            totals[name] += value
        summary_claimed_ids.update(group["claimed_ids"])
        classification_totals[classification] += 1
        trade_names = (
            set(group["demand_trades"])
            | set(group["supply_trades"])
            | set(group["prospect_trades"])
        )
        trade_mix = [
            {
                "trade": trade,
                "demand": group["demand_trades"][trade],
                "claimed_supply": group["supply_trades"][trade],
                "directory_prospects": group["prospect_trades"][trade],
            }
            for trade in trade_names
        ]
        trade_mix.sort(
            key=lambda row: (
                -(row["demand"] + row["claimed_supply"] + row["directory_prospects"]),
                row["trade"],
            )
        )
        dates = group["demand_dates"]
        has_marker = representative is not None
        coverage_status, coverage_status_label = _coverage_status(
            classification,
            has_marker,
        )
        area = {
            "id": "|".join(key),
            "aggregation_level": level,
            "state": group["state"],
            "city": group["city"],
            "zip": group["zip"],
            "has_marker": has_marker,
            "counts": counts,
            "total": counts["active_demand"] + counts["eligible_claimed_supply"] + counts["directory_prospects"],
            "coverage_classification": classification,
            "coverage_status": coverage_status,
            "coverage_status_label": coverage_status_label,
            "trade_mix": trade_mix[:8],
            "oldest_active_demand_age_days": max((now - value).days for value in dates) if dates else None,
            "newest_active_demand_age_days": min((now - value).days for value in dates) if dates else None,
        }
        if representative is not None:
            latitude, longitude, coordinate_source = representative
            area.update({
                "latitude": latitude,
                "longitude": longitude,
                "coordinate_source": coordinate_source,
            })
        coverage_areas.append(area)
        if representative is None:
            location_needed_ids["active_demand"].update(group["request_ids"])
            location_needed_ids["eligible_claimed_supply"].update(group["claimed_ids"])
            location_needed_ids["directory_prospects"].update(group["prospect_ids"])
            continue
        if not _matches_bounds(latitude, longitude, params):
            continue
        points.append(area)

    points.sort(key=lambda row: (-row["total"], row["state"], row["city"], row["zip"]))
    limited = len(points) > POINT_LIMIT
    returned_points = points[:POINT_LIMIT]
    coverage_sort = _text(params.get("coverage_sort"))
    if coverage_sort not in COVERAGE_SORTS:
        coverage_sort = DEFAULT_COVERAGE_SORT
    # Full aggregation precedes slicing: map totals, facets, and marker limits
    # describe the filtered population, while only this table page is returned.
    # Work remains linear in eligible requests/listings and grouped areas.
    coverage_areas.sort(key=_coverage_sort_key(coverage_sort))
    coverage_pagination = _coverage_pagination(params, len(coverage_areas))
    coverage_start = (
        (coverage_pagination["page"] - 1) * coverage_pagination["page_size"]
    )
    coverage_end = coverage_start + coverage_pagination["page_size"]
    layer_for_count = {
        "active_demand": "demand",
        "eligible_claimed_supply": "claimed_supply",
        "directory_prospects": "directory_prospects",
    }
    visible_ungrouped = {
        name: ids if not classification_filter and (not selected_layers or layer_for_count[name] in selected_layers) else set()
        for name, ids in ungrouped_location_needed_ids.items()
    }
    location_needed_payload = {
        name: len(ids | visible_ungrouped[name]) for name, ids in location_needed_ids.items()
    }
    location_needed_payload["total"] = sum(location_needed_payload.values())
    for summary_name, missing_name in (
        ("active_demand", "active_demand"),
        ("eligible_claimed_supply", "eligible_claimed_supply"),
        ("directory_prospects", "directory_prospects"),
    ):
        totals[summary_name] += len(visible_ungrouped[missing_name])
    totals["eligible_claimed_supply"] = len(
        summary_claimed_ids | visible_ungrouped["eligible_claimed_supply"]
    )
    return {
        "applied_filters": {
            "aggregation_level": level,
            "trade": trade_filter,
            "state": _state(params.get("state")),
            "city": _text(params.get("city")),
            "zip": _zip(params.get("zip")),
            "date_range": date_range,
            "classification": classification_filter,
            "layer": sorted(selected_layers),
            "coverage_sort": coverage_sort,
        },
        "aggregation_level": level,
        "points": returned_points,
        # Temporary compatibility alias for the existing accessible card tests.
        "clusters": returned_points,
        "summary": {
            **totals,
            "area_count": len(coverage_areas),
            "returned_area_count": len(returned_points),
            "coverage_classifications": dict(sorted(classification_totals.items())),
        },
        "coverage_areas": {
            "results": coverage_areas[coverage_start:coverage_end],
            "pagination": coverage_pagination,
            "sort": coverage_sort,
        },
        "facets": {
            "trades": sorted(all_trades),
            "states": sorted(all_states),
            "cities": [
                {"state": state, "city": city}
                for state, city in sorted(all_cities)
                if not _text(params.get("state")) or state == _state(params.get("state"))
            ],
            "zips": [
                {"state": state, "city": city, "zip": zip_code}
                for state, city, zip_code in sorted(all_zips)
                if (not _text(params.get("state")) or state == _state(params.get("state")))
                and (not _text(params.get("city")) or city.casefold() == _text(params.get("city")).casefold())
            ],
            "coverage_classifications": [
                "critical_gap", "limited_supply", "covered", "supply_only",
            ],
        },
        "location_needed": location_needed_payload,
        "unlocated": {
            "requests": location_needed_payload.get("active_demand", 0),
            "claimed_contractors": location_needed_payload.get("eligible_claimed_supply", 0),
            "directory_prospects": location_needed_payload.get("directory_prospects", 0),
            "total": location_needed_payload["total"],
        },
        "limited": limited,
        "instruction": "Zoom in or apply filters to view all aggregate areas." if limited else "",
        "privacy": (
            "Demand uses normalized state, city, and ZIP aggregates. Request and "
            "homeowner coordinates are never read or serialized. State markers use "
            "public state centers; city and ZIP markers require at least two distinct "
            "public Google Places businesses and use coarsened centroids."
        ),
    }
