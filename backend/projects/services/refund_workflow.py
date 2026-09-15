from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from payments.models import Payment, Refund
from payments.stripe_config import stripe
from projects.models import (
    CustomerRefundRequest,
    CustomerRefundRequestEvent,
    CustomerRefundTransaction,
    DrawRequestStatus,
    ExternalPaymentStatus,
    InvoiceStatus,
    Notification,
)
from projects.services.dispute_allocation_execution import agreement_escrow_source_balances
from projects.services.invites_delivery import send_postmark_email
from projects.services.notification_center import create_notification
from projects.services.sms_service import send_compliant_sms

logger = logging.getLogger(__name__)

ACTIVE_REFUND_STATUSES = {
    CustomerRefundRequest.Status.REFUND_REQUESTED,
    CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED,
    CustomerRefundRequest.Status.UNDER_REVIEW,
    CustomerRefundRequest.Status.COUNTERED,
    CustomerRefundRequest.Status.APPROVED,
    CustomerRefundRequest.Status.PROCESSING,
    CustomerRefundRequest.Status.FAILED,
}


def _cents(value) -> int:
    if value in (None, ""):
        return 0
    return int((Decimal(str(value)) * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _money_from_cents(value: int) -> Decimal:
    return (Decimal(int(value or 0)) / Decimal("100")).quantize(Decimal("0.01"))


def _stripe_id(value) -> str:
    if isinstance(value, dict):
        return str(value.get("id") or "")
    return str(getattr(value, "id", "") or "")


def record_refund_event(refund_request, *, event_type: str, actor=None, actor_role: str = "", from_status: str = "", note: str = "", metadata=None):
    return CustomerRefundRequestEvent.objects.create(
        refund_request=refund_request,
        actor=actor,
        actor_role=actor_role,
        event_type=event_type,
        from_status=from_status,
        to_status=refund_request.status,
        note=str(note or ""),
        metadata=metadata or {},
    )


def _source_key(*, source_type: str, invoice=None, draw_request=None, milestone=None, external_payment=None) -> str:
    source = invoice or draw_request or milestone or external_payment
    return f"{source_type}:{getattr(source, 'id', 'agreement')}"


def _same_source_transaction_filter(refund_request) -> dict:
    filters = {
        "refund_request__agreement_id": refund_request.agreement_id,
        "refund_request__source_type": refund_request.source_type,
    }
    for field in ("invoice_id", "draw_request_id", "milestone_id", "external_payment_id"):
        filters[f"refund_request__{field}"] = getattr(refund_request, field)
    return filters


def _already_refunded_cents(refund_request) -> int:
    """Return all completed refunds for this source, including older requests."""
    actions = [CustomerRefundTransaction.Action.REFUND]
    if refund_request.payment_mode == CustomerRefundRequest.PaymentMode.EXTERNAL:
        actions.append(CustomerRefundTransaction.Action.EXTERNAL_RECORD)
    return int(
        CustomerRefundTransaction.objects.filter(
            **_same_source_transaction_filter(refund_request),
            action__in=actions,
            status=CustomerRefundTransaction.Status.SUCCEEDED,
        ).aggregate(total=Sum("amount_cents"))["total"]
        or 0
    )


def _target_amount_cents(refund_request) -> int:
    if refund_request.source_type == CustomerRefundRequest.SourceType.INVOICE and refund_request.invoice_id:
        return _cents(refund_request.invoice.amount)
    if refund_request.source_type == CustomerRefundRequest.SourceType.DRAW and refund_request.draw_request_id:
        draw = refund_request.draw_request
        return _cents(draw.current_requested_amount or draw.net_amount)
    if refund_request.source_type == CustomerRefundRequest.SourceType.EXTERNAL and refund_request.external_payment_id:
        return _cents(refund_request.external_payment.net_amount)
    if refund_request.milestone_id:
        return _cents(refund_request.milestone.amount)
    return sum(int(row["available_cents"]) for row in agreement_escrow_source_balances(refund_request.agreement_id))


def refund_request_max_cents(refund_request) -> int:
    target = _target_amount_cents(refund_request)
    # Unreleased escrow availability already subtracts completed Stripe Refund rows.
    # Subtracting our audit transactions again would double-count them.
    if refund_request.source_type == CustomerRefundRequest.SourceType.ESCROW:
        return max(target, 0)
    return max(target - _already_refunded_cents(refund_request), 0)


def _payment_mode_for_source(agreement, *, source_type: str, invoice=None, draw_request=None, external_payment=None) -> str:
    if source_type == CustomerRefundRequest.SourceType.EXTERNAL or external_payment is not None:
        return CustomerRefundRequest.PaymentMode.EXTERNAL
    if source_type in {CustomerRefundRequest.SourceType.INVOICE, CustomerRefundRequest.SourceType.DRAW}:
        if str(getattr(agreement, "payment_mode", "") or "").lower() == "direct":
            return CustomerRefundRequest.PaymentMode.DIRECT
    return CustomerRefundRequest.PaymentMode.ESCROW


def validate_refund_source(agreement, *, source_type: str, invoice=None, draw_request=None, milestone=None, external_payment=None):
    if source_type == CustomerRefundRequest.SourceType.INVOICE:
        if invoice is None or invoice.agreement_id != agreement.id:
            raise ValueError("Select an invoice from this agreement.")
        if str(invoice.status or "").lower() not in {InvoiceStatus.PAID, InvoiceStatus.SETTLED} and not invoice.direct_pay_paid_at and not invoice.escrow_released:
            raise ValueError("Only a paid or released invoice can be refunded.")
    elif source_type == CustomerRefundRequest.SourceType.DRAW:
        if draw_request is None or draw_request.agreement_id != agreement.id:
            raise ValueError("Select a draw from this agreement.")
        if str(draw_request.status or "").lower() not in {DrawRequestStatus.PAID, DrawRequestStatus.RELEASED}:
            raise ValueError("This draw has not been paid. Cancel, reject, or revise it instead of issuing a refund.")
    elif source_type == CustomerRefundRequest.SourceType.EXTERNAL:
        if external_payment is None or external_payment.agreement_id != agreement.id:
            raise ValueError("Select an external payment from this agreement.")
    elif source_type == CustomerRefundRequest.SourceType.ESCROW:
        if str(getattr(agreement, "payment_mode", "") or "").lower() != "escrow":
            raise ValueError("This agreement does not have an escrow balance.")
        if milestone is not None:
            if milestone.agreement_id != agreement.id:
                raise ValueError("Select a milestone from this agreement.")
            if milestone.completed or getattr(milestone, "invoice_id", None):
                raise ValueError("Started, completed, or invoiced work must use an invoice, draw, or dispute refund path.")
    else:
        raise ValueError("Select a supported refund source.")


def create_refund_request(*, agreement, actor, initiated_by_role: str, source_type: str, reason: str, requested_amount=None, evidence_note: str = "", invoice=None, draw_request=None, milestone=None, external_payment=None):
    validate_refund_source(
        agreement,
        source_type=source_type,
        invoice=invoice,
        draw_request=draw_request,
        milestone=milestone,
        external_payment=external_payment,
    )
    payment_mode = _payment_mode_for_source(
        agreement,
        source_type=source_type,
        invoice=invoice,
        draw_request=draw_request,
        external_payment=external_payment,
    )
    source_key = _source_key(
        source_type=source_type,
        invoice=invoice,
        draw_request=draw_request,
        milestone=milestone,
        external_payment=external_payment,
    )
    duplicate_query = CustomerRefundRequest.objects.filter(
        agreement=agreement,
        source_type=source_type,
        status__in=ACTIVE_REFUND_STATUSES,
    )
    if source_type != CustomerRefundRequest.SourceType.ESCROW:
        duplicate_query = duplicate_query.filter(
            invoice=invoice,
            draw_request=draw_request,
            milestone=milestone,
            external_payment=external_payment,
        )
    duplicate = duplicate_query.order_by("-created_at", "-id").first()
    if duplicate:
        raise ValueError(f"A refund request is already open for {source_key}.")

    status = (
        CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED
        if initiated_by_role == CustomerRefundRequest.InitiatorRole.HOMEOWNER
        else CustomerRefundRequest.Status.UNDER_REVIEW
    )
    row = CustomerRefundRequest.objects.create(
        agreement=agreement,
        requested_by=actor,
        initiated_by_role=initiated_by_role,
        source_type=source_type,
        payment_mode=payment_mode,
        invoice=invoice,
        draw_request=draw_request,
        milestone=milestone,
        external_payment=external_payment,
        reason=str(reason or "").strip(),
        evidence_note=str(evidence_note or "").strip(),
        requested_amount=requested_amount,
        status=status,
    )
    max_cents = refund_request_max_cents(row)
    requested_cents = _cents(requested_amount)
    if max_cents <= 0:
        row.delete()
        raise ValueError("No refundable amount remains for this payment source.")
    if requested_cents and requested_cents > max_cents:
        row.delete()
        raise ValueError(f"Requested refund exceeds the available ${_money_from_cents(max_cents)}.")
    record_refund_event(
        row,
        event_type="requested",
        actor=actor,
        actor_role=initiated_by_role,
        note=row.reason,
        metadata={"source_key": source_key, "requested_amount": str(requested_amount or "")},
    )
    if initiated_by_role == CustomerRefundRequest.InitiatorRole.HOMEOWNER:
        _notify_contractor(row)
    return row


def _notification_url(refund_request) -> str:
    return f"/app/agreements/{refund_request.agreement_id}/workspace?tab=funding&refund_request={refund_request.id}"


def _notify_contractor(refund_request):
    agreement = refund_request.agreement
    contractor = agreement.contractor
    amount = f"${refund_request.requested_amount:,.2f}" if refund_request.requested_amount is not None else "an amount to be determined"
    create_notification(
        contractor=contractor,
        category=Notification.EVENT_REFUND_REQUESTED,
        title="Customer requested a refund",
        body=f"{getattr(agreement.homeowner, 'name', '') or 'Your customer'} requested {amount} for {getattr(getattr(agreement, 'project', None), 'title', '') or f'Agreement #{agreement.id}'}.",
        link=_notification_url(refund_request),
        agreement=agreement,
        invoice=refund_request.invoice,
        draw_request=refund_request.draw_request,
        actor_user=refund_request.requested_by,
        dedupe_key=f"refund-requested:{refund_request.id}",
    )
    recipient = str(getattr(getattr(contractor, "user", None), "email", "") or "").strip()
    if recipient:
        send_postmark_email(
            to_email=recipient,
            subject=f"Refund request for Agreement #{agreement.id}",
            text_body=f"A customer refund request needs your response.\n\nReason: {refund_request.reason}\n\nOpen: {_public_url(_notification_url(refund_request))}",
        )


def notify_contractor_refund_update(refund_request, *, title: str, body: str, suffix: str):
    create_notification(
        contractor=refund_request.agreement.contractor,
        category=Notification.EVENT_REFUND_UPDATED,
        title=title,
        body=body,
        link=_notification_url(refund_request),
        agreement=refund_request.agreement,
        invoice=refund_request.invoice,
        draw_request=refund_request.draw_request,
        actor_user=refund_request.requested_by,
        dedupe_key=f"refund-updated:{refund_request.id}:{suffix}",
    )


def _public_url(path: str) -> str:
    base = str(getattr(settings, "FRONTEND_URL", "") or getattr(settings, "SITE_URL", "") or "https://www.myhomebro.com").rstrip("/")
    return f"{base}/{str(path or '').lstrip('/')}"


def notify_homeowner_refund_update(refund_request, *, message: str):
    agreement = refund_request.agreement
    homeowner = agreement.homeowner or getattr(getattr(agreement, "project", None), "homeowner", None)
    email = str(getattr(homeowner, "email", "") or "").strip()
    phone = str(getattr(homeowner, "phone_number", "") or "").strip()
    project_title = str(getattr(getattr(agreement, "project", None), "title", "") or f"Agreement #{agreement.id}")
    delivery = {"email": {"sent": False}, "sms": {"sent": False}, "attempted_at": timezone.now().isoformat()}
    if email:
        ok, detail = send_postmark_email(
            to_email=email,
            subject=f"Refund update for {project_title}",
            text_body=f"{message}\n\nOpen your MyHomeBro customer portal to review the refund history.",
        )
        delivery["email"] = {"sent": bool(ok), "detail": detail}
    if phone:
        result = send_compliant_sms(
            phone,
            f"MyHomeBro: {message}",
            related_object=agreement,
            category="customer_care",
            dedupe_key=f"refund-update:{refund_request.id}:{refund_request.status}",
        )
        delivery["sms"] = {"sent": bool(result.get("ok")), "status": result.get("status"), "detail": result.get("detail")}
    refund_request.notification_delivery = delivery
    refund_request.save(update_fields=["notification_delivery", "updated_at"])
    return delivery


def serialize_refund_request(refund_request) -> dict:
    max_cents = refund_request_max_cents(refund_request)
    return {
        "id": refund_request.id,
        "agreement_id": refund_request.agreement_id,
        "initiated_by_role": refund_request.initiated_by_role,
        "source_type": refund_request.source_type,
        "source_type_label": refund_request.get_source_type_display(),
        "payment_mode": refund_request.payment_mode,
        "payment_mode_label": refund_request.get_payment_mode_display(),
        "invoice_id": refund_request.invoice_id,
        "invoice_number": getattr(refund_request.invoice, "invoice_number", "") if refund_request.invoice_id else "",
        "draw_request_id": refund_request.draw_request_id,
        "draw_number": getattr(refund_request.draw_request, "draw_number", None) if refund_request.draw_request_id else None,
        "milestone_id": refund_request.milestone_id,
        "milestone_title": getattr(refund_request.milestone, "title", "") if refund_request.milestone_id else "",
        "external_payment_id": refund_request.external_payment_id,
        "reason": refund_request.reason,
        "evidence_note": refund_request.evidence_note,
        "requested_amount": str(refund_request.requested_amount) if refund_request.requested_amount is not None else "",
        "approved_amount": str(refund_request.approved_amount) if refund_request.approved_amount is not None else "",
        "maximum_refundable_amount": str(_money_from_cents(max_cents)),
        "response_note": refund_request.response_note,
        "status": refund_request.status,
        "status_label": refund_request.get_status_display(),
        "failure_reason": refund_request.failure_reason,
        "created_at": refund_request.created_at.isoformat(),
        "updated_at": refund_request.updated_at.isoformat(),
        "processed_at": refund_request.processed_at.isoformat() if refund_request.processed_at else None,
        "notification_delivery": refund_request.notification_delivery or {},
        "events": [
            {
                "id": event.id,
                "event_type": event.event_type,
                "actor_role": event.actor_role,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "note": event.note,
                "metadata": event.metadata,
                "created_at": event.created_at.isoformat(),
            }
            for event in refund_request.events.all()
        ],
        "transactions": [
            {
                "id": item.id,
                "action": item.action,
                "status": item.status,
                "amount": str(_money_from_cents(item.amount_cents)),
                "stripe_refund_id": item.stripe_refund_id,
                "stripe_transfer_reversal_id": item.stripe_transfer_reversal_id,
                "error_message": item.error_message,
                "created_at": item.created_at.isoformat(),
                "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            }
            for item in refund_request.transactions.all()
        ],
    }


def refund_source_options(agreement) -> list[dict]:
    options = []
    active = CustomerRefundRequest.objects.filter(agreement=agreement, status__in=ACTIVE_REFUND_STATUSES)
    active_escrow = active.filter(source_type=CustomerRefundRequest.SourceType.ESCROW).exists()
    active_invoice_ids = set(active.exclude(invoice_id__isnull=True).values_list("invoice_id", flat=True))
    active_draw_ids = set(active.exclude(draw_request_id__isnull=True).values_list("draw_request_id", flat=True))
    active_external_ids = set(active.exclude(external_payment_id__isnull=True).values_list("external_payment_id", flat=True))

    if str(getattr(agreement, "payment_mode", "") or "").lower() == "escrow" and not active_escrow:
        available_cents = sum(int(row["available_cents"]) for row in agreement_escrow_source_balances(agreement.id))
        if available_cents > 0:
            options.append({
                "key": "escrow:agreement",
                "source_type": CustomerRefundRequest.SourceType.ESCROW,
                "payment_mode": CustomerRefundRequest.PaymentMode.ESCROW,
                "label": "Available unreleased escrow",
                "maximum_refundable_amount": str(_money_from_cents(available_cents)),
            })
        invoiced_milestone_ids = set(
            agreement.invoices.exclude(milestone_id_snapshot__isnull=True)
            .values_list("milestone_id_snapshot", flat=True)
        )
        for milestone in agreement.milestones.filter(completed=False, amount__gt=0).exclude(
            id__in=invoiced_milestone_ids
        ).order_by("order", "id"):
            options.append({
                "key": f"escrow:milestone:{milestone.id}",
                "source_type": CustomerRefundRequest.SourceType.ESCROW,
                "payment_mode": CustomerRefundRequest.PaymentMode.ESCROW,
                "milestone_id": milestone.id,
                "label": f"Unstarted milestone — {milestone.title}",
                "maximum_refundable_amount": str(Decimal(milestone.amount).quantize(Decimal("0.01"))),
            })
    paid_invoices = agreement.invoices.filter(
        Q(status__in=[InvoiceStatus.PAID, InvoiceStatus.SETTLED])
        | Q(escrow_released=True)
        | Q(direct_pay_paid_at__isnull=False)
    )
    for invoice in paid_invoices.order_by("-created_at", "-id"):
        if invoice.status == InvoiceStatus.REFUNDED or invoice.id in active_invoice_ids:
            continue
        mode = CustomerRefundRequest.PaymentMode.DIRECT if str(getattr(agreement, "payment_mode", "") or "").lower() == "direct" else CustomerRefundRequest.PaymentMode.ESCROW
        if mode == CustomerRefundRequest.PaymentMode.DIRECT and not (invoice.direct_pay_payment_intent_id or invoice.stripe_payment_intent_id):
            continue
        if mode == CustomerRefundRequest.PaymentMode.ESCROW and not invoice.stripe_transfer_id:
            continue
        refunded_cents = int(CustomerRefundTransaction.objects.filter(
            refund_request__invoice=invoice,
            action=CustomerRefundTransaction.Action.REFUND,
            status=CustomerRefundTransaction.Status.SUCCEEDED,
        ).aggregate(total=Sum("amount_cents"))["total"] or 0)
        remaining_cents = max(_cents(invoice.amount) - refunded_cents, 0)
        if remaining_cents <= 0:
            continue
        options.append({
            "key": f"invoice:{invoice.id}",
            "source_type": CustomerRefundRequest.SourceType.INVOICE,
            "payment_mode": mode,
            "invoice_id": invoice.id,
            "label": f"Invoice {invoice.invoice_number} — paid ${Decimal(invoice.amount):,.2f}",
            "maximum_refundable_amount": str(_money_from_cents(remaining_cents)),
        })
    for draw in agreement.draw_requests.filter(status__in=[DrawRequestStatus.PAID, DrawRequestStatus.RELEASED]).order_by("-created_at", "-id"):
        if draw.id in active_draw_ids:
            continue
        mode = CustomerRefundRequest.PaymentMode.DIRECT if str(getattr(agreement, "payment_mode", "") or "").lower() == "direct" else CustomerRefundRequest.PaymentMode.ESCROW
        if mode == CustomerRefundRequest.PaymentMode.DIRECT and not draw.stripe_payment_intent_id:
            continue
        if mode == CustomerRefundRequest.PaymentMode.ESCROW and not draw.stripe_transfer_id:
            continue
        amount = Decimal(draw.current_requested_amount or draw.net_amount or 0).quantize(Decimal("0.01"))
        refunded_cents = int(CustomerRefundTransaction.objects.filter(
            refund_request__draw_request=draw,
            action=CustomerRefundTransaction.Action.REFUND,
            status=CustomerRefundTransaction.Status.SUCCEEDED,
        ).aggregate(total=Sum("amount_cents"))["total"] or 0)
        remaining_cents = max(_cents(amount) - refunded_cents, 0)
        if remaining_cents <= 0:
            continue
        options.append({
            "key": f"draw:{draw.id}",
            "source_type": CustomerRefundRequest.SourceType.DRAW,
            "payment_mode": mode,
            "draw_request_id": draw.id,
            "label": f"Draw {draw.draw_number} — paid ${amount:,.2f}",
            "maximum_refundable_amount": str(_money_from_cents(remaining_cents)),
        })
    for external in agreement.external_payment_records.exclude(status__in=[ExternalPaymentStatus.VOIDED, ExternalPaymentStatus.REFUNDED]).order_by("-payment_date", "-id"):
        if external.id in active_external_ids:
            continue
        amount = Decimal(external.net_amount or 0).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        refunded_cents = int(CustomerRefundTransaction.objects.filter(
            refund_request__external_payment=external,
            action=CustomerRefundTransaction.Action.EXTERNAL_RECORD,
            status=CustomerRefundTransaction.Status.SUCCEEDED,
        ).aggregate(total=Sum("amount_cents"))["total"] or 0)
        remaining_cents = max(_cents(amount) - refunded_cents, 0)
        if remaining_cents <= 0:
            continue
        options.append({
            "key": f"external:{external.id}",
            "source_type": CustomerRefundRequest.SourceType.EXTERNAL,
            "payment_mode": CustomerRefundRequest.PaymentMode.EXTERNAL,
            "external_payment_id": external.id,
            "label": f"External payment {external.reference_number or external.id} — ${amount:,.2f}",
            "maximum_refundable_amount": str(_money_from_cents(remaining_cents)),
            "record_only": True,
        })
    return options


def _new_transaction(refund_request, *, action: str, amount_cents: int, key: str, payment=None, **sources):
    row, _created = CustomerRefundTransaction.objects.get_or_create(
        idempotency_key=key,
        defaults={
            "refund_request": refund_request,
            "payment": payment,
            "action": action,
            "amount_cents": int(amount_cents),
            "currency": "usd",
            **sources,
        },
    )
    return row


def _complete_transaction(row, *, refund_id: str = "", reversal_id: str = ""):
    row.status = CustomerRefundTransaction.Status.SUCCEEDED
    row.stripe_refund_id = refund_id or row.stripe_refund_id
    row.stripe_transfer_reversal_id = reversal_id or row.stripe_transfer_reversal_id
    row.error_message = ""
    row.completed_at = timezone.now()
    row.save(update_fields=["status", "stripe_refund_id", "stripe_transfer_reversal_id", "error_message", "completed_at"])


def _fail_transaction(row, exc):
    row.status = CustomerRefundTransaction.Status.FAILED
    row.error_message = str(exc)[:4000]
    row.completed_at = timezone.now()
    row.save(update_fields=["status", "error_message", "completed_at"])


def _refund_payment_intent(
    refund_request,
    *,
    payment_intent_id: str,
    amount_cents: int,
    payment=None,
    reverse_transfer: bool = False,
    refund_application_fee: bool = False,
    connected_account_id: str = "",
    suffix: str = "",
):
    key = f"refund-request:{refund_request.id}:refund:{suffix or payment_intent_id}:{amount_cents}"
    row = _new_transaction(
        refund_request,
        action=CustomerRefundTransaction.Action.REFUND,
        amount_cents=amount_cents,
        key=key,
        payment=payment,
        source_payment_intent_id=payment_intent_id,
        source_charge_id=str(getattr(payment, "stripe_charge_id", "") or "") if payment else "",
        metadata={
            "reverse_transfer": reverse_transfer,
            "refund_application_fee": refund_application_fee,
            "connected_account_id": str(connected_account_id or ""),
        },
    )
    if row.status == CustomerRefundTransaction.Status.SUCCEEDED:
        return row
    try:
        params = {
            "payment_intent": payment_intent_id,
            "amount": int(amount_cents),
            "reason": "requested_by_customer",
            "metadata": {
                "kind": "myhomebro_refund_request",
                "refund_request_id": str(refund_request.id),
                "agreement_id": str(refund_request.agreement_id),
            },
        }
        if reverse_transfer:
            params["reverse_transfer"] = True
        if refund_application_fee:
            params["refund_application_fee"] = True
        if connected_account_id:
            params["stripe_account"] = str(connected_account_id)
        result = stripe.Refund.create(**params, idempotency_key=key)
        refund_id = _stripe_id(result)
        if not refund_id:
            raise RuntimeError("Stripe did not return a refund identifier.")
        _complete_transaction(row, refund_id=refund_id)
        if payment is not None:
            Refund.objects.update_or_create(
                stripe_refund_id=refund_id,
                defaults={
                    "payment": payment,
                    "created_by": refund_request.responded_by or refund_request.requested_by,
                    "amount_cents": int(amount_cents),
                    "currency": "usd",
                    "reason": f"Refund request #{refund_request.id}",
                    "note": refund_request.response_note or refund_request.reason,
                    "status": "succeeded",
                    "error_message": "",
                },
            )
        return row
    except Exception as exc:
        _fail_transaction(row, exc)
        raise


def _reverse_transfer(refund_request, *, transfer_id: str, amount_cents: int):
    key = f"refund-request:{refund_request.id}:reverse:{transfer_id}:{amount_cents}"
    row = _new_transaction(
        refund_request,
        action=CustomerRefundTransaction.Action.TRANSFER_REVERSAL,
        amount_cents=amount_cents,
        key=key,
        source_transfer_id=transfer_id,
    )
    if row.status == CustomerRefundTransaction.Status.SUCCEEDED:
        return row
    try:
        result = stripe.Transfer.create_reversal(
            transfer_id,
            amount=int(amount_cents),
            metadata={"refund_request_id": str(refund_request.id), "agreement_id": str(refund_request.agreement_id)},
            idempotency_key=key,
        )
        reversal_id = _stripe_id(result)
        if not reversal_id:
            raise RuntimeError("Stripe did not return a transfer reversal identifier.")
        _complete_transaction(row, reversal_id=reversal_id)
        return row
    except Exception as exc:
        _fail_transaction(row, exc)
        raise


def _payment_for_transfer(transfer_id: str):
    transfer = stripe.Transfer.retrieve(transfer_id)
    charge_id = _stripe_id(getattr(transfer, "source_transaction", None) or (transfer.get("source_transaction") if isinstance(transfer, dict) else None))
    if not charge_id:
        raise ValueError("The original escrow funding charge for this release could not be identified.")
    payment = Payment.objects.filter(stripe_charge_id=charge_id, status="succeeded").first()
    if not payment:
        raise ValueError("The original escrow payment record for this release could not be identified.")
    return payment


def _execute_escrow_balance(refund_request, amount_cents: int):
    needed = int(amount_cents)
    # Stripe calls must not run inside a long-lived database transaction. The
    # request row lock in execute_refund_request prevents duplicate execution
    # for this request; Stripe idempotency keys protect retries.
    for source in agreement_escrow_source_balances(refund_request.agreement_id, lock=False):
        take = min(needed, int(source["available_cents"]))
        if take <= 0:
            continue
        payment = source["payment"]
        _refund_payment_intent(
            refund_request,
            payment_intent_id=str(payment.stripe_payment_intent_id),
            amount_cents=take,
            payment=payment,
            suffix=str(payment.id),
        )
        needed -= take
        if needed <= 0:
            break
    if needed:
        raise ValueError("Verified escrow funding sources do not contain enough refundable funds.")


def _mark_source_refunded(refund_request, amount_cents: int):
    completed_actions = [CustomerRefundTransaction.Action.REFUND]
    if refund_request.payment_mode == CustomerRefundRequest.PaymentMode.EXTERNAL:
        completed_actions.append(CustomerRefundTransaction.Action.EXTERNAL_RECORD)
    cumulative_cents = int(CustomerRefundTransaction.objects.filter(
        **_same_source_transaction_filter(refund_request),
        action__in=completed_actions,
        status=CustomerRefundTransaction.Status.SUCCEEDED,
    ).aggregate(total=Sum("amount_cents"))["total"] or 0)
    if refund_request.invoice_id and cumulative_cents >= _cents(refund_request.invoice.amount):
        invoice = refund_request.invoice
        invoice.status = InvoiceStatus.REFUNDED
        invoice.save(update_fields=["status"])
    if refund_request.draw_request_id and cumulative_cents >= _cents(refund_request.draw_request.current_requested_amount or refund_request.draw_request.net_amount):
        draw = refund_request.draw_request
        draw.status = DrawRequestStatus.REFUNDED
        draw.save(update_fields=["status", "updated_at"])
    if refund_request.external_payment_id and cumulative_cents >= _cents(refund_request.external_payment.net_amount):
        payment = refund_request.external_payment
        payment.status = ExternalPaymentStatus.REFUNDED
        payment.save(update_fields=["status", "updated_at"])
    if refund_request.milestone_id and cumulative_cents >= _cents(refund_request.milestone.amount):
        milestone = refund_request.milestone
        if hasattr(milestone, "descope_status"):
            milestone.descope_status = "refunded"
        if hasattr(milestone, "status"):
            milestone.status = "descoped_refunded"
        update_fields = [name for name in ["descope_status", "status"] if hasattr(milestone, name)]
        if update_fields:
            milestone.save(update_fields=update_fields)


def execute_refund_request(refund_request, *, actor=None):
    stripe.api_key = settings.STRIPE_SECRET_KEY
    with transaction.atomic():
        locked = CustomerRefundRequest.objects.select_for_update().select_related(
            "agreement__contractor", "agreement__homeowner", "agreement__project", "invoice", "draw_request", "milestone", "external_payment"
        ).get(pk=refund_request.pk)
        if locked.status == CustomerRefundRequest.Status.REFUNDED:
            return locked
        if locked.status not in {CustomerRefundRequest.Status.APPROVED, CustomerRefundRequest.Status.FAILED}:
            raise ValueError("The refund must be approved before it can be processed.")
        amount_cents = _cents(locked.approved_amount or locked.requested_amount)
        maximum = refund_request_max_cents(locked)
        if amount_cents <= 0:
            raise ValueError("Enter an approved refund amount.")
        if amount_cents > maximum:
            raise ValueError(f"Approved refund exceeds the available ${_money_from_cents(maximum)}.")
        previous_status = locked.status
        locked.status = CustomerRefundRequest.Status.PROCESSING
        locked.failure_reason = ""
        locked.save(update_fields=["status", "failure_reason", "updated_at"])
        record_refund_event(locked, event_type="processing", actor=actor, actor_role="contractor", from_status=previous_status)

    try:
        if locked.payment_mode == CustomerRefundRequest.PaymentMode.EXTERNAL:
            key = f"refund-request:{locked.id}:external:{locked.external_payment_id}:{amount_cents}"
            tx = _new_transaction(locked, action=CustomerRefundTransaction.Action.EXTERNAL_RECORD, amount_cents=amount_cents, key=key)
            _complete_transaction(tx)
        elif locked.payment_mode == CustomerRefundRequest.PaymentMode.DIRECT:
            payment_intent_id = ""
            charge_type = ""
            connected_account_id = ""
            if locked.invoice_id:
                payment_intent_id = str(locked.invoice.direct_pay_payment_intent_id or locked.invoice.stripe_payment_intent_id or "")
                charge_type = str(getattr(locked.invoice, "direct_pay_charge_type", "") or "")
                connected_account_id = str(getattr(locked.invoice, "direct_pay_connected_account_id", "") or "")
            elif locked.draw_request_id:
                payment_intent_id = str(locked.draw_request.stripe_payment_intent_id or "")
                charge_type = str(getattr(locked.draw_request, "direct_pay_charge_type", "") or "")
                connected_account_id = str(getattr(locked.draw_request, "direct_pay_connected_account_id", "") or "")
            if not payment_intent_id:
                raise ValueError("The original Direct Pay charge is not recorded.")
            if charge_type == "direct" and not connected_account_id:
                raise ValueError("The contractor Stripe account for this Direct Pay charge is not recorded.")
            _refund_payment_intent(
                locked,
                payment_intent_id=payment_intent_id,
                amount_cents=amount_cents,
                reverse_transfer=charge_type != "direct",
                refund_application_fee=True,
                connected_account_id=connected_account_id if charge_type == "direct" else "",
            )
        elif locked.source_type == CustomerRefundRequest.SourceType.ESCROW:
            _execute_escrow_balance(locked, amount_cents)
        else:
            transfer_id = str(
                getattr(locked.invoice, "stripe_transfer_id", "")
                if locked.invoice_id
                else getattr(locked.draw_request, "stripe_transfer_id", "")
            ).strip()
            if not transfer_id:
                raise ValueError("The original contractor transfer is not recorded.")
            payment = _payment_for_transfer(transfer_id)
            payout_cents = int(
                getattr(locked.invoice, "payout_cents", 0)
                if locked.invoice_id
                else getattr(locked.draw_request, "payout_cents", 0)
                or 0
            )
            gross_cents = _target_amount_cents(locked)
            already_reversed = int(CustomerRefundTransaction.objects.filter(
                **_same_source_transaction_filter(locked),
                action=CustomerRefundTransaction.Action.TRANSFER_REVERSAL,
                status=CustomerRefundTransaction.Status.SUCCEEDED,
            ).aggregate(total=Sum("amount_cents"))["total"] or 0)
            previously_refunded_cents = _already_refunded_cents(locked)
            cumulative_refund_cents = min(previously_refunded_cents + amount_cents, gross_cents)
            proportional_reversal_total = int(
                (Decimal(payout_cents) * Decimal(cumulative_refund_cents) / Decimal(max(gross_cents, 1)))
                .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            )
            reversal_cents = min(
                max(proportional_reversal_total - already_reversed, 0),
                max(payout_cents - already_reversed, 0),
            )
            if reversal_cents:
                _reverse_transfer(locked, transfer_id=transfer_id, amount_cents=reversal_cents)
            _refund_payment_intent(
                locked,
                payment_intent_id=str(payment.stripe_payment_intent_id),
                amount_cents=amount_cents,
                payment=payment,
                suffix=f"released:{payment.id}",
            )

        with transaction.atomic():
            locked = CustomerRefundRequest.objects.select_for_update().get(pk=locked.pk)
            previous_status = locked.status
            locked.status = CustomerRefundRequest.Status.REFUNDED
            locked.processed_at = timezone.now()
            locked.failure_reason = ""
            locked.save(update_fields=["status", "processed_at", "failure_reason", "updated_at"])
            _mark_source_refunded(locked, amount_cents)
            record_refund_event(
                locked,
                event_type="refunded",
                actor=actor,
                actor_role="contractor",
                from_status=previous_status,
                note=f"${_money_from_cents(amount_cents)} refund completed.",
            )
        notify_homeowner_refund_update(locked, message=f"A ${_money_from_cents(amount_cents)} refund was issued for Agreement #{locked.agreement_id}.")
        notify_contractor_refund_update(
            locked,
            title="Refund completed",
            body=f"The ${_money_from_cents(amount_cents)} refund for Agreement #{locked.agreement_id} was completed and recorded.",
            suffix="completed",
        )
        return locked
    except Exception as exc:
        logger.exception("Refund request %s failed", locked.id)
        with transaction.atomic():
            failed = CustomerRefundRequest.objects.select_for_update().get(pk=locked.pk)
            previous_status = failed.status
            failed.status = CustomerRefundRequest.Status.FAILED
            failed.failure_reason = str(exc)[:4000]
            failed.save(update_fields=["status", "failure_reason", "updated_at"])
            record_refund_event(failed, event_type="failed", actor=actor, actor_role="contractor", from_status=previous_status, note="Refund processing failed.")
        raise ValueError("The refund could not be completed. No additional refund step was attempted after the failure.") from exc


def respond_to_refund_request(refund_request, *, actor, action: str, approved_amount=None, note: str = ""):
    action = str(action or "").lower().strip()
    if action not in {"approve", "counter", "deny", "cancel", "retry"}:
        raise ValueError("Choose approve, counter, deny, cancel, or retry.")
    with transaction.atomic():
        row = CustomerRefundRequest.objects.select_for_update().get(pk=refund_request.pk)
        before = row.status
        if action == "retry":
            if row.status != CustomerRefundRequest.Status.FAILED:
                raise ValueError("Only a failed refund can be retried.")
            row.status = CustomerRefundRequest.Status.APPROVED
        elif action == "approve":
            if row.status not in {
                CustomerRefundRequest.Status.REFUND_REQUESTED,
                CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED,
                CustomerRefundRequest.Status.UNDER_REVIEW,
            }:
                raise ValueError("This refund request can no longer be approved from its current status.")
            amount = approved_amount if approved_amount not in (None, "") else row.requested_amount
            if amount in (None, ""):
                raise ValueError("Enter the approved refund amount.")
            row.approved_amount = amount
            row.status = CustomerRefundRequest.Status.APPROVED
        elif action == "counter":
            if row.status not in {
                CustomerRefundRequest.Status.REFUND_REQUESTED,
                CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED,
                CustomerRefundRequest.Status.UNDER_REVIEW,
                CustomerRefundRequest.Status.COUNTERED,
            }:
                raise ValueError("This refund request can no longer be countered.")
            if approved_amount in (None, "") or _cents(approved_amount) <= 0:
                raise ValueError("Enter the proposed refund amount.")
            row.approved_amount = approved_amount
            row.status = CustomerRefundRequest.Status.COUNTERED
        elif action == "deny":
            if row.status not in {
                CustomerRefundRequest.Status.REFUND_REQUESTED,
                CustomerRefundRequest.Status.CONTRACTOR_RESPONSE_NEEDED,
                CustomerRefundRequest.Status.UNDER_REVIEW,
                CustomerRefundRequest.Status.COUNTERED,
            }:
                raise ValueError("This refund request can no longer be denied.")
            row.status = CustomerRefundRequest.Status.DENIED
        else:
            if row.status not in ACTIVE_REFUND_STATUSES - {CustomerRefundRequest.Status.PROCESSING}:
                raise ValueError("This refund request can no longer be cancelled.")
            row.status = CustomerRefundRequest.Status.CANCELLED
        row.response_note = str(note or "").strip()
        row.responded_by = actor
        row.responded_at = timezone.now()
        row.save(update_fields=["approved_amount", "status", "response_note", "responded_by", "responded_at", "updated_at"])
        record_refund_event(row, event_type=action, actor=actor, actor_role="contractor", from_status=before, note=row.response_note, metadata={"approved_amount": str(row.approved_amount or "")})

    if action in {"approve", "retry"}:
        return execute_refund_request(row, actor=actor)
    if action == "counter":
        notify_homeowner_refund_update(row, message=f"The contractor proposed a ${row.approved_amount} refund for Agreement #{row.agreement_id}. Contact the contractor or use the dispute process if you disagree.")
    elif action == "deny":
        notify_homeowner_refund_update(row, message=f"The contractor declined refund request #{row.id}. Review the explanation in your portal; you may open a dispute if you disagree.")
    return row
