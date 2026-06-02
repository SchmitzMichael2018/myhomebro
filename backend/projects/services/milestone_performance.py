from __future__ import annotations

import hashlib
import json
from datetime import datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Invoice, InvoiceStatus, Milestone
from projects.models_dispute import Dispute
from projects.models_learning import AgreementDraftIntelligenceSnapshot, MilestonePerformanceSnapshot
from projects.services.pricing_observations import normalize_milestone_type


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0.00")).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def _aware_midnight(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else timezone.make_aware(value)
    try:
        return timezone.make_aware(datetime.combine(value, time.min))
    except Exception:
        return None


def _seconds_between(start, end) -> int | None:
    if not start or not end:
        return None
    if timezone.is_naive(start):
        start = timezone.make_aware(start)
    if timezone.is_naive(end):
        end = timezone.make_aware(end)
    seconds = int((end - start).total_seconds())
    return max(seconds, 0)


def _planned_delta_days(planned_completion_date, contractor_completed_at) -> int | None:
    if not planned_completion_date or not contractor_completed_at:
        return None
    completed_date = contractor_completed_at.date() if isinstance(contractor_completed_at, datetime) else contractor_completed_at
    try:
        return (completed_date - planned_completion_date).days
    except Exception:
        return None


def _milestone_invoice(milestone: Milestone) -> Invoice | None:
    invoice = getattr(milestone, "invoice", None)
    if invoice is not None:
        return invoice
    return (
        Invoice.objects.filter(milestone_id_snapshot=milestone.id)
        .order_by("created_at", "id")
        .first()
    )


def _payment_release_at(invoice: Invoice | None):
    if invoice is None:
        return None
    return (
        getattr(invoice, "direct_pay_paid_at", None)
        or getattr(invoice, "escrow_released_at", None)
        or (
            getattr(invoice, "approved_at", None)
            if _safe_text(getattr(invoice, "status", "")).lower() == InvoiceStatus.PAID
            else None
        )
    )


def _dispute_dates(milestone: Milestone) -> tuple[Any, Any, int]:
    disputes = list(
        Dispute.objects.filter(milestone=milestone)
        .exclude(status__in=["canceled", "cancelled"])
        .order_by("created_at", "id")
    )
    opened_at = disputes[0].created_at if disputes else None
    resolved = [
        dispute.resolved_at
        for dispute in disputes
        if getattr(dispute, "resolved_at", None)
    ]
    return opened_at, (min(resolved) if resolved else None), len(disputes)


def _draft_source(agreement: Agreement) -> str:
    try:
        snapshot = getattr(agreement, "draft_intelligence_snapshot", None)
    except AgreementDraftIntelligenceSnapshot.DoesNotExist:
        snapshot = None
    if snapshot is None:
        try:
            snapshot = AgreementDraftIntelligenceSnapshot.objects.filter(agreement=agreement).first()
        except Exception:
            snapshot = None
    return _safe_text(getattr(snapshot, "draft_source", ""))


