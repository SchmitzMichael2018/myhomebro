from __future__ import annotations

from decimal import Decimal

from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    AgreementProjectClass,
    DrawRequest,
    DrawRequestStatus,
    Invoice,
    InvoiceStatus,
)
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


def _normalize_project_class(value) -> str:
    normalized = str(value or "").strip().lower()
    return (
        AgreementProjectClass.COMMERCIAL
        if normalized == AgreementProjectClass.COMMERCIAL
        else AgreementProjectClass.RESIDENTIAL
    )


def _money_cents(value) -> int:
    try:
        return int((Decimal(str(value or 0)) * Decimal("100")).quantize(Decimal("1")))
    except Exception:
        return 0


def _money_from_cents(cents) -> str:
    return str((Decimal(int(cents or 0)) / Decimal("100")).quantize(Decimal("0.01")))


def _display_agreement_title(agreement) -> str:
    project = getattr(agreement, "project", None)
    title = getattr(project, "title", "") or ""
    if title:
        return title
    agreement_id = getattr(agreement, "id", None)
    return f"Agreement #{agreement_id}" if agreement_id else "Agreement"


def _transfer_reference(*values) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _effective_invoice_dt(invoice):
    return (
        getattr(invoice, "escrow_released_at", None)
        or getattr(invoice, "direct_pay_paid_at", None)
        or getattr(invoice, "approved_at", None)
        or getattr(invoice, "updated_at", None)
        or getattr(invoice, "created_at", None)
    )


def _effective_draw_dt(draw):
    return (
        getattr(draw, "transfer_created_at", None)
        or getattr(draw, "released_at", None)
        or getattr(draw, "paid_at", None)
        or getattr(draw, "updated_at", None)
        or getattr(draw, "created_at", None)
    )


def _invoice_queryset(contractor):
    return (
        Invoice.objects.select_related("agreement", "agreement__project")
        .filter(agreement__contractor=contractor)
        .filter(
            Q(status=InvoiceStatus.PAID)
            | Q(escrow_released=True)
            | Q(escrow_released_at__isnull=False)
            | Q(direct_pay_paid_at__isnull=False)
            | ~Q(stripe_transfer_id="")
        )
        .order_by("-escrow_released_at", "-direct_pay_paid_at", "-approved_at", "-created_at", "-id")
    )


def _draw_queryset(contractor):
    return (
        DrawRequest.objects.select_related("agreement", "agreement__project")
        .filter(agreement__contractor=contractor)
        .filter(
            Q(status__in=[DrawRequestStatus.PAID, DrawRequestStatus.RELEASED])
            | Q(paid_at__isnull=False)
            | Q(released_at__isnull=False)
            | ~Q(stripe_transfer_id="")
        )
        .order_by("-updated_at", "-created_at", "-id")
    )


def _serialize_invoice_row(invoice) -> dict:
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None)
    gross_cents = _money_cents(getattr(invoice, "amount", 0))
    platform_fee_cents = int(getattr(invoice, "platform_fee_cents", 0) or 0)
    payout_cents = int(getattr(invoice, "payout_cents", 0) or 0)
    if payout_cents <= 0 and gross_cents > 0:
        payout_cents = max(gross_cents - platform_fee_cents, 0)

    payout_dt = _effective_invoice_dt(invoice)
    transfer_ref = _transfer_reference(
        getattr(invoice, "stripe_transfer_id", ""),
        getattr(invoice, "direct_pay_payment_intent_id", ""),
        getattr(invoice, "direct_pay_checkout_session_id", ""),
    )
    notes = (
        "Escrow released"
        if getattr(invoice, "escrow_released", False) or getattr(invoice, "escrow_released_at", None)
        else "Direct pay completed"
        if getattr(invoice, "direct_pay_paid_at", None)
        else "Paid"
    )

    project_class = _normalize_project_class(
        getattr(agreement, "project_class", None) or getattr(project, "project_class", None)
    )

    return {
        "id": f"invoice-{invoice.id}",
        "record_id": invoice.id,
        "record_type": "invoice",
        "record_type_label": "Invoice",
        "payout_date": payout_dt.isoformat() if payout_dt else None,
        "agreement_id": getattr(agreement, "id", None),
        "agreement_label": _display_agreement_title(agreement),
        "agreement_reference": f"Agreement #{getattr(agreement, 'id', '')}" if getattr(agreement, "id", None) else "",
        "project_id": getattr(project, "id", None),
        "project_title": getattr(project, "title", "") or "",
        "project_class": project_class,
        "project_class_label": "Commercial" if project_class == AgreementProjectClass.COMMERCIAL else "Residential",
        "source_label": getattr(invoice, "invoice_number", "") or f"Invoice #{invoice.id}",
        "gross_amount": _money_from_cents(gross_cents),
        "gross_released_amount": _money_from_cents(gross_cents),
        "platform_fee": _money_from_cents(platform_fee_cents),
        "net_payout": _money_from_cents(payout_cents),
        "transfer_ref": transfer_ref,
        "status": "paid",
        "status_label": "Paid",
        "notes": notes,
        "stripe_transfer_id": getattr(invoice, "stripe_transfer_id", "") or "",
        "platform_fee_cents": platform_fee_cents,
        "payout_cents": payout_cents,
        "gross_released_cents": gross_cents,
        "paid_at": getattr(invoice, "direct_pay_paid_at", None).isoformat()
        if getattr(invoice, "direct_pay_paid_at", None)
        else None,
        "released_at": getattr(invoice, "escrow_released_at", None).isoformat()
        if getattr(invoice, "escrow_released_at", None)
        else None,
        "transfer_created_at": None,
        "_sort_dt": payout_dt,
    }


