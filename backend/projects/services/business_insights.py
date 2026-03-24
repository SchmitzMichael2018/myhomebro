from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from projects.models import (
    Invoice,
    Milestone,
    MilestonePayout,
    MilestonePayoutStatus,
    SubcontractorCompletionStatus,
)


def _money(value) -> str:
    return f"{Decimal(value or 0).quantize(Decimal('0.01'))}"


def build_business_insights(contractor, start_dt, end_dt) -> list[dict]:
    if contractor is None:
        return []

    today = timezone.localdate()

    milestone_qs = Milestone.objects.filter(agreement__contractor=contractor)
    payout_qs = MilestonePayout.objects.filter(milestone__agreement__contractor=contractor)
    invoice_qs = Invoice.objects.filter(agreement__contractor=contractor)

    insights: list[dict] = []

    review_waiting_count = milestone_qs.filter(
        subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    ).count()
    if review_waiting_count:
        noun = "milestone is" if review_waiting_count == 1 else "milestones are"
        insights.append(
            {
                "category": "review_bottleneck",
                "title": "Awaiting review",
                "explanation": f"{review_waiting_count} {noun} waiting for contractor review, which may delay invoicing.",
                "severity": "high" if review_waiting_count >= 3 else "medium",
                "action_label": "View Review Queue",
                "action_href": "/app/reviewer/queue",
            }
        )

    overdue_count = milestone_qs.filter(
        completed=False,
        completion_date__lt=today,
    ).count()
    if overdue_count:
        noun = "milestone is" if overdue_count == 1 else "milestones are"
        insights.append(
            {
                "category": "schedule_risk",
                "title": "Overdue work",
                "explanation": f"{overdue_count} {noun} overdue and may push project timelines further out.",
                "severity": "high" if overdue_count >= 2 else "medium",
                "action_label": "View Milestones",
                "action_href": "/app/milestones",
            }
        )

    failed_payout_qs = payout_qs.filter(status=MilestonePayoutStatus.FAILED)
    failed_payout_count = failed_payout_qs.count()
    failed_payout_total = (
        Decimal(
            failed_payout_qs.aggregate(total=Coalesce(Sum("amount_cents"), 0))["total"]
            or 0
        )
        / Decimal("100")
    )
    if failed_payout_count:
        insights.append(
            {
                "category": "payout_attention",
                "title": "Failed payouts need attention",
                "explanation": f"{failed_payout_count} failed payout{'s' if failed_payout_count != 1 else ''} totalling ${_money(failed_payout_total)} should be reviewed before subcontractors are delayed.",
                "severity": "high",
                "action_label": "View Payout History",
                "action_href": "/app/payouts/history",
            }
        )

    ready_payout_qs = payout_qs.filter(status=MilestonePayoutStatus.READY_FOR_PAYOUT)
    ready_payout_count = ready_payout_qs.count()
    ready_payout_total = (
        Decimal(
            ready_payout_qs.aggregate(total=Coalesce(Sum("amount_cents"), 0))["total"]
            or 0
        )
        / Decimal("100")
    )
    if ready_payout_count:
        insights.append(
            {
                "category": "cash_flow",
                "title": "Ready for subcontractor payout",
                "explanation": f"${_money(ready_payout_total)} across {ready_payout_count} subcontractor payout{'s' if ready_payout_count != 1 else ''} is ready to be paid.",
                "severity": "medium",
                "action_label": "Open Payout Reporting",
                "action_href": "/app/business",
            }
        )

    escrow_pending_total = (
        invoice_qs.filter(status="approved", escrow_released=False)
        .aggregate(total=Coalesce(Sum("amount"), Decimal("0.00")))["total"]
        or Decimal("0.00")
    )
    if escrow_pending_total and Decimal(escrow_pending_total) > Decimal("0.00"):
        insights.append(
            {
                "category": "cash_flow",
                "title": "Approved cash still pending release",
                "explanation": f"${_money(escrow_pending_total)} is approved but not yet released, which may slow cash flow into completed work.",
                "severity": "medium",
                "action_label": "Open Business Dashboard",
                "action_href": "/app/business",
            }
        )

    if len(insights) > 4:
        severity_rank = {"high": 3, "medium": 2, "low": 1}
        insights = sorted(
            insights,
            key=lambda item: severity_rank.get(item.get("severity", "low"), 0),
            reverse=True,
        )[:4]

    return insights
