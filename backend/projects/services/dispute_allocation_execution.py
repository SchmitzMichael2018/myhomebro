from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import InvoiceStatus
from projects.models_dispute import DisputeEscrowAllocation, DisputePaymentHold


def _stripe_id(value) -> str:
    if isinstance(value, dict):
        return str(value.get("id") or "")
    return str(getattr(value, "id", "") or "")


def _source_invoice(hold: DisputePaymentHold):
    if hold.invoice_id:
        return hold.invoice
    if hold.milestone_id:
        try:
            return hold.milestone.invoice
        except Exception:
            return None
    return None


def _source_payment(invoice, minimum_cents: int):
    # Use the same FIFO escrow-source accounting as ordinary invoice releases.
    # Merely selecting any agreement payment large enough can reuse an older,
    # already-consumed charge when an agreement has amendment funding.
    from projects.views.magic_invoice import _select_escrow_source_payment_for_invoice

    return _select_escrow_source_payment_for_invoice(invoice, minimum_cents)


@transaction.atomic
def execute_dispute_escrow_allocation(allocation_id: int, *, actor=None) -> DisputeEscrowAllocation:
    """Execute a validated allocation idempotently; refund precedes transfer.

    This is deliberately restricted to invoice/milestone escrow sources. Draw and
    reimbursement sources keep their existing dedicated release mechanisms.
    """
    if not getattr(settings, "DISPUTE_ESCROW_ALLOCATION_EXECUTION_ENABLED", False):
        raise ValueError("Escrow allocation execution is disabled until production payment operations enable it.")

    allocation = (
        DisputeEscrowAllocation.objects.select_for_update()
        .select_related(
            "dispute__agreement__contractor",
            "payment_hold__invoice",
            "payment_hold__milestone__invoice",
        )
        .get(pk=allocation_id)
    )
    if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
        return allocation
    if allocation.status != DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION:
        raise ValueError("This allocation has not completed authorization and staff validation.")
    if not allocation.is_balanced:
        raise ValueError("Allocation amounts no longer equal the held source amount.")
    if not allocation.staff_confirmed_at:
        raise ValueError("Staff confirmation is required before execution.")

    hold = allocation.payment_hold
    invoice = _source_invoice(hold)
    if invoice is None:
        raise ValueError("Automated allocation currently supports invoice-backed milestone escrow only.")
    if invoice.escrow_released or str(invoice.status or "").lower() in {"paid", "settled"}:
        raise ValueError("The source invoice has already been financially settled.")

    agreement = allocation.dispute.agreement
    contractor = getattr(agreement, "contractor", None)
    destination = str(getattr(contractor, "stripe_account_id", "") or "").strip()
    if allocation.contractor_amount_cents and not destination:
        raise ValueError("The contractor does not have a connected payout account.")
    payment = _source_payment(invoice, allocation.source_amount_cents)
    if payment is None:
        raise ValueError("No verified escrow funding source can support this allocation.")

    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("Stripe is not configured.")
    import stripe

    stripe.api_key = stripe_key
    allocation.execution_error = ""
    allocation.save(update_fields=["execution_error", "updated_at"])

    try:
        # Customer protection comes first. A later contractor-transfer failure is
        # retryable and cannot undo the already authorized refund.
        if allocation.homeowner_amount_cents and not allocation.homeowner_refund_id:
            refund = stripe.Refund.create(
                payment_intent=str(payment.stripe_payment_intent_id),
                amount=int(allocation.homeowner_amount_cents),
                reason="requested_by_customer",
                idempotency_key=f"dispute-allocation-refund:{allocation.id}:{allocation.idempotency_key}",
                metadata={
                    "kind": "dispute_escrow_allocation",
                    "dispute_id": str(allocation.dispute_id),
                    "allocation_id": str(allocation.id),
                    "agreement_id": str(agreement.id),
                },
            )
            allocation.homeowner_refund_id = _stripe_id(refund)
            if not allocation.homeowner_refund_id:
                raise RuntimeError("Stripe did not return a refund identifier.")
            allocation.save(update_fields=["homeowner_refund_id", "updated_at"])

        platform_fee_cents = 0
        contractor_payout_cents = int(allocation.contractor_amount_cents)
        if allocation.contractor_amount_cents and not allocation.contractor_transfer_id:
            from payments.fees import calculate_platform_fee_cents_for_invoice

            platform_fee_cents = int(calculate_platform_fee_cents_for_invoice(
                amount_cents=int(allocation.contractor_amount_cents),
                contractor=contractor,
                agreement_id=agreement.id,
                project_id=getattr(agreement, "project_id", None),
                context="dispute_allocation",
                is_high_risk=False,
            ))
            contractor_payout_cents = int(allocation.contractor_amount_cents) - max(platform_fee_cents, 0)
            if contractor_payout_cents <= 0:
                raise ValueError("The contractor allocation is not sufficient after the disclosed platform fee.")
            transfer = stripe.Transfer.create(
                amount=contractor_payout_cents,
                currency=allocation.currency.lower(),
                destination=destination,
                source_transaction=str(payment.stripe_charge_id),
                idempotency_key=f"dispute-allocation-transfer:{allocation.id}:{allocation.idempotency_key}",
                metadata={
                    "kind": "dispute_escrow_allocation",
                    "dispute_id": str(allocation.dispute_id),
                    "allocation_id": str(allocation.id),
                    "agreement_id": str(agreement.id),
                    "invoice_id": str(invoice.id),
                    "gross_contractor_cents": str(allocation.contractor_amount_cents),
                    "platform_fee_cents": str(platform_fee_cents),
                },
            )
            allocation.contractor_transfer_id = _stripe_id(transfer)
            if not allocation.contractor_transfer_id:
                raise RuntimeError("Stripe did not return a transfer identifier.")
            allocation.save(update_fields=["contractor_transfer_id", "updated_at"])
    except Exception as exc:
        allocation.execution_error = str(exc)[:4000]
        allocation.save(update_fields=["execution_error", "updated_at"])
        raise ValueError(f"Allocation execution is incomplete and can be retried safely: {exc}") from exc

    now = timezone.now()
    allocation.status = DisputeEscrowAllocation.STATUS_EXECUTED
    allocation.executed_at = now
    allocation.execution_reference = ";".join(
        value for value in [
            f"refund:{allocation.homeowner_refund_id}" if allocation.homeowner_refund_id else "",
            f"transfer:{allocation.contractor_transfer_id}" if allocation.contractor_transfer_id else "",
        ] if value
    ) or "no_external_movement"
    allocation.execution_error = ""
    allocation.save(update_fields=[
        "status", "executed_at", "execution_reference", "execution_error", "updated_at"
    ])

    invoice.status = InvoiceStatus.SETTLED
    invoice.approved_at = invoice.approved_at or now
    invoice.escrow_released = True
    invoice.escrow_released_at = now
    invoice.stripe_transfer_id = allocation.contractor_transfer_id
    invoice.platform_fee_cents = platform_fee_cents
    invoice.payout_cents = contractor_payout_cents if allocation.contractor_amount_cents else 0
    invoice.disputed = False
    invoice.save(update_fields=[
        "status", "approved_at", "escrow_released", "escrow_released_at",
        "stripe_transfer_id", "platform_fee_cents", "payout_cents", "disputed",
    ])
    allocation.dispute.approved_amount = Decimal(allocation.contractor_amount_cents) / Decimal("100")
    allocation.dispute.disputed_remainder = Decimal(allocation.homeowner_amount_cents) / Decimal("100")
    if allocation.homeowner_amount_cents == 0:
        allocation.dispute.financial_disposition = allocation.dispute.FINANCIAL_ELIGIBLE_RELEASE
        allocation.dispute.resolution_type = allocation.dispute.RESOLUTION_CONTRACTOR_PREVAILS
        allocation.dispute.status = "resolved_contractor"
    elif allocation.contractor_amount_cents == 0:
        allocation.dispute.financial_disposition = allocation.dispute.FINANCIAL_ELIGIBLE_REFUND
        allocation.dispute.resolution_type = allocation.dispute.RESOLUTION_CUSTOMER_PREVAILS
        allocation.dispute.status = "resolved_homeowner"
    else:
        allocation.dispute.financial_disposition = allocation.dispute.FINANCIAL_PARTIAL_MANUAL
        allocation.dispute.resolution_type = allocation.dispute.RESOLUTION_PARTIAL
        allocation.dispute.status = "resolved_partial"
    allocation.dispute.resolved_at = now
    allocation.dispute.escrow_frozen = False
    allocation.dispute.workflow_stage = allocation.dispute.STAGE_CLOSED
    allocation.dispute.save(update_fields=[
        "approved_amount", "disputed_remainder", "financial_disposition", "resolution_type", "status",
        "resolved_at", "escrow_frozen", "workflow_stage", "updated_at",
    ])
    hold.status = DisputePaymentHold.STATUS_RELEASED
    hold.released_at = now
    hold.release_reason = "Executed the authorized exact-dollar escrow allocation."
    hold.save(update_fields=["status", "released_at", "release_reason"])
    return allocation
