# backend/projects/views/business_dashboard.py

import csv
from collections import OrderedDict
from datetime import timedelta, datetime, date
from decimal import Decimal

from django.http import HttpResponse
from django.db.models import Sum
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
    Invoice,
    InvoiceStatus,
    Milestone,
    MilestonePayoutStatus,
    ProjectStatus,
)
from projects.services.business_insights import build_business_insights
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
            "by_category": category_rows,
            "insights": build_business_insights(contractor, start_dt, end_dt),
            "progress_summary": _build_progress_summary(contractor, end_dt),
        }
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
