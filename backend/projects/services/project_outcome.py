from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import Agreement, InvoiceStatus, ProjectStatus
from projects.models_learning import ProjectOutcomeSnapshot
from projects.services.project_intelligence_orchestrator import build_project_intelligence


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _safe_decimal(value: Any) -> Decimal | None:
    if value in (None, "", []):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _date_only(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return value.date()
    except Exception:
        return None


def _duration_to_days(value: Any) -> int | None:
    if value in (None, "", []):
        return None
    try:
        if hasattr(value, "total_seconds"):
            seconds = int(value.total_seconds())
            return max(int(round(seconds / 86400)), 0)
        return max(int(value), 0)
    except Exception:
        return None


def _days_between(start: Any, end: Any) -> int | None:
    start_date = _date_only(start)
    end_date = _date_only(end)
    if not start_date or not end_date:
        return None
    return max((end_date - start_date).days, 0)


def _agreement_completed_date(agreement: Agreement) -> date | None:
    candidate_dates: list[date] = []
    for milestone in agreement.milestones.all():
        if getattr(milestone, "completed_at", None):
            candidate_dates.append(milestone.completed_at.date())
        elif getattr(milestone, "completion_date", None):
            candidate_dates.append(milestone.completion_date)
    for invoice in agreement.invoices.all():
        for field_name in ("direct_pay_paid_at", "escrow_released_at", "approved_at"):
            stamp = getattr(invoice, field_name, None)
            if stamp:
                candidate_dates.append(stamp.date())
    if candidate_dates:
        return max(candidate_dates)
    return _date_only(getattr(agreement, "completed_at", None)) or _date_only(getattr(agreement, "updated_at", None))


def _milestone_payload(agreement: Agreement, milestone) -> dict[str, Any]:
    invoice_qs = agreement.invoices.filter(milestone_id_snapshot=getattr(milestone, "id", None))
    paid_invoice_qs = invoice_qs.filter(
        Q(status=InvoiceStatus.PAID)
        | Q(direct_pay_paid_at__isnull=False)
        | Q(escrow_released_at__isnull=False)
        | Q(approved_at__isnull=False)
    )
    return {
        "id": getattr(milestone, "id", None),
        "order": getattr(milestone, "order", 0) or 0,
        "title": _safe_text(getattr(milestone, "title", "")),
        "description": _safe_text(getattr(milestone, "description", "")),
        "normalized_milestone_type": _safe_text(getattr(milestone, "normalized_milestone_type", "")),
        "amount": str(_safe_decimal(getattr(milestone, "amount", None)) or Decimal("0.00")),
        "template_suggested_amount": str(_safe_decimal(getattr(milestone, "template_suggested_amount", None)) or Decimal("0.00"))
        if getattr(milestone, "template_suggested_amount", None) is not None
        else "",
        "ai_suggested_amount": str(_safe_decimal(getattr(milestone, "ai_suggested_amount", None)) or Decimal("0.00"))
        if getattr(milestone, "ai_suggested_amount", None) is not None
        else "",
        "estimated_amount": str(_safe_decimal(getattr(milestone, "estimated_amount", None)) or Decimal("0.00"))
        if getattr(milestone, "estimated_amount", None) is not None
        else "",
        "completed": bool(getattr(milestone, "completed", False)),
        "completed_at": getattr(milestone, "completed_at", None).isoformat() if getattr(milestone, "completed_at", None) else None,
        "start_date": getattr(milestone, "start_date", None).isoformat() if getattr(milestone, "start_date", None) else None,
        "completion_date": getattr(milestone, "completion_date", None).isoformat() if getattr(milestone, "completion_date", None) else None,
        "is_invoiced": bool(getattr(milestone, "is_invoiced", False)),
        "invoice_count": invoice_qs.count(),
        "paid_amount": str(sum(
            (_safe_decimal(getattr(invoice, "amount", None)) or Decimal("0.00"))
            for invoice in paid_invoice_qs
        ) or Decimal("0.00")),
        "has_dispute": bool(getattr(milestone, "disputes", None) and milestone.disputes.exclude(status__in=["canceled", "cancelled"]).exists())
        if hasattr(milestone, "disputes") else False,
        "dispute_count": milestone.disputes.exclude(status__in=["canceled", "cancelled"]).count() if hasattr(milestone, "disputes") else 0,
    }


def _final_milestones_payload(agreement: Agreement) -> list[dict[str, Any]]:
    milestones = list(agreement.milestones.all().order_by("order", "id"))
    return [_milestone_payload(agreement, milestone) for milestone in milestones]


def _completion_status(agreement: Agreement, trigger: str) -> str:
    status = _safe_text(getattr(agreement, "status", "")).lower()
    if status == ProjectStatus.COMPLETED:
        return ProjectStatus.COMPLETED
    if trigger == "payment_released":
        return "payment_released"
    return status or trigger


def _estimated_ranges(bundle: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    estimate_preview = _safe_dict(bundle.get("estimate_preview"))
    suggested_plan = _safe_dict(bundle.get("suggested_plan"))

    value_range = {
        "low": _safe_text(estimate_preview.get("suggested_price_low") or suggested_plan.get("suggested_budget_low")),
        "high": _safe_text(estimate_preview.get("suggested_price_high") or suggested_plan.get("suggested_budget_high")),
        "center": _safe_text(estimate_preview.get("suggested_total_price") or suggested_plan.get("suggested_budget_center")),
        "currency": "USD",
    }
    duration_range = {
        "low": _safe_text(estimate_preview.get("suggested_duration_low") or suggested_plan.get("suggested_duration_low_days")),
        "high": _safe_text(estimate_preview.get("suggested_duration_high") or suggested_plan.get("suggested_duration_high_days")),
        "center": _safe_text(estimate_preview.get("suggested_duration_days") or suggested_plan.get("suggested_duration_days")),
        "unit": "days",
    }
    return value_range, duration_range


def _final_project_state(agreement: Agreement, bundle: dict[str, Any], trigger: str) -> dict[str, Any]:
    completed_date = _agreement_completed_date(agreement)
    total_cost = _safe_decimal(getattr(agreement, "total_cost", None))
    return {
        "agreement_id": getattr(agreement, "id", None),
        "project_id": getattr(getattr(agreement, "project", None), "id", None),
        "project_title": _safe_text(getattr(getattr(agreement, "project", None), "title", "")),
        "project_type": _safe_text(getattr(agreement, "project_type", "")),
        "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")),
        "description": _safe_text(getattr(agreement, "description", "")),
        "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
        "signature_policy": _safe_text(getattr(agreement, "signature_policy", "")),
        "template_used": _safe_text(getattr(getattr(agreement, "selected_template", None), "name", "")) or _safe_text(getattr(agreement, "selected_template_name_snapshot", "")),
        "template_id": getattr(agreement, "selected_template_id", None),
        "total_project_value": str(total_cost or Decimal("0.00")),
        "total_time_estimate_days": _duration_to_days(getattr(agreement, "total_time_estimate", None)),
        "start_date": getattr(agreement, "start", None).isoformat() if getattr(agreement, "start", None) else None,
        "end_date": getattr(agreement, "end", None).isoformat() if getattr(agreement, "end", None) else None,
        "completed_at": completed_date.isoformat() if completed_date else None,
        "milestone_count": agreement.milestones.count(),
        "dispute_flag": bool(agreement.disputes.exclude(status__in=["canceled", "cancelled"]).exists()),
        "dispute_count": agreement.disputes.exclude(status__in=["canceled", "cancelled"]).count(),
        "amendment_count": agreement.amendments.count() + (1 if getattr(agreement, "amendment_number", 0) else 0),
        "completion_status": _completion_status(agreement, trigger),
        "trigger_source": trigger,
        "original_project_intelligence": _safe_dict(bundle.get("analysis")),
    }


