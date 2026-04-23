# backend/projects/views/business_dashboard.py

import csv
from collections import OrderedDict
from datetime import timedelta, datetime, date
from decimal import Decimal

from django.http import HttpResponse
from django.db.models import Sum, Q
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_date

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import (
    Agreement,
    Contractor,
    DrawRequest,
    DrawRequestStatus,
    ExternalPaymentRecord,
    ExternalPaymentStatus,
    ExpenseRequest,
    ExpenseStatus,
    Invoice,
    InvoiceStatus,
    Milestone,
    MilestonePayoutStatus,
    PublicContractorLead,
    ProjectStatus,
)
from projects.models_project_intake import ProjectIntake
from projects.services.business_insights import build_business_insights
from projects.services.business_dashboard_insights import build_business_dashboard_contractor_insights
from payments.fees import MAX_PLATFORM_FEE, get_collected_platform_fees_for_agreement
from projects.views.payout_history import _apply_history_filters, _history_base_queryset, _serialize_payout_row


def _parse_range(request):
    now = timezone.now()
    tz = timezone.get_current_timezone()

    preset = (request.query_params.get("range") or "30").lower()

    if preset == "90":
        start = now - timedelta(days=90)
    elif preset == "ytd":
        start = timezone.make_aware(datetime(now.year, 1, 1), tz)
    elif preset == "all":
        start = timezone.make_aware(datetime(2000, 1, 1), tz)
    else:
        start = now - timedelta(days=30)

    return start, now


def _require_contractor(request):
    try:
        return request.user.contractor_profile
    except Contractor.DoesNotExist:
        return None


def _format_money(value):
    return str((Decimal(value or 0)).quantize(Decimal("0.01")))


def _format_dt(value):
    return value.isoformat() if value else ""


def _to_local_dt(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, timezone.get_current_timezone())
    return timezone.localtime(value, timezone.get_current_timezone())


def _effective_invoice_paid_at(invoice):
    return (
        getattr(invoice, "escrow_released_at", None)
        or getattr(invoice, "direct_pay_paid_at", None)
    )


def _effective_payout_dt(payout):
    return payout.paid_at if payout.status == MilestonePayoutStatus.PAID else payout.updated_at


def _range_bucket_kind(start_dt, end_dt):
    span_days = max((end_dt.date() - start_dt.date()).days + 1, 1)
    if span_days <= 45:
        return "day"
    if span_days <= 180:
        return "week"
    return "month"


def _bucket_start_for_dt(value, bucket_kind):
    local_dt = _to_local_dt(value)
    if local_dt is None:
        return None
    if bucket_kind == "day":
        return local_dt.date()
    if bucket_kind == "week":
        return (local_dt - timedelta(days=local_dt.weekday())).date()
    return local_dt.date().replace(day=1)


def _bucket_label(bucket_start, bucket_kind):
    if bucket_kind == "day":
        return f"{bucket_start.strftime('%b')} {bucket_start.day}"
    if bucket_kind == "week":
        bucket_end = bucket_start + timedelta(days=6)
        if bucket_start.month == bucket_end.month:
            return f"{bucket_start.strftime('%b')} {bucket_start.day}-{bucket_end.day}"
        return f"{bucket_start.strftime('%b')} {bucket_start.day}-{bucket_end.strftime('%b')} {bucket_end.day}"
    return bucket_start.strftime("%b %Y")


def _bucket_range(start_dt, end_dt, bucket_kind):
    buckets = OrderedDict()
    cursor = _bucket_start_for_dt(start_dt, bucket_kind)
    last_bucket = _bucket_start_for_dt(end_dt, bucket_kind)

    while cursor is not None and cursor <= last_bucket:
        buckets[cursor] = {
            "bucket_start": cursor.isoformat(),
            "bucket_label": _bucket_label(cursor, bucket_kind),
        }
        if bucket_kind == "day":
            cursor = cursor + timedelta(days=1)
        elif bucket_kind == "week":
            cursor = cursor + timedelta(days=7)
        else:
            if cursor.month == 12:
                cursor = date(cursor.year + 1, 1, 1)
            else:
                cursor = date(cursor.year, cursor.month + 1, 1)

    return buckets


def _amount_to_cents(value):
    return int((Decimal(value or 0) * Decimal("100")).quantize(Decimal("1")))


def _sum_money_series(rows, key, divisor=Decimal("100")):
    total = sum(Decimal(row.get(key) or 0) for row in rows)
    return str((total / divisor).quantize(Decimal("0.01")))


def _percent_value(numerator: int, denominator: int) -> str:
    if not denominator:
        return "0.00"
    return str((Decimal(numerator) / Decimal(denominator) * Decimal("100")).quantize(Decimal("0.01")))


def _build_business_performance_summary(contractor, start_dt, end_dt):
    request_qs = ProjectIntake.objects.filter(
        contractor=contractor,
        status__in=[
            "submitted",
            "analyzed",
            "converted",
        ],
    ).filter(
        Q(submitted_at__gte=start_dt, submitted_at__lte=end_dt)
        | (Q(submitted_at__isnull=True) & Q(created_at__gte=start_dt, created_at__lte=end_dt))
    )

    lead_qs = PublicContractorLead.objects.filter(
        contractor=contractor,
        updated_at__gte=start_dt,
        updated_at__lte=end_dt,
    )

    request_received_count = request_qs.count()
    bids_submitted_count = lead_qs.exclude(status=PublicContractorLead.STATUS_NEW).count()
    bids_awarded_count = lead_qs.filter(
        status=PublicContractorLead.STATUS_ACCEPTED
    ).filter(
        Q(accepted_at__gte=start_dt, accepted_at__lte=end_dt)
        | Q(converted_at__gte=start_dt, converted_at__lte=end_dt)
        | (Q(accepted_at__isnull=True) & Q(converted_at__isnull=True))
    ).count()

    agreements_qs = Agreement.objects.filter(
        contractor=contractor,
        created_at__gte=start_dt,
        created_at__lte=end_dt,
    )
    agreements_created_count = agreements_qs.count()

    invoice_qs = Invoice.objects.filter(
        agreement__contractor=contractor,
        status=InvoiceStatus.PAID,
    ).filter(
        Q(escrow_released_at__gte=start_dt, escrow_released_at__lte=end_dt)
        | Q(direct_pay_paid_at__gte=start_dt, direct_pay_paid_at__lte=end_dt)
    )
    draw_qs = DrawRequest.objects.filter(
        agreement__contractor=contractor,
        status__in=[DrawRequestStatus.RELEASED, DrawRequestStatus.PAID],
    ).filter(
        Q(paid_at__gte=start_dt, paid_at__lte=end_dt)
        | Q(released_at__gte=start_dt, released_at__lte=end_dt)
    )

    paid_invoice_total = (
        invoice_qs.aggregate(total=Coalesce(Sum("amount"), Decimal("0.00")))["total"]
    ).quantize(Decimal("0.01"))
    paid_draw_total = (
        draw_qs.aggregate(total=Coalesce(Sum("gross_amount"), Decimal("0.00")))["total"]
    ).quantize(Decimal("0.01"))
    total_paid = (paid_invoice_total + paid_draw_total).quantize(Decimal("0.01"))

    paid_project_ids = set(invoice_qs.values_list("agreement_id", flat=True))
    paid_project_ids.update(draw_qs.values_list("agreement_id", flat=True))
    paid_projects_count = len(paid_project_ids)

    pipeline_value = (
        agreements_qs.aggregate(total=Coalesce(Sum("total_cost"), Decimal("0.00")))["total"]
    ).quantize(Decimal("0.01"))
    average_project_value = (
        (pipeline_value / agreements_created_count).quantize(Decimal("0.01"))
        if agreements_created_count
        else Decimal("0.00")
    )

    return {
        "funnel": {
            "requests_received": request_received_count,
            "bids_submitted": bids_submitted_count,
            "bids_awarded": bids_awarded_count,
            "agreements_created": agreements_created_count,
            "paid_projects": paid_projects_count,
        },
        "conversion_rates": {
            "request_to_bid_rate": _percent_value(bids_submitted_count, request_received_count),
            "bid_to_award_rate": _percent_value(bids_awarded_count, bids_submitted_count),
            "award_to_paid_rate": _percent_value(paid_projects_count, bids_awarded_count),
        },
        "revenue": {
            "total_paid": str(total_paid),
            "total_pipeline_value": str(pipeline_value),
            "average_project_value": str(average_project_value),
        },
    }


