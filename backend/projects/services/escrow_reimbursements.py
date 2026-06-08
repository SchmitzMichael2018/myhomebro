from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, DrawRequest, DrawRequestStatus, ExpenseRequest, Invoice, InvoiceStatus
from projects.models_dispute import Dispute


def money(value) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def _invoice_released_amount(agreement: Agreement) -> Decimal:
    total = Decimal("0.00")
    for invoice in Invoice.objects.filter(agreement=agreement):
        status = str(getattr(invoice, "status", "") or "").lower()
        if (
            getattr(invoice, "escrow_released", False)
            or getattr(invoice, "escrow_released_at", None)
            or getattr(invoice, "stripe_transfer_id", "")
            or status == InvoiceStatus.PAID
        ):
            total += money(getattr(invoice, "amount", 0))
    return total


def _draw_released_amount(agreement: Agreement) -> Decimal:
    total = Decimal("0.00")
    released_statuses = {DrawRequestStatus.RELEASED, DrawRequestStatus.PAID}
    for draw in DrawRequest.objects.filter(agreement=agreement):
        if getattr(draw, "released_at", None) or str(getattr(draw, "status", "") or "").lower() in released_statuses:
            total += money(getattr(draw, "net_amount", None) or getattr(draw, "current_requested_amount", None))
    return total


def _reimbursement_amounts(agreement: Agreement, *, exclude_id: int | None = None) -> tuple[Decimal, Decimal]:
    qs = ExpenseRequest.objects.filter(
        agreement=agreement,
        request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
        is_archived=False,
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    released = Decimal("0.00")
    reserved = Decimal("0.00")
    reserve_statuses = {
        ExpenseRequest.Status.APPROVED,
        ExpenseRequest.Status.PENDING_RELEASE,
        ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
    }
    released_statuses = {ExpenseRequest.Status.RELEASED, ExpenseRequest.Status.PAID}
    for expense in qs:
        amount = money(expense.amount)
        status = str(expense.status or "").lower()
        if status in released_statuses or getattr(expense, "released_at", None):
            released += amount
        elif status in reserve_statuses:
            reserved += amount
    return released, reserved


def agreement_has_escrow_hold(agreement: Agreement) -> bool:
    return Dispute.objects.filter(
        agreement=agreement,
        escrow_frozen=True,
        is_archived=False,
    ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "canceled"]).exists()


def escrow_ledger(agreement: Agreement, *, exclude_reimbursement_id: int | None = None) -> dict:
    funded = money(getattr(agreement, "escrow_funded_amount", 0))
    invoice_released = _invoice_released_amount(agreement)
    draw_released = _draw_released_amount(agreement)
    reimbursement_released, reimbursement_pending = _reimbursement_amounts(
        agreement,
        exclude_id=exclude_reimbursement_id,
    )
    released = invoice_released + draw_released + reimbursement_released
    holds = funded if agreement_has_escrow_hold(agreement) else Decimal("0.00")
    available = funded - released - reimbursement_pending - holds
    if available < Decimal("0.00"):
        available = Decimal("0.00")
    return {
        "funded": funded,
        "invoice_released": invoice_released,
        "draw_released": draw_released,
        "reimbursement_released": reimbursement_released,
        "reimbursement_pending": reimbursement_pending,
        "released_total": released,
        "holds": holds,
        "available": available,
    }


def serialize_ledger(ledger: dict) -> dict:
    return {key: f"{money(value):.2f}" for key, value in ledger.items()}


@dataclass
class ReimbursementValidation:
    ok: bool
    detail: str
    ledger: dict


