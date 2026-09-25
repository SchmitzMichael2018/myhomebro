from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
import math
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import Http404
from django.utils import timezone

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from .permissions import IsAdminUserRole
from .utils import safe_get
from .marketplace_analytics import build_marketplace_analytics
from projects.models import Contractor, ContractorPublicProfile, PublicContractorLead
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorDirectoryListing, ContractorDiscoveryInvite, ContractorOpportunity, MarketplaceAutomaticMatchingApproval, MarketplaceLocation
from projects.models_project_intake import ProjectIntake
from projects.services.marketplace_readiness import CORE_TRADE_CATEGORIES, automatic_matching_location_keys, automatic_matching_readiness, automatic_matching_readiness_rows_for_locations, create_marketplace_invites_for_intake, eligible_marketplace_listings, intake_marketplace_location, location_readiness, marketplace_enabled_for_intake, marketplace_request_trade_signature, matching_marketplace_locations, normalize_location_value, normalize_trade
from projects.services.marketplace_request_lifecycle import (
    LIFECYCLE_ARCHIVED,
    LIFECYCLE_PURGE_DUE,
    LIFECYCLE_RETENTION_PROTECTED,
    archive_request,
    lifecycle_state,
    meaningful_response_intake_ids,
    restore_request,
)
from projects.services.marketplace_coverage_map import build_marketplace_coverage_map
from projects.services.workflow_notifications import notify_contractor_verification_status
from projects.services.contractor_reviews import contractor_performance_summary
from projects.services.contractor_discovery import build_contractor_recommendations
from projects.services.google_places_contractors import (
    project_type_to_places_query,
    suggest_radius_miles,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value)))
    except Exception:
        return default


READINESS_PAGE_SIZES = {25, 50, 100}
READINESS_DEFAULT_PAGE_SIZE = 25
READINESS_SORTS = {
    "location",
    "trade",
    "largest_supply_gap",
    "closest_to_readiness",
    "approval_state",
}


def _positive_int(value: Any, default: int) -> int:
    parsed = _safe_int(value, default)
    return parsed if parsed > 0 else default


def _marketplace_location_keys() -> list[tuple[str, str]]:
    location_keys = {
        (normalize_location_value(city), normalize_location_value(state))
        for city, state in ContractorDirectoryListing.objects.exclude(
            city="", state="",
        ).values_list("city", "state")
    }
    location_keys.update(
        {
            (normalize_location_value(city), normalize_location_value(state))
            for city, state in MarketplaceLocation.objects.values_list("city", "state")
        }
    )
    location_keys.update(
        {
            (normalize_location_value(city), normalize_location_value(state))
            for city, state in ContractorDirectoryEntry.objects.exclude(
                city="", state="",
            ).values_list("city", "state")
        }
    )
    location_keys.update(
        {
            (normalize_location_value(city), normalize_location_value(state))
            for city, state in ContractorDirectoryEntry.objects.exclude(
                service_city="", service_state="",
            ).values_list("service_city", "service_state")
        }
    )
    normalized_locations = {}
    for city, state in sorted(location_keys):
        if city and state:
            normalized_locations.setdefault(
                automatic_matching_location_keys(city, state),
                (city, state),
            )
    for city_key, state_key in MarketplaceAutomaticMatchingApproval.objects.values_list(
        "city_key", "state_key",
    ).distinct():
        normalized_locations.setdefault(
            (city_key, state_key),
            (city_key.title(), state_key),
        )
    return list(normalized_locations.values())


def _readiness_supply_gap(row: dict[str, Any]) -> int:
    thresholds = row.get("thresholds") or {}
    counts = row.get("counts") or {}
    return sum(
        max(
            int(thresholds.get(threshold_name) or 0)
            - int(counts.get(count_name) or 0),
            0,
        )
        for threshold_name, count_name in (
            ("min_claimed_contractors", "claimed_contractors"),
            ("min_verified_contractors", "verified_contractors"),
            ("min_stripe_ready_contractors", "stripe_ready_contractors"),
        )
    )


def _readiness_rows(params) -> dict[str, Any]:
    state_filter = normalize_location_value(params.get("readiness_state")).upper()
    city_filter = normalize_location_value(params.get("readiness_city")).casefold()
    trade_filter = normalize_trade(params.get("readiness_trade"))
    status_filter = _safe_text(params.get("readiness_status"))
    location_keys = [
        (city, state)
        for city, state in _marketplace_location_keys()
        if city and state
        and (not state_filter or state.upper() == state_filter)
        and (not city_filter or city.casefold() == city_filter)
    ]
    rows = automatic_matching_readiness_rows_for_locations(location_keys)
    rows = [
        row
        for row in rows
        if (not state_filter or row["state"].upper() == state_filter)
        and (not city_filter or row["city"].casefold() == city_filter)
        and (not trade_filter or row["trade"] == trade_filter)
        and (not status_filter or row["status"] == status_filter)
    ]
    readiness_sort = _safe_text(params.get("readiness_sort"))
    if readiness_sort not in READINESS_SORTS:
        readiness_sort = "largest_supply_gap"
    identity = lambda row: (
        row["state"].casefold(),
        row["city"].casefold(),
        row["trade"].casefold(),
        int(row.get("location_id") or 0),
    )
    if readiness_sort == "trade":
        key = lambda row: (
            row["trade"].casefold(),
            row["state"].casefold(),
            row["city"].casefold(),
            int(row.get("location_id") or 0),
        )
    elif readiness_sort == "largest_supply_gap":
        key = lambda row: (-_readiness_supply_gap(row), *identity(row))
    elif readiness_sort == "closest_to_readiness":
        key = lambda row: (
            len(row.get("coverage_gaps") or []),
            _readiness_supply_gap(row),
            *identity(row),
        )
    elif readiness_sort == "approval_state":
        status_order = {
            "awaiting_approval": 0,
            "active": 1,
            "paused": 2,
            "building_coverage": 3,
            "location_review_needed": 4,
        }
        key = lambda row: (status_order.get(row["status"], 9), *identity(row))
    else:
        key = identity
    rows.sort(key=key)
    requested_size = _positive_int(
        params.get("readiness_page_size"),
        READINESS_DEFAULT_PAGE_SIZE,
    )
    page_size = (
        requested_size
        if requested_size in READINESS_PAGE_SIZES
        else READINESS_DEFAULT_PAGE_SIZE
    )
    total = len(rows)
    total_pages = max(1, math.ceil(total / page_size))
    page = min(_positive_int(params.get("readiness_page"), 1), total_pages)
    start = (page - 1) * page_size
    return {
        "results": rows[start:start + page_size],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": page < total_pages,
        },
        "sort": readiness_sort,
        "applied_filters": {
            "state": state_filter,
            "city": normalize_location_value(params.get("readiness_city")),
            "trade": trade_filter,
            "status": status_filter,
        },
    }


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        next_value = float(str(value))
    except Exception:
        return default
    return next_value if next_value == next_value else default


def _normalize_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _format_money(value: Any) -> str:
    try:
        return f"{Decimal(str(value or 0)).quantize(Decimal('0.01')):.2f}"
    except Exception:
        return "0.00"


def _safe_dt(value: Any) -> str | None:
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None


def _intake_title(intake: ProjectIntake) -> str:
    return (
        _safe_text(getattr(intake, "ai_project_title", ""))
        or _safe_text(getattr(intake, "ai_project_type", ""))
        or _safe_text(getattr(intake, "accomplishment_text", ""))[:80]
        or f"Marketplace request #{intake.id}"
    )


def _marketplace_request_counts(intake: ProjectIntake) -> dict[str, int]:
    return {
        "invites": ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(),
        "opportunities": ContractorOpportunity.objects.filter(intake_request=intake).count(),
        "leads": PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(),
    }


def _marketplace_request_counts_by_id(intake_ids: list[int], *, chunk_size: int = 500) -> dict[int, dict[str, int]]:
    counts = {
        intake_id: {"invites": 0, "opportunities": 0, "leads": 0}
        for intake_id in intake_ids
    }
    for offset in range(0, len(intake_ids), chunk_size):
        chunk = intake_ids[offset : offset + chunk_size]
        for row in (
            ContractorDiscoveryInvite.objects.filter(public_intake_id__in=chunk)
            .values("public_intake_id")
            .annotate(total=Count("id"))
        ):
            counts[row["public_intake_id"]]["invites"] = row["total"]
        for row in (
            ContractorOpportunity.objects.filter(intake_request_id__in=chunk)
            .values("intake_request_id")
            .annotate(total=Count("id"))
        ):
            counts[row["intake_request_id"]]["opportunities"] = row["total"]
        for row in (
            PublicContractorLead.objects.filter(ai_analysis__source_intake_id__in=chunk)
            .values("ai_analysis__source_intake_id")
            .annotate(total=Count("id"))
        ):
            counts[int(row["ai_analysis__source_intake_id"])]["leads"] = row["total"]
    return counts