def _build_chart_series(contractor, request, start_dt, end_dt):
    bucket_kind, buckets = _chart_buckets(start_dt, end_dt)

    revenue_buckets = OrderedDict(
        (
            bucket_start,
            {
                **meta,
                "revenue": Decimal("0.00"),
            },
        )
        for bucket_start, meta in buckets.items()
    )
    fee_buckets = OrderedDict(
        (
            bucket_start,
            {
                **meta,
                "platform_fee": Decimal("0.00"),
                "estimated_processing_fee": Decimal("0.00"),
                "total_fee": Decimal("0.00"),
            },
        )
        for bucket_start, meta in buckets.items()
    )
    payout_buckets = OrderedDict(
        (
            bucket_start,
            {
                **meta,
                "paid_amount": Decimal("0.00"),
                "ready_amount": Decimal("0.00"),
                "failed_amount": Decimal("0.00"),
                "paid_count": 0,
                "ready_count": 0,
                "failed_count": 0,
            },
        )
        for bucket_start, meta in buckets.items()
    )
    workflow_buckets = OrderedDict(
        (
            bucket_start,
            {
                **meta,
                "overdue_milestones": 0,
            },
        )
        for bucket_start, meta in buckets.items()
    )

    for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
        paid_at = _effective_invoice_paid_at(invoice)
        bucket_start = _bucket_start_for_dt(paid_at, bucket_kind)
        if bucket_start not in revenue_buckets:
            continue

        amount = Decimal(invoice.amount or 0)
        platform_fee = (Decimal(invoice.platform_fee_cents or 0) / Decimal("100")).quantize(Decimal("0.01"))
        processing_fee = Decimal("0.00")
        amount_cents = _amount_to_cents(invoice.amount)
        payout_cents = int(getattr(invoice, "payout_cents", 0) or 0)
        platform_fee_cents = int(getattr(invoice, "platform_fee_cents", 0) or 0)
        if payout_cents > 0 and amount_cents > 0:
            estimated_processing_cents = max(amount_cents - payout_cents - platform_fee_cents, 0)
            processing_fee = (Decimal(estimated_processing_cents) / Decimal("100")).quantize(Decimal("0.01"))

        revenue_buckets[bucket_start]["revenue"] += amount
        fee_buckets[bucket_start]["platform_fee"] += platform_fee
        fee_buckets[bucket_start]["estimated_processing_fee"] += processing_fee
        fee_buckets[bucket_start]["total_fee"] += platform_fee + processing_fee

    payout_request = request._request
    payout_qs = _apply_history_filters(_history_base_queryset(contractor), payout_request)
    filtered_ids = []
    for payout in payout_qs:
        effective_dt = _effective_payout_dt(payout)
        if effective_dt is None:
            continue
        lhs = timezone.make_naive(effective_dt) if timezone.is_aware(effective_dt) else effective_dt
        rhs_from = timezone.make_naive(start_dt) if timezone.is_aware(start_dt) else start_dt
        rhs_to = timezone.make_naive(end_dt) if timezone.is_aware(end_dt) else end_dt
        if lhs < rhs_from or lhs > rhs_to:
            continue
        filtered_ids.append(payout.id)
    payout_qs = payout_qs.filter(id__in=filtered_ids)

    for payout in payout_qs:
        payout_dt = _effective_payout_dt(payout)
        bucket_start = _bucket_start_for_dt(payout_dt, bucket_kind)
        if bucket_start not in payout_buckets:
            continue
        amount = (Decimal(payout.amount_cents or 0) / Decimal("100")).quantize(Decimal("0.01"))
        row = payout_buckets[bucket_start]
        if payout.status == MilestonePayoutStatus.PAID:
            row["paid_amount"] += amount
            row["paid_count"] += 1
        elif payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT:
            row["ready_amount"] += amount
            row["ready_count"] += 1
        elif payout.status == MilestonePayoutStatus.FAILED:
            row["failed_amount"] += amount
            row["failed_count"] += 1

    overdue_qs = Milestone.objects.filter(
        agreement__contractor=contractor,
        completed=False,
        completion_date__isnull=False,
        completion_date__gte=start_dt.date(),
        completion_date__lte=end_dt.date(),
        completion_date__lt=timezone.localdate(),
    )
    for milestone in overdue_qs:
        bucket_start = _bucket_start_for_dt(
            timezone.make_aware(datetime.combine(milestone.completion_date, datetime.min.time())),
            bucket_kind,
        )
        if bucket_start in workflow_buckets:
            workflow_buckets[bucket_start]["overdue_milestones"] += 1

    def serialize_money_series(rows, keys):
        result = []
        for row in rows.values():
            serialized = dict(row)
            for key in keys:
                serialized[key] = str(Decimal(serialized[key]).quantize(Decimal("0.01")))
            result.append(serialized)
        return result

    revenue_series = serialize_money_series(revenue_buckets, ["revenue"])
    fee_series = serialize_money_series(
        fee_buckets,
        ["platform_fee", "estimated_processing_fee", "total_fee"],
    )
    payout_series = serialize_money_series(
        payout_buckets,
        ["paid_amount", "ready_amount", "failed_amount"],
    )
    workflow_series = list(workflow_buckets.values())

    return {
        "bucket": bucket_kind,
        "revenue_series": revenue_series,
        "fee_series": fee_series,
        "payout_series": payout_series,
        "workflow_series": workflow_series,
        "fee_summary": {
            "platform_fee_total": _sum_money_series(fee_series, "platform_fee", Decimal("1")),
            "estimated_processing_fee_total": _sum_money_series(
                fee_series, "estimated_processing_fee", Decimal("1")
            ),
            "total_fee": _sum_money_series(fee_series, "total_fee", Decimal("1")),
        },
        "workflow_summary": {
            "metric": "overdue_milestones",
            "label": "Overdue Milestones",
        },
    }