def validate_reimbursement(expense: ExpenseRequest, *, require_receipt: bool = True) -> ReimbursementValidation:
    agreement = expense.agreement
    if agreement is None:
        return ReimbursementValidation(False, "Agreement is required.", {})
    ledger = escrow_ledger(agreement, exclude_reimbursement_id=expense.id)
    if getattr(agreement, "payment_mode", "escrow") == "direct":
        return ReimbursementValidation(False, "Reimbursements from escrow require an escrow agreement.", ledger)
    if not getattr(agreement, "signature_is_satisfied", False):
        return ReimbursementValidation(False, "Agreement must be signed before reimbursement requests.", ledger)
    if not getattr(agreement, "escrow_funded", False) and money(getattr(agreement, "escrow_funded_amount", 0)) <= Decimal("0.00"):
        return ReimbursementValidation(False, "Escrow must be funded before reimbursement requests.", ledger)
    if agreement_has_escrow_hold(agreement):
        return ReimbursementValidation(False, "Escrow is on hold because a dispute is open.", ledger)
    if money(expense.amount) <= Decimal("0.00"):
        return ReimbursementValidation(False, "Amount must be greater than zero.", ledger)
    if require_receipt:
        has_receipt = bool(getattr(expense, "receipt", None)) or expense.attachments.exists()
        if not has_receipt:
            return ReimbursementValidation(False, "Receipt or proof attachment is required.", ledger)
    if money(expense.amount) > money(ledger.get("available")):
        return ReimbursementValidation(False, "Requested amount exceeds available escrow.", ledger)
    return ReimbursementValidation(True, "", ledger)


@transaction.atomic
def submit_reimbursement(expense: ExpenseRequest) -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    validation = validate_reimbursement(locked)
    if not validation.ok:
        raise ValueError(validation.detail)
    locked.request_kind = ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT
    locked.status = ExpenseRequest.Status.SUBMITTED
    locked.submitted_at = locked.submitted_at or timezone.now()
    locked.contractor_signed_at = locked.contractor_signed_at or locked.submitted_at
    locked.save(update_fields=["request_kind", "status", "submitted_at", "contractor_signed_at", "updated_at"])
    return locked


@transaction.atomic
def approve_reimbursement(expense: ExpenseRequest, *, reviewed_by=None) -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    if locked.status not in {ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER}:
        raise ValueError("Only submitted reimbursement requests can be approved.")
    validation = validate_reimbursement(locked)
    if not validation.ok:
        raise ValueError(validation.detail)
    locked.status = ExpenseRequest.Status.PENDING_RELEASE
    locked.approved_at = timezone.now()
    locked.homeowner_acted_at = locked.approved_at
    locked.reviewed_by = reviewed_by
    locked.available_escrow_at_approval = money(validation.ledger["available"])
    locked.release_error = ""
    locked.save(
        update_fields=[
            "status",
            "approved_at",
            "homeowner_acted_at",
            "reviewed_by",
            "available_escrow_at_approval",
            "release_error",
            "updated_at",
        ]
    )
    return locked


@transaction.atomic
def deny_reimbursement(expense: ExpenseRequest, *, reviewed_by=None, reason: str = "") -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().get(pk=expense.pk)
    if locked.status not in {ExpenseRequest.Status.SUBMITTED, ExpenseRequest.Status.SENT_TO_HOMEOWNER, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.PENDING_RELEASE}:
        raise ValueError("This reimbursement request cannot be denied now.")
    locked.status = ExpenseRequest.Status.DENIED
    locked.denied_at = timezone.now()
    locked.homeowner_acted_at = locked.denied_at
    locked.reviewed_by = reviewed_by
    locked.denial_reason = (reason or "").strip()
    locked.save(update_fields=["status", "denied_at", "homeowner_acted_at", "reviewed_by", "denial_reason", "updated_at"])
    return locked


@transaction.atomic
def mark_reimbursement_released(expense: ExpenseRequest, *, stripe_transfer_id: str = "") -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        return locked
    if locked.status not in {ExpenseRequest.Status.PENDING_RELEASE, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.HOMEOWNER_ACCEPTED}:
        raise ValueError("Only approved reimbursements can be released.")
    validation = validate_reimbursement(locked, require_receipt=False)
    if not validation.ok:
        raise ValueError(validation.detail)
    locked.status = ExpenseRequest.Status.RELEASED
    locked.released_at = timezone.now()
    locked.paid_at = locked.released_at
    if stripe_transfer_id:
        locked.stripe_transfer_id = stripe_transfer_id
    locked.save(update_fields=["status", "released_at", "paid_at", "stripe_transfer_id", "updated_at"])
    return locked
