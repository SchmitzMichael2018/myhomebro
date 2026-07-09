from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from projects.models import (
    Agreement,
    DrawRequest,
    DrawRequestStatus,
    Invoice,
    InvoiceStatus,
    Milestone,
    ProjectStatus,
    PublicContractorLead,
)
from projects.models_dispute import Dispute
from projects.models_proposals import Proposal
from projects.models_warranty import WarrantyRequest
from projects.services.workforce_assignments import normalize_workforce_assignments


def _money(value: Any) -> str:
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


def _money_from_cents(value: Any) -> str:
    return _money(Decimal(value or 0) / Decimal("100"))


def _metric(key: str, label: str, value: Any, *, detail: str = "", href: str = "", kind: str = "count") -> dict:
    return {
        "key": key,
        "label": label,
        "value": _money(value) if kind == "money" else int(value or 0),
        "kind": kind,
        "detail": detail,
        "href": href,
    }


def _status_from_count(count: int, at_risk_threshold: int = 3) -> str:
    if count >= at_risk_threshold:
        return "At Risk"
    if count > 0:
        return "Needs Attention"
    return "Healthy"


def _attention_item(key: str, title: str, count: int, *, severity: str, why: str, workspace: str, href: str, amount: str = "") -> dict:
    return {
        "key": key,
        "title": title,
        "count": int(count or 0),
        "amount": amount,
        "severity": severity,
        "why": why,
        "source_workspace": workspace,
        "open_url": href,
        "action_label": "Open",
    }


