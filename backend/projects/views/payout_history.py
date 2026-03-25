from __future__ import annotations

import csv
from decimal import Decimal

from django.http import HttpResponse
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import MilestonePayout, MilestonePayoutStatus
from projects.utils.accounts import get_contractor_for_user


def _require_contractor_owner(user):
    contractor = get_contractor_for_user(user)
    if contractor is None or getattr(contractor, "user_id", None) != getattr(user, "id", None):
        return None
    return contractor


def _parse_filter_dt(value):
    if not value:
        return None
    dt = parse_datetime(str(value))
    if dt is not None:
        return dt
    d = parse_date(str(value))
    if d is not None:
        from django.utils import timezone

        return timezone.make_aware(timezone.datetime.combine(d, timezone.datetime.min.time()))
    return None


def _display_name(user):
    if user is None:
        return ""
    full_name = getattr(user, "get_full_name", lambda: "")() or ""
    return full_name or getattr(user, "email", "") or ""


def _history_base_queryset(contractor):
    return (
        MilestonePayout.objects.select_related(
            "milestone",
            "milestone__agreement",
            "milestone__agreement__project",
            "subcontractor_user",
        )
        .filter(milestone__agreement__project__contractor=contractor)
        .order_by("-updated_at", "-id")
    )


def _apply_history_filters(qs, request):
    from django.utils import timezone

    status_value = str(request.GET.get("status", "") or "").strip().lower()
    if status_value:
        qs = qs.filter(status=status_value)

    agreement_id = request.GET.get("agreement_id")
    if agreement_id:
        qs = qs.filter(milestone__agreement_id=agreement_id)

    subcontractor_value = str(request.GET.get("subcontractor_user", "") or "").strip()
    if subcontractor_value:
        if subcontractor_value.isdigit():
            qs = qs.filter(subcontractor_user_id=int(subcontractor_value))
        else:
            qs = qs.filter(subcontractor_user__email__icontains=subcontractor_value)

    date_from = _parse_filter_dt(request.GET.get("date_from"))
    date_to = _parse_filter_dt(request.GET.get("date_to"))

    # Filtering uses paid_at for paid records and updated_at for all other statuses,
    # so date ranges match actual payout dates when available and operational changes otherwise.
    if date_from is not None or date_to is not None:
        filtered_ids = []
        for payout in qs:
            effective_dt = payout.paid_at if payout.status == MilestonePayoutStatus.PAID else payout.updated_at
            if effective_dt is None:
                continue
            lhs = timezone.make_naive(effective_dt) if timezone.is_aware(effective_dt) else effective_dt
            rhs_from = timezone.make_naive(date_from) if (date_from is not None and timezone.is_aware(date_from)) else date_from
            rhs_to = timezone.make_naive(date_to) if (date_to is not None and timezone.is_aware(date_to)) else date_to
            if rhs_from is not None and lhs < rhs_from:
                continue
            if rhs_to is not None and lhs > rhs_to:
                continue
            filtered_ids.append(payout.id)
        qs = qs.filter(id__in=filtered_ids)

    return qs


def _serialize_payout_row(payout: MilestonePayout) -> dict:
    milestone = getattr(payout, "milestone", None)
    agreement = getattr(milestone, "agreement", None) if milestone is not None else None
    project = getattr(agreement, "project", None) if agreement is not None else None
    subcontractor = getattr(payout, "subcontractor_user", None)

    return {
        "id": payout.id,
        "payout_id": payout.id,
        "milestone_id": getattr(milestone, "id", None),
        "milestone_title": getattr(milestone, "title", "") or "",
        "agreement_id": getattr(agreement, "id", None),
        "agreement_title": getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}".strip(),
        "subcontractor_user_id": getattr(subcontractor, "id", None),
        "subcontractor_display_name": _display_name(subcontractor),
        "subcontractor_email": getattr(subcontractor, "email", "") or "",
        "payout_amount": f"{Decimal(payout.amount_cents) / Decimal('100'):.2f}",
        "payout_amount_cents": payout.amount_cents,
        "payout_status": payout.status,
        "eligible_at": payout.eligible_at,
        "ready_for_payout_at": payout.ready_for_payout_at,
        "paid_at": payout.paid_at,
        "failed_at": payout.failed_at,
        "stripe_transfer_id": payout.stripe_transfer_id or "",
        "failure_reason": payout.failure_reason or "",
        "execution_mode": payout.execution_mode or "",
        "created_at": payout.created_at,
        "updated_at": payout.updated_at,
    }


def _serialize_payout_detail(payout: MilestonePayout) -> dict:
    row = _serialize_payout_row(payout)
    row["effective_at"] = (
        row.get("paid_at")
        or row.get("failed_at")
        or row.get("ready_for_payout_at")
        or row.get("updated_at")
    )
    return row


def _build_summary(qs) -> dict:
    total_paid = 0
    total_ready = 0
    total_failed = 0
    total_pending = 0
    count = 0

    for payout in qs:
        count += 1
        amount = int(getattr(payout, "amount_cents", 0) or 0)
        if payout.status == MilestonePayoutStatus.PAID:
            total_paid += amount
        elif payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT:
            total_ready += amount
        elif payout.status == MilestonePayoutStatus.FAILED:
            total_failed += amount
        else:
            total_pending += amount

    def as_money(cents):
        return f"{Decimal(cents) / Decimal('100'):.2f}"

    return {
        "total_paid_amount": as_money(total_paid),
        "total_ready_amount": as_money(total_ready),
        "total_failed_amount": as_money(total_failed),
        "total_pending_amount": as_money(total_pending),
        "record_count": count,
    }


class ContractorPayoutHistoryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = _require_contractor_owner(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can view payout history."}, status=status.HTTP_403_FORBIDDEN)

        qs = _apply_history_filters(_history_base_queryset(contractor), request)
        rows = [_serialize_payout_row(payout) for payout in qs]
        return Response(
            {
                "results": rows,
                "summary": _build_summary(qs),
            },
            status=status.HTTP_200_OK,
        )


class ContractorPayoutHistoryExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = _require_contractor_owner(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can export payout history."}, status=status.HTTP_403_FORBIDDEN)

        qs = _apply_history_filters(_history_base_queryset(contractor), request)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="payout-history.csv"'

        writer = csv.writer(response)
        writer.writerow(
            [
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
        )
        for payout in qs:
            row = _serialize_payout_row(payout)
            writer.writerow(
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

        return response


class ContractorPayoutDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, payout_id: int):
        contractor = _require_contractor_owner(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can view payout detail."}, status=status.HTTP_403_FORBIDDEN)

        payout = _history_base_queryset(contractor).filter(id=payout_id).first()
        if payout is None:
            return Response({"detail": "Payout record not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(_serialize_payout_detail(payout), status=status.HTTP_200_OK)
