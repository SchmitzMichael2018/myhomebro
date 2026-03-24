# backend/projects/views/business_dashboard.py

import csv
from datetime import timedelta, datetime, date
from decimal import Decimal

from django.http import HttpResponse
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Agreement, Invoice, Contractor, ProjectStatus
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


def _effective_invoice_paid_at(invoice):
    return (
        getattr(invoice, "escrow_released_at", None)
        or getattr(invoice, "direct_pay_paid_at", None)
        or getattr(invoice, "approved_at", None)
        or getattr(invoice, "created_at", None)
    )


def _paid_invoice_queryset(contractor, start_dt, end_dt):
    paid_qs = Invoice.objects.select_related("agreement").filter(
        agreement__contractor=contractor,
        status="paid",
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
            status="paid",
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
            invoices.filter(status="approved", escrow_released=False)
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
                    status="paid",
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
        }

        return Response(payload)


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