def build_insights_command_center(contractor, start_dt, end_dt, *, financial_summary=None, snapshot=None, business_performance=None) -> dict:
    if contractor is None:
        return {
            "metrics": {},
            "business_health": {},
            "needs_attention": [],
            "morning_brief": {},
            "opportunity_forecast": {},
            "operations_analyst": {},
        }

    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    financial_summary = financial_summary or {}
    snapshot = snapshot or {}
    business_performance = business_performance or {}

    agreements = Agreement.objects.filter(contractor=contractor)
    open_agreements = agreements.exclude(status__in=[ProjectStatus.COMPLETED, ProjectStatus.CANCELLED])
    unsigned_agreements = open_agreements.filter(signed_by_homeowner=False).count()
    unfunded_agreements = open_agreements.filter(payment_mode="escrow", escrow_funded=False).count()

    overdue_milestones = Milestone.objects.filter(
        agreement__contractor=contractor,
        completed=False,
        completion_date__lt=today,
    ).count()
    due_today_milestones = Milestone.objects.filter(
        agreement__contractor=contractor,
        completed=False,
        completion_date=today,
    ).count()
    completed_yesterday = Milestone.objects.filter(
        agreement__contractor=contractor,
        completed=True,
        completed_at__date=yesterday,
    ).count()

    pending_invoice_count = Invoice.objects.filter(
        agreement__contractor=contractor,
        status__in=[InvoiceStatus.SENT, InvoiceStatus.PENDING, InvoiceStatus.APPROVED],
    ).count()
    outstanding_receivables = Invoice.objects.filter(
        agreement__contractor=contractor,
        status__in=[InvoiceStatus.SENT, InvoiceStatus.PENDING],
    ).aggregate(total=Coalesce(Sum("amount"), Decimal("0.00")))["total"]
    pending_draw_receivables = DrawRequest.objects.filter(
        agreement__contractor=contractor,
        status__in=[DrawRequestStatus.SUBMITTED, DrawRequestStatus.APPROVED, DrawRequestStatus.AWAITING_RELEASE],
    ).aggregate(total=Coalesce(Sum("gross_amount"), Decimal("0.00")))["total"]
    outstanding_receivables = Decimal(outstanding_receivables or 0) + Decimal(pending_draw_receivables or 0)

    warranty_attention_statuses = [
        WarrantyRequest.STATUS_SUBMITTED,
        WarrantyRequest.STATUS_UNDER_REVIEW,
        WarrantyRequest.STATUS_MORE_INFORMATION_REQUESTED,
        WarrantyRequest.STATUS_FOLLOW_UP_NEEDED,
        WarrantyRequest.STATUS_WAITING_ON_CUSTOMER,
    ]
    warranty_count = WarrantyRequest.objects.filter(contractor=contractor, status__in=warranty_attention_statuses).count()

    resolution_count = Dispute.objects.filter(agreement__contractor=contractor, is_archived=False).exclude(
        status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "canceled"]
    ).count()
    stale_cutoff = timezone.now() - timedelta(days=7)
    stale_opportunities = PublicContractorLead.objects.filter(
        contractor=contractor,
        status__in=[
            PublicContractorLead.STATUS_NEW,
            PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
            PublicContractorLead.STATUS_READY_FOR_REVIEW,
            PublicContractorLead.STATUS_FOLLOW_UP,
            PublicContractorLead.STATUS_CONTACTED,
            PublicContractorLead.STATUS_QUALIFIED,
        ],
        updated_at__lt=stale_cutoff,
    ).count()
    open_opportunities = PublicContractorLead.objects.filter(
        contractor=contractor,
    ).exclude(status__in=[PublicContractorLead.STATUS_CLOSED, PublicContractorLead.STATUS_ARCHIVED, PublicContractorLead.STATUS_REJECTED]).count()

    estimate_pipeline_count = Proposal.objects.filter(contractor=contractor).exclude(
        status__in=[Proposal.STATUS_CONVERTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED]
    ).count()

    workforce = normalize_workforce_assignments(contractor)
    workforce_summary = workforce.get("summary") or {}
    overbooked_count = sum(1 for row in workforce.get("capacity") or [] if row.get("state") in {"near_capacity", "overbooked"})

    net_paid = Decimal(financial_summary.get("net_paid_total") or 0)
    pending_release = Decimal(financial_summary.get("pending_release_total") or 0)
    held_funds = Decimal(financial_summary.get("on_hold_total") or 0)
    collected_revenue = Decimal(financial_summary.get("gross_revenue_total") or 0)

    potential_revenue = Decimal(
        (business_performance.get("revenue") or {}).get("total_pipeline_value") or 0
    )
    likely_revenue = potential_revenue * Decimal("0.60")
    committed_revenue = open_agreements.aggregate(total=Coalesce(Sum("total_cost"), Decimal("0.00")))["total"] or Decimal("0.00")

    metrics = {
        "revenue": _metric("revenue", "Revenue", collected_revenue, detail="Collected in selected range", href="/app/business?view=reports-trends", kind="money"),
        "net_paid": _metric("net_paid", "Net Paid To You", net_paid, detail="Collected after platform fees", href="/app/business?view=reports-trends", kind="money"),
        "pending_release": _metric("pending_release", "Money Waiting On Customer Approval", pending_release, detail="Approved or ready but not released", href="/app/payments?money_status=payment_pending", kind="money"),
        "held_funds": _metric("held_funds", "Money On Hold", held_funds, detail="Disputed or paused for review", href="/app/resolution", kind="money"),
        "outstanding_receivables": _metric("outstanding_receivables", "Money Customers Still Owe", outstanding_receivables, detail="Sent invoices and submitted draws", href="/app/payments", kind="money"),
        "open_projects": _metric("open_projects", "Open Projects", open_agreements.count(), detail="Active agreements not completed or cancelled", href="/app/agreements"),
        "open_opportunities": _metric("open_opportunities", "Open Opportunities", open_opportunities, detail="Leads still in the opportunity pipeline", href="/app/opportunities"),
        "estimate_pipeline": _metric("estimate_pipeline", "Estimate Pipeline", estimate_pipeline_count, detail="Active estimate workspaces", href="/app/estimates"),
        "warranty_requests": _metric("warranty_requests", "Warranty Requests", warranty_count, detail="Warranty items needing review", href="/app/warranty"),
        "resolution_cases": _metric("resolution_cases", "Resolution Cases", resolution_count, detail="Open resolution cases", href="/app/resolution"),
        "team_capacity": _metric("team_capacity", "Team Capacity", overbooked_count, detail="Team members near capacity or overbooked", href="/app/team"),
        "customer_requests": _metric("customer_requests", "Customer Requests", stale_opportunities, detail="Stale opportunities that may need follow-up", href="/app/opportunities"),
    }

    attention = [
        _attention_item("overdue_milestones", "Overdue milestones", overdue_milestones, severity="high" if overdue_milestones >= 2 else "medium", why="Late milestones can delay invoices, customer approvals, and schedules.", workspace="Milestones", href="/app/milestones"),
        _attention_item("unsigned_agreements", "Unsigned agreements", unsigned_agreements, severity="medium", why="Unsigned agreements are not ready for funded project work.", workspace="Agreements", href="/app/agreements?status=awaiting_signature"),
        _attention_item("unfunded_agreements", "Money waiting to be funded", unfunded_agreements, severity="medium", why="Escrow agreements need funding before money can safely move.", workspace="Agreements", href="/app/agreements?status=signed"),
        _attention_item("pending_customer_approvals", "Pending customer approvals", pending_invoice_count, severity="medium", why="Customer approvals are the next step before money can be released.", workspace="Payments", href="/app/payments?money_status=payment_pending", amount=_money(pending_release)),
        _attention_item("warranty_requests", "Warranty requests", warranty_count, severity="high" if warranty_count >= 2 else "medium", why="Warranty items affect customer trust and may become resolution cases.", workspace="Warranty", href="/app/warranty"),
        _attention_item("resolution_cases", "Resolution cases", resolution_count, severity="high", why="Open resolution cases can hold funds and slow project closeout.", workspace="Resolution", href="/app/resolution"),
        _attention_item("team_capacity", "Team capacity pressure", overbooked_count, severity="medium", why="Capacity pressure increases schedule risk before new work is committed.", workspace="Team", href="/app/team"),
        _attention_item("stale_opportunities", "Stale opportunities", stale_opportunities, severity="low", why="Older leads may need follow-up or cleanup to keep the pipeline accurate.", workspace="Opportunities", href="/app/opportunities"),
    ]
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    needs_attention = sorted(
        [item for item in attention if item["count"] > 0 or Decimal(str(item.get("amount") or "0")) > 0],
        key=lambda item: (severity_rank.get(item["severity"], 0), item["count"]),
        reverse=True,
    )[:8]

    financial_state = "At Risk" if held_funds > 0 else "Needs Attention" if pending_release > 0 or outstanding_receivables > 0 else "Healthy"
    operational_state = _status_from_count(overdue_milestones + pending_invoice_count)
    customer_state = _status_from_count(warranty_count + resolution_count, at_risk_threshold=2)
    workforce_state = _status_from_count(overbooked_count, at_risk_threshold=2)
    growth_state = "Needs Attention" if stale_opportunities else "Healthy"
    states = [financial_state, operational_state, customer_state, workforce_state, growth_state]
    overall = "At Risk" if "At Risk" in states else "Needs Attention" if "Needs Attention" in states else "Healthy"

    biggest_win = "Revenue is moving." if collected_revenue > 0 else "No urgent revenue issue was found in the selected range."
    concern_source = needs_attention[0]["title"] if needs_attention else "No urgent attention item"
    recommended_focus = needs_attention[0]["why"] if needs_attention else "Review reports and keep current work moving."

    return {
        "metrics": metrics,
        "business_health": {
            "overall": overall,
            "summary": f"{overall} overall",
            "dimensions": [
                {"key": "financial", "label": "Financial Health", "status": financial_state, "detail": "Cash movement, held funds, and customer approvals."},
                {"key": "operational", "label": "Operational Health", "status": operational_state, "detail": "Milestones, approvals, and active work."},
                {"key": "customer", "label": "Customer Health", "status": customer_state, "detail": "Warranty and resolution pressure."},
                {"key": "workforce", "label": "Workforce Health", "status": workforce_state, "detail": "Team workload and capacity indicators."},
                {"key": "growth", "label": "Growth Health", "status": growth_state, "detail": "Opportunities and estimate pipeline follow-up."},
            ],
            "biggest_win": biggest_win,
            "biggest_concern": concern_source,
            "recommended_focus": recommended_focus,
        },
        "needs_attention": needs_attention,
        "morning_brief": {
            "yesterday": [
                f"Completed {completed_yesterday} milestone{'s' if completed_yesterday != 1 else ''}.",
            ],
            "today": [
                f"{due_today_milestones} milestone{'s' if due_today_milestones != 1 else ''} scheduled or due today.",
                f"{workforce_summary.get('estimate_count', 0)} active estimate item{'s' if workforce_summary.get('estimate_count', 0) != 1 else ''}.",
            ],
            "upcoming": [
                f"{workforce_summary.get('this_week_count', 0)} workforce item{'s' if workforce_summary.get('this_week_count', 0) != 1 else ''} this week.",
            ],
            "risks": [item["title"] for item in needs_attention[:3]] or ["No urgent risks found."],
            "recommended_action": needs_attention[0]["title"] if needs_attention else "Review reports and keep current work moving.",
        },
        "opportunity_forecast": {
            "potential_revenue": _money(potential_revenue),
            "likely_revenue": _money(likely_revenue),
            "committed_revenue": _money(committed_revenue),
            "collected_revenue": _money(collected_revenue),
            "source_note": "Deterministic workflow state from opportunities, estimates, agreements, and collected payments.",
            "sections": [
                {"label": "Potential Revenue", "value": _money(potential_revenue), "href": "/app/opportunities"},
                {"label": "Likely Revenue", "value": _money(likely_revenue), "href": "/app/estimates"},
                {"label": "Committed Revenue", "value": _money(committed_revenue), "href": "/app/agreements"},
                {"label": "Collected Revenue", "value": _money(collected_revenue), "href": "/app/business?view=reports-trends"},
            ],
        },
        "operations_analyst": {
            "role": "Operations Analyst",
            "summary": f"{overall} overall. {biggest_win} Biggest concern: {concern_source}.",
            "why_this_matters": "These records show where cash, customers, and schedules may need attention before daily work starts.",
            "confidence": "medium" if needs_attention else "high",
            "recommendations": [recommended_focus],
            "evidence": [
                {"label": "Canonical metrics", "type": "Insights", "status": overall, "href": "/app/business"},
                {"label": "Needs Attention queue", "type": "Operational records", "status": f"{len(needs_attention)} items", "href": "/app/business"},
                {"label": "Workforce workload", "type": "Team", "status": f"{workforce_summary.get('total', 0)} records", "href": "/app/team"},
            ],
            "prepared_actions": [
                {"label": "Open Needs Attention", "href": "/app/business"},
                {"label": "Review Payments", "href": "/app/payments"},
                {"label": "Review Opportunities", "href": "/app/opportunities"},
            ],
            "human_only_actions": [
                "Release money",
                "Change pricing",
                "Notify customers",
                "Modify records",
            ],
        },
    }