def _serialize_draw_row(draw) -> dict:
    agreement = getattr(draw, "agreement", None)
    project = getattr(agreement, "project", None)
    gross_cents = _money_cents(getattr(draw, "gross_amount", 0))
    platform_fee_cents = int(getattr(draw, "platform_fee_cents", 0) or 0)
    payout_cents = int(getattr(draw, "payout_cents", 0) or 0)
    if payout_cents <= 0 and gross_cents > 0:
        payout_cents = max(gross_cents - platform_fee_cents, 0)

    payout_dt = _effective_draw_dt(draw)
    transfer_ref = _transfer_reference(getattr(draw, "stripe_transfer_id", ""))
    notes = "Released to contractor" if getattr(draw, "released_at", None) or transfer_ref else "Paid"

    project_class = _normalize_project_class(
        getattr(agreement, "project_class", None) or getattr(project, "project_class", None)
    )

    return {
        "id": f"draw-{draw.id}",
        "record_id": draw.id,
        "record_type": "draw_request",
        "record_type_label": "Draw",
        "payout_date": payout_dt.isoformat() if payout_dt else None,
        "agreement_id": getattr(agreement, "id", None),
        "agreement_label": _display_agreement_title(agreement),
        "agreement_reference": f"Agreement #{getattr(agreement, 'id', '')}" if getattr(agreement, "id", None) else "",
        "project_id": getattr(project, "id", None),
        "project_title": getattr(project, "title", "") or "",
        "project_class": project_class,
        "project_class_label": "Commercial" if project_class == AgreementProjectClass.COMMERCIAL else "Residential",
        "source_label": f"Draw #{getattr(draw, 'draw_number', draw.id)}",
        "gross_amount": _money_from_cents(gross_cents),
        "gross_released_amount": _money_from_cents(gross_cents),
        "platform_fee": _money_from_cents(platform_fee_cents),
        "net_payout": _money_from_cents(payout_cents),
        "transfer_ref": transfer_ref,
        "status": "paid",
        "status_label": "Paid",
        "notes": notes,
        "stripe_transfer_id": transfer_ref,
        "platform_fee_cents": platform_fee_cents,
        "payout_cents": payout_cents,
        "gross_released_cents": gross_cents,
        "paid_at": getattr(draw, "paid_at", None).isoformat() if getattr(draw, "paid_at", None) else None,
        "released_at": getattr(draw, "released_at", None).isoformat() if getattr(draw, "released_at", None) else None,
        "transfer_created_at": getattr(draw, "transfer_created_at", None).isoformat()
        if getattr(draw, "transfer_created_at", None)
        else None,
        "_sort_dt": payout_dt,
    }


def _apply_filters(rows, request):
    project_class = str(request.GET.get("project_class", "") or "").strip().lower()
    record_type = str(request.GET.get("record_type", "") or "").strip().lower()
    date_from = _parse_filter_dt(request.GET.get("date_from"))
    date_to = _parse_filter_dt(request.GET.get("date_to"))

    filtered = []
    for row in rows:
        if project_class and project_class != "all" and row.get("project_class") != project_class:
            continue
        if record_type and record_type != "all" and row.get("record_type") != record_type:
            continue

        row_dt = row.get("_sort_dt")
        if row_dt is not None and (date_from is not None or date_to is not None):
            from django.utils import timezone

            lhs = timezone.make_naive(row_dt) if timezone.is_aware(row_dt) else row_dt
            rhs_from = timezone.make_naive(date_from) if (date_from is not None and timezone.is_aware(date_from)) else date_from
            rhs_to = timezone.make_naive(date_to) if (date_to is not None and timezone.is_aware(date_to)) else date_to
            if rhs_from is not None and lhs < rhs_from:
                continue
            if rhs_to is not None and lhs > rhs_to:
                continue

        filtered.append(row)

    filtered.sort(key=lambda row: row.get("_sort_dt") or 0, reverse=True)
    return filtered


def _build_summary(rows) -> dict:
    total_paid_out = 0
    total_platform_fees = 0
    total_gross_released = 0
    invoice_count = 0
    draw_count = 0

    for row in rows:
        total_paid_out += int(row.get("payout_cents", 0) or 0)
        total_platform_fees += int(row.get("platform_fee_cents", 0) or 0)
        total_gross_released += int(row.get("gross_released_cents", 0) or 0)
        if row.get("record_type") == "invoice":
            invoice_count += 1
        elif row.get("record_type") == "draw_request":
            draw_count += 1

    return {
        "total_paid_out": _money_from_cents(total_paid_out),
        "total_platform_fees_retained": _money_from_cents(total_platform_fees),
        "total_gross_released": _money_from_cents(total_gross_released),
        "payout_count": len(rows),
        "invoice_count": invoice_count,
        "draw_count": draw_count,
    }


class ContractorPayoutHistoryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = _require_contractor_owner(request.user)
        if contractor is None:
            return Response(
                {"detail": "Only contractor owners can view payout history."},
                status=status.HTTP_403_FORBIDDEN,
            )

        rows = []
        for invoice in _invoice_queryset(contractor):
            rows.append(_serialize_invoice_row(invoice))
        for draw in _draw_queryset(contractor):
            rows.append(_serialize_draw_row(draw))

        rows = _apply_filters(rows, request)
        for row in rows:
            row.pop("_sort_dt", None)

        return Response(
            {
                "results": rows,
                "summary": _build_summary(rows),
                "filters": {
                    "project_class": str(request.GET.get("project_class", "") or "all"),
                    "record_type": str(request.GET.get("record_type", "") or "all"),
                },
            },
            status=status.HTTP_200_OK,
        )