def _chart_buckets(start_dt, end_dt):
    bucket_kind = _range_bucket_kind(start_dt, end_dt)
    return bucket_kind, _bucket_range(start_dt, end_dt, bucket_kind)


def _parse_bucket_start(value):
    parsed = parse_date(str(value or "").strip())
    return parsed


def _serialize_revenue_drilldown_row(invoice):
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None)
    return {
        "id": invoice.id,
        "invoice_id": invoice.id,
        "record_type": "invoice",
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}".strip(),
        "invoice_number": invoice.invoice_number,
        "milestone_title": invoice.milestone_title_snapshot or "",
        "paid_at": _format_dt(_effective_invoice_paid_at(invoice)),
        "gross_amount": _format_money(invoice.amount),
    }


def _serialize_fee_drilldown_row(invoice):
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None)
    amount_cents = _amount_to_cents(invoice.amount)
    payout_cents = int(getattr(invoice, "payout_cents", 0) or 0)
    platform_fee_cents = int(getattr(invoice, "platform_fee_cents", 0) or 0)
    estimated_processing_cents = 0
    if payout_cents > 0 and amount_cents > 0:
        estimated_processing_cents = max(amount_cents - payout_cents - platform_fee_cents, 0)

    return {
        "id": invoice.id,
        "invoice_id": invoice.id,
        "record_type": "invoice_fee",
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}".strip(),
        "invoice_number": invoice.invoice_number,
        "paid_at": _format_dt(_effective_invoice_paid_at(invoice)),
        "gross_amount": _format_money(invoice.amount),
        "platform_fee": _format_money(Decimal(platform_fee_cents) / Decimal("100")),
        "estimated_processing_fee": _format_money(Decimal(estimated_processing_cents) / Decimal("100")),
    }


def _serialize_fee_project_row(agreement, range_fee_cents, last_fee_activity_at):
    project = getattr(agreement, "project", None)
    collected_total = Decimal(get_collected_platform_fees_for_agreement(getattr(agreement, "id", None)))
    cap_total = Decimal(MAX_PLATFORM_FEE).quantize(Decimal("0.01"))
    remaining_cap = max(cap_total - collected_total, Decimal("0.00")).quantize(Decimal("0.01"))
    total_cost = Decimal(getattr(agreement, "total_cost", 0) or 0).quantize(Decimal("0.01"))

    payment_status = (
        getattr(agreement, "get_status_display", None)() if callable(getattr(agreement, "get_status_display", None)) else getattr(agreement, "status", "")
    )
    payment_mode = getattr(agreement, "payment_mode", "") or ""
    if payment_mode:
        payment_status = f"{payment_status} / {payment_mode.replace('_', ' ')}".strip(" /")

    return {
        "id": agreement.id,
        "agreement_id": agreement.id,
        "project_id": getattr(agreement, "project_id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{agreement.id}",
        "contract_value": _format_money(total_cost),
        "fees_collected_in_range": _format_money(Decimal(range_fee_cents) / Decimal("100")),
        "fees_collected_so_far": _format_money(collected_total),
        "fee_cap": _format_money(cap_total),
        "remaining_cap": _format_money(remaining_cap),
        "payment_status": payment_status or "—",
        "last_fee_activity_at": _format_dt(last_fee_activity_at),
    }


def _serialize_workflow_drilldown_row(milestone):
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None)
    return {
        "id": milestone.id,
        "milestone_id": milestone.id,
        "record_type": "overdue_milestone",
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}".strip(),
        "milestone_title": getattr(milestone, "title", "") or "",
        "completion_date": milestone.completion_date.isoformat() if getattr(milestone, "completion_date", None) else "",
        "subcontractor_completion_status": getattr(milestone, "subcontractor_completion_status", "") or "",
        "amount": _format_money(getattr(milestone, "amount", 0)),
    }


def _chart_detail_payload(chart_type, bucket_kind, bucket_start, records):
    bucket_label = _bucket_label(bucket_start, bucket_kind)
    return {
        "chart_type": chart_type,
        "bucket": bucket_kind,
        "bucket_start": bucket_start.isoformat(),
        "bucket_label": bucket_label,
        "record_count": len(records),
        "records": records,
    }


def _paid_invoice_queryset(contractor, start_dt, end_dt):
    paid_qs = Invoice.objects.select_related("agreement").filter(
        agreement__contractor=contractor,
        status=InvoiceStatus.PAID,
    )

    invoice_ids = []
    for invoice in paid_qs:
        effective_dt = _effective_invoice_paid_at(invoice)
        if effective_dt is None:
            continue
        if effective_dt < start_dt or effective_dt > end_dt:
            continue
        invoice_ids.append(invoice.id)

    return paid_qs.filter(id__in=invoice_ids).order_by("-created_at", "-id")


def _completed_agreements_queryset(contractor, start_dt, end_dt):
    return Agreement.objects.select_related("homeowner").filter(
        contractor=contractor,
        status=ProjectStatus.COMPLETED,
        updated_at__gte=start_dt,
        updated_at__lte=end_dt,
    ).order_by("-updated_at", "-id")


def _build_progress_summary(contractor, end_dt):
    progress_agreements = Agreement.objects.filter(
        contractor=contractor,
        payment_structure="progress",
    )
    contract_value = (
        progress_agreements.aggregate(total=Coalesce(Sum("total_cost"), Decimal("0.00"))).get("total")
        or Decimal("0.00")
    ).quantize(Decimal("0.01"))

    progress_draws = DrawRequest.objects.filter(
        agreement__contractor=contractor,
        agreement__payment_structure="progress",
        created_at__lte=end_dt,
    )
    valid_earned_draws = progress_draws.filter(
        status__in=[
            DrawRequestStatus.APPROVED,
            DrawRequestStatus.AWAITING_RELEASE,
            DrawRequestStatus.RELEASED,
            DrawRequestStatus.PAID,
        ]
    )
    earned_to_date = (
        valid_earned_draws.aggregate(total=Coalesce(Sum("gross_amount"), Decimal("0.00"))).get("total")
        or Decimal("0.00")
    ).quantize(Decimal("0.01"))
    approved_to_date = (
        valid_earned_draws.aggregate(
            total=Coalesce(Sum("gross_amount"), Decimal("0.00"))
        ).get("total")
        or Decimal("0.00")
    ).quantize(Decimal("0.01"))
    retainage_held = (
        valid_earned_draws.aggregate(
            total=Coalesce(Sum("retainage_amount"), Decimal("0.00"))
        ).get("total")
        or Decimal("0.00")
    ).quantize(Decimal("0.01"))

    paid_to_date = (
        ExternalPaymentRecord.objects.filter(
            agreement__contractor=contractor,
            agreement__payment_structure="progress",
            payment_date__lte=end_dt.date(),
            status__in=[ExternalPaymentStatus.RECORDED, ExternalPaymentStatus.VERIFIED],
        ).aggregate(total=Coalesce(Sum("net_amount"), Decimal("0.00"))).get("total")
        or Decimal("0.00")
    ).quantize(Decimal("0.01"))

    remaining_balance = max(contract_value - earned_to_date, Decimal("0.00")).quantize(Decimal("0.01"))

    return {
        "project_count": progress_agreements.count(),
        "contract_value": str(contract_value),
        "earned_to_date": str(earned_to_date),
        "approved_to_date": str(approved_to_date),
        "paid_to_date": str(paid_to_date),
        "retainage_held": str(retainage_held),
        "remaining_balance": str(remaining_balance),
    }


