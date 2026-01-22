# backend/projects/views/business_dashboard.py

from datetime import timedelta, datetime, date
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Agreement, Invoice, Contractor, ProjectStatus


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


class BusinessDashboardSummaryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        start_dt, end_dt = _parse_range(request)

        # -------------------------
        # Contractor scope (AUTHORITATIVE)
        # -------------------------
        try:
            contractor = request.user.contractor_profile
        except Contractor.DoesNotExist:
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
