from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, DrawRequest, DrawRequestStatus, ExpenseRequest, Invoice, InvoiceStatus
from projects.models_dispute import Dispute


def money(value) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def _to_cents(value) -> int:
    try:
        return int(
            (Decimal(str(value or "0")) * Decimal("100"))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
    except Exception:
        return 0


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
    if getattr(expense, "status", "") == ExpenseRequest.Status.HELD:
        return ReimbursementValidation(False, "This reimbursement is on admin hold.", ledger)
    if money(expense.amount) <= Decimal("0.00"):
        return ReimbursementValidation(False, "Amount must be greater than zero.", ledger)
    if require_receipt:
        has_receipt = bool(getattr(expense, "receipt", None)) or expense.attachments.exists()
        if not has_receipt:
            return ReimbursementValidation(False, "Receipt or proof attachment is required.", ledger)
    if money(expense.amount) > money(ledger.get("available")):
        return ReimbursementValidation(False, "Requested amount exceeds available escrow.", ledger)
    return ReimbursementValidation(True, "", ledger)


def _release_validation(locked: ExpenseRequest) -> ReimbursementValidation:
    if locked.status == ExpenseRequest.Status.HELD:
        return ReimbursementValidation(False, "This reimbursement is on admin hold.", escrow_ledger(locked.agreement, exclude_reimbursement_id=locked.id))
    validation = validate_reimbursement(locked, require_receipt=False)
    if not validation.ok:
        if "exceeds available escrow" in validation.detail:
            return ReimbursementValidation(False, "Current escrow availability is insufficient.", validation.ledger)
        return validation
    return validation


def _contractor_stripe_release_blocker(contractor) -> str:
    if not contractor:
        return "Agreement is missing contractor."
    if getattr(contractor, "stripe_deauthorized_at", None):
        return "Contractor Stripe account is disconnected."
    stripe_account_id = str(getattr(contractor, "stripe_account_id", "") or "").strip()
    if not stripe_account_id or not stripe_account_id.startswith("acct_"):
        return "Contractor is not connected to Stripe."
    if not bool(getattr(contractor, "charges_enabled", False)):
        return "Contractor Stripe account is not charges-enabled."
    if not bool(getattr(contractor, "payouts_enabled", False)):
        return "Contractor Stripe account is not payouts-enabled."
    if not bool(getattr(contractor, "details_submitted", False)):
        return "Contractor Stripe account setup is incomplete."
    if int(getattr(contractor, "requirements_due_count", 0) or 0) > 0:
        return "Contractor Stripe account has outstanding requirements."
    return ""


def _select_escrow_source_payment(agreement: Agreement, amount_cents: int):
    try:
        from payments.models import Payment
    except Exception:
        return None

    payments = (
        Payment.objects.select_for_update()
        .filter(
            agreement=agreement,
            status="succeeded",
        )
        .exclude(stripe_charge_id__isnull=True)
        .exclude(stripe_charge_id="")
        .order_by("created_at", "id")
    )
    for payment in payments:
        payment_amount_cents = int(getattr(payment, "amount_cents", 0) or 0)
        if payment_amount_cents >= int(amount_cents or 0):
            return payment
    return payments.first()


def _release_idempotency_key(expense: ExpenseRequest) -> str:
    return f"escrow-reimbursement-release:{expense.id}"


def _stripe_object_id(value) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return str(value.get("id") or "")
    return str(getattr(value, "id", "") or "")


def _mark_release_failure(expense_id: int, message: str) -> None:
    ExpenseRequest.objects.filter(pk=expense_id).update(
        status=ExpenseRequest.Status.PENDING_RELEASE,
        release_error=message,
        updated_at=timezone.now(),
    )
    try:
        expense = ExpenseRequest.objects.select_related("agreement", "agreement__contractor").get(pk=expense_id)
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=expense,
            event_type=Notification.EVENT_REIMBURSEMENT_HELD,
            reason=message,
        )
    except Exception:
        pass


