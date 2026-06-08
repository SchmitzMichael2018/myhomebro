from __future__ import annotations

from decimal import Decimal

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsAdminUserRole
from projects.models import ExpenseRequest
from projects.services.escrow_reimbursements import (
    agreement_has_escrow_hold,
    clear_reimbursement_hold,
    clear_reimbursement_release_error,
    escrow_ledger,
    place_reimbursement_hold,
    record_manual_reimbursement_release,
    release_reimbursement_transfer,
    serialize_ledger,
)


def _money(value) -> str:
    try:
        return f"{Decimal(str(value or '0')).quantize(Decimal('0.01')):.2f}"
    except Exception:
        return "0.00"


def _absolute_url(request, file_field) -> str:
    if not file_field or not hasattr(file_field, "url"):
        return ""
    try:
        return request.build_absolute_uri(file_field.url)
    except Exception:
        return str(file_field.url or "")


def _first_attachment(expense: ExpenseRequest, request) -> dict:
    attachment = expense.attachments.order_by("-uploaded_at", "-id").first()
    if not attachment:
        return {}
    return {
        "id": attachment.id,
        "name": attachment.original_name or f"Attachment #{attachment.id}",
        "url": _absolute_url(request, attachment.file),
        "uploaded_at": attachment.uploaded_at,
    }


def _reimbursement_queryset():
    return (
        ExpenseRequest.objects.filter(
            request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
            is_archived=False,
        )
        .select_related("agreement", "agreement__project", "agreement__contractor", "agreement__homeowner", "milestone")
        .prefetch_related("attachments")
        .order_by("-approved_at", "-submitted_at", "-created_at", "-id")
    )


def _current_ledger(expense: ExpenseRequest, *, exclude_reimbursement: bool = False) -> dict:
    agreement = expense.agreement
    if not agreement:
        return {}
    return escrow_ledger(agreement, exclude_reimbursement_id=expense.id if exclude_reimbursement else None)


def _release_blockers(expense: ExpenseRequest, ledger: dict | None = None) -> list[str]:
    blockers: list[str] = []
    if expense.status == ExpenseRequest.Status.RELEASED or expense.released_at:
        blockers.append("Already released.")
    if expense.status == ExpenseRequest.Status.HELD:
        blockers.append("Admin hold is active.")
    if expense.status not in {
        ExpenseRequest.Status.PENDING_RELEASE,
        ExpenseRequest.Status.APPROVED,
        ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
    }:
        blockers.append("Not approved for release.")
    if expense.agreement and agreement_has_escrow_hold(expense.agreement):
        blockers.append("Agreement escrow is frozen by an active dispute.")
    contractor = getattr(getattr(expense, "agreement", None), "contractor", None)
    if contractor is not None:
        if getattr(contractor, "stripe_deauthorized_at", None):
            blockers.append("Contractor Stripe account is disconnected.")
        elif not str(getattr(contractor, "stripe_account_id", "") or "").startswith("acct_"):
            blockers.append("Contractor is not connected to Stripe.")
        elif not bool(getattr(contractor, "charges_enabled", False)):
            blockers.append("Contractor Stripe account is not charges-enabled.")
        elif not bool(getattr(contractor, "payouts_enabled", False)):
            blockers.append("Contractor Stripe account is not payouts-enabled.")
        elif not bool(getattr(contractor, "details_submitted", False)):
            blockers.append("Contractor Stripe account setup is incomplete.")
        elif int(getattr(contractor, "requirements_due_count", 0) or 0) > 0:
            blockers.append("Contractor Stripe account has outstanding requirements.")
    ledger = ledger if ledger is not None else _current_ledger(expense, exclude_reimbursement=True)
    try:
        available = Decimal(str(ledger.get("available") or "0"))
    except Exception:
        available = Decimal("0")
    if available < Decimal(str(expense.amount or "0")):
        blockers.append("Current escrow availability is insufficient.")
    return blockers