def _record_effective_dt(record):
    return (
        getattr(record, "escrow_released_at", None)
        or getattr(record, "direct_pay_paid_at", None)
        or getattr(record, "paid_at", None)
        or getattr(record, "released_at", None)
        or getattr(record, "updated_at", None)
        or getattr(record, "created_at", None)
    )


def _record_is_paid_like(record) -> bool:
    status = str(getattr(record, "status", "") or "").lower()
    if isinstance(record, Invoice):
        return (
            status == InvoiceStatus.PAID
            or bool(getattr(record, "escrow_released", False))
            or getattr(record, "escrow_released_at", None) is not None
            or getattr(record, "direct_pay_paid_at", None) is not None
        )
    if isinstance(record, DrawRequest):
        return status in {DrawRequestStatus.RELEASED, DrawRequestStatus.PAID} or getattr(record, "paid_at", None) is not None or getattr(record, "released_at", None) is not None
    if isinstance(record, ExpenseRequest):
        return _expense_request_status_is(record, "PAID") or getattr(record, "paid_at", None) is not None
    return False


def _expense_request_status_is(record, *status_names) -> bool:
    status = str(getattr(record, "status", "") or "").lower()
    values = {str(name).lower() for name in status_names}
    status_enum = getattr(ExpenseRequest, "Status", None)
    for name in status_names:
        if status_enum is not None and hasattr(status_enum, name):
            values.add(str(getattr(status_enum, name)).lower())
        if hasattr(ExpenseStatus, name):
            values.add(str(getattr(ExpenseStatus, name)).lower())
    return status in values


def _record_is_pending_release(record) -> bool:
    status = str(getattr(record, "status", "") or "").lower()
    if isinstance(record, Invoice):
        return status == InvoiceStatus.APPROVED and not bool(getattr(record, "escrow_released", False)) and getattr(record, "escrow_released_at", None) is None and getattr(record, "direct_pay_paid_at", None) is None
    if isinstance(record, DrawRequest):
        return status in {DrawRequestStatus.APPROVED, DrawRequestStatus.AWAITING_RELEASE}
    if isinstance(record, ExpenseRequest):
        return _expense_request_status_is(record, "HOMEOWNER_ACCEPTED", "APPROVED")
    return False


def _record_is_on_hold(record) -> bool:
    status = str(getattr(record, "status", "") or "").lower()
    if isinstance(record, Invoice):
        return status == InvoiceStatus.DISPUTED or bool(getattr(record, "disputed", False))
    if isinstance(record, DrawRequest):
        return status in {DrawRequestStatus.REJECTED, DrawRequestStatus.CHANGES_REQUESTED}
    if isinstance(record, ExpenseRequest):
        return _expense_request_status_is(record, "HOMEOWNER_REJECTED", "DISPUTED")
    return False


def _record_gross_cents(record) -> int:
    if isinstance(record, Invoice):
        return _amount_to_cents(getattr(record, "amount", 0))
    if isinstance(record, DrawRequest):
        return _amount_to_cents(getattr(record, "gross_amount", 0))
    if isinstance(record, ExpenseRequest):
        return _amount_to_cents(getattr(record, "amount", 0))
    return 0


def _record_platform_fee_cents(record) -> int:
    if isinstance(record, Invoice):
        return int(getattr(record, "platform_fee_cents", 0) or 0)
    if isinstance(record, DrawRequest):
        return int(getattr(record, "platform_fee_cents", 0) or 0)
    if isinstance(record, ExpenseRequest):
        return int(getattr(record, "platform_fee_cents", 0) or 0)
    return 0


def _record_payout_cents(record) -> int:
    if isinstance(record, Invoice):
        payout_cents = int(getattr(record, "payout_cents", 0) or 0)
        if payout_cents <= 0:
            payout_cents = max(_record_gross_cents(record) - _record_platform_fee_cents(record), 0)
        return payout_cents
    if isinstance(record, DrawRequest):
        payout_cents = int(getattr(record, "payout_cents", 0) or 0)
        if payout_cents <= 0:
            payout_cents = max(_record_gross_cents(record) - _record_platform_fee_cents(record), 0)
        return payout_cents
    if isinstance(record, ExpenseRequest):
        payout_cents = int(getattr(record, "payout_cents", 0) or 0)
        if payout_cents <= 0:
            payout_cents = max(_record_gross_cents(record) - _record_platform_fee_cents(record), 0)
        return payout_cents
    return 0


def _build_financial_summary(contractor, start_dt, end_dt):
    invoice_qs = Invoice.objects.filter(agreement__contractor=contractor).select_related("agreement", "agreement__project")
    draw_qs = DrawRequest.objects.filter(agreement__contractor=contractor).select_related("agreement", "agreement__project")
    expense_qs = ExpenseRequest.objects.filter(agreement__contractor=contractor).select_related("agreement", "agreement__project")

    paid_records = []
    for qs in (invoice_qs, draw_qs, expense_qs):
        for record in qs:
            if not _record_is_paid_like(record):
                continue
            effective_dt = _record_effective_dt(record)
            if effective_dt is None or effective_dt < start_dt or effective_dt > end_dt:
                continue
            paid_records.append(record)

    gross_total_cents = sum(_record_gross_cents(record) for record in paid_records)
    platform_fee_total_cents = sum(_record_platform_fee_cents(record) for record in paid_records)
    net_paid_total_cents = sum(_record_payout_cents(record) for record in paid_records)

    pending_release_records = []
    on_hold_records = []
    for qs in (invoice_qs, draw_qs, expense_qs):
        for record in qs:
            if _record_is_pending_release(record):
                pending_release_records.append(record)
            if _record_is_on_hold(record):
                on_hold_records.append(record)

    pending_release_total_cents = sum(_record_gross_cents(record) for record in pending_release_records)
    on_hold_total_cents = sum(_record_gross_cents(record) for record in on_hold_records)

    return {
        "gross_revenue_total": _format_money(Decimal(gross_total_cents) / Decimal("100")),
        "platform_fees_total": _format_money(Decimal(platform_fee_total_cents) / Decimal("100")),
        "net_paid_total": _format_money(Decimal(net_paid_total_cents) / Decimal("100")),
        "pending_release_total": _format_money(Decimal(pending_release_total_cents) / Decimal("100")),
        "on_hold_total": _format_money(Decimal(on_hold_total_cents) / Decimal("100")),
        "paid_events_count": len(paid_records),
        "pending_release_count": len(pending_release_records),
        "on_hold_count": len(on_hold_records),
        "range_label": f"{start_dt.date().isoformat()} to {end_dt.date().isoformat()}",
    }