@transaction.atomic
def capture_project_outcome_snapshot(agreement: Agreement | int, *, trigger: str = "completed") -> ProjectOutcomeSnapshot:
    if isinstance(agreement, int):
        agreement = Agreement.objects.select_related(
            "contractor",
            "homeowner",
            "selected_template",
            "source_lead",
        ).prefetch_related(
            "milestones",
            "invoices",
            "draw_requests",
            "external_payment_records",
            "amendments",
            "disputes",
        ).get(pk=agreement)

    bundle = build_project_intelligence({"agreement": agreement})
    analysis = _safe_dict(bundle.get("analysis"))
    suggested_plan = _safe_dict(bundle.get("suggested_plan"))
    source_metadata = _safe_dict(bundle.get("source_metadata"))
    estimate_preview = _safe_dict(bundle.get("estimate_preview"))

    source_lead = getattr(agreement, "source_lead", None)
    if source_lead is not None:
        source_analysis = _safe_dict(getattr(source_lead, "ai_analysis", None))
        if source_analysis:
            bundle = dict(bundle)
            bundle.setdefault("source_lead_analysis_snapshot", source_analysis)

    value_range, duration_range = _estimated_ranges(bundle)
    template_used = (
        _safe_text(suggested_plan.get("recommended_template_name"))
        or _safe_text(suggested_plan.get("suggested_template_label"))
        or _safe_text(getattr(getattr(agreement, "selected_template", None), "name", ""))
        or _safe_text(getattr(agreement, "selected_template_name_snapshot", ""))
    )

    payload = {
        "contractor": getattr(agreement, "contractor", None),
        "source_lead": source_lead,
        "template": getattr(agreement, "selected_template", None),
        "project_family_key": _safe_text(suggested_plan.get("project_family_key") or analysis.get("project_family_key") or source_metadata.get("project_family_key")),
        "project_family_label": _safe_text(suggested_plan.get("project_family_label") or analysis.get("project_family_label")),
        "scope_mode": _safe_text(source_metadata.get("scope_mode") or suggested_plan.get("source_metadata", {}).get("scope_mode")),
        "template_used": template_used,
        "original_intelligence_payload": bundle,
        "original_suggested_plan": suggested_plan,
        "final_project_state": _final_project_state(agreement, bundle, trigger),
        "final_milestones": _final_milestones_payload(agreement),
        "total_project_value": _safe_decimal(getattr(agreement, "total_cost", None)),
        "estimated_value_range": value_range,
        "estimated_duration_range": duration_range,
        "actual_duration_days": _days_between(getattr(agreement, "start", None), _agreement_completed_date(agreement) or timezone.localdate()),
        "milestone_count": agreement.milestones.count(),
        "dispute_flag": bool(agreement.disputes.exclude(status__in=["canceled", "cancelled"]).exists()),
        "amendment_count": agreement.amendments.count() + (1 if getattr(agreement, "amendment_number", 0) else 0),
        "completion_status": _completion_status(agreement, trigger),
    }

    snapshot, _created = ProjectOutcomeSnapshot.objects.update_or_create(
        agreement=agreement,
        defaults=payload,
    )
    return snapshot