def _row(expense: ExpenseRequest, request, *, include_detail: bool = False) -> dict:
    agreement = expense.agreement
    project = getattr(agreement, "project", None) if agreement else None
    contractor = getattr(agreement, "contractor", None) if agreement else None
    homeowner = getattr(agreement, "homeowner", None) if agreement else None
    ledger = _current_ledger(expense)
    release_ledger = _current_ledger(expense, exclude_reimbursement=True)
    blockers = _release_blockers(expense, release_ledger)
    attachment = _first_attachment(expense, request)
    receipt_url = _absolute_url(request, expense.receipt)
    payload = {
        "id": expense.id,
        "agreement_id": getattr(agreement, "id", None),
        "project_id": getattr(project, "id", None),
        "project_title": getattr(project, "title", "") or getattr(agreement, "project_title", "") or f"Agreement #{getattr(agreement, 'id', '')}",
        "contractor": {
            "id": getattr(contractor, "id", None),
            "name": getattr(contractor, "business_name", "") or getattr(getattr(contractor, "user", None), "email", "") or "Contractor",
        },
        "customer": {
            "id": getattr(homeowner, "id", None),
            "name": getattr(homeowner, "full_name", "") or "Customer",
            "email": getattr(homeowner, "email", ""),
        },
        "amount": _money(expense.amount),
        "category": expense.category,
        "category_label": expense.get_category_display(),
        "milestone": {
            "id": getattr(expense.milestone, "id", None),
            "title": getattr(expense.milestone, "title", ""),
        } if expense.milestone_id else None,
        "status": expense.status,
        "status_label": expense.get_status_display(),
        "submitted_at": expense.submitted_at,
        "approved_at": expense.approved_at,
        "denied_at": expense.denied_at,
        "released_at": expense.released_at,
        "receipt_url": receipt_url,
        "proof": attachment,
        "available_escrow_at_approval": _money(expense.available_escrow_at_approval),
        "current_ledger": serialize_ledger(ledger) if ledger else None,
        "stripe_transfer_id": expense.stripe_transfer_id,
        "release_error": expense.release_error,
        "hold_reason": expense.hold_reason,
        "held_at": expense.held_at,
        "hold_cleared_at": expense.hold_cleared_at,
        "has_dispute_hold": bool(agreement and agreement_has_escrow_hold(agreement)),
        "release_blockers": blockers,
        "can_release": not blockers,
    }
    if include_detail:
        payload.update(
            {
                "description": expense.description,
                "notes_to_homeowner": expense.notes_to_homeowner,
                "created_at": expense.created_at,
                "updated_at": expense.updated_at,
                "customer_acted_at": expense.homeowner_acted_at,
                "denial_reason": expense.denial_reason,
                "attachments": [
                    {
                        "id": attachment.id,
                        "name": attachment.original_name or f"Attachment #{attachment.id}",
                        "url": _absolute_url(request, attachment.file),
                        "uploaded_at": attachment.uploaded_at,
                    }
                    for attachment in expense.attachments.order_by("-uploaded_at", "-id")
                ],
                "ledger_breakdown": serialize_ledger(ledger) if ledger else None,
            }
        )
    return payload


def _apply_filters(qs, request):
    state_filter = (request.query_params.get("status") or "").strip()
    if state_filter == "pending_review":
        qs = qs.filter(status__in=[ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER])
    elif state_filter == "pending_release":
        qs = qs.filter(status__in=[ExpenseRequest.Status.PENDING_RELEASE, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.HOMEOWNER_ACCEPTED])
    elif state_filter == "released":
        qs = qs.filter(Q(status=ExpenseRequest.Status.RELEASED) | Q(released_at__isnull=False))
    elif state_filter == "denied":
        qs = qs.filter(status=ExpenseRequest.Status.DENIED)
    elif state_filter == "failed_release":
        qs = qs.exclude(release_error="")
    elif state_filter in {"blocked", "held"}:
        qs = qs.filter(status=ExpenseRequest.Status.HELD)
    elif state_filter:
        qs = qs.filter(status=state_filter)

    contractor = (request.query_params.get("contractor") or "").strip()
    if contractor:
        qs = qs.filter(Q(agreement__contractor__business_name__icontains=contractor) | Q(agreement__contractor__user__email__icontains=contractor))

    project = (request.query_params.get("project") or request.query_params.get("agreement") or "").strip()
    if project:
        project_q = Q(agreement__project__title__icontains=project)
        if project.isdigit():
            project_q |= Q(agreement_id=int(project))
        qs = qs.filter(project_q)

    date_from = parse_date((request.query_params.get("date_from") or "").strip())
    date_to = parse_date((request.query_params.get("date_to") or "").strip())
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    return qs