def _build_financial_series(contractor, request, start_dt, end_dt):
    bucket_kind, buckets = _chart_buckets(start_dt, end_dt)
    series = OrderedDict(
        (
            bucket_start,
            {
                **meta,
                "gross_revenue": Decimal("0.00"),
                "platform_fees": Decimal("0.00"),
                "net_paid": Decimal("0.00"),
            },
        )
        for bucket_start, meta in buckets.items()
    )

    invoice_qs = _paid_invoice_queryset(contractor, start_dt, end_dt)
    for invoice in invoice_qs:
        bucket_start = _bucket_start_for_dt(_effective_invoice_paid_at(invoice), bucket_kind)
        if bucket_start not in series:
            continue
        series[bucket_start]["gross_revenue"] += Decimal(invoice.amount or 0)
        series[bucket_start]["platform_fees"] += Decimal(invoice.platform_fee_cents or 0) / Decimal("100")
        payout_cents = int(getattr(invoice, "payout_cents", 0) or 0)
        if payout_cents <= 0:
            payout_cents = max(_amount_to_cents(invoice.amount) - int(getattr(invoice, "platform_fee_cents", 0) or 0), 0)
        series[bucket_start]["net_paid"] += Decimal(payout_cents) / Decimal("100")

    draw_qs = DrawRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status__in=[DrawRequestStatus.RELEASED, DrawRequestStatus.PAID],
    )
    for draw in draw_qs:
        effective_dt = _effective_payout_dt(draw)
        if effective_dt is None or effective_dt < start_dt or effective_dt > end_dt:
            continue
        bucket_start = _bucket_start_for_dt(effective_dt, bucket_kind)
        if bucket_start not in series:
            continue
        series[bucket_start]["gross_revenue"] += Decimal(draw.gross_amount or 0)
        series[bucket_start]["platform_fees"] += Decimal(draw.platform_fee_cents or 0) / Decimal("100")
        payout_cents = int(getattr(draw, "payout_cents", 0) or 0)
        if payout_cents <= 0:
            payout_cents = max(_amount_to_cents(draw.gross_amount) - int(getattr(draw, "platform_fee_cents", 0) or 0), 0)
        series[bucket_start]["net_paid"] += Decimal(payout_cents) / Decimal("100")

    expense_qs = ExpenseRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status=ExpenseRequest.Status.PAID,
    )
    for expense in expense_qs:
        effective_dt = getattr(expense, "paid_at", None) or getattr(expense, "updated_at", None)
        if effective_dt is None or effective_dt < start_dt or effective_dt > end_dt:
            continue
        bucket_start = _bucket_start_for_dt(effective_dt, bucket_kind)
        if bucket_start not in series:
            continue
        series[bucket_start]["gross_revenue"] += Decimal(expense.amount or 0)
        series[bucket_start]["platform_fees"] += Decimal(expense.platform_fee_cents or 0) / Decimal("100")
        series[bucket_start]["net_paid"] += Decimal(expense.payout_cents or 0) / Decimal("100")

    def serialize_money_series(rows, keys):
        result = []
        for row in rows.values():
            serialized = dict(row)
            for key in keys:
                serialized[key] = str(Decimal(serialized[key]).quantize(Decimal("0.01")))
            result.append(serialized)
        return result

    financial_series = serialize_money_series(series, ["gross_revenue", "platform_fees", "net_paid"])
    return financial_series


def _build_financial_insights(contractor, summary, project_rows):
    insights = []

    gross = Decimal(summary["gross_revenue_total"] or 0)
    fees = Decimal(summary["platform_fees_total"] or 0)
    net = Decimal(summary["net_paid_total"] or 0)
    pending = Decimal(summary["pending_release_total"] or 0)
    on_hold = Decimal(summary["on_hold_total"] or 0)
    fee_rate = (fees / gross * Decimal("100")) if gross > 0 else Decimal("0")

    if gross > 0:
        insights.append(
            {
                "title": "Revenue mix",
                "explanation": f"Collected revenue totals { _format_money(gross) } with platform fees at {_format_money(fees)} ({fee_rate.quantize(Decimal('0.1'))}%).",
                "severity": "medium" if fee_rate > Decimal("10") else "low",
            }
        )
    if pending > 0:
        insights.append(
            {
                "title": "Cash waiting to move",
                "explanation": f"{_format_money(pending)} is approved or ready to release, so it should turn into paid revenue soon.",
                "severity": "medium",
            }
        )
    if on_hold > 0:
        insights.append(
            {
                "title": "Money on hold",
                "explanation": f"{_format_money(on_hold)} is tied up in disputes or review states and needs follow-up.",
                "severity": "high",
            }
        )
    if project_rows:
        top_project = max(project_rows, key=lambda row: Decimal(row.get("gross_collected", "0") or "0"))
        top_gross = Decimal(top_project.get("gross_collected", 0) or 0)
        if gross > 0 and top_gross / gross >= Decimal("0.4"):
            insights.append(
                {
                    "title": "Revenue concentration",
                    "explanation": f"{top_project.get('agreement_title', 'One project')} is generating a large share of current revenue, so keeping its payments moving matters.",
                    "severity": "medium",
                }
            )

    if net > 0 and fees > 0:
        insights.append(
            {
                "title": "Net paid",
                "explanation": f"You have {_format_money(net)} in net paid funds after {_format_money(fees)} in platform fees.",
                "severity": "low",
            }
        )

    return insights[:4]


