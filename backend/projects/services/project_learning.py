from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
from statistics import median, pstdev
from typing import Iterable

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone

from projects.models import Agreement, AgreementAIScope, Milestone, ProjectStatus
from projects.models_dispute import Dispute
from projects.models_learning import (
    AgreementOutcomeMilestoneSnapshot,
    AgreementOutcomeSnapshot,
    MilestoneBenchmarkAggregate,
    ProjectBenchmarkAggregate,
)
from projects.services.agreement_completion import _agreement_mode, _invoice_is_paid, _invoice_is_system_funding_invoice
from projects.services.pricing_observations import normalize_milestone_type
from projects.services.regions import build_normalized_region_key as shared_build_normalized_region_key


TWOPLACES = Decimal("0.01")


def _dec(value, *, default: Decimal | None = Decimal("0.00")) -> Decimal | None:
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _quantize(value: Decimal | None) -> Decimal:
    return (_dec(value) or Decimal("0.00")).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _mean_decimal(values: Iterable[Decimal]) -> Decimal:
    values = list(values)
    if not values:
        return Decimal("0.00")
    return _quantize(sum(values) / Decimal(len(values)))


def _median_decimal(values: Iterable[Decimal]) -> Decimal:
    values = list(values)
    if not values:
        return Decimal("0.00")
    return _quantize(Decimal(str(median(values))))


def _mean_number(values: Iterable[int | float | Decimal]) -> Decimal:
    values = [Decimal(str(v)) for v in values]
    if not values:
        return Decimal("0.00")
    return _quantize(sum(values) / Decimal(len(values)))


def _stddev_decimal(values: Iterable[Decimal]) -> Decimal:
    values = [float(v) for v in values]
    if len(values) < 2:
        return Decimal("0.00")
    return _quantize(Decimal(str(pstdev(values))))


def _stddev_number(values: Iterable[int | float | Decimal]) -> Decimal:
    values = [float(v) for v in values]
    if len(values) < 2:
        return Decimal("0.00")
    return _quantize(Decimal(str(pstdev(values))))


def _safe_text(value) -> str:
    return str(value or "").strip()


