from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Max
from django.utils import timezone

from projects.models import (
    Agreement,
    AgreementMode,
    MaintenanceStatus,
    Milestone,
    RecurrencePattern,
)
from projects.services.activity_feed import create_activity_event


@dataclass(frozen=True)
class RecurringPreviewRow:
    rule_milestone_id: int | None
    title: str
    sequence_number: int
    scheduled_service_date: date | None
    service_period_start: date | None
    service_period_end: date | None
    amount: str


def _today() -> date:
    return timezone.localdate()


def _coerce_interval(value) -> int:
    try:
        parsed = int(value or 1)
    except Exception:
        parsed = 1
    return parsed if parsed > 0 else 1


def _add_months(base: date, months: int) -> date:
    total = (base.month - 1) + months
    year = base.year + total // 12
    month = (total % 12) + 1
    day = min(base.day, monthrange(year, month)[1])
    return date(year, month, day)


def advance_recurrence(base: date, pattern: str, interval: int = 1) -> date:
    safe_interval = _coerce_interval(interval)
    if pattern == RecurrencePattern.WEEKLY:
        return base + timedelta(weeks=safe_interval)
    if pattern == RecurrencePattern.QUARTERLY:
        return _add_months(base, safe_interval * 3)
    if pattern == RecurrencePattern.YEARLY:
        return _add_months(base, safe_interval * 12)
    return _add_months(base, safe_interval)


def _agreement_supports_generation(agreement: Agreement | None) -> bool:
    if agreement is None:
        return False
    if agreement.agreement_mode != AgreementMode.MAINTENANCE and not agreement.recurring_service_enabled:
        return False
    if not agreement.recurring_service_enabled:
        return False
    if agreement.maintenance_status in {
        MaintenanceStatus.PAUSED,
        MaintenanceStatus.CANCELLED,
        MaintenanceStatus.COMPLETED,
    }:
        return False
    if not agreement.auto_generate_next_occurrence:
        return False
    return True


def _rule_supports_generation(rule: Milestone) -> bool:
    agreement = getattr(rule, "agreement", None)
    if not _agreement_supports_generation(agreement):
        return False
    if not rule.is_recurring_rule:
        return False
    pattern = (rule.recurrence_pattern or agreement.recurrence_pattern or "").strip()
    if not pattern:
        return False
    anchor = rule.recurrence_anchor_date or agreement.recurrence_start_date or rule.start_date
    if not anchor:
        return False
    return True


def _rule_pattern(rule: Milestone) -> str:
    agreement = rule.agreement
    return (rule.recurrence_pattern or agreement.recurrence_pattern or RecurrencePattern.MONTHLY).strip()


def _rule_interval(rule: Milestone) -> int:
    agreement = rule.agreement
    return _coerce_interval(rule.recurrence_interval or agreement.recurrence_interval or 1)


def _rule_anchor_date(rule: Milestone) -> date:
    agreement = rule.agreement
    return (
        rule.recurrence_anchor_date
        or agreement.recurrence_start_date
        or rule.scheduled_service_date
        or rule.start_date
        or _today()
    )


def _rule_end_date(rule: Milestone) -> date | None:
    agreement = rule.agreement
    return rule.recurrence_end_date or agreement.recurrence_end_date


def _existing_occurrence_dates(rule: Milestone) -> set[date]:
    rows = rule.generated_occurrences.exclude(scheduled_service_date__isnull=True).values_list(
        "scheduled_service_date",
        flat=True,
    )
    return {row for row in rows if row is not None}


def _current_upcoming_occurrences(rule: Milestone) -> list[Milestone]:
    today = _today()
    return list(
        rule.generated_occurrences.filter(
            completed=False,
            scheduled_service_date__gte=today,
        )
        .order_by("scheduled_service_date", "occurrence_sequence_number", "id")
    )


def _next_sequence_number(rule: Milestone) -> int:
    max_existing = (
        rule.generated_occurrences.aggregate(max_seq=Max("occurrence_sequence_number")).get("max_seq") or 0
    )
    return int(max_existing) + 1


def _next_order_for_agreement(agreement: Agreement) -> int:
    max_existing = agreement.milestones.aggregate(max_order=Max("order")).get("max_order") or 0
    return int(max_existing) + 1


def _build_service_period(rule: Milestone, scheduled_date: date) -> tuple[date, date]:
    next_date = advance_recurrence(scheduled_date, _rule_pattern(rule), _rule_interval(rule))
    end_date = next_date - timedelta(days=1)
    rule_end = _rule_end_date(rule)
    if rule_end and end_date > rule_end:
        end_date = rule_end
    return scheduled_date, end_date