def _marketplace_operational_status(
    *,
    readiness: dict[str, Any],
    eligible_count: int,
) -> tuple[str, str, str]:
    if readiness.get("status") == "location_needed":
        return (
            "location_needed",
            "Location needed",
            "The request is saved for future matching. Add a complete project city and state to evaluate automatic routing.",
        )
    if readiness.get("status") == "service_needed":
        return (
            "service_needed",
            "Service needed",
            "The request is saved. Identify one service/trade before evaluating automatic matching; customer-selected invitations remain available.",
        )
    if readiness.get("can_auto_route"):
        if eligible_count:
            return (
                "active",
                "Active",
                "Automatic routing is ready and eligible contractors are available. Routing still requires an explicit admin action.",
            )
        return (
            "supply_needed",
            "Supply needed",
            "Automatic routing is activated, but no eligible claimed contractors currently match this request.",
        )
    if readiness.get("status") == "paused":
        return (
            "routing_paused",
            "Routing paused",
            "Automatic routing was previously activated and is now paused. The request remains saved for future matching.",
        )
    if readiness.get("status") == "awaiting_approval":
        return (
            "coverage_not_activated",
            "Coverage not activated",
            "Eligible supply thresholds are met, but an admin has not approved automatic matching for this service and location.",
        )
    if readiness.get("status") == "building_coverage":
        return (
            "building_coverage",
            "Building coverage",
            "Local contractor coverage is progressing. Automatic matching is not yet available.",
        )
    return (
        "supply_needed",
        "Supply needed",
        "Building local coverage. Automatic matching is not yet available, and the request is saved for future matching.",
    )


def _marketplace_request_evaluation(
    intake: ProjectIntake,
    *,
    readiness_cache: dict[tuple[str, str], dict[str, Any]],
    eligible_count_cache: dict[tuple[Any, ...], int],
) -> dict[str, Any]:
    city, state, zip_code = intake_marketplace_location(intake)
    location_key = (city.casefold(), state.casefold(), *marketplace_request_trade_signature(intake))
    if location_key not in readiness_cache:
        readiness_cache[location_key] = marketplace_enabled_for_intake(intake)
    readiness = readiness_cache[location_key]
    eligibility_key = (
        *location_key,
        *marketplace_request_trade_signature(intake),
    )
    if eligibility_key not in eligible_count_cache:
        eligible_count_cache[eligibility_key] = len(eligible_marketplace_listings(intake))
    eligible_count = eligible_count_cache[eligibility_key]
    operational_status, operational_label, operational_reason = _marketplace_operational_status(
        readiness=readiness,
        eligible_count=eligible_count,
    )
    return {
        "id": intake.id,
        "city": city,
        "state": state,
        "zip": zip_code,
        "location_complete": bool(city and state),
        "readiness": readiness,
        "eligible_count": eligible_count,
        "operational_status": operational_status,
        "operational_label": operational_label,
        "operational_reason": operational_reason,
    }