def _build_project_financial_rows(contractor):
    agreements = Agreement.objects.select_related("project").filter(contractor=contractor).order_by("project__title", "id")
    rows = []
    for agreement in agreements:
        invoice_qs = Invoice.objects.filter(agreement=agreement)
        draw_qs = DrawRequest.objects.filter(agreement=agreement)
        expense_qs = ExpenseRequest.objects.filter(agreement=agreement)

        gross_cents = 0
        fee_cents = 0
        net_cents = 0
        pending_cents = 0
        hold_cents = 0
        last_activity = None

        for record in list(invoice_qs) + list(draw_qs) + list(expense_qs):
            effective_dt = _record_effective_dt(record)
            if effective_dt and (last_activity is None or effective_dt > last_activity):
                last_activity = effective_dt

            if _record_is_paid_like(record):
                gross_cents += _record_gross_cents(record)
                fee_cents += _record_platform_fee_cents(record)
                net_cents += _record_payout_cents(record)
            if _record_is_pending_release(record):
                pending_cents += _record_gross_cents(record)
            if _record_is_on_hold(record):
                hold_cents += _record_gross_cents(record)

        cap_total = Decimal(MAX_PLATFORM_FEE).quantize(Decimal("0.01"))
        collected_total = Decimal(get_collected_platform_fees_for_agreement(agreement.id)).quantize(Decimal("0.01"))
        remaining_cap = max(cap_total - collected_total, Decimal("0.00")).quantize(Decimal("0.01"))
        total_cents = gross_cents + pending_cents + hold_cents
        if total_cents <= 0 and fee_cents <= 0:
            continue

        status_label = "On Hold" if hold_cents > 0 else "Pending Release" if pending_cents > 0 else "Paid" if gross_cents > 0 else "Active"

        rows.append(
            {
                "id": agreement.id,
                "agreement_id": agreement.id,
                "project_id": getattr(agreement, "project_id", None),
                "agreement_title": getattr(getattr(agreement, "project", None), "title", "") or f"Agreement #{agreement.id}",
                "contract_value": _format_money(Decimal(getattr(agreement, "total_cost", 0) or 0)),
                "gross_collected": _format_money(Decimal(gross_cents) / Decimal("100")),
                "platform_fees": _format_money(Decimal(fee_cents) / Decimal("100")),
                "fees_collected_so_far": _format_money(Decimal(fee_cents) / Decimal("100")),
                "net_paid": _format_money(Decimal(net_cents) / Decimal("100")),
                "fee_cap": _format_money(cap_total),
                "remaining_cap": _format_money(remaining_cap),
                "status": status_label,
                "status_detail": status_label,
                "payment_status": status_label,
                "pending_release": _format_money(Decimal(pending_cents) / Decimal("100")),
                "on_hold": _format_money(Decimal(hold_cents) / Decimal("100")),
                "last_activity_at": _format_dt(last_activity),
                "open_href": f"/app/agreements/{agreement.id}",
            }
        )

    rows.sort(
        key=lambda row: (
            Decimal(row.get("gross_collected", "0") or "0"),
            row.get("last_activity_at") or "",
        ),
        reverse=True,
    )
    return rows


def _build_recent_financial_events(contractor, start_dt, end_dt):
    events = []

    for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
        events.append(
            {
                "id": f"invoice-{invoice.id}",
                "record_type": "Invoice",
                "record_id": invoice.id,
                "agreement_id": getattr(invoice, "agreement_id", None),
                "agreement_title": getattr(getattr(invoice.agreement, "project", None), "title", "") or f"Agreement #{getattr(invoice, 'agreement_id', '')}",
                "source_label": getattr(invoice, "invoice_number", ""),
                "gross_amount": _format_money(invoice.amount),
                "platform_fee": _format_money(Decimal(invoice.platform_fee_cents or 0) / Decimal("100")),
                "net_paid": _format_money(Decimal(_record_payout_cents(invoice)) / Decimal("100")),
                "status": "paid",
                "activity_at": _format_dt(_record_effective_dt(invoice)),
            }
        )

    draw_qs = DrawRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status__in=[DrawRequestStatus.RELEASED, DrawRequestStatus.PAID],
    )
    for draw in draw_qs:
        effective_dt = _effective_payout_dt(draw)
        if effective_dt is None or effective_dt < start_dt or effective_dt > end_dt:
            continue
        events.append(
            {
                "id": f"draw-{draw.id}",
                "record_type": "Draw",
                "record_id": draw.id,
                "agreement_id": getattr(draw, "agreement_id", None),
                "agreement_title": getattr(getattr(draw.agreement, "project", None), "title", "") or f"Agreement #{getattr(draw, 'agreement_id', '')}",
                "source_label": f"Draw #{getattr(draw, 'draw_number', draw.id)}",
                "gross_amount": _format_money(draw.gross_amount),
                "platform_fee": _format_money(Decimal(draw.platform_fee_cents or 0) / Decimal("100")),
                "net_paid": _format_money(Decimal(_record_payout_cents(draw)) / Decimal("100")),
                "status": str(getattr(draw, "status", "")).replace("_", " "),
                "activity_at": _format_dt(effective_dt),
            }
        )

    expense_qs = ExpenseRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status=ExpenseRequest.Status.PAID,
    )
    for expense in expense_qs:
        effective_dt = getattr(expense, "paid_at", None) or getattr(expense, "updated_at", None)
        if effective_dt is None or effective_dt < start_dt or effective_dt > end_dt:
            continue
        events.append(
            {
                "id": f"expense-{expense.id}",
                "record_type": "Expense",
                "record_id": expense.id,
                "agreement_id": getattr(expense, "agreement_id", None),
                "agreement_title": getattr(getattr(expense.agreement, "project", None), "title", "") or f"Agreement #{getattr(expense, 'agreement_id', '')}",
                "source_label": getattr(expense, "description", "") or f"Expense #{expense.id}",
                "gross_amount": _format_money(expense.amount),
                "platform_fee": _format_money(Decimal(expense.platform_fee_cents or 0) / Decimal("100")),
                "net_paid": _format_money(Decimal(expense.payout_cents or 0) / Decimal("100")),
                "status": "paid",
                "activity_at": _format_dt(effective_dt),
            }
        )

    events.sort(key=lambda row: row.get("activity_at") or "", reverse=True)
    return events[:10]


def _build_fee_project_rows(contractor, start_dt, end_dt):
    fee_activity: dict[int, dict] = {}

    def mark_activity(agreement_id, fee_cents, activity_at, status_label):
        if agreement_id is None:
            return
        entry = fee_activity.setdefault(
            int(agreement_id),
            {
                "range_fee_cents": 0,
                "last_fee_activity_at": None,
                "fee_status_label": "",
            },
        )
        entry["range_fee_cents"] += int(fee_cents or 0)
        if activity_at and (
            entry["last_fee_activity_at"] is None or activity_at > entry["last_fee_activity_at"]
        ):
            entry["last_fee_activity_at"] = activity_at
        if status_label:
            entry["fee_status_label"] = status_label

    for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
        activity_at = _effective_invoice_paid_at(invoice)
        mark_activity(
            getattr(invoice, "agreement_id", None),
            int(getattr(invoice, "platform_fee_cents", 0) or 0),
            activity_at,
            "Invoice paid",
        )

    draw_qs = DrawRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status__in=[DrawRequestStatus.PAID, DrawRequestStatus.RELEASED],
    )
    for draw in draw_qs:
        activity_at = getattr(draw, "paid_at", None) or getattr(draw, "released_at", None)
        if activity_at is None or activity_at < start_dt or activity_at > end_dt:
            continue
        mark_activity(
            getattr(draw, "agreement_id", None),
            int(getattr(draw, "platform_fee_cents", 0) or 0),
            activity_at,
            "Draw paid",
        )

    expense_qs = ExpenseRequest.objects.select_related("agreement", "agreement__project").filter(
        agreement__contractor=contractor,
        status=ExpenseRequest.Status.PAID,
    )
    for expense in expense_qs:
        activity_at = getattr(expense, "paid_at", None) or getattr(expense, "updated_at", None)
        if activity_at is None or activity_at < start_dt or activity_at > end_dt:
            continue
        mark_activity(
            getattr(expense, "agreement_id", None),
            int(getattr(expense, "platform_fee_cents", 0) or 0),
            activity_at,
            "Expense paid",
        )

    agreements = (
        Agreement.objects.select_related("project")
        .filter(contractor=contractor)
        .order_by("project__title", "id")
    )
    rows = []
    for agreement in agreements:
        entry = fee_activity.get(agreement.id)
        if not entry:
            continue

        rows.append(
            {
                **_serialize_fee_project_row(
                    agreement,
                    entry["range_fee_cents"],
                    entry["last_fee_activity_at"],
                ),
                "fee_status_label": entry["fee_status_label"] or getattr(agreement, "status", "") or "",
            }
        )

    rows.sort(
        key=lambda row: (
            row.get("last_fee_activity_at") or "",
            row.get("fees_collected_so_far") or "",
            row.get("agreement_title") or "",
        ),
        reverse=True,
    )
    return rows