def release_reimbursement_transfer(expense: ExpenseRequest, *, reviewed_by=None) -> ExpenseRequest:
    transfer = None
    source_payment_intent_id = ""
    failure_message = ""
    locked_id = expense.id

    with transaction.atomic():
        locked = (
            ExpenseRequest.objects.select_for_update()
            .select_related("agreement", "agreement__contractor")
            .get(pk=expense.pk)
        )
        if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
            return locked
        if locked.stripe_transfer_id:
            locked.status = ExpenseRequest.Status.RELEASED
            locked.released_at = locked.released_at or timezone.now()
            locked.paid_at = locked.paid_at or locked.released_at
            locked.release_error = ""
            locked.save(update_fields=["status", "released_at", "paid_at", "release_error", "updated_at"])
            return locked
        if locked.status not in {
            ExpenseRequest.Status.PENDING_RELEASE,
            ExpenseRequest.Status.APPROVED,
            ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
        }:
            raise ValueError("Only approved reimbursements can be released.")

        validation = _release_validation(locked)
        if not validation.ok:
            raise ValueError(validation.detail)

        agreement = locked.agreement
        contractor = getattr(agreement, "contractor", None) if agreement else None
        stripe_blocker = _contractor_stripe_release_blocker(contractor)
        if stripe_blocker:
            raise ValueError(stripe_blocker)

        amount_cents = _to_cents(locked.amount)
        if amount_cents <= 0:
            raise ValueError("Reimbursement amount is invalid.")
        source_payment = _select_escrow_source_payment(agreement, amount_cents)
        if source_payment is None:
            raise ValueError("No escrow funding charge has enough remaining capacity to release this reimbursement.")
        source_charge_id = str(getattr(source_payment, "stripe_charge_id", "") or "").strip()
        if not source_charge_id:
            raise ValueError("Escrow funding charge is missing, so Stripe cannot create the reimbursement transfer.")
        source_payment_intent_id = str(getattr(source_payment, "stripe_payment_intent_id", "") or "")

        try:
            import stripe

            transfer = stripe.Transfer.create(
                amount=int(amount_cents),
                currency="usd",
                destination=str(getattr(contractor, "stripe_account_id", "") or "").strip(),
                source_transaction=source_charge_id,
                idempotency_key=_release_idempotency_key(locked),
                metadata={
                    "kind": "escrow_reimbursement_release",
                    "expense_request_id": str(locked.id),
                    "agreement_id": str(locked.agreement_id),
                    "contractor_id": str(getattr(contractor, "id", "") or ""),
                    "amount_cents": str(amount_cents),
                    "source_payment_intent_id": source_payment_intent_id,
                    "source_charge_id": source_charge_id,
                },
            )
        except Exception as exc:
            failure_message = str(exc)

        if not failure_message:
            locked.status = ExpenseRequest.Status.RELEASED
            locked.released_at = timezone.now()
            locked.paid_at = locked.released_at
            locked.reviewed_by = reviewed_by or locked.reviewed_by
            locked.release_error = ""
            locked.stripe_transfer_id = _stripe_object_id(transfer)
            locked.escrow_source_payment_intent_id = source_payment_intent_id
            locked.save(update_fields=[
                "status",
                "released_at",
                "paid_at",
                "reviewed_by",
                "release_error",
                "stripe_transfer_id",
                "escrow_source_payment_intent_id",
                "updated_at",
            ])
            locked_id = locked.id

    if failure_message:
        _mark_release_failure(locked_id, f"Stripe reimbursement transfer failed: {failure_message}")
        raise ValueError(f"Stripe reimbursement transfer failed: {failure_message}")

    released = ExpenseRequest.objects.select_related("agreement").get(pk=locked_id)
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=released,
            event_type=Notification.EVENT_REIMBURSEMENT_RELEASED,
            actor_user=reviewed_by,
        )
    except Exception:
        pass
    return released


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
    try:
        from projects.services.workflow_notifications import notify_reimbursement_submitted

        notify_reimbursement_submitted(expense=locked)
    except Exception:
        pass
    return locked


@transaction.atomic
def approve_reimbursement(expense: ExpenseRequest, *, reviewed_by=None) -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        return locked
    if locked.status in {
        ExpenseRequest.Status.PENDING_RELEASE,
        ExpenseRequest.Status.APPROVED,
        ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
    }:
        try:
            return release_reimbursement_transfer(locked, reviewed_by=reviewed_by)
        except ValueError as exc:
            ExpenseRequest.objects.filter(pk=locked.pk).update(release_error=str(exc), updated_at=timezone.now())
            locked.refresh_from_db()
            return locked
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
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=locked,
            event_type=Notification.EVENT_REIMBURSEMENT_APPROVED,
            actor_user=reviewed_by,
        )
    except Exception:
        pass
    try:
        locked = release_reimbursement_transfer(locked, reviewed_by=reviewed_by)
    except ValueError as exc:
        ExpenseRequest.objects.filter(pk=locked.pk).update(release_error=str(exc), updated_at=timezone.now())
        locked.refresh_from_db()
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
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=locked,
            event_type=Notification.EVENT_REIMBURSEMENT_DENIED,
            actor_user=reviewed_by,
            reason=locked.denial_reason,
        )
    except Exception:
        pass
    return locked