class AdminReimbursements(APIView):
    permission_classes = [IsAdminUserRole]

    def get(self, request):
        qs = _apply_filters(_reimbursement_queryset(), request)
        rows = [_row(expense, request) for expense in qs[:200]]
        summary = {
            "pending_review": qs.filter(status__in=[ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER]).count(),
            "pending_release": qs.filter(status__in=[ExpenseRequest.Status.PENDING_RELEASE, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.HOMEOWNER_ACCEPTED]).count(),
            "held": qs.filter(status=ExpenseRequest.Status.HELD).count(),
            "released": qs.filter(Q(status=ExpenseRequest.Status.RELEASED) | Q(released_at__isnull=False)).count(),
            "denied": qs.filter(status=ExpenseRequest.Status.DENIED).count(),
            "failed_release": qs.exclude(release_error="").count(),
        }
        return Response({"summary": summary, "results": rows}, status=status.HTTP_200_OK)


class AdminReimbursementDetail(APIView):
    permission_classes = [IsAdminUserRole]

    def get(self, request, reimbursement_id: int):
        expense = get_object_or_404(_reimbursement_queryset(), pk=reimbursement_id)
        return Response(_row(expense, request, include_detail=True), status=status.HTTP_200_OK)


class AdminReimbursementRecordRelease(APIView):
    permission_classes = [IsAdminUserRole]

    def post(self, request, reimbursement_id: int):
        expense = get_object_or_404(_reimbursement_queryset(), pk=reimbursement_id)
        try:
            updated = record_manual_reimbursement_release(
                expense,
                reviewed_by=request.user,
                stripe_transfer_id=(request.data.get("stripe_transfer_id") or request.data.get("reference") or "").strip(),
            )
        except ValueError as exc:
            ExpenseRequest.objects.filter(pk=expense.pk).update(release_error=str(exc))
            expense.refresh_from_db()
            return Response({"detail": str(exc), "reimbursement": _row(expense, request, include_detail=True)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Manual release recorded.", "reimbursement": _row(updated, request, include_detail=True)}, status=status.HTTP_200_OK)


class AdminReimbursementHold(APIView):
    permission_classes = [IsAdminUserRole]

    def post(self, request, reimbursement_id: int):
        expense = get_object_or_404(_reimbursement_queryset(), pk=reimbursement_id)
        reason = (request.data.get("reason") or request.data.get("hold_reason") or "").strip()
        if not reason:
            return Response({"detail": "Hold reason is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            updated = place_reimbursement_hold(expense, reviewed_by=request.user, reason=reason)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Reimbursement placed on hold.", "reimbursement": _row(updated, request, include_detail=True)}, status=status.HTTP_200_OK)


class AdminReimbursementClearHold(APIView):
    permission_classes = [IsAdminUserRole]

    def post(self, request, reimbursement_id: int):
        expense = get_object_or_404(_reimbursement_queryset(), pk=reimbursement_id)
        try:
            updated = clear_reimbursement_hold(expense, reviewed_by=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Reimbursement hold cleared.", "reimbursement": _row(updated, request, include_detail=True)}, status=status.HTTP_200_OK)


class AdminReimbursementRetryRelease(APIView):
    permission_classes = [IsAdminUserRole]

    def post(self, request, reimbursement_id: int):
        expense = get_object_or_404(_reimbursement_queryset(), pk=reimbursement_id)
        try:
            clear_reimbursement_release_error(expense)
            updated = release_reimbursement_transfer(expense, reviewed_by=request.user)
        except ValueError as exc:
            expense.refresh_from_db()
            return Response({"detail": str(exc), "reimbursement": _row(expense, request, include_detail=True)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Reimbursement released.", "reimbursement": _row(updated, request, include_detail=True)}, status=status.HTTP_200_OK)