class _CSVExportBase(APIView):
    permission_classes = [IsAuthenticated]
    filename = "report.csv"
    header = []

    def get_rows(self, contractor, request, start_dt, end_dt):
        raise NotImplementedError

    def get(self, request):
        contractor = _require_contractor(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        start_dt, end_dt = _parse_range(request)
        rows = self.get_rows(contractor, request, start_dt, end_dt)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{self.filename}"'
        writer = csv.writer(response)
        writer.writerow(self.header)
        writer.writerows(rows)
        return response


class BusinessDashboardSummaryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        start_dt, end_dt = _parse_range(request)

        # -------------------------
        # Contractor scope (AUTHORITATIVE)
        # -------------------------
        contractor = _require_contractor(request)
        if contractor is None:
            return Response(
                {"detail": "Contractor profile not found."},
                status=400,
            )

        agreements = Agreement.objects.filter(contractor=contractor)

        # -------------------------
        # Completed vs Active Jobs
        # -------------------------
        completed_qs = agreements.filter(
            status=ProjectStatus.COMPLETED,
            updated_at__gte=start_dt,
            updated_at__lte=end_dt,
        )

        active_qs = agreements.exclude(
            status__in=[ProjectStatus.COMPLETED, ProjectStatus.CANCELLED]
        )

        jobs_completed = completed_qs.count()
        active_jobs = active_qs.count()

        # -------------------------
        # Completion time (days)
        # -------------------------
        durations = []
        for a in completed_qs.only("start", "end"):
            if a.start and a.end:
                durations.append((a.end - a.start).days)

        avg_completion_days = (
            round(sum(durations) / len(durations), 2) if durations else 0.0
        )

        # -------------------------
        # Invoices (scoped THROUGH agreement)
        # -------------------------
        invoices = Invoice.objects.filter(
            agreement__contractor=contractor
        )

        paid_invoices = invoices.filter(
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at__gte=start_dt,
            escrow_released_at__lte=end_dt,
        )

        total_revenue = (
            paid_invoices.aggregate(
                total=Coalesce(Sum("amount"), Decimal("0.00"))
            )["total"]
        ).quantize(Decimal("0.01"))

        avg_revenue_per_job = (
            (total_revenue / jobs_completed).quantize(Decimal("0.01"))
            if jobs_completed
            else Decimal("0.00")
        )

        escrow_pending = (
            invoices.filter(status=InvoiceStatus.APPROVED, escrow_released=False)
            .aggregate(total=Coalesce(Sum("amount"), Decimal("0.00")))["total"]
        ).quantize(Decimal("0.01"))

        # -------------------------
        # Platform fees (cents → dollars)
        # -------------------------
        fee_cents = paid_invoices.aggregate(
            total=Coalesce(Sum("platform_fee_cents"), 0)
        )["total"]

        platform_fees_paid = (
            Decimal(fee_cents) / Decimal("100.00")
        ).quantize(Decimal("0.01"))

        # -------------------------
        # Jobs by Category
        # -------------------------
        category_rows = []

        for row in (
            completed_qs.values("project_type")
            .annotate(
                jobs=Sum(1),
            )
        ):
            cat = row["project_type"] or "Uncategorized"

            cat_agreements = completed_qs.filter(project_type=row["project_type"])

            rev = (
                Invoice.objects.filter(
                    agreement__in=cat_agreements,
                    status=InvoiceStatus.PAID,
                    escrow_released=True,
                ).aggregate(total=Coalesce(Sum("amount"), Decimal("0.00")))["total"]
            ).quantize(Decimal("0.01"))

            durations = []
            for a in cat_agreements.only("start", "end"):
                if a.start and a.end:
                    durations.append((a.end - a.start).days)

            avg_days = (
                round(sum(durations) / len(durations), 2) if durations else 0.0
            )

            avg_rev = (
                (rev / row["jobs"]).quantize(Decimal("0.01"))
                if row["jobs"]
                else Decimal("0.00")
            )

            category_rows.append(
                {
                    "category": cat,
                    "jobs": row["jobs"],
                    "total_revenue": str(rev),
                    "avg_revenue": str(avg_rev),
                    "avg_completion_days": avg_days,
                }
            )

        payload = {
            "snapshot": {
                "jobs_completed": jobs_completed,
                "active_jobs": active_jobs,
                "total_revenue": str(total_revenue),
                "avg_revenue_per_job": str(avg_revenue_per_job),
                "escrow_pending": str(escrow_pending),
                "platform_fees_paid": str(platform_fees_paid),
                "disputes_open": invoices.filter(disputed=True).count(),
                "avg_completion_days": avg_completion_days,
            },
            "business_performance": _build_business_performance_summary(
                contractor, start_dt, end_dt
            ),
            "contractor_insights": build_business_dashboard_contractor_insights(
                contractor,
                start_dt,
                end_dt,
                project_family_key=request.query_params.get("project_family_key", ""),
            ),
            "by_category": category_rows,
            "insights": build_business_insights(contractor, start_dt, end_dt),
            "progress_summary": _build_progress_summary(contractor, end_dt),
            "fee_projects": _build_fee_project_rows(contractor, start_dt, end_dt),
        }
        financial_summary = _build_financial_summary(contractor, start_dt, end_dt)
        project_financials = _build_project_financial_rows(contractor)
        payload.update(
            {
                "financial_summary": financial_summary,
                "financial_series": _build_financial_series(contractor, request, start_dt, end_dt),
                "financial_insights": _build_financial_insights(contractor, financial_summary, project_financials),
                "project_financials": project_financials,
                "recent_financial_events": _build_recent_financial_events(contractor, start_dt, end_dt),
            }
        )
        payload.update(_build_chart_series(contractor, request, start_dt, end_dt))

        return Response(payload)


class BusinessDashboardDrilldownAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _require_contractor(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        chart_type = str(request.query_params.get("chart_type", "") or "").strip().lower()
        bucket_start = _parse_bucket_start(request.query_params.get("bucket_start"))
        if chart_type not in {"revenue", "fees", "payouts", "workflow"}:
            return Response({"detail": "Invalid chart type."}, status=400)
        if bucket_start is None:
            return Response({"detail": "Valid bucket_start is required."}, status=400)

        start_dt, end_dt = _parse_range(request)
        bucket_kind, buckets = _chart_buckets(start_dt, end_dt)
        if bucket_start not in buckets:
            return Response(
                _chart_detail_payload(chart_type, bucket_kind, bucket_start, []),
                status=200,
            )

        if chart_type == "revenue":
            records = []
            for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
                invoice_bucket = _bucket_start_for_dt(_effective_invoice_paid_at(invoice), bucket_kind)
                if invoice_bucket == bucket_start:
                    records.append(_serialize_revenue_drilldown_row(invoice))
            return Response(_chart_detail_payload(chart_type, bucket_kind, bucket_start, records))

        if chart_type == "fees":
            records = []
            for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
                invoice_bucket = _bucket_start_for_dt(_effective_invoice_paid_at(invoice), bucket_kind)
                if invoice_bucket == bucket_start:
                    records.append(_serialize_fee_drilldown_row(invoice))
            return Response(_chart_detail_payload(chart_type, bucket_kind, bucket_start, records))

        if chart_type == "payouts":
            payout_request = request._request
            payout_qs = _apply_history_filters(_history_base_queryset(contractor), payout_request)
            filtered_ids = []
            for payout in payout_qs:
                effective_dt = _effective_payout_dt(payout)
                if effective_dt is None:
                    continue
                lhs = timezone.make_naive(effective_dt) if timezone.is_aware(effective_dt) else effective_dt
                rhs_from = timezone.make_naive(start_dt) if timezone.is_aware(start_dt) else start_dt
                rhs_to = timezone.make_naive(end_dt) if timezone.is_aware(end_dt) else end_dt
                if lhs < rhs_from or lhs > rhs_to:
                    continue
                filtered_ids.append(payout.id)
            payout_qs = payout_qs.filter(id__in=filtered_ids)

            records = []
            for payout in payout_qs:
                payout_bucket = _bucket_start_for_dt(_effective_payout_dt(payout), bucket_kind)
                if payout_bucket == bucket_start:
                    records.append(_serialize_payout_row(payout))
            return Response(_chart_detail_payload(chart_type, bucket_kind, bucket_start, records))

        workflow_qs = Milestone.objects.select_related("agreement", "agreement__project").filter(
            agreement__contractor=contractor,
            completed=False,
            completion_date__isnull=False,
            completion_date__gte=start_dt.date(),
            completion_date__lte=end_dt.date(),
            completion_date__lt=timezone.localdate(),
        ).order_by("completion_date", "id")
        records = []
        for milestone in workflow_qs:
            milestone_bucket = _bucket_start_for_dt(
                timezone.make_aware(datetime.combine(milestone.completion_date, datetime.min.time())),
                bucket_kind,
            )
            if milestone_bucket == bucket_start:
                records.append(_serialize_workflow_drilldown_row(milestone))
        return Response(_chart_detail_payload(chart_type, bucket_kind, bucket_start, records))


class BusinessDashboardRevenueExportView(_CSVExportBase):
    filename = "business-dashboard-revenue.csv"
    header = [
        "agreement",
        "invoice",
        "milestone",
        "project_type",
        "payment_mode",
        "paid_at",
        "gross_amount",
    ]

    def get_rows(self, contractor, request, start_dt, end_dt):
        rows = []
        for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
            agreement = invoice.agreement
            rows.append(
                [
                    getattr(agreement.project, "title", "") or f"Agreement #{agreement.id}",
                    invoice.invoice_number,
                    invoice.milestone_title_snapshot or "",
                    agreement.project_type or "",
                    agreement.payment_mode or "",
                    _format_dt(_effective_invoice_paid_at(invoice)),
                    _format_money(invoice.amount),
                ]
            )
        return rows


class BusinessDashboardFeesExportView(_CSVExportBase):
    filename = "business-dashboard-fees.csv"
    header = [
        "agreement",
        "invoice",
        "project_type",
        "paid_at",
        "gross_amount",
        "platform_fee_amount",
    ]

    def get_rows(self, contractor, request, start_dt, end_dt):
        rows = []
        for invoice in _paid_invoice_queryset(contractor, start_dt, end_dt):
            agreement = invoice.agreement
            rows.append(
                [
                    getattr(agreement.project, "title", "") or f"Agreement #{agreement.id}",
                    invoice.invoice_number,
                    agreement.project_type or "",
                    _format_dt(_effective_invoice_paid_at(invoice)),
                    _format_money(invoice.amount),
                    _format_money(Decimal(invoice.platform_fee_cents or 0) / Decimal("100")),
                ]
            )
        return rows


class BusinessDashboardPayoutsExportView(_CSVExportBase):
    filename = "business-dashboard-subcontractor-payouts.csv"
    header = [
        "agreement",
        "milestone",
        "subcontractor",
        "amount",
        "status",
        "execution_mode",
        "paid_at",
        "failed_at",
        "transfer_id",
        "failure_reason",
    ]

    def get_rows(self, contractor, request, start_dt, end_dt):
        from django.utils import timezone as dj_timezone

        payout_request = request._request
        qs = _apply_history_filters(_history_base_queryset(contractor), payout_request)
        filtered_ids = []
        for payout in qs:
            effective_dt = payout.paid_at if payout.status == "paid" else payout.updated_at
            if effective_dt is None:
                continue
            lhs = (
                dj_timezone.make_naive(effective_dt)
                if dj_timezone.is_aware(effective_dt)
                else effective_dt
            )
            rhs_from = (
                dj_timezone.make_naive(start_dt)
                if dj_timezone.is_aware(start_dt)
                else start_dt
            )
            rhs_to = (
                dj_timezone.make_naive(end_dt)
                if dj_timezone.is_aware(end_dt)
                else end_dt
            )
            if lhs < rhs_from or lhs > rhs_to:
                continue
            filtered_ids.append(payout.id)
        qs = qs.filter(id__in=filtered_ids)
        rows = []
        for payout in qs:
            row = _serialize_payout_row(payout)
            rows.append(
                [
                    row["agreement_title"],
                    row["milestone_title"],
                    row["subcontractor_display_name"] or row["subcontractor_email"],
                    row["payout_amount"],
                    row["payout_status"],
                    row["execution_mode"],
                    row["paid_at"] or "",
                    row["failed_at"] or "",
                    row["stripe_transfer_id"],
                    row["failure_reason"],
                ]
            )
        return rows


class BusinessDashboardCompletedJobsExportView(_CSVExportBase):
    filename = "business-dashboard-completed-jobs.csv"
    header = [
        "agreement",
        "customer",
        "project_type",
        "project_subtype",
        "status",
        "start_date",
        "end_date",
        "completion_days",
        "total_cost",
    ]

    def get_rows(self, contractor, request, start_dt, end_dt):
        rows = []
        for agreement in _completed_agreements_queryset(contractor, start_dt, end_dt):
            completion_days = ""
            if agreement.start and agreement.end:
                completion_days = (agreement.end - agreement.start).days
            rows.append(
                [
                    getattr(agreement.project, "title", "") or f"Agreement #{agreement.id}",
                    getattr(getattr(agreement, "homeowner", None), "full_name", "") or "",
                    agreement.project_type or "",
                    agreement.project_subtype or "",
                    agreement.status or "",
                    agreement.start.isoformat() if agreement.start else "",
                    agreement.end.isoformat() if agreement.end else "",
                    completion_days,
                    _format_money(agreement.total_cost),
                ]
            )
        return rows