@transaction.atomic
def mark_reimbursement_released(expense: ExpenseRequest, *, stripe_transfer_id: str = "") -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        return locked
    if locked.status not in {ExpenseRequest.Status.PENDING_RELEASE, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.HOMEOWNER_ACCEPTED}:
        raise ValueError("Only approved reimbursements can be released.")
    validation = _release_validation(locked)
    if not validation.ok:
        raise ValueError(validation.detail)
    locked.status = ExpenseRequest.Status.RELEASED
    locked.released_at = timezone.now()
    locked.paid_at = locked.released_at
    if stripe_transfer_id:
        locked.stripe_transfer_id = stripe_transfer_id
    locked.save(update_fields=["status", "released_at", "paid_at", "stripe_transfer_id", "updated_at"])
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=locked,
            event_type=Notification.EVENT_REIMBURSEMENT_RELEASED,
        )
    except Exception:
        pass
    return locked


@transaction.atomic
def record_manual_reimbursement_release(expense: ExpenseRequest, *, reviewed_by=None, stripe_transfer_id: str = "") -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().select_related("agreement").get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        raise ValueError("This reimbursement has already been released.")
    if locked.status == ExpenseRequest.Status.HELD:
        raise ValueError("This reimbursement is on admin hold.")
    if locked.status not in {ExpenseRequest.Status.PENDING_RELEASE, ExpenseRequest.Status.APPROVED, ExpenseRequest.Status.HOMEOWNER_ACCEPTED}:
        raise ValueError("Only approved reimbursements can be released.")
    validation = _release_validation(locked)
    if not validation.ok:
        locked.release_error = validation.detail
        locked.save(update_fields=["release_error", "updated_at"])
        raise ValueError(validation.detail)
    locked.status = ExpenseRequest.Status.RELEASED
    locked.released_at = timezone.now()
    locked.paid_at = locked.released_at
    locked.reviewed_by = reviewed_by or locked.reviewed_by
    locked.release_error = ""
    if stripe_transfer_id:
        locked.stripe_transfer_id = stripe_transfer_id
    locked.save(update_fields=["status", "released_at", "paid_at", "reviewed_by", "release_error", "stripe_transfer_id", "updated_at"])
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=locked,
            event_type=Notification.EVENT_REIMBURSEMENT_RELEASED,
            actor_user=reviewed_by,
        )
    except Exception:
        pass
    return locked


@transaction.atomic
def place_reimbursement_hold(expense: ExpenseRequest, *, reviewed_by=None, reason: str = "") -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        raise ValueError("Released reimbursements cannot be placed on hold.")
    if locked.request_kind != ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT:
        raise ValueError("Only escrow reimbursements can be placed on hold.")
    locked.status = ExpenseRequest.Status.HELD
    locked.held_at = timezone.now()
    locked.held_by = reviewed_by
    locked.hold_reason = (reason or "").strip()
    locked.release_error = ""
    locked.save(update_fields=["status", "held_at", "held_by", "hold_reason", "release_error", "updated_at"])
    try:
        from projects.models import Notification
        from projects.services.workflow_notifications import notify_reimbursement_contractor_update

        notify_reimbursement_contractor_update(
            expense=locked,
            event_type=Notification.EVENT_REIMBURSEMENT_HELD,
            actor_user=reviewed_by,
            reason=locked.hold_reason,
        )
    except Exception:
        pass
    return locked


@transaction.atomic
def clear_reimbursement_hold(expense: ExpenseRequest, *, reviewed_by=None) -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().get(pk=expense.pk)
    if locked.status != ExpenseRequest.Status.HELD:
        raise ValueError("This reimbursement is not on hold.")
    locked.status = ExpenseRequest.Status.PENDING_RELEASE if locked.approved_at else ExpenseRequest.Status.SUBMITTED
    locked.hold_cleared_at = timezone.now()
    locked.hold_cleared_by = reviewed_by
    locked.save(update_fields=["status", "hold_cleared_at", "hold_cleared_by", "updated_at"])
    return locked


@transaction.atomic
def clear_reimbursement_release_error(expense: ExpenseRequest) -> ExpenseRequest:
    locked = ExpenseRequest.objects.select_for_update().get(pk=expense.pk)
    if locked.status == ExpenseRequest.Status.RELEASED or locked.released_at:
        raise ValueError("Released reimbursements do not need retry.")
    locked.release_error = ""
    if locked.approved_at and locked.status not in {ExpenseRequest.Status.HELD, ExpenseRequest.Status.PENDING_RELEASE}:
        locked.status = ExpenseRequest.Status.PENDING_RELEASE
    locked.save(update_fields=["release_error", "status", "updated_at"])
    return locked