def _clone_rule_to_occurrence(rule: Milestone, scheduled_date: date) -> Milestone:
    period_start, period_end = _build_service_period(rule, scheduled_date)
    sequence_number = _next_sequence_number(rule)
    occurrence = Milestone(
        agreement=rule.agreement,
        order=_next_order_for_agreement(rule.agreement),
        title=f"{rule.title} - Visit {sequence_number}",
        description=rule.description,
        amount=rule.amount if isinstance(rule.amount, Decimal) else Decimal(str(rule.amount or 0)),
        start_date=scheduled_date,
        completion_date=scheduled_date,
        duration=rule.duration,
        normalized_milestone_type=rule.normalized_milestone_type,
        template_suggested_amount=rule.template_suggested_amount,
        ai_suggested_amount=rule.ai_suggested_amount,
        suggested_amount_low=rule.suggested_amount_low,
        suggested_amount_high=rule.suggested_amount_high,
        labor_estimate_low=rule.labor_estimate_low,
        labor_estimate_high=rule.labor_estimate_high,
        materials_estimate_low=rule.materials_estimate_low,
        materials_estimate_high=rule.materials_estimate_high,
        pricing_confidence=rule.pricing_confidence,
        pricing_source_note=rule.pricing_source_note,
        materials_hint=rule.materials_hint,
        recommended_duration_days=rule.recommended_duration_days,
        assigned_subcontractor_invitation=rule.assigned_subcontractor_invitation,
        delegated_reviewer_subaccount=rule.delegated_reviewer_subaccount,
        subcontractor_payout_amount_cents=rule.subcontractor_payout_amount_cents,
        subcontractor_required_trade_key=rule.subcontractor_required_trade_key,
        subcontractor_required_state_code=rule.subcontractor_required_state_code,
        is_recurring_rule=False,
        recurrence_pattern="",
        recurrence_interval=1,
        recurrence_anchor_date=None,
        recurrence_end_date=None,
        next_occurrence_date=None,
        recurring_rule_parent=rule,
        occurrence_sequence_number=sequence_number,
        generated_from_recurring_rule=True,
        service_period_start=period_start,
        service_period_end=period_end,
        scheduled_service_date=scheduled_date,
    )
    occurrence._skip_recurring_sync = True
    occurrence.save()
    return occurrence


def sync_agreement_next_occurrence(agreement: Agreement) -> date | None:
    next_date = (
        Milestone.objects.filter(
            agreement=agreement,
            generated_from_recurring_rule=True,
            completed=False,
            scheduled_service_date__isnull=False,
        )
        .order_by("scheduled_service_date", "occurrence_sequence_number", "id")
        .values_list("scheduled_service_date", flat=True)
        .first()
    )
    if agreement.next_occurrence_date != next_date:
        Agreement.objects.filter(pk=agreement.pk).update(next_occurrence_date=next_date)
        agreement.next_occurrence_date = next_date
    return next_date


def _candidate_dates_for_rule(rule: Milestone, horizon: int = 1) -> list[date]:
    if not _rule_supports_generation(rule):
        return []

    today = _today()
    pattern = _rule_pattern(rule)
    interval = _rule_interval(rule)
    anchor = _rule_anchor_date(rule)
    end_date = _rule_end_date(rule)
    existing_dates = _existing_occurrence_dates(rule)
    upcoming = _current_upcoming_occurrences(rule)
    needed = max(1, int(horizon or 1)) - len(upcoming)
    if needed <= 0:
        return []

    candidate = anchor
    while candidate < today:
        candidate = advance_recurrence(candidate, pattern, interval)

    out: list[date] = []
    seen = set(existing_dates)
    guard = 0
    while len(out) < needed and guard < 64:
        guard += 1
        if end_date and candidate > end_date:
            break
        if candidate not in seen:
            out.append(candidate)
            seen.add(candidate)
        candidate = advance_recurrence(candidate, pattern, interval)
    return out