def _state_signature(payload: dict[str, Any]) -> str:
    observed = {
        key: payload.get(key)
        for key in (
            "planned_start_date",
            "planned_completion_date",
            "contractor_completed_at",
            "homeowner_approved_at",
            "invoice_created_at",
            "invoice_paid_at",
            "escrow_released_at",
            "dispute_opened_at",
            "dispute_resolved_at",
            "planned_vs_actual_completion_days",
            "completion_to_approval_seconds",
            "approval_to_payment_release_seconds",
            "invoice_to_payment_release_seconds",
            "total_lifecycle_seconds",
            "is_delayed",
        )
    }
    encoded = json.dumps(observed, sort_keys=True, default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def build_milestone_performance_payload(milestone: Milestone, *, source_event: str = "") -> dict[str, Any]:
    agreement = milestone.agreement
    invoice = _milestone_invoice(milestone)
    project = getattr(agreement, "project", None)
    template = getattr(agreement, "selected_template", None)
    completed_at = getattr(milestone, "completed_at", None)
    approved_at = getattr(invoice, "approved_at", None) if invoice else None
    invoice_created_at = getattr(invoice, "created_at", None) if invoice else None
    invoice_paid_at = _payment_release_at(invoice)
    escrow_released_at = getattr(invoice, "escrow_released_at", None) if invoice else None
    dispute_opened_at, dispute_resolved_at, dispute_count = _dispute_dates(milestone)
    planned_delta = _planned_delta_days(getattr(milestone, "completion_date", None), completed_at)
    lifecycle_start = _aware_midnight(getattr(milestone, "start_date", None)) or _aware_midnight(getattr(agreement, "start", None))
    lifecycle_end = escrow_released_at or invoice_paid_at or approved_at or completed_at or dispute_resolved_at
    normalized_type = _safe_text(getattr(milestone, "normalized_milestone_type", ""))
    if not normalized_type:
        normalized_type = normalize_milestone_type(
            title=_safe_text(getattr(milestone, "title", "")),
            description=_safe_text(getattr(milestone, "description", "")),
        )

    payload = {
        "agreement": agreement,
        "milestone": milestone,
        "contractor": getattr(agreement, "contractor", None),
        "invoice": invoice,
        "selected_template": template,
        "project_title": _safe_text(getattr(project, "title", "")),
        "project_type": _safe_text(getattr(agreement, "project_type", "")),
        "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")),
        "draft_source": _draft_source(agreement),
        "template_name_snapshot": _safe_text(getattr(template, "name", "")) or _safe_text(getattr(agreement, "selected_template_name_snapshot", "")),
        "milestone_order": int(getattr(milestone, "order", 0) or 0),
        "milestone_title": _safe_text(getattr(milestone, "title", "")),
        "normalized_milestone_type": normalized_type,
        "milestone_amount": _safe_decimal(getattr(milestone, "amount", None)),
        "planned_start_date": getattr(milestone, "start_date", None),
        "planned_completion_date": getattr(milestone, "completion_date", None),
        "contractor_completed_at": completed_at,
        "homeowner_approved_at": approved_at,
        "invoice_created_at": invoice_created_at,
        "invoice_paid_at": invoice_paid_at,
        "escrow_released_at": escrow_released_at,
        "dispute_opened_at": dispute_opened_at,
        "dispute_resolved_at": dispute_resolved_at,
        "planned_vs_actual_completion_days": planned_delta,
        "completion_to_approval_seconds": _seconds_between(completed_at, approved_at),
        "approval_to_payment_release_seconds": _seconds_between(approved_at, invoice_paid_at or escrow_released_at),
        "invoice_to_payment_release_seconds": _seconds_between(invoice_created_at, invoice_paid_at or escrow_released_at),
        "total_lifecycle_seconds": _seconds_between(lifecycle_start, lifecycle_end),
        "is_delayed": bool(planned_delta is not None and planned_delta > 0),
        "source_event": _safe_text(source_event),
        "metadata": {
            "agreement_payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
            "invoice_status": _safe_text(getattr(invoice, "status", "")) if invoice else "",
            "invoice_id": getattr(invoice, "id", None) if invoice else None,
            "dispute_count": dispute_count,
            "snapshot_version": 1,
        },
    }
    payload["state_signature"] = _state_signature(payload)
    return payload


def capture_milestone_performance_snapshot(
    milestone: Milestone | int | None,
    *,
    source_event: str = "",
) -> MilestonePerformanceSnapshot | None:
    if milestone is None:
        return None
    if isinstance(milestone, int):
        try:
            milestone = (
                Milestone.objects.select_related(
                    "agreement",
                    "agreement__project",
                    "agreement__contractor",
                    "agreement__selected_template",
                    "invoice",
                )
                .get(pk=milestone)
            )
        except Milestone.DoesNotExist:
            return None

    payload = build_milestone_performance_payload(milestone, source_event=source_event)
    latest = (
        MilestonePerformanceSnapshot.objects.filter(milestone=milestone)
        .order_by("-created_at", "-id")
        .first()
    )
    if latest and latest.state_signature == payload["state_signature"]:
        return latest
    with transaction.atomic():
        return MilestonePerformanceSnapshot.objects.create(**payload)
