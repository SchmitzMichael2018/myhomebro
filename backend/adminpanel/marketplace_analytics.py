from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal
from typing import Any

from django.db.models import Q
from django.utils import timezone

from projects.models import Agreement, Contractor, PublicContractorLead
from projects.models_contractor_discovery import (
    ContractorDiscoveryInvite,
    ContractorOpportunity,
    MarketplaceLocation,
)
from projects.models_project_intake import ProjectIntake
from projects.services.bid_workflow import parse_money_like_text
from projects.services.contractor_reviews import contractor_performance_summary
from projects.services.marketplace_readiness import normalize_location_value


def _safe_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _parse_date_bound(value: Any, *, end: bool = False):
    text = _safe_text(value)
    if not text:
        return None
    try:
        parsed_date = datetime.fromisoformat(text).date()
    except Exception:
        return None
    return timezone.make_aware(datetime.combine(parsed_date, time.max if end else time.min))


def _pct(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round((float(numerator) / float(denominator)) * 100.0, 2)


def _avg_seconds(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _days(seconds: float | None) -> float | None:
    if seconds is None:
        return None
    return round(seconds / 86400, 2)


def _intake_title(intake: ProjectIntake) -> str:
    return (
        _safe_text(getattr(intake, "ai_project_title", ""))
        or _safe_text(getattr(intake, "accomplishment_text", ""))[:80]
        or f"Marketplace request #{intake.id}"
    )


def _source_intake_id(lead: PublicContractorLead) -> int | None:
    try:
        source_intake = getattr(lead, "source_intake", None)
        if source_intake and getattr(source_intake, "id", None):
            return int(source_intake.id)
    except Exception:
        pass
    analysis = getattr(lead, "ai_analysis", None) or {}
    try:
        value = analysis.get("source_intake_id")
        return int(value) if value else None
    except Exception:
        return None


def _lead_amount(lead: PublicContractorLead) -> Decimal | None:
    analysis = getattr(lead, "ai_analysis", None) or {}
    return (
        parse_money_like_text(getattr(lead, "budget_text", ""))
        or parse_money_like_text(analysis.get("suggested_total_price"))
        or parse_money_like_text(analysis.get("budget"))
    )


def _signed(agreement: Agreement | None) -> bool:
    if not agreement:
        return False
    contractor_ok = bool(getattr(agreement, "signed_by_contractor", False)) or not bool(getattr(agreement, "require_contractor_signature", True))
    homeowner_ok = bool(getattr(agreement, "signed_by_homeowner", False)) or not bool(getattr(agreement, "require_customer_signature", True))
    return contractor_ok and homeowner_ok


def build_marketplace_analytics(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    date_from = _parse_date_bound(params.get("date_from"))
    date_to = _parse_date_bound(params.get("date_to"), end=True)
    city_filter = normalize_location_value(params.get("city"))
    state_filter = normalize_location_value(params.get("state"))
    trade_filter = _safe_text(params.get("trade")).lower()
    contractor_status = _safe_text(params.get("contractor_status")).lower()

    intake_qs = ProjectIntake.objects.filter(post_submit_flow="multi_contractor")
    if date_from:
        intake_qs = intake_qs.filter(Q(submitted_at__gte=date_from) | Q(created_at__gte=date_from))
    if date_to:
        intake_qs = intake_qs.filter(Q(submitted_at__lte=date_to) | Q(created_at__lte=date_to))
    if city_filter:
        intake_qs = intake_qs.filter(Q(project_city__iexact=city_filter) | Q(customer_city__iexact=city_filter))
    if state_filter:
        intake_qs = intake_qs.filter(Q(project_state__iexact=state_filter) | Q(customer_state__iexact=state_filter))
    if trade_filter:
        intake_qs = intake_qs.filter(
            Q(ai_project_type__icontains=trade_filter)
            | Q(ai_project_subtype__icontains=trade_filter)
            | Q(accomplishment_text__icontains=trade_filter)
        )

    intakes = list(intake_qs.order_by("-created_at", "-id")[:1000])
    intake_ids = {row.id for row in intakes}

    invite_qs = ContractorDiscoveryInvite.objects.filter(public_intake_id__in=intake_ids)
    opportunity_qs = ContractorOpportunity.objects.filter(intake_request_id__in=intake_ids)
    lead_qs = PublicContractorLead.objects.select_related("contractor", "converted_agreement").all()
    leads = [lead for lead in lead_qs if _source_intake_id(lead) in intake_ids]
    if contractor_status:
        leads = [
            lead for lead in leads
            if _safe_text(getattr(getattr(lead, "contractor", None), "marketplace_verification_status", "")).lower() == contractor_status
        ]

    leads_by_intake: dict[int, list[PublicContractorLead]] = defaultdict(list)
    for lead in leads:
        source_id = _source_intake_id(lead)
        if source_id:
            leads_by_intake[source_id].append(lead)

    routed_ids = set(invite_qs.values_list("public_intake_id", flat=True))
    routed_ids.update(opportunity_qs.values_list("intake_request_id", flat=True))
    routed_ids.update(leads_by_intake.keys())

    awarded_leads = [
        lead for lead in leads
        if getattr(lead, "converted_agreement_id", None) or getattr(lead, "status", "") == PublicContractorLead.STATUS_ACCEPTED
    ]
    agreement_leads = [lead for lead in leads if getattr(lead, "converted_agreement_id", None)]
    signed_agreements = [lead.converted_agreement for lead in agreement_leads if _signed(getattr(lead, "converted_agreement", None))]
    escrow_funded = [
        lead.converted_agreement for lead in agreement_leads
        if getattr(getattr(lead, "converted_agreement", None), "escrow_funded", False)
        or Decimal(str(getattr(getattr(lead, "converted_agreement", None), "escrow_funded_amount", 0) or 0)) > 0
    ]

    request_to_first_bid = []
    request_to_award = []
    award_to_agreement = []
    for intake in intakes:
        request_at = getattr(intake, "submitted_at", None) or getattr(intake, "created_at", None)
        related = sorted(leads_by_intake.get(intake.id, []), key=lambda lead: getattr(lead, "created_at", None) or timezone.now())
        if request_at and related:
            request_to_first_bid.append((related[0].created_at - request_at).total_seconds())
        awarded = next((lead for lead in related if lead in awarded_leads), None)
        if request_at and awarded:
            award_time = getattr(awarded, "converted_at", None) or getattr(awarded, "accepted_at", None) or getattr(awarded, "updated_at", None)
            if award_time:
                request_to_award.append((award_time - request_at).total_seconds())
            agreement = getattr(awarded, "converted_agreement", None)
            if agreement and award_time and getattr(agreement, "created_at", None):
                award_to_agreement.append((agreement.created_at - award_time).total_seconds())

    requests_submitted = len(intakes)
    requests_routed = len([pk for pk in intake_ids if pk in routed_ids])
    requests_with_bid = len([pk for pk in intake_ids if leads_by_intake.get(pk)])
    awarded_request_ids = {_source_intake_id(lead) for lead in awarded_leads if _source_intake_id(lead)}
    agreement_request_ids = {_source_intake_id(lead) for lead in agreement_leads if _source_intake_id(lead)}

    funnel = {
        "requests_submitted": requests_submitted,
        "requests_routed": requests_routed,
        "contractor_invites_created": invite_qs.count(),
        "contractor_opportunities_created": opportunity_qs.count(),
        "bids_submitted": len(leads),
        "requests_with_zero_bids": max(requests_submitted - requests_with_bid, 0),
        "requests_with_at_least_one_bid": requests_with_bid,
        "awarded_requests": len(awarded_request_ids),
        "agreement_drafts_created": len(agreement_request_ids),
        "signed_agreements": len(signed_agreements),
        "escrow_funded": len(escrow_funded),
    }
    conversion_rates = {
        "request_to_routed": _pct(funnel["requests_routed"], funnel["requests_submitted"]),
        "routed_to_bid_received": _pct(funnel["requests_with_at_least_one_bid"], funnel["requests_routed"]),
        "bid_received_to_awarded": _pct(funnel["awarded_requests"], funnel["requests_with_at_least_one_bid"]),
        "awarded_to_agreement_draft": _pct(funnel["agreement_drafts_created"], funnel["awarded_requests"]),
        "agreement_draft_to_signed": _pct(funnel["signed_agreements"], funnel["agreement_drafts_created"]),
        "signed_to_escrow_funded": _pct(funnel["escrow_funded"], funnel["signed_agreements"]),
    }

    city_rows = defaultdict(lambda: {"requests": 0, "routed": 0, "bids": 0, "zero_bid_requests": 0, "awarded_requests": 0, "agreement_drafts": 0})
    for intake in intakes:
        city = normalize_location_value(getattr(intake, "project_city", "") or getattr(intake, "customer_city", "")) or "Unknown"
        state = normalize_location_value(getattr(intake, "project_state", "") or getattr(intake, "customer_state", "")) or ""
        key = f"{city}, {state}".strip(", ")
        row = city_rows[key]
        row.update({"city": city, "state": state})
        row["requests"] += 1
        row["routed"] += int(intake.id in routed_ids)
        row["bids"] += len(leads_by_intake.get(intake.id, []))
        row["zero_bid_requests"] += int(not leads_by_intake.get(intake.id))
        row["awarded_requests"] += int(intake.id in awarded_request_ids)
        row["agreement_drafts"] += int(intake.id in agreement_request_ids)
    city_analytics = []
    for row in city_rows.values():
        city_analytics.append({
            **row,
            "average_bids_per_request": round(row["bids"] / row["requests"], 2) if row["requests"] else 0,
            "award_rate": _pct(row["awarded_requests"], row["requests"]),
            "agreement_conversion_rate": _pct(row["agreement_drafts"], row["requests"]),
        })
    location_rows = list(MarketplaceLocation.objects.all())

    contractor_ids = {lead.contractor_id for lead in leads if lead.contractor_id}
    contractor_ids.update(opportunity_qs.exclude(accepted_by_contractor__isnull=True).values_list("accepted_by_contractor_id", flat=True))
    contractor_rows = []
    for contractor in Contractor.objects.filter(id__in=contractor_ids).select_related("user")[:100]:
        contractor_leads = [lead for lead in leads if lead.contractor_id == contractor.id]
        amounts = [amount for amount in (_lead_amount(lead) for lead in contractor_leads) if amount is not None]
        won = [lead for lead in contractor_leads if lead in awarded_leads]
        performance = contractor_performance_summary(contractor)
        contractor_rows.append({
            "contractor_id": contractor.id,
            "business_name": contractor.business_name or getattr(contractor.user, "email", "") or f"Contractor #{contractor.id}",
            "verification_status": contractor.marketplace_verification_status,
            "preferred": bool(contractor.marketplace_preferred),
            "opportunities_received": opportunity_qs.filter(
                Q(accepted_by_contractor=contractor) | Q(directory_entry__claimed_by_contractor=contractor)
            ).count(),
            "bids_submitted": len(contractor_leads),
            "bids_won": len(won),
            "win_rate": _pct(len(won), len(contractor_leads)),
            "average_bid_amount": f"{(sum(amounts, Decimal('0.00')) / len(amounts)):.2f}" if amounts else "",
            "average_rating": performance.get("average_rating"),
            "review_count": performance.get("review_count", 0),
            "performance_score": performance.get("performance_score"),
            "confidence": performance.get("confidence"),
            "confidence_label": performance.get("confidence_label"),
        })
    contractor_rows.sort(key=lambda row: (-(row["bids_submitted"] or 0), -(row["bids_won"] or 0), row["business_name"]))

    zero_bid_queue = []
    awaiting_award_queue = []
    awarded_unsigned_queue = []
    for intake in intakes:
        related = leads_by_intake.get(intake.id, [])
        if not related:
            zero_bid_queue.append({
                "id": intake.id,
                "title": _intake_title(intake),
                "city": normalize_location_value(getattr(intake, "project_city", "") or getattr(intake, "customer_city", "")),
                "state": normalize_location_value(getattr(intake, "project_state", "") or getattr(intake, "customer_state", "")),
                "submitted_at": (getattr(intake, "submitted_at", None) or getattr(intake, "created_at", None)).isoformat(),
                "routed": intake.id in routed_ids,
            })
        elif not any(lead in awarded_leads for lead in related):
            awaiting_award_queue.append({
                "id": intake.id,
                "title": _intake_title(intake),
                "city": normalize_location_value(getattr(intake, "project_city", "") or getattr(intake, "customer_city", "")),
                "state": normalize_location_value(getattr(intake, "project_state", "") or getattr(intake, "customer_state", "")),
                "bid_count": len(related),
                "oldest_bid_at": min(getattr(lead, "created_at", timezone.now()) for lead in related).isoformat(),
            })
    for lead in agreement_leads:
        agreement = getattr(lead, "converted_agreement", None)
        if agreement and not _signed(agreement):
            awarded_unsigned_queue.append({
                "lead_id": lead.id,
                "agreement_id": agreement.id,
                "title": getattr(getattr(agreement, "project", None), "title", "") or getattr(agreement, "project_type", "") or f"Agreement #{agreement.id}",
                "contractor": getattr(getattr(agreement, "contractor", None), "business_name", "") or getattr(lead.contractor, "business_name", ""),
                "created_at": agreement.created_at.isoformat() if getattr(agreement, "created_at", None) else "",
                "escrow_funded": bool(getattr(agreement, "escrow_funded", False)),
            })

    return {
        "generated_at": timezone.now().isoformat(),
        "filters": {
            "date_from": _safe_text(params.get("date_from")),
            "date_to": _safe_text(params.get("date_to")),
            "city": city_filter,
            "state": state_filter,
            "trade": trade_filter,
            "contractor_status": contractor_status,
        },
        "funnel": funnel,
        "conversion_rates": conversion_rates,
        "city_analytics": sorted(city_analytics, key=lambda row: (-row["requests"], row["state"], row["city"]))[:50],
        "contractor_analytics": contractor_rows[:50],
        "attention_queues": {
            "zero_bid_requests": zero_bid_queue[:25],
            "requests_awaiting_award": awaiting_award_queue[:25],
            "awarded_not_signed_or_funded": awarded_unsigned_queue[:25],
        },
        "time_metrics": {
            "avg_request_to_first_bid_days": _days(_avg_seconds(request_to_first_bid)),
            "avg_request_to_award_days": _days(_avg_seconds(request_to_award)),
            "avg_award_to_agreement_draft_days": _days(_avg_seconds(award_to_agreement)),
        },
        "location_summary": {
            "enabled_cities": sum(1 for row in location_rows if row.is_enabled),
            "ready_cities": sum(1 for row in location_rows if row.is_enabled),
        },
    }