def _saved_marketplace_request_row(
    intake: ProjectIntake,
    *,
    evaluation: dict[str, Any] | None = None,
    counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    if evaluation is None:
        evaluation = _marketplace_request_evaluation(
            intake,
            readiness_cache={},
            eligible_count_cache={},
        )
    city = evaluation["city"]
    state = evaluation["state"]
    zip_code = evaluation["zip"]
    readiness = evaluation["readiness"]
    counts = counts or _marketplace_request_counts(intake)
    cap = int(readiness.get("max_bids_per_request") or 5)
    routed_count = max(counts.values() or [0])
    at_cap = routed_count >= cap
    enabled = bool(readiness.get("can_auto_route"))
    eligible_count = evaluation["eligible_count"]
    operational_status = evaluation["operational_status"]
    operational_label = evaluation["operational_label"]
    operational_reason = evaluation["operational_reason"]
    already_routed = routed_count > 0
    routable_now = enabled and not at_cap and eligible_count > routed_count
    if at_cap:
        reason = "Bid cap already reached."
    elif enabled and eligible_count <= routed_count:
        reason = "No additional eligible claimed contractors are available."
    elif enabled and already_routed:
        reason = "Partially routed. Additional eligible contractors can be routed."
    elif enabled:
        reason = "Ready to route to eligible contractors."
    else:
        reason = operational_reason

    return {
        "id": intake.id,
        "source": _safe_text(getattr(intake, "lead_source", "")),
        "source_label": _safe_text(intake.get_lead_source_display() if hasattr(intake, "get_lead_source_display") else getattr(intake, "lead_source", "")),
        "customer_linked": bool(getattr(intake, "homeowner_id", None)),
        "contractor_linked": bool(getattr(intake, "contractor_id", None) or getattr(intake, "public_profile_id", None) or already_routed),
        "request_title": _intake_title(intake),
        "project_type": _safe_text(getattr(intake, "ai_project_type", "")),
        "project_subtype": _safe_text(getattr(intake, "ai_project_subtype", "")),
        "city": city,
        "state": state,
        "zip": zip_code,
        "location_complete": bool(city and state),
        "customer_name": _safe_text(intake.customer_name) or _safe_text(getattr(intake.homeowner, "full_name", "")) or _safe_text(getattr(intake.public_lead, "full_name", "")),
        "customer_email": _safe_text(intake.customer_email) or _safe_text(getattr(intake.homeowner, "email", "")) or _safe_text(getattr(intake.public_lead, "email", "")),
        "customer_phone": _safe_text(intake.customer_phone) or _safe_text(getattr(intake.homeowner, "phone_number", "")) or _safe_text(getattr(intake.public_lead, "phone", "")),
        "submitted_at": _safe_dt(getattr(intake, "post_submit_flow_selected_at", None) or getattr(intake, "submitted_at", None) or getattr(intake, "created_at", None)),
        "lifecycle_status": evaluation["lifecycle_status"],
        "request_age_days": evaluation["request_age_days"],
        "last_meaningful_activity_at": evaluation["last_meaningful_activity_at"],
        "archived_at": _safe_dt(intake.marketplace_archived_at),
        "archive_reason": intake.marketplace_archive_reason,
        "last_archived_at": _safe_dt(intake.marketplace_last_archived_at),
        "last_archive_reason": intake.marketplace_last_archive_reason,
        "restored_at": _safe_dt(intake.marketplace_restored_at),
        "purge_eligible_at": evaluation["purge_eligible_at"],
        "protection_reason": evaluation["protection_reason"],
        "marketplace_status": operational_status,
        "marketplace_status_label": operational_label,
        "marketplace_status_reason": operational_reason,
        "marketplace_action": (
            {"label": "Review request location", "target": f"/app/admin/requests?request={intake.id}"}
            if operational_status == "location_needed"
            else {"label": "Review request service", "target": f"/app/admin/requests?request={intake.id}"}
            if operational_status == "service_needed"
            else {"label": "Review coverage", "target": "/app/admin/marketplace"}
        ),
        "marketplace_enabled": enabled,
        "capabilities": readiness.get("capabilities"),
        "can_participate": readiness.get("can_participate", True),
        "can_search": readiness.get("can_search", True),
        "can_direct_invite": readiness.get("can_direct_invite", True),
        "can_auto_route": readiness.get("can_auto_route", enabled),
        "saved_for_future_matching": not already_routed and not enabled,
        "routed_status": "at_cap" if at_cap else "partially_routed" if already_routed else "not_routed",
        "routable_now": routable_now and not intake.marketplace_archived_at,
        "already_routed": already_routed,
        "at_cap": at_cap,
        "eligible_contractors": eligible_count,
        "counts": counts,
        "cap": cap,
        "reason": reason,
    }


def _marketplace_request_queryset():
    return (
        ProjectIntake.objects.select_related("homeowner", "public_lead").filter(
            Q(post_submit_flow="multi_contractor")
            | Q(
                lead_source=PublicContractorLead.SOURCE_LANDING_PAGE,
                status__in=["submitted", "analyzed"],
                contractor__isnull=True,
            )
        )
        .exclude(traffic_classification__in=("test", "spam_fraud", "archived"))
    )


def _filter_marketplace_requests(qs, params):
    query = _safe_text(params.get("q"))[:120]
    if query:
        lookup = (
            Q(ai_project_title__icontains=query)
            | Q(ai_project_type__icontains=query)
            | Q(ai_project_subtype__icontains=query)
            | Q(customer_name__icontains=query)
            | Q(customer_email__icontains=query)
            | Q(project_city__icontains=query)
            | Q(project_state__icontains=query)
            | Q(project_postal_code__icontains=query)
        )
        if query.isdigit():
            lookup |= Q(pk=int(query))
        qs = qs.filter(lookup)
    for param, fields in {
        "city": ("project_city", "customer_city"),
        "state": ("project_state", "customer_state"),
        "zip": ("project_postal_code", "customer_postal_code"),
    }.items():
        value = _safe_text(params.get(param))
        if value:
            qs = qs.filter(Q(**{f"{fields[0]}__iexact": value}) | Q(**{f"{fields[1]}__iexact": value}))
    trade = _safe_text(params.get("trade"))
    if trade:
        qs = qs.filter(Q(ai_project_type__icontains=trade) | Q(ai_project_subtype__icontains=trade))
    source = _safe_text(params.get("source"))
    if source:
        qs = qs.filter(lead_source=source)
    request_status = _safe_text(params.get("request_status"))
    if request_status:
        qs = qs.filter(status=request_status)
    return qs


def _marketplace_request_ordering(params) -> tuple[str, ...]:
    return {
        "submitted_asc": ("post_submit_flow_selected_at", "created_at", "id"),
        "location_asc": ("project_state", "project_city", "id"),
        "trade_asc": ("ai_project_type", "ai_project_subtype", "id"),
        "request_status_asc": ("status", "-created_at", "-id"),
    }.get(_safe_text(params.get("sort")), ("-post_submit_flow_selected_at", "-created_at", "-id"))


def _marketplace_request_evaluations(qs, *, status_filter: str = "", chunk_size: int = 200) -> list[dict[str, Any]]:
    readiness_cache: dict[tuple[str, str], dict[str, Any]] = {}
    eligible_count_cache: dict[tuple[Any, ...], int] = {}
    evaluations = []
    candidate_ids = list(qs.values_list("id", flat=True))
    responded_ids = meaningful_response_intake_ids(candidate_ids)
    candidate_fields = (
        "id",
        "project_city", "project_state", "project_postal_code",
        "customer_city", "customer_state", "customer_postal_code", "same_as_customer_address",
        "ai_project_type", "ai_project_subtype", "ai_project_title",
        "accomplishment_text", "ai_description",
        "status", "traffic_classification", "agreement_id", "converted_at",
        "submitted_at", "post_submit_flow_selected_at", "created_at", "analyzed_at",
        "first_marketplace_reminder_sent_at", "final_marketplace_reminder_sent_at",
        "marketplace_archived_at", "marketplace_archive_reason",
        "marketplace_last_archived_at", "marketplace_last_archive_reason",
        "marketplace_restored_at", "marketplace_hold_reason",
    )
    # Operational status depends on the authoritative Python readiness and
    # eligibility services, so evaluate compact candidates in database chunks.
    for intake in qs.filter(id__in=candidate_ids).select_related(None).only(*candidate_fields).iterator(chunk_size=chunk_size):
        evaluation = _marketplace_request_evaluation(
            intake,
            readiness_cache=readiness_cache,
            eligible_count_cache=eligible_count_cache,
        )
        lifecycle = lifecycle_state(
            intake,
            has_meaningful_response=intake.id in responded_ids,
        )
        evaluation.update({
            "lifecycle_status": lifecycle["code"],
            "request_age_days": lifecycle["request_age_days"],
            "last_meaningful_activity_at": _safe_dt(lifecycle["last_meaningful_activity_at"]),
            "purge_eligible_at": _safe_dt(lifecycle["purge_eligible_at"]),
            "protection_reason": lifecycle["protection_reason"],
        })
        if not status_filter or evaluation["operational_status"] == status_filter:
            evaluations.append(evaluation)
    return evaluations


def _marketplace_request_aggregates(
    evaluations: list[dict[str, Any]],
    counts_by_id: dict[int, dict[str, int]],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    summary = {
        "total": len(evaluations),
        "saved_not_routed": 0,
        "routable_now": 0,
        "already_routed": 0,
        "blocked_location_missing": 0,
        "blocked_disabled": 0,
        "automatic_routing_unavailable": 0,
        "blocked_no_eligible_contractors": 0,
        "at_cap": 0,
        "operational_statuses": {},
    }
    by_location: dict[tuple[str, str], dict[str, int]] = {}
    for evaluation in evaluations:
        operational_status = evaluation["operational_status"]
        summary["operational_statuses"][operational_status] = (
            summary["operational_statuses"].get(operational_status, 0) + 1
        )
        counts = counts_by_id[evaluation["id"]]
        cap = int(evaluation["readiness"].get("max_bids_per_request") or 5)
        routed_count = max(counts.values() or [0])
        at_cap = routed_count >= cap
        enabled = bool(evaluation["readiness"].get("can_auto_route"))
        already_routed = routed_count > 0
        routable_now = enabled and not at_cap and evaluation["eligible_count"] > routed_count
        no_eligible = enabled and not at_cap and evaluation["eligible_count"] <= routed_count

        summary["saved_not_routed"] += int(not already_routed)
        summary["routable_now"] += int(routable_now)
        summary["already_routed"] += int(already_routed)
        summary["blocked_location_missing"] += int(not evaluation["location_complete"])
        summary["blocked_disabled"] += int(evaluation["location_complete"] and not enabled)
        summary["automatic_routing_unavailable"] += int(evaluation["location_complete"] and not enabled)
        summary["blocked_no_eligible_contractors"] += int(no_eligible)
        summary["at_cap"] += int(at_cap)

        if not evaluation["location_complete"]:
            continue
        key = (evaluation["city"], evaluation["state"])
        bucket = by_location.setdefault(
            key,
            {
                "saved_not_routed": 0,
                "routable_now": 0,
                "already_routed": 0,
                "blocked_disabled": 0,
                "blocked_no_eligible_contractors": 0,
                "at_cap": 0,
            },
        )
        bucket["saved_not_routed"] += int(not already_routed)
        bucket["routable_now"] += int(routable_now)
        bucket["already_routed"] += int(already_routed)
        bucket["blocked_disabled"] += int(not enabled)
        bucket["blocked_no_eligible_contractors"] += int(no_eligible)
        bucket["at_cap"] += int(at_cap)
    return summary, {
        f"{city}, {state}": {"city": city, "state": state, **counts}
        for (city, state), counts in by_location.items()
    }


def _marketplace_request_rows(
    evaluations: list[dict[str, Any]],
    counts_by_id: dict[int, dict[str, int]],
) -> list[dict[str, Any]]:
    if not evaluations:
        return []
    evaluation_by_id = {evaluation["id"]: evaluation for evaluation in evaluations}
    intakes_by_id = {
        intake.id: intake
        for intake in _marketplace_request_queryset().filter(id__in=evaluation_by_id)
    }
    return [
        _saved_marketplace_request_row(
            intakes_by_id[evaluation["id"]],
            evaluation=evaluation,
            counts=counts_by_id[evaluation["id"]],
        )
        for evaluation in evaluations
    ]


def _saved_marketplace_requests_payload(params=None) -> dict[str, Any]:
    params = params or {}
    qs = _filter_marketplace_requests(_marketplace_request_queryset(), params).order_by(
        *_marketplace_request_ordering(params)
    )
    status_filter = _safe_text(params.get("marketplace_status"))
    all_evaluations = _marketplace_request_evaluations(qs, status_filter=status_filter)
    lifecycle_counts = defaultdict(int)
    for evaluation in all_evaluations:
        lifecycle_counts[evaluation["lifecycle_status"]] += 1
    lifecycle_filter = _safe_text(params.get("lifecycle_status")).lower() or "operational"
    if lifecycle_filter == "all":
        evaluations = all_evaluations
    elif lifecycle_filter == "operational":
        evaluations = [
            row for row in all_evaluations
            if row["lifecycle_status"] not in {
                LIFECYCLE_ARCHIVED,
                LIFECYCLE_PURGE_DUE,
                LIFECYCLE_RETENTION_PROTECTED,
            }
        ]
    else:
        evaluations = [row for row in all_evaluations if row["lifecycle_status"] == lifecycle_filter]
    total_count = len(evaluations)
    counts_by_id = _marketplace_request_counts_by_id([evaluation["id"] for evaluation in evaluations])
    summary, by_location = _marketplace_request_aggregates(evaluations, counts_by_id)
    summary["lifecycle_statuses"] = dict(lifecycle_counts)
    page_size = max(1, min(_safe_int(params.get("page_size"), 25), 100))
    total_pages = max(1, math.ceil(total_count / page_size))
    page = min(max(1, _safe_int(params.get("page"), 1)), total_pages)
    page_evaluations = evaluations[(page - 1) * page_size : page * page_size]
    rows = _marketplace_request_rows(page_evaluations, counts_by_id)
    return {
        "summary": summary,
        "results": rows,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total_count,
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": page < total_pages,
        },
        "by_location": by_location,
    }


def _marketplace_overview_requests_payload(*, result_limit: int = 25) -> dict[str, Any]:
    qs = _marketplace_request_queryset().order_by(*_marketplace_request_ordering({}))
    evaluations = [
        row
        for row in _marketplace_request_evaluations(qs)
        if row["lifecycle_status"] not in {
            LIFECYCLE_ARCHIVED,
            LIFECYCLE_PURGE_DUE,
            LIFECYCLE_RETENTION_PROTECTED,
        }
    ]
    counts_by_id = _marketplace_request_counts_by_id([evaluation["id"] for evaluation in evaluations])
    summary, by_location = _marketplace_request_aggregates(evaluations, counts_by_id)
    return {
        "summary": summary,
        "results": _marketplace_request_rows(evaluations[:result_limit], counts_by_id),
        "by_location": by_location,
        "pagination": {
            "page": 1,
            "page_size": result_limit,
            "total": len(evaluations),
            "total_pages": max(1, math.ceil(len(evaluations) / result_limit)),
            "has_previous": False,
            "has_next": len(evaluations) > result_limit,
        },
    }


def _contractor_stripe_ready(contractor: Contractor) -> bool:
    return bool(contractor.charges_enabled and contractor.payouts_enabled and not contractor.stripe_deauthorized_at)


def _contractor_claimed(contractor: Contractor) -> bool:
    return bool(
        ContractorDirectoryListing.objects.filter(claimed_contractor=contractor, claimed_profile=True).exists()
        or contractor.directory_entries.filter(claimed=True).exists()
        or contractor.activation_type in {
            Contractor.ACTIVATION_PREFILLED_DIRECTORY,
            Contractor.ACTIVATION_HOMEOWNER_SELECTED,
            Contractor.ACTIVATION_TRADITIONAL_SIGNUP,
        }
    )


def _contractor_trade_labels(contractor: Contractor) -> list[str]:
    values = set()
    for listing in ContractorDirectoryListing.objects.filter(claimed_contractor=contractor):
        if _safe_text(listing.primary_trade):
            values.add(_safe_text(listing.primary_trade))
        for item in listing.trade_categories or []:
            if _safe_text(item):
                values.add(_safe_text(item))
    for entry in contractor.directory_entries.all():
        if _safe_text(entry.primary_service):
            values.add(_safe_text(entry.primary_service))
        for item in (entry.normalized_services or []) + (entry.services or []):
            if _safe_text(item):
                values.add(_safe_text(item))
    for skill in contractor.skills.all():
        if _safe_text(getattr(skill, "name", "")):
            values.add(_safe_text(skill.name))
    return sorted(values)


def _contractor_missing_requirements(contractor: Contractor) -> list[str]:
    missing = []
    claimed = _contractor_claimed(contractor)
    if not claimed:
        missing.append("claimed profile")
    if not _safe_text(contractor.business_name):
        missing.append("business name")
    if not (_safe_text(contractor.phone) or _safe_text(getattr(contractor.user, "email", ""))):
        missing.append("contact")
    if not (_safe_text(contractor.city) and _safe_text(contractor.state)):
        missing.append("service area")
    if not _contractor_trade_labels(contractor):
        missing.append("trade/category")
    if _safe_bool(getattr(settings, "MYHOMEBRO_MARKETPLACE_REQUIRE_LICENSE_ON_FILE", False)) and not (
        _safe_text(contractor.license_number) or contractor.license_file
    ):
        missing.append("license")
    if _safe_bool(getattr(settings, "MYHOMEBRO_MARKETPLACE_REQUIRE_INSURANCE_ON_FILE", False)) and not contractor.insurance_file:
        missing.append("insurance")
    if _safe_bool(getattr(settings, "MYHOMEBRO_MARKETPLACE_REQUIRE_STRIPE_READY_FOR_VERIFICATION", False)) and not _contractor_stripe_ready(contractor):
        missing.append("Stripe ready")
    return missing


def _serialize_verification_contractor(contractor: Contractor) -> dict[str, Any]:
    missing_requirements = _contractor_missing_requirements(contractor)
    status_value = contractor.marketplace_verification_status or Contractor.MARKETPLACE_UNVERIFIED
    user = contractor.user
    service_area = ", ".join(part for part in [_safe_text(contractor.city), _safe_text(contractor.state)] if part)
    listing_count = ContractorDirectoryListing.objects.filter(claimed_contractor=contractor).count()
    return {
        "id": contractor.id,
        "business_name": _safe_text(contractor.business_name) or contractor.name or f"Contractor #{contractor.id}",
        "contact_name": contractor.name,
        "email": _safe_text(getattr(user, "email", "")),
        "phone": _safe_text(contractor.phone),
        "active": bool(getattr(user, "is_active", True)),
        "claimed": _contractor_claimed(contractor),
        "claimed_listing_count": listing_count,
        "service_area": service_area,
        "city": _safe_text(contractor.city),
        "state": _safe_text(contractor.state),
        "trades": _contractor_trade_labels(contractor),
        "stripe_ready": _contractor_stripe_ready(contractor),
        "charges_enabled": bool(contractor.charges_enabled),
        "payouts_enabled": bool(contractor.payouts_enabled),
        "details_submitted": bool(contractor.details_submitted),
        "license_on_file": bool(_safe_text(contractor.license_number) or contractor.license_file),
        "insurance_on_file": bool(contractor.insurance_file),
        "verification_status": status_value,
        "verification_notes": _safe_text(contractor.marketplace_verification_notes),
        "rejected_reason": _safe_text(contractor.marketplace_verification_rejected_reason),
        "verified_at": _safe_dt(contractor.marketplace_verified_at),
        "verified_by": _safe_text(getattr(contractor.marketplace_verified_by, "email", "")),
        "suspended_at": _safe_dt(contractor.marketplace_suspended_at),
        "suspended_by": _safe_text(getattr(contractor.marketplace_suspended_by, "email", "")),
        "preferred": bool(contractor.marketplace_preferred),
        "preferred_reason": _safe_text(contractor.marketplace_preferred_reason),
        "preferred_at": _safe_dt(contractor.marketplace_preferred_at),
        "preferred_by": _safe_text(getattr(contractor.marketplace_preferred_by, "email", "")),
        "missing_requirements": missing_requirements,
        "eligible_for_marketplace": bool(
            status_value == Contractor.MARKETPLACE_VERIFIED
            and getattr(user, "is_active", True)
            and not missing_requirements
            and _contractor_stripe_ready(contractor)
        ),
        "performance_summary": contractor_performance_summary(contractor),
    }


def _query_listings(request):
    qs = ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user")
    q = _safe_text(request.query_params.get("q"))
    trade = _safe_text(request.query_params.get("trade"))
    city = _safe_text(request.query_params.get("city"))
    state = _safe_text(request.query_params.get("state"))
    source = _safe_text(request.query_params.get("source"))
    claimed = _safe_text(request.query_params.get("claimed"))
    invited = _safe_text(request.query_params.get("invited"))
    opted_out = _safe_text(request.query_params.get("opted_out"))
    reviewed = _safe_text(request.query_params.get("reviewed"))
    enriched = _safe_text(request.query_params.get("enriched"))
    assisted = _safe_text(request.query_params.get("assisted_diy"))
    escrow = _safe_text(request.query_params.get("escrow_friendly"))
    inspection = _safe_text(request.query_params.get("inspection_capable"))
    rescue = _safe_text(request.query_params.get("rescue_project_friendly"))
    has_phone = _safe_text(request.query_params.get("has_phone"))
    has_email = _safe_text(request.query_params.get("has_email"))
    min_rating = _safe_float(request.query_params.get("min_rating"), 0.0)

    if q:
        qs = qs.filter(
            Q(business_name__icontains=q)
            | Q(normalized_business_name__icontains=q)
            | Q(city__icontains=q)
            | Q(state__icontains=q)
            | Q(primary_trade__icontains=q)
            | Q(phone_number__icontains=q)
        )
    if trade:
        qs = qs.filter(Q(primary_trade__icontains=trade) | Q(trade_categories__contains=[trade]))
    if city:
        qs = qs.filter(city__icontains=city)
    if state:
        qs = qs.filter(state__icontains=state)
    if source:
        qs = qs.filter(source=source)
    if claimed in {"1", "true", "yes"}:
        qs = qs.filter(claimed_profile=True)
    elif claimed in {"0", "false", "no"}:
        qs = qs.filter(claimed_profile=False)
    if invited in {"1", "true", "yes"}:
        qs = qs.filter(discovery_invites__isnull=False).distinct()
    elif invited in {"0", "false", "no"}:
        qs = qs.filter(discovery_invites__isnull=True)
    if opted_out in {"1", "true", "yes"}:
        qs = qs.filter(Q(sms_opt_out=True) | Q(email_opt_out=True))
    elif opted_out in {"0", "false", "no"}:
        qs = qs.filter(sms_opt_out=False, email_opt_out=False)
    if reviewed in {"1", "true", "yes"}:
        qs = qs.filter(manually_reviewed=True)
    elif reviewed in {"0", "false", "no"}:
        qs = qs.filter(manually_reviewed=False)
    if enriched in {"1", "true", "yes"}:
        qs = qs.filter(manually_enriched=True)
    elif enriched in {"0", "false", "no"}:
        qs = qs.filter(manually_enriched=False)
    if assisted in {"1", "true", "yes"}:
        qs = qs.filter(assisted_diy_friendly=True)
    if escrow in {"1", "true", "yes"}:
        qs = qs.filter(escrow_friendly=True)
    if inspection in {"1", "true", "yes"}:
        qs = qs.filter(inspection_capable=True)
    if rescue in {"1", "true", "yes"}:
        qs = qs.filter(rescue_project_friendly=True)
    if has_phone in {"1", "true", "yes"}:
        qs = qs.exclude(phone_number="")
    elif has_phone in {"0", "false", "no"}:
        qs = qs.filter(phone_number="")
    if has_email in {"1", "true", "yes"}:
        qs = qs.exclude(email="")
    elif has_email in {"0", "false", "no"}:
        qs = qs.filter(email="")
    if min_rating:
        qs = qs.filter(google_rating__gte=min_rating)

    return qs.order_by("-claimed_profile", "-google_review_count", "-google_rating", "business_name")


def _compatibility_reasons(listing: ContractorDirectoryListing) -> list[str]:
    reasons = []
    contractor = getattr(listing, "claimed_contractor", None)
    tags = [str(tag).strip() for tag in (listing.compatibility_tags or []) if str(tag).strip()]
    if listing.assisted_diy_friendly:
        reasons.append("Assisted DIY friendly")
    if listing.escrow_friendly:
        reasons.append("Escrow friendly")
    if listing.inspection_capable:
        reasons.append("Inspection capable")
    if listing.rescue_project_friendly:
        reasons.append("Rescue-project friendly")
    if listing.collaboration_score is not None:
        reasons.append(f"Collaboration score {int(round(float(listing.collaboration_score)))}")
    for tag in tags[:3]:
        reasons.append(tag)
    if contractor and getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED:
        reasons.append("MyHomeBro verified")
    if contractor and getattr(contractor, "marketplace_preferred", False) and getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED:
        reasons.append("Preferred status reviewed")
    return list(dict.fromkeys(reasons))


def _recommendation_tier(listing: ContractorDirectoryListing) -> str:
    score = 0
    if listing.claimed_profile:
        score += 25
    if listing.assisted_diy_friendly:
        score += 20
    if listing.escrow_friendly:
        score += 15
    if listing.inspection_capable:
        score += 15
    if listing.rescue_project_friendly:
        score += 10
    if listing.google_review_count:
        score += min(15, int(listing.google_review_count // 20))
    if listing.google_rating:
        score += min(10, int(float(listing.google_rating)))
    if score >= 60:
        return "Strong Match"
    if score >= 35:
        return "Good Match"
    return "Limited Match"


def _serialize_listing(listing: ContractorDirectoryListing, *, include_invites: bool = False) -> dict[str, Any]:
    profile = getattr(listing, "claimed_contractor", None)
    invites = list(getattr(listing, "discovery_invites", []).all().order_by("-created_at")[:5]) if include_invites and hasattr(listing, "discovery_invites") else []
    recommendation_reasons = _compatibility_reasons(listing)
    supported_modes = ["full_service"]
    if listing.assisted_diy_friendly:
        supported_modes.append("assisted_diy")
    if listing.inspection_capable:
        supported_modes.append("inspection_only")
    if listing.escrow_friendly:
        supported_modes.append("consultation")

    return {
        "id": listing.id,
        "source": listing.source,
        "google_place_id": listing.google_place_id,
        "business_name": listing.business_name,
        "normalized_business_name": listing.normalized_business_name,
        "phone_number": listing.phone_number,
        "email": listing.email,
        "website_url": listing.website_url,
        "google_maps_url": listing.google_maps_url,
        "formatted_address": listing.formatted_address,
        "city": listing.city,
        "state": listing.state,
        "zip_code": listing.zip_code,
        "latitude": listing.latitude,
        "longitude": listing.longitude,
        "primary_trade": listing.primary_trade,
        "trade_categories": listing.trade_categories or [],
        "google_rating": listing.google_rating,
        "google_review_count": int(listing.google_review_count or 0),
        "business_status": listing.business_status,
        "claimed_profile": bool(listing.claimed_profile),
        "claimed_contractor_id": listing.claimed_contractor_id,
        "claimed_contractor_name": safe_get(profile, ["business_name", "name"], None) if profile else None,
        "contractor_verification_status": getattr(profile, "marketplace_verification_status", "") if profile else "",
        "contractor_verified": bool(profile and getattr(profile, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED),
        "contractor_preferred": bool(profile and getattr(profile, "marketplace_preferred", False) and getattr(profile, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED),
        "sms_opt_out": bool(listing.sms_opt_out),
        "email_opt_out": bool(listing.email_opt_out),
        "manually_reviewed": bool(listing.manually_reviewed),
        "manually_enriched": bool(listing.manually_enriched),
        "admin_notes": listing.admin_notes,
        "assisted_diy_friendly": bool(listing.assisted_diy_friendly),
        "escrow_friendly": bool(listing.escrow_friendly),
        "inspection_capable": bool(listing.inspection_capable),
        "rescue_project_friendly": bool(listing.rescue_project_friendly),
        "collaboration_score": listing.collaboration_score,
        "compatibility_tags": listing.compatibility_tags or [],
        "compatibility_reasons": recommendation_reasons,
        "recommendation_tier": _recommendation_tier(listing),
        "recommended_score": min(100, int(round((listing.collaboration_score or 0) if listing.collaboration_score is not None else len(recommendation_reasons) * 10))),
        "supported_project_modes": list(dict.fromkeys(supported_modes)),
        "invite_count": ContractorDiscoveryInvite.objects.filter(directory_listing=listing).count(),
        "latest_invite_at": ContractorDiscoveryInvite.objects.filter(directory_listing=listing).aggregate(latest=Max("created_at")).get("latest"),
        "last_synced_at": listing.last_synced_at.isoformat() if listing.last_synced_at else None,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
        "updated_at": listing.updated_at.isoformat() if listing.updated_at else None,
        "label": "Profile Reviewed" if profile and getattr(profile, "marketplace_verification_status", "") == Contractor.MARKETPLACE_VERIFIED else "Claimed Contractor" if listing.claimed_profile else "Local Business Listing",
        "claimed": bool(listing.claimed_profile),
        "invite_available": bool(listing.phone_number or listing.email or listing.claimed_contractor_id),
        "phone_available": bool(listing.phone_number),
        "email_available": bool(listing.email),
        "compatibility_profile": {
            "tier": _recommendation_tier(listing),
            "summary": "Admin-managed marketplace listing.",
            "badges": [
                "DIY Assistance Available" if listing.assisted_diy_friendly else None,
                "Escrow Workflow Compatible" if listing.escrow_friendly else None,
                "Inspection Services" if listing.inspection_capable else None,
                "Rescue Project Assistance" if listing.rescue_project_friendly else None,
            ],
            "ways_i_work": [
                {
                    "key": "assisted_diy",
                    "label": "DIY Assistance Available",
                    "description": "Comfortable supporting homeowner participation.",
                }
                if listing.assisted_diy_friendly
                else None,
                {
                    "key": "escrow",
                    "label": "Escrow Workflow Compatible",
                    "description": "Works with milestone-based protection.",
                }
                if listing.escrow_friendly
                else None,
            ],
            "reasons": recommendation_reasons,
        },
        "recent_invites": [
            {
                "id": invite.id,
                "status": invite.status,
                "channel": invite.channel,
                "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
                "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
                "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
                "response_at": invite.response_at.isoformat() if invite.response_at else None,
                "destination_phone": invite.destination_phone,
                "destination_email": invite.destination_email,
                "error_message": invite.error_message,
                "claim_url": invite.invite_url_path,
            }
            for invite in invites
        ],
    }


class AdminMarketplaceOverview(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        listings = ContractorDirectoryListing.objects.all()
        invites = ContractorDiscoveryInvite.objects.all()

        by_trade = defaultdict(lambda: {"total": 0, "claimed": 0, "assisted": 0, "escrow": 0, "inspection": 0})
        by_city = defaultdict(lambda: {"total": 0, "claimed": 0})
        by_state = defaultdict(lambda: {"total": 0, "claimed": 0})
        gaps = []

        for listing in listings:
            trade = _safe_text(listing.primary_trade) or "Unknown"
            by_trade[trade]["total"] += 1
            by_trade[trade]["claimed"] += int(bool(listing.claimed_profile))
            by_trade[trade]["assisted"] += int(bool(listing.assisted_diy_friendly))
            by_trade[trade]["escrow"] += int(bool(listing.escrow_friendly))
            by_trade[trade]["inspection"] += int(bool(listing.inspection_capable))

            city = _safe_text(listing.city) or "Unknown"
            state = _safe_text(listing.state) or "Unknown"
            by_city[city]["total"] += 1
            by_city[city]["claimed"] += int(bool(listing.claimed_profile))
            by_state[state]["total"] += 1
            by_state[state]["claimed"] += int(bool(listing.claimed_profile))

        for trade, stats in sorted(by_trade.items(), key=lambda item: (-item[1]["total"], item[0])):
            if stats["total"] and stats["claimed"] == 0:
                gaps.append({
                    "title": f"{trade} has no claimed contractors",
                    "detail": f"{stats['total']} directory listing(s) are still unclaimed for this trade.",
                    "trade": trade,
                    "claimed": stats["claimed"],
                    "total": stats["total"],
                    "tone": "warn",
                })

        invite_analytics = ContractorDiscoveryInvite.analytics()
        claimed_count = listings.filter(claimed_profile=True).count()
        unclaimed_count = listings.filter(claimed_profile=False).count()
        opted_out_count = listings.filter(Q(sms_opt_out=True) | Q(email_opt_out=True)).count()
        location_keys = _marketplace_location_keys()
        saved_marketplace_requests = _marketplace_overview_requests_payload()
        location_rows = [
            location_readiness(city, state)
            for city, state in location_keys
            if city and state
        ]
        automatic_matching_rows = (
            automatic_matching_readiness_rows_for_locations(location_keys)
            if _safe_bool(request.query_params.get("include_readiness", True))
            else []
        )
        automatic_matching_rows.sort(
            key=lambda row: (row["state"], row["city"], row["trade"])
        )
        for row in location_rows:
            row["marketplace_backlog"] = saved_marketplace_requests["by_location"].get(
                f"{row['city']}, {row['state']}",
                {
                    "city": row["city"],
                    "state": row["state"],
                    "saved_not_routed": 0,
                    "routable_now": 0,
                    "already_routed": 0,
                    "blocked_disabled": 0,
                    "blocked_no_eligible_contractors": 0,
                    "at_cap": 0,
                },
            )
        status_order = {"enabled": 0, "ready": 1, "nearing_ready": 2, "not_ready": 3}
        location_rows.sort(
            key=lambda row: (
                status_order.get(row["status"], 9),
                -int(row["counts"]["claimed_contractors"]),
                row["state"],
                row["city"],
            )
        )

        return Response(
            {
                "generated_at": timezone.now().isoformat(),
                "summary": {
                    "total_listings": listings.count(),
                    "claimed_listings": claimed_count,
                    "unclaimed_listings": unclaimed_count,
                    "opted_out_listings": opted_out_count,
                    "manual_reviewed_listings": listings.filter(manually_reviewed=True).count(),
                    "manual_enriched_listings": listings.filter(manually_enriched=True).count(),
                    "total_invites": invite_analytics["total"],
                    "sent_invites": invite_analytics["sent"],
                    "claimed_invites": invite_analytics["claimed"],
                    "claim_rate": invite_analytics["claim_rate"],
                    "response_rate": invite_analytics["response_rate"],
                    "agreement_conversion": invite_analytics["agreement_conversion"],
                    "escrow_conversion": invite_analytics["escrow_conversion"],
                },
                "coverage": {
                    "trades": [
                        {
                            "trade": trade,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                            "claim_rate": round((stats["claimed"] / stats["total"]) * 100.0, 2) if stats["total"] else 0.0,
                            "assisted_diy": stats["assisted"],
                            "escrow_friendly": stats["escrow"],
                            "inspection_capable": stats["inspection"],
                        }
                        for trade, stats in sorted(by_trade.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "cities": [
                        {
                            "city": city,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                        }
                        for city, stats in sorted(by_city.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "states": [
                        {
                            "state": state,
                            "total": stats["total"],
                            "claimed": stats["claimed"],
                        }
                        for state, stats in sorted(by_state.items(), key=lambda item: (-item[1]["total"], item[0]))[:12]
                    ],
                    "gaps": gaps[:10],
                    "location_readiness": location_rows[:50],
                    "automatic_matching_readiness": automatic_matching_rows,
                },
                "invite_analytics": invite_analytics,
                "saved_marketplace_requests": saved_marketplace_requests,
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceAnalytics(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        return Response(build_marketplace_analytics(request.query_params), status=status.HTTP_200_OK)


class AdminMarketplaceRequests(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        return Response(_saved_marketplace_requests_payload(request.query_params), status=status.HTTP_200_OK)


class AdminMarketplaceRequestLifecycle(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, request_id):
        if not (request.user.is_superuser or request.user.has_perm("projects.change_projectintake")):
            return Response({"detail": "You do not have permission to change request lifecycle state."}, status=403)
        if request.data.get("confirmed") is not True:
            return Response({"detail": "Explicit confirmation is required."}, status=400)
        intake = ProjectIntake.objects.filter(pk=request_id).first()
        if intake is None:
            return Response({"detail": "Marketplace request not found."}, status=404)
        action = _safe_text(request.data.get("action")).lower()
        if action == "archive":
            changed = archive_request(intake, reason="admin_archived")
        elif action == "restore":
            changed = restore_request(intake)
        else:
            return Response({"detail": "Action must be archive or restore."}, status=400)
        intake.refresh_from_db()
        return Response({
            "changed": changed,
            "lifecycle_status": lifecycle_state(intake)["code"],
            "archived_at": _safe_dt(intake.marketplace_archived_at),
            "restored_at": _safe_dt(intake.marketplace_restored_at),
        })


class AdminMarketplaceCoverage(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        return Response(
            build_marketplace_coverage_map(request.query_params),
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceReadiness(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        return Response(
            _readiness_rows(request.query_params),
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceLocationStatus(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    @transaction.atomic
    def post(self, request):
        city = normalize_location_value(request.data.get("city"))
        state = normalize_location_value(request.data.get("state"))
        if not city or not state:
            return Response({"detail": "City and state are required."}, status=status.HTTP_400_BAD_REQUEST)

        enabled = _safe_bool(request.data.get("enabled"))
        trade = normalize_trade(request.data.get("trade"))
        if "trade" in request.data and trade not in CORE_TRADE_CATEGORIES:
            return Response({"detail": "A supported service/trade is required."}, status=status.HTTP_400_BAD_REQUEST)
        matching_locations = matching_marketplace_locations(city, state)
        if len(matching_locations) > 1:
            return Response(
                {"detail": "Multiple legacy location records share this normalized city and state; review them before changing automatic matching."},
                status=status.HTTP_409_CONFLICT,
            )
        location = matching_locations[0] if matching_locations else None
        if location is None:
            location = MarketplaceLocation.objects.create(city=city, state=state, updated_by=request.user)
        location_changed = not trade
        if trade:
            city_key, state_key = automatic_matching_location_keys(city, state)
            MarketplaceAutomaticMatchingApproval.objects.update_or_create(
                city_key=city_key, state_key=state_key, trade=trade,
                defaults={"is_approved": enabled, "updated_by": request.user},
            )
        else:
            # Preserve the legacy city setting for historical compatibility only.
            # It cannot authorize or pause any per-trade automatic match.
            location.is_enabled = enabled
        if "admin_notes" in request.data and _safe_text(request.data.get("admin_notes")):
            location.admin_notes = _safe_text(request.data.get("admin_notes"))
            location_changed = True
        if enabled and not trade:
            location.enabled_at = timezone.now()
            location.disabled_at = None
        elif not trade:
            location.disabled_at = timezone.now()
        for field in [
            "min_claimed_contractors",
            "min_verified_contractors",
            "min_stripe_ready_contractors",
            "min_trade_categories",
            "max_bids_per_request",
        ]:
            if field in request.data:
                value = _safe_int(request.data.get(field), 0)
                setattr(location, field, value or None if field != "max_bids_per_request" else max(1, min(value or 5, 5)))
                location_changed = True
        if location_changed:
            location.updated_by = request.user
            location.save()
        return Response(
            automatic_matching_readiness(city, state, trade) if trade else location_readiness(city, state),
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceRouteIntake(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request):
        intake_id = _safe_int(request.data.get("intake_id"), 0)
        if not intake_id:
            return Response({"detail": "intake_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        intake = ProjectIntake.objects.filter(pk=intake_id).first()
        if intake is None:
            return Response({"detail": "Project intake not found."}, status=status.HTTP_404_NOT_FOUND)
        if intake.marketplace_archived_at:
            return Response(
                {"detail": "Archived marketplace requests must be restored and reviewed before routing."},
                status=status.HTTP_409_CONFLICT,
            )

        result = create_marketplace_invites_for_intake(intake_id)
        response_status = status.HTTP_200_OK if result.get("marketplace", {}).get("can_auto_route") else status.HTTP_202_ACCEPTED
        return Response(result, status=response_status)


class AdminMarketplaceVerification(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        qs = Contractor.objects.select_related(
            "user",
            "marketplace_verified_by",
            "marketplace_suspended_by",
            "marketplace_preferred_by",
        ).prefetch_related("skills", "directory_entries")
        status_filter = _safe_text(request.query_params.get("status")).lower()
        preferred_filter = _safe_text(request.query_params.get("preferred")).lower()
        stripe_filter = _safe_text(request.query_params.get("stripe_ready")).lower()
        missing_filter = _safe_text(request.query_params.get("missing")).lower()
        q = _safe_text(request.query_params.get("q")).lower()
        if status_filter and status_filter != "all":
            qs = qs.filter(marketplace_verification_status=status_filter)
        if preferred_filter in {"1", "true", "yes"}:
            qs = qs.filter(marketplace_preferred=True)
        elif preferred_filter in {"0", "false", "no"}:
            qs = qs.filter(marketplace_preferred=False)
        if stripe_filter in {"1", "true", "yes"}:
            qs = qs.filter(charges_enabled=True, payouts_enabled=True, stripe_deauthorized_at__isnull=True)
        elif stripe_filter in {"0", "false", "no"}:
            qs = qs.exclude(charges_enabled=True, payouts_enabled=True, stripe_deauthorized_at__isnull=True)

        rows = [_serialize_verification_contractor(contractor) for contractor in qs.order_by("marketplace_verification_status", "-marketplace_preferred", "business_name", "id")[:500]]
        if missing_filter:
            rows = [row for row in rows if missing_filter in {item.lower() for item in row["missing_requirements"]}]
        if q:
            rows = [
                row
                for row in rows
                if q
                in " ".join(
                    [
                        row["business_name"],
                        row["email"],
                        row["service_area"],
                        " ".join(row["trades"]),
                        row["verification_status"],
                    ]
                ).lower()
            ]
        summary = {
            "total": len(rows),
            "pending_review": sum(1 for row in rows if row["verification_status"] == Contractor.MARKETPLACE_PENDING_REVIEW),
            "verified": sum(1 for row in rows if row["verification_status"] == Contractor.MARKETPLACE_VERIFIED),
            "preferred": sum(1 for row in rows if row["preferred"]),
            "rejected": sum(1 for row in rows if row["verification_status"] == Contractor.MARKETPLACE_REJECTED),
            "suspended": sum(1 for row in rows if row["verification_status"] == Contractor.MARKETPLACE_SUSPENDED),
            "stripe_ready": sum(1 for row in rows if row["stripe_ready"]),
            "missing_license": sum(1 for row in rows if "license" in row["missing_requirements"]),
            "missing_insurance": sum(1 for row in rows if "insurance" in row["missing_requirements"]),
        }
        return Response({"summary": summary, "results": rows}, status=status.HTTP_200_OK)

    def post(self, request):
        contractor_id = _safe_int(request.data.get("contractor_id"), 0)
        action = _safe_text(request.data.get("action")).lower()
        notes = _safe_text(request.data.get("notes"))
        reason = _safe_text(request.data.get("reason")) or notes
        if not contractor_id:
            return Response({"detail": "contractor_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        contractor = Contractor.objects.select_related("user").filter(pk=contractor_id).first()
        if contractor is None:
            return Response({"detail": "Contractor not found."}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        update_fields = ["marketplace_verification_status", "marketplace_verification_notes", "updated_at"]
        if notes:
            contractor.marketplace_verification_notes = notes

        if action == "verify":
            missing = _contractor_missing_requirements(contractor)
            if missing:
                return Response(
                    {"detail": f"Cannot verify until missing requirements are resolved: {', '.join(missing)}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            contractor.marketplace_verification_status = Contractor.MARKETPLACE_VERIFIED
            contractor.marketplace_verified_at = now
            contractor.marketplace_verified_by = request.user
            contractor.marketplace_verification_rejected_reason = ""
            update_fields += ["marketplace_verified_at", "marketplace_verified_by", "marketplace_verification_rejected_reason"]
        elif action == "reject":
            contractor.marketplace_verification_status = Contractor.MARKETPLACE_REJECTED
            contractor.marketplace_verification_rejected_reason = reason
            contractor.marketplace_preferred = False
            contractor.marketplace_preferred_reason = ""
            contractor.marketplace_preferred_at = None
            contractor.marketplace_preferred_by = None
            update_fields += [
                "marketplace_verification_rejected_reason",
                "marketplace_preferred",
                "marketplace_preferred_reason",
                "marketplace_preferred_at",
                "marketplace_preferred_by",
            ]
        elif action == "suspend":
            contractor.marketplace_verification_status = Contractor.MARKETPLACE_SUSPENDED
            contractor.marketplace_suspended_at = now
            contractor.marketplace_suspended_by = request.user
            contractor.marketplace_preferred = False
            contractor.marketplace_preferred_reason = ""
            contractor.marketplace_preferred_at = None
            contractor.marketplace_preferred_by = None
            update_fields += [
                "marketplace_suspended_at",
                "marketplace_suspended_by",
                "marketplace_preferred",
                "marketplace_preferred_reason",
                "marketplace_preferred_at",
                "marketplace_preferred_by",
            ]
        elif action == "unsuspend":
            if contractor.marketplace_verification_status == Contractor.MARKETPLACE_SUSPENDED:
                contractor.marketplace_verification_status = Contractor.MARKETPLACE_UNVERIFIED
            contractor.marketplace_suspended_at = None
            contractor.marketplace_suspended_by = None
            update_fields += ["marketplace_suspended_at", "marketplace_suspended_by"]
        elif action == "mark_preferred":
            if contractor.marketplace_verification_status != Contractor.MARKETPLACE_VERIFIED:
                return Response({"detail": "Only verified contractors can be marked preferred."}, status=status.HTTP_400_BAD_REQUEST)
            if getattr(contractor.user, "is_active", True) is False:
                return Response({"detail": "Inactive contractors cannot be marked preferred."}, status=status.HTTP_400_BAD_REQUEST)
            contractor.marketplace_preferred = True
            contractor.marketplace_preferred_reason = reason
            contractor.marketplace_preferred_at = now
            contractor.marketplace_preferred_by = request.user
            update_fields += [
                "marketplace_preferred",
                "marketplace_preferred_reason",
                "marketplace_preferred_at",
                "marketplace_preferred_by",
            ]
        elif action == "remove_preferred":
            contractor.marketplace_preferred = False
            contractor.marketplace_preferred_reason = reason
            contractor.marketplace_preferred_at = None
            contractor.marketplace_preferred_by = None
            update_fields += [
                "marketplace_preferred",
                "marketplace_preferred_reason",
                "marketplace_preferred_at",
                "marketplace_preferred_by",
            ]
        else:
            return Response({"detail": "Unsupported verification action."}, status=status.HTTP_400_BAD_REQUEST)

        contractor.save(update_fields=list(dict.fromkeys(update_fields)))
        try:
            notify_contractor_verification_status(
                contractor=contractor,
                action=action,
                actor_user=request.user,
                reason=reason,
            )
        except Exception:
            pass
        return Response(_serialize_verification_contractor(contractor), status=status.HTTP_200_OK)


class AdminMarketplaceContractors(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        qs = _query_listings(request)
        limit = max(1, min(_safe_int(request.query_params.get("limit"), 100), 500))
        offset = max(0, _safe_int(request.query_params.get("offset"), 0))
        page = list(qs[offset : offset + limit])
        recent_invites = {}
        invite_rows = ContractorDiscoveryInvite.objects.filter(directory_listing_id__in=[row.id for row in page]).order_by("-created_at")[:300]
        for invite in invite_rows:
            recent_invites.setdefault(invite.directory_listing_id, []).append(invite)

        results = []
        for listing in page:
            payload = _serialize_listing(listing)
            payload["recent_invites"] = [
                {
                    "id": invite.id,
                    "status": invite.status,
                    "channel": invite.channel,
                    "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
                    "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
                    "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
                }
                for invite in recent_invites.get(listing.id, [])[:3]
            ]
            results.append(payload)

        return Response(
            {
                "count": qs.count(),
                "offset": offset,
                "limit": limit,
                "results": results,
                "filters": {
                    "q": _safe_text(request.query_params.get("q")),
                    "trade": _safe_text(request.query_params.get("trade")),
                    "city": _safe_text(request.query_params.get("city")),
                    "state": _safe_text(request.query_params.get("state")),
                    "claimed": _safe_text(request.query_params.get("claimed")),
                    "source": _safe_text(request.query_params.get("source")),
                    "reviewed": _safe_text(request.query_params.get("reviewed")),
                    "enriched": _safe_text(request.query_params.get("enriched")),
                    "invited": _safe_text(request.query_params.get("invited")),
                    "assisted_diy": _safe_text(request.query_params.get("assisted_diy")),
                    "escrow_friendly": _safe_text(request.query_params.get("escrow_friendly")),
                    "inspection_capable": _safe_text(request.query_params.get("inspection_capable")),
                    "rescue_project_friendly": _safe_text(request.query_params.get("rescue_project_friendly")),
                    "has_phone": _safe_text(request.query_params.get("has_phone")),
                    "has_email": _safe_text(request.query_params.get("has_email")),
                    "min_rating": _safe_text(request.query_params.get("min_rating")),
                },
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceImport(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        payload = {
            "project_type": _safe_text(request.query_params.get("project_type")),
            "project_subtype": _safe_text(request.query_params.get("project_subtype")),
            "project_mode": _safe_text(request.query_params.get("project_mode")),
            "payment_preference": _safe_text(request.query_params.get("payment_preference")),
            "project_city": _safe_text(request.query_params.get("city")),
            "project_state": _safe_text(request.query_params.get("state")),
            "project_postal_code": _safe_text(request.query_params.get("zip")),
        }
        query = _safe_text(request.query_params.get("query")) or project_type_to_places_query(payload["project_type"], payload["project_subtype"])
        radius = _safe_int(request.query_params.get("radius_miles"), suggest_radius_miles(payload["project_type"], payload["project_subtype"], payload["project_mode"]))
        limit = max(1, min(_safe_int(request.query_params.get("limit"), 10), 25))
        latitude = request.query_params.get("lat")
        longitude = request.query_params.get("lng")

        recommendations = build_contractor_recommendations(
            payload=payload,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius,
            limit=limit,
        )
        return Response(recommendations, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request):
        selected = request.data.get("selected_contractors") or request.data.get("selected_results") or []
        if not isinstance(selected, list) or not selected:
            return Response({"detail": "Select at least one contractor listing."}, status=status.HTTP_400_BAD_REQUEST)

        admin_notes = _safe_text(request.data.get("admin_notes"))
        compatibility_tags = _normalize_list(request.data.get("compatibility_tags"))
        updated_rows = []
        for item in selected:
            if not isinstance(item, dict):
                continue
            listing_id = item.get("directory_listing_id") or item.get("id")
            if isinstance(listing_id, str) and ":" in listing_id:
                listing_id = listing_id.split(":", 1)[1]
            try:
                listing = ContractorDirectoryListing.objects.get(id=int(listing_id))
            except Exception:
                continue
            listing.manually_reviewed = True
            if admin_notes:
                listing.admin_notes = admin_notes
            if compatibility_tags:
                listing.compatibility_tags = list(dict.fromkeys((listing.compatibility_tags or []) + compatibility_tags))
                listing.manually_enriched = True
            if _safe_bool(item.get("assisted_diy_friendly")):
                listing.assisted_diy_friendly = True
            if _safe_bool(item.get("escrow_friendly")):
                listing.escrow_friendly = True
            if _safe_bool(item.get("inspection_capable")):
                listing.inspection_capable = True
            if _safe_bool(item.get("rescue_project_friendly")):
                listing.rescue_project_friendly = True
            if item.get("primary_trade"):
                listing.primary_trade = _safe_text(item.get("primary_trade"))
            if isinstance(item.get("trade_categories"), list):
                listing.trade_categories = _normalize_list(item.get("trade_categories"))
            if _safe_text(item.get("email")):
                listing.email = _safe_text(item.get("email"))
            if _safe_text(item.get("phone_number")):
                listing.phone_number = _safe_text(item.get("phone_number"))
            listing.save()
            updated_rows.append(_serialize_listing(listing))

        return Response(
            {
                "detail": "Listings imported.",
                "updated_count": len(updated_rows),
                "results": updated_rows,
            },
            status=status.HTTP_200_OK,
        )


class AdminMarketplaceListingDetail(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get_object(self, listing_id: int) -> ContractorDirectoryListing:
        try:
            return ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user").get(id=listing_id)
        except ContractorDirectoryListing.DoesNotExist as exc:
            raise Http404("Directory listing not found.") from exc

    def get(self, request, listing_id: int):
        listing = self.get_object(listing_id)
        payload = _serialize_listing(listing, include_invites=True)
        payload["recommendation_snapshot"] = build_contractor_recommendations(
            payload={
                "project_type": listing.primary_trade,
                "project_subtype": " ".join(listing.trade_categories or []),
                "project_title": listing.business_name,
                "description": listing.formatted_address or listing.business_name,
                "project_scope_summary": listing.business_name,
                "project_city": listing.city,
                "project_state": listing.state,
                "project_mode": "assisted_diy" if listing.assisted_diy_friendly else "full_service",
                "payment_preference": "escrow" if listing.escrow_friendly else "direct",
            },
            query=listing.business_name or listing.primary_trade,
            latitude=listing.latitude,
            longitude=listing.longitude,
            radius_miles=25,
            limit=3,
        ).get("results", [])
        return Response(payload, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, listing_id: int):
        listing = self.get_object(listing_id)
        mutable_fields = {
            "business_name",
            "phone_number",
            "email",
            "website_url",
            "google_maps_url",
            "formatted_address",
            "city",
            "state",
            "zip_code",
            "primary_trade",
            "google_rating",
            "google_review_count",
            "business_status",
            "admin_notes",
            "assisted_diy_friendly",
            "escrow_friendly",
            "inspection_capable",
            "rescue_project_friendly",
            "manually_reviewed",
            "manually_enriched",
            "claimed_profile",
            "sms_opt_out",
            "email_opt_out",
            "collaboration_score",
        }

        for key in mutable_fields:
            if key in request.data:
                setattr(listing, key, request.data.get(key))

        if "trade_categories" in request.data:
            listing.trade_categories = _normalize_list(request.data.get("trade_categories"))
        if "compatibility_tags" in request.data:
            listing.compatibility_tags = _normalize_list(request.data.get("compatibility_tags"))

        listing.save()
        return Response(_serialize_listing(listing, include_invites=True), status=status.HTTP_200_OK)


class AdminMarketplaceListingInvite(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, listing_id: int):
        try:
            listing = ContractorDirectoryListing.objects.select_related("claimed_contractor", "claimed_contractor__user").get(id=listing_id)
        except ContractorDirectoryListing.DoesNotExist as exc:
            raise Http404("Directory listing not found.") from exc

        if listing.claimed_profile and listing.claimed_contractor_id:
            return Response(
                {"detail": "This listing is already claimed.", "claimed": True},
                status=status.HTTP_400_BAD_REQUEST,
            )

        channel = _safe_text(request.data.get("preferred_channel") or request.data.get("channel") or "").lower() or ContractorDiscoveryInvite.CHANNEL_SMS
        if channel not in dict(ContractorDiscoveryInvite.CHANNEL_CHOICES):
            channel = ContractorDiscoveryInvite.CHANNEL_SMS

        invite = ContractorDiscoveryInvite.objects.filter(directory_listing=listing).order_by("-created_at").first()
        if invite is not None and invite.status in {ContractorDiscoveryInvite.STATUS_SENT, ContractorDiscoveryInvite.STATUS_DELIVERED, ContractorDiscoveryInvite.STATUS_CLICKED}:
            return Response(
                {"detail": "An invite has already been sent recently.", "invite": _invite_payload(invite)},
                status=status.HTTP_200_OK,
            )

        invite = ContractorDiscoveryInvite.objects.create(
            directory_listing=listing,
            channel=channel,
            destination_phone=listing.phone_number if channel == ContractorDiscoveryInvite.CHANNEL_SMS else "",
            destination_email=listing.email if channel == ContractorDiscoveryInvite.CHANNEL_EMAIL else "",
        )

        claim_link = request.build_absolute_uri(f"/contractors/claim/{invite.invite_token}")
        city = listing.city or "your area"
        project_type = listing.primary_trade or "project"
        message = (
            f"MyHomeBro: Your business was selected for local contractor discovery on MyHomeBro. "
            f"Claim your profile to review project opportunities in your area: {claim_link} "
            "Reply STOP to opt out."
        )
        email_subject = "Claim your contractor profile on MyHomeBro"
        email_body = (
            "Your business has been added as a local contractor listing on MyHomeBro using publicly available business information.\n\n"
            "Claim your contractor profile to:\n"
            "- receive project requests\n"
            "- manage your profile\n"
            "- participate in milestone-based escrow workflow projects\n"
            "- review Assisted DIY opportunities\n"
            "- receive collaborative project matches\n\n"
            f"Claim profile:\n{claim_link}\n\n"
            f"Opt out:\n{claim_link}?opt_out=1\n"
        )

        if channel == ContractorDiscoveryInvite.CHANNEL_SMS:
            if listing.sms_opt_out or not listing.phone_number:
                invite.status = ContractorDiscoveryInvite.STATUS_OPTED_OUT if listing.sms_opt_out else ContractorDiscoveryInvite.STATUS_FAILED
                invite.error_message = "SMS unavailable or opted out."
            else:
                try:
                    from projects.services.invites_delivery import send_twilio_sms

                    ok, msg = send_twilio_sms(to_phone=listing.phone_number, body=message)
                    invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                    invite.sent_at = timezone.now() if ok else None
                    invite.error_message = "" if ok else msg
                except Exception as exc:
                    invite.status = ContractorDiscoveryInvite.STATUS_FAILED
                    invite.error_message = str(exc)
        elif channel == ContractorDiscoveryInvite.CHANNEL_EMAIL:
            if listing.email_opt_out or not listing.email:
                invite.status = ContractorDiscoveryInvite.STATUS_OPTED_OUT if listing.email_opt_out else ContractorDiscoveryInvite.STATUS_FAILED
                invite.error_message = "Email unavailable or opted out."
            else:
                try:
                    from projects.services.invites_delivery import send_postmark_email

                    ok, msg = send_postmark_email(to_email=listing.email, subject=email_subject, text_body=email_body)
                    invite.status = ContractorDiscoveryInvite.STATUS_SENT if ok else ContractorDiscoveryInvite.STATUS_FAILED
                    invite.sent_at = timezone.now() if ok else None
                    invite.error_message = "" if ok else msg
                except Exception as exc:
                    invite.status = ContractorDiscoveryInvite.STATUS_FAILED
                    invite.error_message = str(exc)
        else:
            invite.status = ContractorDiscoveryInvite.STATUS_PENDING
            invite.error_message = "Invite created for manual follow-up."

        invite.save(update_fields=["status", "sent_at", "error_message", "destination_phone", "destination_email", "updated_at"])
        return Response(
            {
                "detail": "Invite created.",
                "claim_link": claim_link,
                "invite": _invite_payload(invite),
                "message": message,
                "email_subject": email_subject,
                "email_body": email_body,
            },
            status=status.HTTP_200_OK,
        )


def _invite_payload(invite: ContractorDiscoveryInvite) -> dict[str, Any]:
    return {
        "id": invite.id,
        "invite_token": str(invite.invite_token),
        "status": invite.status,
        "channel": invite.channel,
        "destination_phone": invite.destination_phone,
        "destination_email": invite.destination_email,
        "sent_at": invite.sent_at.isoformat() if invite.sent_at else None,
        "clicked_at": invite.clicked_at.isoformat() if invite.clicked_at else None,
        "claimed_at": invite.claimed_at.isoformat() if invite.claimed_at else None,
        "response_at": invite.response_at.isoformat() if invite.response_at else None,
        "error_message": invite.error_message,
        "claim_url": invite.invite_url_path,
    }