def ensure_rule_occurrences(rule: Milestone, *, horizon: int = 1) -> list[Milestone]:
    created: list[Milestone] = []
    for scheduled_date in _candidate_dates_for_rule(rule, horizon=horizon):
        occurrence = _clone_rule_to_occurrence(rule, scheduled_date)
        created.append(occurrence)
        create_activity_event(
            contractor=getattr(rule.agreement, "contractor", None),
            agreement=rule.agreement,
            milestone=occurrence,
            event_type="recurring_occurrence_generated",
            title="Recurring service occurrence generated",
            summary=f"{rule.title} now has a scheduled service visit ready for review.",
            severity="info",
            related_label=occurrence.title,
            icon_hint="maintenance",
            navigation_target=f"/app/agreements/{rule.agreement_id}/wizard?step=2",
            metadata={
                "agreement_id": rule.agreement_id,
                "rule_milestone_id": rule.id,
                "occurrence_id": occurrence.id,
                "scheduled_service_date": occurrence.scheduled_service_date.isoformat() if occurrence.scheduled_service_date else "",
            },
            dedupe_key=f"recurring_occurrence_generated:{occurrence.id}",
        )

    next_upcoming = _current_upcoming_occurrences(rule)
    next_date = next_upcoming[0].scheduled_service_date if next_upcoming else None
    if rule.next_occurrence_date != next_date:
        Milestone.objects.filter(pk=rule.pk).update(next_occurrence_date=next_date)
        rule.next_occurrence_date = next_date
    sync_agreement_next_occurrence(rule.agreement)
    return created


def ensure_recurring_milestones(agreement: Agreement, *, horizon: int = 1) -> list[Milestone]:
    if not _agreement_supports_generation(agreement):
        sync_agreement_next_occurrence(agreement)
        return []

    created: list[Milestone] = []
    rules = list(
        agreement.milestones.filter(
            is_recurring_rule=True,
            recurring_rule_parent__isnull=True,
        ).order_by("order", "id")
    )
    for rule in rules:
        created.extend(ensure_rule_occurrences(rule, horizon=horizon))
    sync_agreement_next_occurrence(agreement)
    return created


def handle_milestone_recurring_state_change(milestone: Milestone) -> list[Milestone]:
    agreement = getattr(milestone, "agreement", None)
    if agreement is None:
        return []
    if milestone.is_recurring_rule:
        return ensure_rule_occurrences(milestone, horizon=1)
    if milestone.generated_from_recurring_rule and milestone.completed and milestone.recurring_rule_parent_id:
        parent = milestone.recurring_rule_parent
        if parent is not None:
            return ensure_rule_occurrences(parent, horizon=1)
    return ensure_recurring_milestones(agreement, horizon=1)


def build_recurring_preview(agreement: Agreement, *, horizon: int = 3) -> dict[str, object]:
    if agreement is None:
        return {}

    rows: list[RecurringPreviewRow] = []
    if _agreement_supports_generation(agreement):
        rules = list(
            agreement.milestones.filter(
                is_recurring_rule=True,
                recurring_rule_parent__isnull=True,
            ).order_by("order", "id")
        )
        for rule in rules:
            next_seq = _next_sequence_number(rule)
            for offset, scheduled_date in enumerate(_candidate_dates_for_rule(rule, horizon=horizon), start=0):
                period_start, period_end = _build_service_period(rule, scheduled_date)
                rows.append(
                    RecurringPreviewRow(
                        rule_milestone_id=rule.id,
                        title=rule.title,
                        sequence_number=next_seq + offset,
                        scheduled_service_date=scheduled_date,
                        service_period_start=period_start,
                        service_period_end=period_end,
                        amount=f"{Decimal(str(rule.amount or 0)):.2f}",
                    )
                )

    return {
        "agreement_mode": agreement.agreement_mode,
        "recurring_service_enabled": bool(agreement.recurring_service_enabled),
        "maintenance_status": agreement.maintenance_status,
        "recurrence_pattern": agreement.recurrence_pattern,
        "recurrence_interval": agreement.recurrence_interval,
        "recurrence_start_date": agreement.recurrence_start_date.isoformat() if agreement.recurrence_start_date else None,
        "recurrence_end_date": agreement.recurrence_end_date.isoformat() if agreement.recurrence_end_date else None,
        "next_occurrence_date": agreement.next_occurrence_date.isoformat() if agreement.next_occurrence_date else None,
        "service_window_notes": agreement.service_window_notes or "",
        "recurring_summary_label": agreement.recurring_summary_label or "",
        "preview_occurrences": [
            {
                "rule_milestone_id": row.rule_milestone_id,
                "title": row.title,
                "sequence_number": row.sequence_number,
                "scheduled_service_date": row.scheduled_service_date.isoformat() if row.scheduled_service_date else None,
                "service_period_start": row.service_period_start.isoformat() if row.service_period_start else None,
                "service_period_end": row.service_period_end.isoformat() if row.service_period_end else None,
                "amount": row.amount,
            }
            for row in rows
        ],
    }