def _slug(value) -> str:
    return (
        _safe_text(value)
        .lower()
        .replace("&", " and ")
        .replace("/", " ")
        .replace("-", " ")
        .replace(",", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace(".", " ")
    )


def _normalize_answer_key(value) -> str:
    return "_".join(part for part in _slug(value).split() if part)


def _normalize_answer_value(value) -> str:
    return "_".join(part for part in _slug(value).split() if part)


def build_normalized_region_key(*, country: str = "US", state: str = "", city: str = "") -> str:
    """
    Backward-compatible wrapper around the shared normalized region key helper.

    Phase C learning snapshots and seeded benchmark logic should use the same key
    format so later learned-vs-seeded blending stays consistent.
    """
    return shared_build_normalized_region_key(country=country, state=state, city=city)


def _region_granularity(snapshot: AgreementOutcomeSnapshot) -> str:
    if snapshot.city:
        return "city"
    if snapshot.state:
        return "state"
    if snapshot.country:
        return "country"
    return "none"


def _date_only(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return None


def _duration_to_days(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, timedelta):
        return max(int(value.total_seconds() // 86400), 0)
    if isinstance(value, int):
        return max(value, 0)
    return None


def _days_between(start, end) -> int | None:
    start_date = _date_only(start)
    end_date = _date_only(end)
    if not start_date or not end_date:
        return None
    return max((end_date - start_date).days, 0)


def _eligible_for_benchmarks(agreement: Agreement) -> tuple[bool, str]:
    status_value = _safe_text(getattr(agreement, "status", "")).lower()
    if status_value in {"cancelled", "canceled"}:
        return False, "Agreement is cancelled."
    if status_value != ProjectStatus.COMPLETED:
        return False, "Agreement is not completed."
    return True, ""


def _estimated_total_from_milestones(milestones: list[Milestone]) -> Decimal | None:
    values: list[Decimal] = []
    for milestone in milestones:
        amount = _dec(getattr(milestone, "ai_suggested_amount", None), default=None)
        if amount is None:
            amount = _dec(getattr(milestone, "template_suggested_amount", None), default=None)
        if amount is not None:
            values.append(amount)
    if not values:
        return None
    return _quantize(sum(values))


def _final_paid_amount(agreement: Agreement) -> Decimal:
    invoices = [
        invoice
        for invoice in agreement.invoices.all()
        if not _invoice_is_system_funding_invoice(invoice)
        and _invoice_is_paid(invoice, mode=_agreement_mode(agreement))
    ]
    invoice_total = sum((_dec(getattr(invoice, "amount", None)) or Decimal("0.00")) for invoice in invoices)

    external_total = sum(
        (_dec(getattr(payment, "net_amount", None)) or Decimal("0.00"))
        for payment in agreement.external_payment_records.all()
        if _safe_text(getattr(payment, "status", "")).lower() in {"recorded", "verified"}
    )
    total = invoice_total + external_total
    if total <= Decimal("0.00"):
        total = _dec(getattr(agreement, "total_cost", None)) or Decimal("0.00")
    return _quantize(total)


def _retainage_amount(agreement: Agreement, final_agreed_total: Decimal) -> Decimal:
    total = Decimal("0.00")
    total += sum((_dec(getattr(draw, "retainage_amount", None)) or Decimal("0.00")) for draw in agreement.draw_requests.all())
    total += sum(
        (_dec(getattr(payment, "retainage_withheld_amount", None)) or Decimal("0.00"))
        for payment in agreement.external_payment_records.all()
    )
    if total <= Decimal("0.00"):
        retainage_percent = _dec(getattr(agreement, "retainage_percent", None)) or Decimal("0.00")
        if retainage_percent > Decimal("0.00") and final_agreed_total > Decimal("0.00"):
            total = (final_agreed_total * retainage_percent / Decimal("100"))
    return _quantize(total)


def _agreement_completed_date(agreement: Agreement) -> date | None:
    candidate_dates: list[date] = []
    for milestone in agreement.milestones.all():
        if milestone.completed_at:
            candidate_dates.append(milestone.completed_at.date())
        elif milestone.completion_date:
            candidate_dates.append(milestone.completion_date)
    for invoice in agreement.invoices.all():
        if getattr(invoice, "direct_pay_paid_at", None):
            candidate_dates.append(invoice.direct_pay_paid_at.date())
        if getattr(invoice, "escrow_released_at", None):
            candidate_dates.append(invoice.escrow_released_at.date())
        if getattr(invoice, "approved_at", None):
            candidate_dates.append(invoice.approved_at.date())
    if candidate_dates:
        return max(candidate_dates)
    return _date_only(getattr(agreement, "updated_at", None)) or timezone.now().date()


def _clarification_summary(agreement: Agreement) -> dict:
    summary = {
        "question_count": 0,
        "answered_count": 0,
        "questions": [],
        "answers": {},
    }
    scope = getattr(agreement, "ai_scope", None)
    if not scope:
        return summary

    questions = list(getattr(scope, "questions", []) or [])
    answers = dict(getattr(scope, "answers", {}) or {})
    summary["question_count"] = len(questions)
    summary["answered_count"] = len([key for key, value in answers.items() if _safe_text(value)])
    summary["questions"] = questions
    summary["answers"] = answers
    return summary


def _bucket_numeric_answer(key: str, value: str) -> str:
    try:
        number = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return ""
    if "square_foot" in key or "sq_ft" in key or "sqft" in key or "project_size" in key:
        lower = max((number // 250) * 250, 0)
        upper = lower + 249
        return f"{lower}_{upper}"
    if number <= 1:
        return "1"
    if number <= 3:
        return "2_3"
    if number <= 7:
        return "4_7"
    return "8_plus"


def _clarification_traits(summary: dict) -> tuple[dict, str]:
    answers = dict(summary.get("answers") or {})
    traits: dict[str, str] = {}
    for raw_key, raw_value in sorted(answers.items()):
        key = _normalize_answer_key(raw_key)
        if not key:
            continue
        value_text = _safe_text(raw_value)
        if not value_text:
            continue
        bucketed = _bucket_numeric_answer(key, value_text)
        if bucketed:
            traits[key] = bucketed
            continue
        if len(value_text.split()) > 6:
            continue
        normalized = _normalize_answer_value(value_text)
        if normalized:
            traits[key] = normalized[:64]
    if not traits:
        return {}, ""
    joined = "|".join(f"{key}={traits[key]}" for key in sorted(traits))
    signature = hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]
    return traits, signature


def _milestone_summary(milestones: list[Milestone]) -> dict:
    normalized_types: list[str] = []
    pattern: list[str] = []
    title_rows: list[dict] = []
    amount_total = Decimal("0.00")

    for milestone in milestones:
        normalized = _safe_text(getattr(milestone, "normalized_milestone_type", ""))
        if not normalized:
            normalized = normalize_milestone_type(
                title=_safe_text(getattr(milestone, "title", "")),
                description=_safe_text(getattr(milestone, "description", "")),
            )
        normalized_types.append(normalized)
        pattern.append(normalized)
        title_rows.append(
            {
                "order": int(getattr(milestone, "order", 0) or 0),
                "title": _safe_text(getattr(milestone, "title", "")),
                "normalized_type": normalized,
            }
        )
        amount_total += _dec(getattr(milestone, "amount", None)) or Decimal("0.00")

    counts = Counter(normalized_types)
    return {
        "normalized_types": normalized_types,
        "counts_by_type": dict(counts),
        "pattern_key": " > ".join(pattern),
        "titles": title_rows,
        "milestone_amount_total": str(_quantize(amount_total)),
    }


def _milestone_invoices(agreement: Agreement, milestone: Milestone):
    invoice_rows = []
    for invoice in agreement.invoices.all():
        if getattr(invoice, "milestone_id_snapshot", None) == milestone.id:
            invoice_rows.append(invoice)
            continue
        if getattr(milestone, "invoice_id", None) and getattr(invoice, "id", None) == milestone.invoice_id:
            invoice_rows.append(invoice)
    return invoice_rows


def _milestone_child_payload(agreement: Agreement, milestone: Milestone) -> dict:
    actual_duration_days = None
    if getattr(milestone, "completed_at", None) and getattr(milestone, "start_date", None):
        actual_duration_days = _days_between(milestone.start_date, milestone.completed_at.date())
    elif getattr(milestone, "start_date", None) and getattr(milestone, "completion_date", None):
        actual_duration_days = _days_between(milestone.start_date, milestone.completion_date)

    normalized_type = _safe_text(getattr(milestone, "normalized_milestone_type", ""))
    if not normalized_type:
        normalized_type = normalize_milestone_type(
            title=_safe_text(getattr(milestone, "title", "")),
            description=_safe_text(getattr(milestone, "description", "")),
        )

    estimate_amount = _dec(getattr(milestone, "ai_suggested_amount", None), default=None)
    if estimate_amount is None:
        estimate_amount = _dec(getattr(milestone, "template_suggested_amount", None), default=None)

    invoice_rows = _milestone_invoices(agreement, milestone)
    invoiced_amount = _quantize(
        sum((_dec(getattr(invoice, "amount", None)) or Decimal("0.00")) for invoice in invoice_rows)
    )
    paid_amount = _quantize(
        sum(
            (_dec(getattr(invoice, "amount", None)) or Decimal("0.00"))
            for invoice in invoice_rows
            if _invoice_is_paid(invoice, mode=_agreement_mode(agreement))
        )
    )
    dispute_count = agreement.disputes.exclude(status__in=["canceled", "cancelled"]).filter(milestone_id=milestone.id).count()
    amount = _quantize(_dec(getattr(milestone, "amount", None)))
    amount_delta = _quantize(amount - estimate_amount) if estimate_amount is not None else None
    duration_delta = (
        actual_duration_days - int(getattr(milestone, "recommended_duration_days", 0) or 0)
        if actual_duration_days is not None and getattr(milestone, "recommended_duration_days", None) is not None
        else None
    )

    return {
        "milestone": milestone,
        "sort_order": int(getattr(milestone, "order", 0) or 0),
        "title": _safe_text(getattr(milestone, "title", "")),
        "normalized_milestone_type": normalized_type,
        "amount": amount,
        "template_suggested_amount": _dec(getattr(milestone, "template_suggested_amount", None), default=None),
        "ai_suggested_amount": _dec(getattr(milestone, "ai_suggested_amount", None), default=None),
        "estimated_amount": estimate_amount,
        "amount_delta_from_estimate": amount_delta,
        "start_date": getattr(milestone, "start_date", None),
        "completion_date": getattr(milestone, "completion_date", None),
        "estimated_offset_days": getattr(milestone, "recommended_days_from_start", None),
        "estimated_duration_days": getattr(milestone, "recommended_duration_days", None) or _duration_to_days(getattr(milestone, "duration", None)),
        "actual_duration_days": actual_duration_days,
        "duration_delta_from_estimate": duration_delta,
        "has_invoice": bool(invoice_rows),
        "invoice_count": len(invoice_rows),
        "invoiced_amount": invoiced_amount,
        "paid_amount": paid_amount,
        "has_dispute": dispute_count > 0,
        "dispute_count": dispute_count,
        "is_rework": bool(getattr(milestone, "rework_origin_milestone_id", None)),
        "rework_origin_milestone_id": getattr(milestone, "rework_origin_milestone_id", None),
    }


def _build_snapshot_payload(agreement: Agreement) -> tuple[dict, list[dict]]:
    milestones = list(agreement.milestones.all().order_by("order", "id"))
    estimated_total = _estimated_total_from_milestones(milestones)
    final_agreed_total = _quantize(_dec(getattr(agreement, "total_cost", None)))
    completed_date = _agreement_completed_date(agreement)
    start_date = getattr(agreement, "start", None)
    actual_duration_days = _days_between(start_date, completed_date)
    estimated_duration_days = _duration_to_days(getattr(agreement, "total_time_estimate", None))
    if estimated_duration_days is None:
        estimated_duration_days = getattr(getattr(agreement, "selected_template", None), "estimated_days", None)

    amendment_children = agreement.amendments.count()
    amendment_number = int(getattr(agreement, "amendment_number", 0) or 0)
    dispute_qs = agreement.disputes.exclude(status__in=["canceled", "cancelled"])

    country = "US"
    state = _safe_text(getattr(agreement, "project_address_state", None))
    city = _safe_text(getattr(agreement, "project_address_city", None))
    postal_code = _safe_text(getattr(agreement, "project_postal_code", None))
    region_key = build_normalized_region_key(country=country, state=state, city=city)

    milestone_summary = _milestone_summary(milestones)
    milestone_rows = [_milestone_child_payload(agreement, milestone) for milestone in milestones]
    clarification_summary = _clarification_summary(agreement)
    clarification_traits, clarification_signature = _clarification_traits(clarification_summary)
    selected_template = getattr(agreement, "selected_template", None)

    payload = {
        "contractor": getattr(agreement, "contractor", None),
        "template": selected_template,
        "template_name_snapshot": _safe_text(getattr(selected_template, "name", None))
        or _safe_text(getattr(agreement, "selected_template_name_snapshot", None)),
        "template_benchmark_match_key": _safe_text(getattr(selected_template, "benchmark_match_key", None)),
        "project_type": _safe_text(getattr(agreement, "project_type", None)),
        "project_subtype": _safe_text(getattr(agreement, "project_subtype", None)),
        "country": country,
        "state": state,
        "city": city,
        "postal_code": postal_code,
        "normalized_region_key": region_key,
        "payment_mode": _safe_text(getattr(agreement, "payment_mode", None)),
        "signature_policy": _safe_text(getattr(agreement, "signature_policy", None)),
        "estimated_total_amount": _quantize(estimated_total) if estimated_total is not None else None,
        "final_agreed_total_amount": final_agreed_total,
        "final_paid_amount": _final_paid_amount(agreement),
        "retainage_percent": _quantize(_dec(getattr(agreement, "retainage_percent", None))),
        "retainage_amount": _retainage_amount(agreement, final_agreed_total),
        "agreement_start_date": start_date,
        "agreement_target_end_date": getattr(agreement, "end", None),
        "agreement_completed_date": completed_date,
        "estimated_duration_days": estimated_duration_days,
        "actual_duration_days": actual_duration_days,
        "milestone_count": len(milestones),
        "milestone_summary": milestone_summary,
        "clarification_summary": clarification_summary,
        "clarification_traits": clarification_traits,
        "clarification_signature": clarification_signature,
        "has_amendments": bool(amendment_children or amendment_number),
        "amendment_count": amendment_children + (1 if amendment_number else 0),
        "has_change_orders": bool(amendment_children or amendment_number),
        "change_order_count": amendment_children + (1 if amendment_number else 0),
        "has_disputes": dispute_qs.exists(),
        "dispute_count": dispute_qs.count(),
        "excluded_from_benchmarks": False,
        "exclusion_reason": "",
    }
    return payload, milestone_rows


def _snapshot_signatures(snapshot: AgreementOutcomeSnapshot) -> list[dict]:
    base_rows = [
        {
            "scope": ProjectBenchmarkAggregate.Scope.GLOBAL,
            "project_type": snapshot.project_type,
            "project_subtype": snapshot.project_subtype,
            "normalized_region_key": "",
            "contractor_id": None,
            "template_id": None,
        }
    ]
    if snapshot.normalized_region_key:
        base_rows.append(
            {
                "scope": ProjectBenchmarkAggregate.Scope.REGIONAL,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": snapshot.normalized_region_key,
                "contractor_id": None,
                "template_id": None,
            }
        )
    if snapshot.template_id:
        base_rows.append(
            {
                "scope": ProjectBenchmarkAggregate.Scope.TEMPLATE,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": "",
                "contractor_id": None,
                "template_id": snapshot.template_id,
            }
        )
    if snapshot.contractor_id:
        base_rows.append(
            {
                "scope": ProjectBenchmarkAggregate.Scope.CONTRACTOR,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": "",
                "contractor_id": snapshot.contractor_id,
                "template_id": None,
            }
        )

    signatures = [{**row, "clarification_signature": ""} for row in base_rows]
    if snapshot.clarification_signature:
        signatures.extend(
            [
                {
                    **row,
                    "clarification_signature": snapshot.clarification_signature,
                }
                for row in base_rows
            ]
        )
    return signatures


def _signature_tuple(signature: dict) -> tuple:
    return (
        signature.get("scope", ""),
        signature.get("project_type", ""),
        signature.get("project_subtype", ""),
        signature.get("clarification_signature", ""),
        signature.get("normalized_region_key", ""),
        signature.get("contractor_id"),
        signature.get("template_id"),
    )


def _eligible_snapshots_qs():
    return (
        AgreementOutcomeSnapshot.objects.filter(excluded_from_benchmarks=False)
        .select_related("contractor", "template", "agreement")
    )


def _snapshots_for_signature(signature: dict):
    queryset = _eligible_snapshots_qs().filter(
        project_type=signature.get("project_type", ""),
        project_subtype=signature.get("project_subtype", ""),
        clarification_signature=signature.get("clarification_signature", ""),
    )
    scope = signature.get("scope")
    if scope == ProjectBenchmarkAggregate.Scope.REGIONAL:
        queryset = queryset.filter(normalized_region_key=signature.get("normalized_region_key", ""))
    if scope == ProjectBenchmarkAggregate.Scope.TEMPLATE:
        queryset = queryset.filter(template_id=signature.get("template_id"))
    if scope == ProjectBenchmarkAggregate.Scope.CONTRACTOR:
        queryset = queryset.filter(contractor_id=signature.get("contractor_id"))
    return list(queryset)


def _common_patterns(snapshots: list[AgreementOutcomeSnapshot]) -> list[dict]:
    counter = Counter()
    for snapshot in snapshots:
        pattern_key = _safe_text((snapshot.milestone_summary or {}).get("pattern_key"))
        if pattern_key:
            counter[pattern_key] += 1
    return [
        {"pattern_key": pattern, "count": count}
        for pattern, count in counter.most_common(5)
    ]


def _aggregate_metadata(scope: str, snapshots: list[AgreementOutcomeSnapshot], signature: dict) -> dict:
    return {
        "scope": scope,
        "sample_size": len(snapshots),
        "has_template_specificity": bool(signature.get("template_id")),
        "has_contractor_specificity": bool(signature.get("contractor_id")),
        "has_region_specificity": bool(signature.get("normalized_region_key")),
        "has_clarification_specificity": bool(signature.get("clarification_signature")),
    }


def _build_aggregate_payload(signature: dict, snapshots: list[AgreementOutcomeSnapshot]) -> dict:
    final_totals = [snapshot.final_agreed_total_amount for snapshot in snapshots if snapshot.final_agreed_total_amount is not None]
    final_paid_amounts = [snapshot.final_paid_amount for snapshot in snapshots if snapshot.final_paid_amount is not None]
    durations = [snapshot.actual_duration_days for snapshot in snapshots if snapshot.actual_duration_days is not None]
    milestone_counts = [snapshot.milestone_count for snapshot in snapshots]
    retainage_amounts = [snapshot.retainage_amount for snapshot in snapshots if snapshot.retainage_amount is not None]
    retainage_percents = [snapshot.retainage_percent for snapshot in snapshots if snapshot.retainage_percent is not None]
    change_order_counts = [snapshot.change_order_count for snapshot in snapshots]
    dispute_counts = [snapshot.dispute_count for snapshot in snapshots]

    estimate_variances_amount: list[Decimal] = []
    estimate_variances_percent: list[Decimal] = []
    duration_variances: list[int] = []

    for snapshot in snapshots:
        if snapshot.estimated_total_amount is not None and snapshot.final_agreed_total_amount is not None:
            variance_amount = snapshot.final_agreed_total_amount - snapshot.estimated_total_amount
            estimate_variances_amount.append(variance_amount)
            if snapshot.estimated_total_amount:
                estimate_variances_percent.append((variance_amount / snapshot.estimated_total_amount) * Decimal("100"))
        if snapshot.estimated_duration_days is not None and snapshot.actual_duration_days is not None:
            duration_variances.append(snapshot.actual_duration_days - snapshot.estimated_duration_days)

    reference_snapshot = snapshots[0] if snapshots else None
    return {
        "scope": signature["scope"],
        "contractor_id": signature.get("contractor_id"),
        "template_id": signature.get("template_id"),
        "project_type": signature.get("project_type", ""),
        "project_subtype": signature.get("project_subtype", ""),
        "clarification_signature": signature.get("clarification_signature", ""),
        "clarification_traits": getattr(reference_snapshot, "clarification_traits", {}) if signature.get("clarification_signature") else {},
        "country": getattr(reference_snapshot, "country", "US") or "US",
        "state": getattr(reference_snapshot, "state", "") if signature["scope"] == ProjectBenchmarkAggregate.Scope.REGIONAL else "",
        "city": getattr(reference_snapshot, "city", "") if signature["scope"] == ProjectBenchmarkAggregate.Scope.REGIONAL else "",
        "normalized_region_key": signature.get("normalized_region_key", ""),
        "completed_project_count": len(snapshots),
        "average_final_total": _mean_decimal(final_totals),
        "average_final_paid_amount": _mean_decimal(final_paid_amounts),
        "median_final_total": _median_decimal(final_totals),
        "min_final_total": _quantize(min(final_totals)) if final_totals else Decimal("0.00"),
        "max_final_total": _quantize(max(final_totals)) if final_totals else Decimal("0.00"),
        "average_actual_duration_days": _mean_number(durations),
        "median_actual_duration_days": _mean_number([median(durations)]) if durations else Decimal("0.00"),
        "average_milestone_count": _mean_number(milestone_counts),
        "average_retainage_amount": _mean_decimal(retainage_amounts),
        "average_retainage_percent": _mean_decimal(retainage_percents),
        "average_change_order_count": _mean_number(change_order_counts),
        "average_dispute_count": _mean_number(dispute_counts),
        "average_estimate_variance_amount": _mean_decimal(estimate_variances_amount),
        "average_estimate_variance_percent": _mean_decimal(estimate_variances_percent),
        "average_duration_variance_days": _mean_number(duration_variances),
        "change_order_project_count": len([snapshot for snapshot in snapshots if snapshot.change_order_count > 0]),
        "dispute_project_count": len([snapshot for snapshot in snapshots if snapshot.dispute_count > 0]),
        "amount_sample_size": len(final_totals),
        "duration_sample_size": len(durations),
        "estimate_variance_sample_size": len(estimate_variances_amount),
        "duration_variance_sample_size": len(duration_variances),
        "amount_stddev": _stddev_decimal(final_totals),
        "duration_stddev": _stddev_number(durations),
        "region_granularity": _region_granularity(reference_snapshot) if reference_snapshot and signature["scope"] == ProjectBenchmarkAggregate.Scope.REGIONAL else "none",
        "common_milestone_patterns": _common_patterns(snapshots),
        "metadata": _aggregate_metadata(signature["scope"], snapshots, signature),
        "first_snapshot_completed_date": min(
            (snapshot.agreement_completed_date for snapshot in snapshots if snapshot.agreement_completed_date),
            default=None,
        ),
        "last_snapshot_completed_date": max(
            (snapshot.agreement_completed_date for snapshot in snapshots if snapshot.agreement_completed_date),
            default=None,
        ),
    }


@transaction.atomic
def rebuild_benchmarks_for_signatures(signatures: Iterable[dict]) -> int:
    touched = 0
    unique_signatures = {
        _signature_tuple(signature): signature
        for signature in signatures
    }
    for signature in unique_signatures.values():
        snapshots = _snapshots_for_signature(signature)
        lookup = {
            "scope": signature["scope"],
            "contractor_id": signature.get("contractor_id"),
            "template_id": signature.get("template_id"),
            "project_type": signature.get("project_type", ""),
            "project_subtype": signature.get("project_subtype", ""),
            "clarification_signature": signature.get("clarification_signature", ""),
            "normalized_region_key": signature.get("normalized_region_key", ""),
        }
        if not snapshots:
            ProjectBenchmarkAggregate.objects.filter(**lookup).delete()
            continue
        payload = _build_aggregate_payload(signature, snapshots)
        ProjectBenchmarkAggregate.objects.update_or_create(defaults=payload, **lookup)
        touched += 1
    return touched


@transaction.atomic
def rebuild_project_benchmarks() -> int:
    ProjectBenchmarkAggregate.objects.all().delete()
    signatures: list[dict] = []
    for snapshot in _eligible_snapshots_qs():
        signatures.extend(_snapshot_signatures(snapshot))
    return rebuild_benchmarks_for_signatures(signatures)


def rebuild_benchmarks_for_snapshot(snapshot: AgreementOutcomeSnapshot) -> int:
    return rebuild_benchmarks_for_signatures(_snapshot_signatures(snapshot))


def _eligible_milestone_snapshots_qs():
    return AgreementOutcomeMilestoneSnapshot.objects.filter(
        snapshot__excluded_from_benchmarks=False
    ).select_related("snapshot", "snapshot__contractor", "snapshot__template")


def _milestone_signatures(snapshot: AgreementOutcomeSnapshot, milestone_type: str) -> list[dict]:
    base_rows = [
        {
            "scope": MilestoneBenchmarkAggregate.Scope.GLOBAL,
            "project_type": snapshot.project_type,
            "project_subtype": snapshot.project_subtype,
            "normalized_region_key": "",
            "contractor_id": None,
            "template_id": None,
            "normalized_milestone_type": milestone_type,
        }
    ]
    if snapshot.normalized_region_key:
        base_rows.append(
            {
                "scope": MilestoneBenchmarkAggregate.Scope.REGIONAL,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": snapshot.normalized_region_key,
                "contractor_id": None,
                "template_id": None,
                "normalized_milestone_type": milestone_type,
            }
        )
    if snapshot.template_id:
        base_rows.append(
            {
                "scope": MilestoneBenchmarkAggregate.Scope.TEMPLATE,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": "",
                "contractor_id": None,
                "template_id": snapshot.template_id,
                "normalized_milestone_type": milestone_type,
            }
        )
    if snapshot.contractor_id:
        base_rows.append(
            {
                "scope": MilestoneBenchmarkAggregate.Scope.CONTRACTOR,
                "project_type": snapshot.project_type,
                "project_subtype": snapshot.project_subtype,
                "normalized_region_key": "",
                "contractor_id": snapshot.contractor_id,
                "template_id": None,
                "normalized_milestone_type": milestone_type,
            }
        )
    signatures = [{**row, "clarification_signature": ""} for row in base_rows]
    if snapshot.clarification_signature:
        signatures.extend([{**row, "clarification_signature": snapshot.clarification_signature} for row in base_rows])
    return signatures


def _milestone_signature_tuple(signature: dict) -> tuple:
    return (
        signature.get("scope", ""),
        signature.get("project_type", ""),
        signature.get("project_subtype", ""),
        signature.get("clarification_signature", ""),
        signature.get("normalized_region_key", ""),
        signature.get("contractor_id"),
        signature.get("template_id"),
        signature.get("normalized_milestone_type", ""),
    )


def _milestones_for_signature(signature: dict):
    queryset = _eligible_milestone_snapshots_qs().filter(
        snapshot__project_type=signature.get("project_type", ""),
        snapshot__project_subtype=signature.get("project_subtype", ""),
        snapshot__clarification_signature=signature.get("clarification_signature", ""),
        normalized_milestone_type=signature.get("normalized_milestone_type", ""),
    )
    scope = signature.get("scope")
    if scope == MilestoneBenchmarkAggregate.Scope.REGIONAL:
        queryset = queryset.filter(snapshot__normalized_region_key=signature.get("normalized_region_key", ""))
    if scope == MilestoneBenchmarkAggregate.Scope.TEMPLATE:
        queryset = queryset.filter(snapshot__template_id=signature.get("template_id"))
    if scope == MilestoneBenchmarkAggregate.Scope.CONTRACTOR:
        queryset = queryset.filter(snapshot__contractor_id=signature.get("contractor_id"))
    return list(queryset)


def _build_milestone_aggregate_payload(signature: dict, rows: list[AgreementOutcomeMilestoneSnapshot]) -> dict:
    amounts = [row.amount for row in rows if row.amount is not None]
    paid_amounts = [row.paid_amount for row in rows if row.paid_amount is not None]
    durations = [row.actual_duration_days for row in rows if row.actual_duration_days is not None]
    estimate_variances = [row.amount_delta_from_estimate for row in rows if row.amount_delta_from_estimate is not None]
    duration_variances = [row.duration_delta_from_estimate for row in rows if row.duration_delta_from_estimate is not None]
    reference = rows[0].snapshot if rows else None
    return {
        "scope": signature["scope"],
        "contractor_id": signature.get("contractor_id"),
        "template_id": signature.get("template_id"),
        "project_type": signature.get("project_type", ""),
        "project_subtype": signature.get("project_subtype", ""),
        "clarification_signature": signature.get("clarification_signature", ""),
        "clarification_traits": getattr(reference, "clarification_traits", {}) if signature.get("clarification_signature") else {},
        "normalized_milestone_type": signature.get("normalized_milestone_type", ""),
        "country": getattr(reference, "country", "US") or "US",
        "state": getattr(reference, "state", "") if signature["scope"] == MilestoneBenchmarkAggregate.Scope.REGIONAL else "",
        "city": getattr(reference, "city", "") if signature["scope"] == MilestoneBenchmarkAggregate.Scope.REGIONAL else "",
        "normalized_region_key": signature.get("normalized_region_key", ""),
        "completed_milestone_count": len(rows),
        "paid_milestone_count": len([row for row in rows if row.paid_amount > 0]),
        "disputed_milestone_count": len([row for row in rows if row.dispute_count > 0]),
        "rework_milestone_count": len([row for row in rows if row.is_rework]),
        "average_final_amount": _mean_decimal(amounts),
        "median_final_amount": _median_decimal(amounts),
        "min_final_amount": _quantize(min(amounts)) if amounts else Decimal("0.00"),
        "max_final_amount": _quantize(max(amounts)) if amounts else Decimal("0.00"),
        "average_paid_amount": _mean_decimal(paid_amounts),
        "average_actual_duration_days": _mean_number(durations),
        "median_actual_duration_days": _mean_number([median(durations)]) if durations else Decimal("0.00"),
        "average_estimate_variance_amount": _mean_decimal(estimate_variances),
        "average_duration_variance_days": _mean_number(duration_variances),
        "amount_sample_size": len(amounts),
        "duration_sample_size": len(durations),
        "estimate_variance_sample_size": len(estimate_variances),
        "duration_variance_sample_size": len(duration_variances),
        "metadata": {
            "scope": signature["scope"],
            "sample_size": len(rows),
            "has_clarification_specificity": bool(signature.get("clarification_signature")),
        },
        "first_snapshot_completed_date": min(
            (row.snapshot.agreement_completed_date for row in rows if row.snapshot.agreement_completed_date),
            default=None,
        ),
        "last_snapshot_completed_date": max(
            (row.snapshot.agreement_completed_date for row in rows if row.snapshot.agreement_completed_date),
            default=None,
        ),
    }


@transaction.atomic
def rebuild_milestone_benchmarks_for_signatures(signatures: Iterable[dict]) -> int:
    touched = 0
    unique_signatures = {_milestone_signature_tuple(signature): signature for signature in signatures}
    for signature in unique_signatures.values():
        rows = _milestones_for_signature(signature)
        lookup = {
            "scope": signature["scope"],
            "contractor_id": signature.get("contractor_id"),
            "template_id": signature.get("template_id"),
            "project_type": signature.get("project_type", ""),
            "project_subtype": signature.get("project_subtype", ""),
            "clarification_signature": signature.get("clarification_signature", ""),
            "normalized_region_key": signature.get("normalized_region_key", ""),
            "normalized_milestone_type": signature.get("normalized_milestone_type", ""),
        }
        if not rows:
            MilestoneBenchmarkAggregate.objects.filter(**lookup).delete()
            continue
        payload = _build_milestone_aggregate_payload(signature, rows)
        MilestoneBenchmarkAggregate.objects.update_or_create(defaults=payload, **lookup)
        touched += 1
    return touched


@transaction.atomic
def rebuild_milestone_benchmarks() -> int:
    MilestoneBenchmarkAggregate.objects.all().delete()
    signatures: list[dict] = []
    for milestone_snapshot in _eligible_milestone_snapshots_qs():
        signatures.extend(_milestone_signatures(milestone_snapshot.snapshot, milestone_snapshot.normalized_milestone_type))
    return rebuild_milestone_benchmarks_for_signatures(signatures)


def rebuild_milestone_benchmarks_for_snapshot(snapshot: AgreementOutcomeSnapshot) -> int:
    signatures: list[dict] = []
    milestone_types = (
        AgreementOutcomeMilestoneSnapshot.objects.filter(snapshot=snapshot)
        .values_list("normalized_milestone_type", flat=True)
    )
    for milestone_type in milestone_types:
        signatures.extend(_milestone_signatures(snapshot, milestone_type))
    return rebuild_milestone_benchmarks_for_signatures(signatures)


def capture_agreement_outcome_snapshot(agreement: Agreement | int) -> AgreementOutcomeSnapshot:
    if isinstance(agreement, int):
        agreement = Agreement.objects.select_related(
            "contractor",
            "homeowner",
            "selected_template",
        ).prefetch_related(
            "milestones",
            "invoices",
            "draw_requests",
            "external_payment_records",
            "amendments",
            "disputes",
        ).get(pk=agreement)

    eligible, exclusion_reason = _eligible_for_benchmarks(agreement)
    snapshot = AgreementOutcomeSnapshot.objects.filter(agreement=agreement).first()
    previous_signatures = _snapshot_signatures(snapshot) if snapshot else []
    previous_milestone_signatures: list[dict] = []
    if snapshot:
        previous_milestone_types = (
            AgreementOutcomeMilestoneSnapshot.objects.filter(snapshot=snapshot)
            .values_list("normalized_milestone_type", flat=True)
        )
        for milestone_type in previous_milestone_types:
            previous_milestone_signatures.extend(_milestone_signatures(snapshot, milestone_type))

    if not eligible:
        if snapshot is None:
            snapshot = AgreementOutcomeSnapshot.objects.create(
                agreement=agreement,
                contractor=getattr(agreement, "contractor", None),
                template=getattr(agreement, "selected_template", None),
                project_type=_safe_text(getattr(agreement, "project_type", None)),
                project_subtype=_safe_text(getattr(agreement, "project_subtype", None)),
                excluded_from_benchmarks=True,
                exclusion_reason=exclusion_reason,
            )
        else:
            snapshot.excluded_from_benchmarks = True
            snapshot.exclusion_reason = exclusion_reason
            snapshot.save(update_fields=["excluded_from_benchmarks", "exclusion_reason", "snapshot_updated_at"])
            snapshot.milestones.all().delete()
        rebuild_benchmarks_for_signatures(previous_signatures)
        rebuild_milestone_benchmarks_for_signatures(previous_milestone_signatures)
        return snapshot

    payload, milestone_rows = _build_snapshot_payload(agreement)
    snapshot, _created = AgreementOutcomeSnapshot.objects.update_or_create(
        agreement=agreement,
        defaults=payload,
    )
    AgreementOutcomeMilestoneSnapshot.objects.filter(snapshot=snapshot).delete()
    AgreementOutcomeMilestoneSnapshot.objects.bulk_create(
        [AgreementOutcomeMilestoneSnapshot(snapshot=snapshot, **row) for row in milestone_rows]
    )

    rebuild_benchmarks_for_signatures(previous_signatures + _snapshot_signatures(snapshot))
    rebuild_milestone_benchmarks_for_signatures(previous_milestone_signatures)
    rebuild_milestone_benchmarks_for_snapshot(snapshot)
    return snapshot


def on_agreement_completed(agreement: Agreement | int) -> AgreementOutcomeSnapshot:
    """
    Canonical learning hook for completed agreements.
    Safe to call repeatedly; snapshot updates in place and aggregates refresh.
    """
    return capture_agreement_outcome_snapshot(agreement)


def backfill_completed_agreement_snapshots(*, agreement_ids: list[int] | None = None) -> int:
    queryset = Agreement.objects.select_related(
        "contractor",
        "homeowner",
        "selected_template",
    ).prefetch_related(
        "milestones",
        "invoices",
        "draw_requests",
        "external_payment_records",
        "amendments",
        "disputes",
    )
    if agreement_ids:
        queryset = queryset.filter(id__in=agreement_ids)
    else:
        queryset = queryset.filter(status=ProjectStatus.COMPLETED)

    count = 0
    for agreement in queryset.iterator():
        capture_agreement_outcome_snapshot(agreement)
        count += 1
    return count
