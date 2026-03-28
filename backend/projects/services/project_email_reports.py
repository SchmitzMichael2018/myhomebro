from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
import re
from typing import Any

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, transaction
from django.template.loader import render_to_string
from django.utils import timezone

from projects.models import Agreement, Invoice, Milestone, ProjectEmailReportLog
from projects.services.compliance import get_agreement_compliance_warning


def _frontend_base() -> str:
    return (getattr(settings, "FRONTEND_URL", "") or getattr(settings, "SITE_URL", "") or "").rstrip("/")


def _money(value: Any) -> str:
    try:
        return f"{Decimal(str(value or 0)):.2f}"
    except Exception:
        return "0.00"


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _contractor_name(agreement: Agreement) -> str:
    contractor = getattr(agreement, "contractor", None)
    if contractor is None:
        return "MyHomeBro Contractor"
    return (
        getattr(contractor, "business_name", "")
        or getattr(contractor, "full_name", "")
        or getattr(contractor, "email", "")
        or "MyHomeBro Contractor"
    )


def _project_title(agreement: Agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        getattr(project, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or getattr(agreement, "title", "")
        or f"Agreement #{agreement.id}"
    )


def _recipient_for_agreement(agreement: Agreement) -> tuple[str, str]:
    if _safe_text(getattr(agreement, "report_recipient_email", "")):
        return (
            _safe_text(getattr(agreement, "report_recipient_name", "")) or "Project Owner",
            _safe_text(getattr(agreement, "report_recipient_email", "")),
        )
    homeowner = getattr(agreement, "homeowner", None)
    if homeowner is not None and _safe_text(getattr(homeowner, "email", "")):
        return (
            _safe_text(getattr(homeowner, "full_name", "")) or "Project Owner",
            _safe_text(getattr(homeowner, "email", "")),
        )
    return "", ""


def _agreement_budget_snapshot(agreement: Agreement) -> dict[str, str]:
    total_budget = Decimal(str(getattr(agreement, "total_cost", 0) or 0))
    released_to_date = sum(
        Decimal(str(inv.amount or 0))
        for inv in agreement.invoices.filter(escrow_released=True)
    )
    remaining_budget = total_budget - released_to_date
    if remaining_budget < Decimal("0.00"):
        remaining_budget = Decimal("0.00")
    return {
        "total_budget": _money(total_budget),
        "released_to_date": _money(released_to_date),
        "remaining_budget": _money(remaining_budget),
    }


def _invoice_links(invoice: Invoice | None) -> dict[str, str]:
    if invoice is None:
        return {
            "review_url": "",
            "approve_url": "",
            "request_changes_url": "",
        }
    base = _frontend_base()
    token = str(getattr(invoice, "public_token", "") or "").strip()
    if not base or not token:
        return {
            "review_url": "",
            "approve_url": "",
            "request_changes_url": "",
        }
    invoice_url = f"{base}/invoice/{token}"
    return {
        "review_url": invoice_url,
        "approve_url": f"{invoice_url}?action=approve",
        "request_changes_url": f"{invoice_url}?action=dispute",
    }


def _project_url(agreement: Agreement) -> str:
    base = _frontend_base()
    return f"{base}/app/agreements/{agreement.id}" if base else ""


def _safe_compliance_note(message: str) -> str:
    text = _safe_text(message)
    if not text:
        return ""
    redacted = re.sub(
        r"(?i)\b(license|policy)\s+number\s+([A-Z0-9-]+)\b",
        lambda match: f"{match.group(1).capitalize()} document on file",
        text,
    )
    redacted = re.sub(
        r"(?i)\bidentifier\s*[:#]?\s*([A-Z0-9-]+)\b",
        "document reference withheld",
        redacted,
    )
    return redacted


def _recurring_context(agreement: Agreement, milestone: Milestone | None = None) -> dict[str, str]:
    source = milestone or agreement
    service_period_start = getattr(source, "service_period_start", None)
    service_period_end = getattr(source, "service_period_end", None)
    scheduled_service_date = getattr(source, "scheduled_service_date", None)
    recurring_label = _safe_text(getattr(agreement, "recurring_summary_label", ""))
    if not recurring_label and getattr(agreement, "recurring_service_enabled", False):
        pattern = _safe_text(getattr(agreement, "recurrence_pattern", ""))
        interval = int(getattr(agreement, "recurrence_interval", 1) or 1)
        if pattern:
            recurring_label = f"Every {interval} {pattern}"
    return {
        "recurring_service_label": recurring_label,
        "scheduled_service_date": scheduled_service_date.isoformat() if scheduled_service_date else "",
        "service_period_start": service_period_start.isoformat() if service_period_start else "",
        "service_period_end": service_period_end.isoformat() if service_period_end else "",
    }


@dataclass(frozen=True)
class ProjectEmailReportPayload:
    event_type: str
    subject: str
    recipient_name: str
    recipient_email: str
    template_name: str
    context: dict[str, Any]
    dedup_key: str


def build_milestone_approval_email(*, agreement: Agreement, milestone: Milestone) -> ProjectEmailReportPayload:
    recipient_name, recipient_email = _recipient_for_agreement(agreement)
    budget = _agreement_budget_snapshot(agreement)
    invoice = getattr(milestone, "invoice", None)
    links = _invoice_links(invoice)
    requested_amount = Decimal(str(getattr(invoice, "amount", None) or getattr(milestone, "amount", 0) or 0))
    submitted_at = getattr(milestone, "subcontractor_marked_complete_at", None) or getattr(milestone, "completed_at", None)
    dedup_marker = submitted_at.isoformat() if submitted_at else f"milestone-{milestone.id}"
    context = {
        "event_label": "Milestone approval requested",
        "recipient_name": recipient_name,
        "project_title": _project_title(agreement),
        "contractor_name": _contractor_name(agreement),
        "milestone_title": _safe_text(getattr(milestone, "title", "")) or f"Milestone #{milestone.id}",
        "requested_amount": _money(requested_amount),
        "released_amount": "",
        "completed_date": submitted_at.date().isoformat() if submitted_at else "",
        "work_summary": _safe_text(getattr(milestone, "description", "")),
        "compliance_note": "",
        "highlights": [
            "Work is marked ready for review.",
            "Use the review link to approve or request changes.",
        ],
        "risks": [],
        "project_url": _project_url(agreement),
        **links,
        **budget,
        **_recurring_context(agreement, milestone),
    }
    return ProjectEmailReportPayload(
        event_type=ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED,
        subject=f"MyHomeBro: Milestone ready for approval on {_project_title(agreement)}",
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        template_name="emails/project_reports/milestone_approval_requested",
        context=context,
        dedup_key=f"milestone-approval:{agreement.id}:{milestone.id}:{recipient_email}:{dedup_marker}",
    )


def build_payment_release_email(*, agreement: Agreement, invoice: Invoice) -> ProjectEmailReportPayload:
    recipient_name, recipient_email = _recipient_for_agreement(agreement)
    budget = _agreement_budget_snapshot(agreement)
    links = _invoice_links(invoice)
    released_at = getattr(invoice, "escrow_released_at", None) or getattr(invoice, "direct_pay_paid_at", None) or timezone.now()
    context = {
        "event_label": "Payment released",
        "recipient_name": recipient_name,
        "project_title": _project_title(agreement),
        "contractor_name": _contractor_name(agreement),
        "milestone_title": _safe_text(getattr(invoice, "milestone_title_snapshot", "")),
        "requested_amount": _money(getattr(invoice, "amount", 0)),
        "released_amount": _money(getattr(invoice, "amount", 0)),
        "completed_date": released_at.date().isoformat() if released_at else "",
        "work_summary": _safe_text(getattr(invoice, "milestone_completion_notes", "")),
        "compliance_note": "",
        "highlights": [
            "Funds were released for this project event.",
            "Budget totals below reflect the current released amount.",
        ],
        "risks": [],
        "project_url": _project_url(agreement),
        **links,
        **budget,
        **_recurring_context(agreement),
    }
    return ProjectEmailReportPayload(
        event_type=ProjectEmailReportLog.EventType.PAYMENT_RELEASED,
        subject=f"MyHomeBro: Payment released for {_project_title(agreement)}",
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        template_name="emails/project_reports/payment_released",
        context=context,
        dedup_key=f"payment-released:{agreement.id}:{invoice.id}:{recipient_email}:{released_at.isoformat()}",
    )


def build_compliance_alert_email(
    *,
    agreement: Agreement,
    milestone: Milestone | None = None,
    compliance_note: str = "",
) -> ProjectEmailReportPayload:
    recipient_name, recipient_email = _recipient_for_agreement(agreement)
    budget = _agreement_budget_snapshot(agreement)
    warning = get_agreement_compliance_warning(agreement)
    note = _safe_compliance_note(compliance_note or warning.get("message"))
    source_key = _safe_text(getattr(milestone, "subcontractor_required_trade_key", "")) or warning.get("trade_key") or "compliance"
    context = {
        "event_label": "Compliance note",
        "recipient_name": recipient_name,
        "project_title": _project_title(agreement),
        "contractor_name": _contractor_name(agreement),
        "milestone_title": _safe_text(getattr(milestone, "title", "")) if milestone is not None else "",
        "requested_amount": "",
        "released_amount": "",
        "completed_date": "",
        "work_summary": "",
        "compliance_note": note,
        "highlights": ["A compliance-related issue needs review."],
        "risks": [note] if note else [],
        "project_url": _project_url(agreement),
        "review_url": _project_url(agreement),
        "approve_url": "",
        "request_changes_url": "",
        **budget,
        **_recurring_context(agreement, milestone),
    }
    marker = _safe_text(getattr(milestone, "subcontractor_license_requested_at", "")) or source_key
    return ProjectEmailReportPayload(
        event_type=ProjectEmailReportLog.EventType.COMPLIANCE_ALERT,
        subject=f"MyHomeBro: Compliance note for {_project_title(agreement)}",
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        template_name="emails/project_reports/compliance_alert",
        context=context,
        dedup_key=f"compliance-alert:{agreement.id}:{getattr(milestone, 'id', 'agreement')}:{recipient_email}:{marker}",
    )


def build_weekly_project_summary_email(
    *,
    agreement: Agreement,
    week_end: timezone.datetime | None = None,
) -> ProjectEmailReportPayload:
    recipient_name, recipient_email = _recipient_for_agreement(agreement)
    budget = _agreement_budget_snapshot(agreement)
    end = week_end or timezone.now()
    start = end - timedelta(days=7)
    completed = list(
        agreement.milestones.filter(completed_at__gte=start, completed_at__lte=end).order_by("completed_at")
    )
    pending_approval = list(
        agreement.milestones.filter(
            subcontractor_completion_status="submitted_for_review"
        ).order_by("order", "id")
    )
    released = list(
        agreement.invoices.filter(escrow_released_at__gte=start, escrow_released_at__lte=end).order_by("escrow_released_at")
    )
    compliance_warning = get_agreement_compliance_warning(agreement)
    highlights = [f"{len(completed)} milestone(s) completed this week.", f"{len(released)} payment release(s) recorded this week."]
    risks = []
    if pending_approval:
        risks.append(f"{len(pending_approval)} milestone(s) are waiting for approval.")
    if compliance_warning.get("warning_level") not in {"", "none"}:
        risks.append(_safe_compliance_note(compliance_warning.get("message")))
    context = {
        "event_label": "Weekly project summary",
        "recipient_name": recipient_name,
        "project_title": _project_title(agreement),
        "contractor_name": _contractor_name(agreement),
        "milestone_title": "",
        "requested_amount": "",
        "released_amount": _money(sum(Decimal(str(inv.amount or 0)) for inv in released)),
        "completed_date": end.date().isoformat(),
        "work_summary": "",
        "compliance_note": _safe_compliance_note(compliance_warning.get("message")),
        "highlights": highlights,
        "risks": risks,
        "project_url": _project_url(agreement),
        "review_url": _project_url(agreement),
        "approve_url": "",
        "request_changes_url": "",
        "completed_milestones": [item.title for item in completed],
        "pending_approval_milestones": [item.title for item in pending_approval],
        "funds_released_this_week": _money(sum(Decimal(str(inv.amount or 0)) for inv in released)),
        "compliance_alert_count": 1 if compliance_warning.get("warning_level") not in {"", "none"} else 0,
        "week_start": start.date().isoformat(),
        "week_end": end.date().isoformat(),
        **budget,
        **_recurring_context(agreement),
    }
    return ProjectEmailReportPayload(
        event_type=ProjectEmailReportLog.EventType.WEEKLY_PROJECT_SUMMARY,
        subject=f"MyHomeBro: Weekly summary for {_project_title(agreement)}",
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        template_name="emails/project_reports/weekly_project_summary",
        context=context,
        dedup_key=f"weekly-summary:{agreement.id}:{recipient_email}:{start.date().isoformat()}:{end.date().isoformat()}",
    )


def build_project_email_report(
    *,
    event_type: str,
    agreement: Agreement,
    milestone: Milestone | None = None,
    invoice: Invoice | None = None,
    compliance_note: str = "",
    week_end: timezone.datetime | None = None,
) -> ProjectEmailReportPayload:
    if event_type == ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED:
        if milestone is None:
            raise ValueError("milestone is required for milestone approval emails")
        return build_milestone_approval_email(agreement=agreement, milestone=milestone)
    if event_type == ProjectEmailReportLog.EventType.PAYMENT_RELEASED:
        if invoice is None:
            raise ValueError("invoice is required for payment release emails")
        return build_payment_release_email(agreement=agreement, invoice=invoice)
    if event_type == ProjectEmailReportLog.EventType.COMPLIANCE_ALERT:
        return build_compliance_alert_email(agreement=agreement, milestone=milestone, compliance_note=compliance_note)
    if event_type == ProjectEmailReportLog.EventType.WEEKLY_PROJECT_SUMMARY:
        return build_weekly_project_summary_email(agreement=agreement, week_end=week_end)
    raise ValueError(f"Unsupported project email report event type: {event_type}")


def send_project_email_report(
    *,
    event_type: str,
    agreement: Agreement,
    milestone: Milestone | None = None,
    invoice: Invoice | None = None,
    compliance_note: str = "",
    week_end: timezone.datetime | None = None,
) -> dict[str, Any]:
    payload = build_project_email_report(
        event_type=event_type,
        agreement=agreement,
        milestone=milestone,
        invoice=invoice,
        compliance_note=compliance_note,
        week_end=week_end,
    )
    if not payload.recipient_email:
        return {"sent": False, "reason": "missing_recipient", "payload": payload.context}

    html_body = render_to_string(f"{payload.template_name}.html", payload.context)
    text_body = render_to_string(f"{payload.template_name}.txt", payload.context)
    if ProjectEmailReportLog.objects.filter(dedup_key=payload.dedup_key).exists():
        return {"sent": False, "reason": "duplicate", "payload": payload.context}

    try:
        with transaction.atomic():
            ProjectEmailReportLog.objects.create(
                agreement=agreement,
                milestone=milestone,
                invoice=invoice,
                event_type=payload.event_type,
                recipient_email=payload.recipient_email,
                recipient_name=payload.recipient_name,
                dedup_key=payload.dedup_key,
                payload_snapshot=payload.context,
            )
    except IntegrityError:
        return {"sent": False, "reason": "duplicate", "payload": payload.context}

    msg = EmailMultiAlternatives(
        subject=payload.subject,
        body=text_body,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com"),
        to=[payload.recipient_email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)
    return {"sent": True, "reason": "sent", "payload": payload.context}
