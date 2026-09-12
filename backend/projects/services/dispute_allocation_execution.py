from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from payments.models import Payment, Refund
from projects.models import DrawRequest, DrawRequestStatus, ExpenseRequest, Invoice, InvoiceStatus
from projects.models_dispute import (
    DisputeEscrowAllocation,
    DisputeEscrowAllocationAttempt,
    DisputeEscrowAllocationSource,
    DisputePaymentHold,
)


def _stripe_id(value) -> str:
    raw = value.get("id") if isinstance(value, dict) else getattr(value, "id", "")
    return str(raw or "")


def _to_cents(value) -> int:
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _source_invoice(hold: DisputePaymentHold):
    if hold.invoice_id:
        return hold.invoice
    if hold.milestone_id:
        try:
            return hold.milestone.invoice
        except Exception:
            return None
    return None


def _released_legacy_gross_cents(agreement_id: int) -> int:
    """Gross escrow consumption not yet represented by allocation source rows."""
    settlement_ids = DisputeEscrowAllocation.objects.filter(
        dispute__agreement_id=agreement_id, settlement_invoice_id__isnull=False
    ).values_list("settlement_invoice_id", flat=True)
    invoices = Invoice.objects.filter(agreement_id=agreement_id).filter(
        Q(escrow_released=True) | Q(escrow_released_at__isnull=False) | ~Q(stripe_transfer_id="")
    ).exclude(id__in=settlement_ids)
    invoice_total = sum(_to_cents(row.amount) for row in invoices.only("amount"))

    draws = DrawRequest.objects.filter(agreement_id=agreement_id).filter(
        Q(released_at__isnull=False)
        | Q(status__in=[DrawRequestStatus.RELEASED, DrawRequestStatus.PAID])
        | ~Q(stripe_transfer_id="")
    )
    draw_total = sum(
        _to_cents(row.current_requested_amount or row.net_amount)
        for row in draws.only("current_requested_amount", "net_amount")
    )

    reimbursements = ExpenseRequest.objects.filter(
        agreement_id=agreement_id,
        request_kind=ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
        is_archived=False,
    ).filter(
        Q(released_at__isnull=False)
        | Q(status__in=[ExpenseRequest.Status.RELEASED, ExpenseRequest.Status.PAID])
        | ~Q(stripe_transfer_id="")
    )
    reimbursement_total = sum(_to_cents(row.amount) for row in reimbursements.only("amount"))

    allocation_refunds = DisputeEscrowAllocationSource.objects.exclude(
        stripe_refund_id=""
    ).values_list("stripe_refund_id", flat=True)
    refunds = Refund.objects.filter(payment__agreement_id=agreement_id, status="succeeded").exclude(
        stripe_refund_id__in=allocation_refunds
    )
    other_refunds = int(refunds.aggregate(total=Sum("amount_cents"))["total"] or 0)
    return invoice_total + draw_total + reimbursement_total + other_refunds


def agreement_escrow_source_balances(
    agreement_id: int, *, exclude_allocation_id: int | None = None, lock: bool = False
) -> list[dict]:
    """Return deterministic per-charge balances including dispute reservations.

    Historical releases that predate source tracking consume funding FIFO. New
    dispute allocations reserve explicit Payment records and therefore preserve
    the exact source charge used for every refund and transfer.
    """
    payments = Payment.objects.filter(agreement_id=agreement_id, status="succeeded").exclude(
        stripe_charge_id__isnull=True
    ).exclude(stripe_charge_id="").order_by("created_at", "id")
    if lock:
        payments = payments.select_for_update()
    rows = [
        {
            "payment": payment,
            "funded_cents": int(payment.amount_cents or 0),
            "legacy_consumed_cents": 0,
            "reserved_cents": 0,
            "available_cents": int(payment.amount_cents or 0),
        }
        for payment in payments
        if int(payment.amount_cents or 0) > 0
    ]
    legacy_remaining = _released_legacy_gross_cents(agreement_id)
    for row in rows:
        consumed = min(row["available_cents"], legacy_remaining)
        row["legacy_consumed_cents"] = consumed
        row["available_cents"] -= consumed
        legacy_remaining -= consumed

    sources = DisputeEscrowAllocationSource.objects.filter(
        allocation__dispute__agreement_id=agreement_id,
        allocation__status__in=[
            DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION,
            DisputeEscrowAllocation.STATUS_EXECUTED,
        ],
    )
    if exclude_allocation_id:
        sources = sources.exclude(allocation_id=exclude_allocation_id)
    reserved = {
        row["payment_id"]: int(row["total"] or 0)
        for row in sources.values("payment_id").annotate(total=Sum("source_amount_cents"))
    }
    for row in rows:
        row["reserved_cents"] = reserved.get(row["payment"].id, 0)
        row["available_cents"] = max(row["available_cents"] - row["reserved_cents"], 0)
    return rows


def dispute_allocation_execution_readiness(allocation: DisputeEscrowAllocation) -> tuple[bool, str]:
    if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
        return True, ""
    if not allocation.is_balanced:
        return False, "The allocation no longer balances to the held amount."
    available = sum(
        row["available_cents"]
        for row in agreement_escrow_source_balances(
            allocation.dispute.agreement_id, exclude_allocation_id=allocation.id
        )
    )
    if available < int(allocation.source_amount_cents or 0):
        return False, "Verified escrow funding charges do not have enough unallocated capacity for this split."
    if allocation.contractor_amount_cents and not str(
        getattr(allocation.dispute.agreement.contractor, "stripe_account_id", "") or ""
    ).strip():
        return False, "The contractor does not have a connected payout account."
    return True, ""


def _distribute_fee(gross_values: list[int], total_fee_cents: int) -> list[int]:
    total_gross = sum(gross_values)
    if total_gross <= 0:
        return [0 for _ in gross_values]
    fees = [(gross * total_fee_cents) // total_gross for gross in gross_values]
    for index in range(total_fee_cents - sum(fees)):
        fees[index % len(fees)] += 1
    return fees


def _prepare_sources(allocation_id: int, *, actor=None) -> DisputeEscrowAllocation:
    with transaction.atomic():
        allocation = DisputeEscrowAllocation.objects.select_for_update().select_related(
            "dispute__agreement__contractor", "payment_hold"
        ).get(pk=allocation_id)
        if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
            return allocation
        if allocation.status != DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION:
            raise ValueError("This allocation has not completed authorization and staff validation.")
        if not allocation.is_balanced:
            raise ValueError("Allocation amounts no longer equal the held source amount.")
        if not allocation.staff_confirmed_at:
            raise ValueError("Staff confirmation is required before execution.")
        existing = list(allocation.funding_sources.select_related("payment"))
        if existing:
            if sum(int(row.source_amount_cents) for row in existing) != int(allocation.source_amount_cents):
                raise ValueError("Existing escrow source reservations no longer equal the allocation amount.")
            return allocation

        agreement = allocation.dispute.agreement
        if allocation.contractor_amount_cents and not str(
            getattr(agreement.contractor, "stripe_account_id", "") or ""
        ).strip():
            raise ValueError("The contractor does not have a connected payout account.")
        balances = agreement_escrow_source_balances(
            agreement.id, exclude_allocation_id=allocation.id, lock=True
        )
        needed = int(allocation.source_amount_cents)
        slices = []
        for row in balances:
            take = min(int(row["available_cents"]), needed)
            if take:
                slices.append((row["payment"], take))
                needed -= take
            if not needed:
                break
        if needed:
            raise ValueError("No verified escrow funding source combination can support this allocation.")

        refund_remaining = int(allocation.homeowner_amount_cents)
        values = []
        for payment, source_amount in slices:
            refund_cents = min(source_amount, refund_remaining)
            refund_remaining -= refund_cents
            values.append((payment, source_amount, refund_cents, source_amount - refund_cents))

        from payments.fees import calculate_platform_fee_cents_for_invoice

        total_fee = 0
        if allocation.contractor_amount_cents:
            total_fee = max(0, int(calculate_platform_fee_cents_for_invoice(
                amount_cents=int(allocation.contractor_amount_cents),
                contractor=agreement.contractor,
                agreement_id=agreement.id,
                project_id=getattr(agreement, "project_id", None),
                context="dispute_allocation",
                is_high_risk=False,
            )))
        if allocation.contractor_amount_cents and total_fee >= int(allocation.contractor_amount_cents):
            raise ValueError("The contractor allocation is not sufficient after the disclosed platform fee.")
        fees = _distribute_fee([row[3] for row in values], total_fee)
        for (payment, source_amount, refund_cents, contractor_gross), fee_cents in zip(values, fees):
            source = DisputeEscrowAllocationSource.objects.create(
                allocation=allocation,
                payment=payment,
                source_amount_cents=source_amount,
                homeowner_refund_cents=refund_cents,
                contractor_gross_cents=contractor_gross,
                platform_fee_cents=fee_cents,
                contractor_payout_cents=contractor_gross - fee_cents,
            )
            DisputeEscrowAllocationAttempt.objects.create(
                allocation=allocation,
                source=source,
                action=DisputeEscrowAllocationAttempt.ACTION_SOURCE,
                amount_cents=source_amount,
                currency=allocation.currency,
                idempotency_key=f"dispute-allocation-source:{allocation.id}:{payment.id}",
                status=DisputeEscrowAllocationAttempt.STATUS_SUCCEEDED,
                completed_at=timezone.now(),
                actor=actor,
                metadata={
                    "payment_id": payment.id,
                    "payment_intent_id": payment.stripe_payment_intent_id or "",
                    "charge_id": payment.stripe_charge_id or "",
                },
            )
        return allocation


def _start_attempt(source, action: str, amount_cents: int, key: str, *, actor=None):
    with transaction.atomic():
        number = source.attempts.filter(action=action).count() + 1
        return DisputeEscrowAllocationAttempt.objects.create(
            allocation=source.allocation,
            source=source,
            action=action,
            attempt_number=number,
            amount_cents=amount_cents,
            currency=source.allocation.currency,
            idempotency_key=key,
            actor=actor,
            metadata={"payment_id": source.payment_id},
        )


def _finish_attempt(attempt, *, status: str, reference: str = "", error: str = "") -> None:
    DisputeEscrowAllocationAttempt.objects.filter(pk=attempt.pk).update(
        status=status,
        external_reference=reference,
        error_message=error[:4000],
        completed_at=timezone.now(),
    )


def _record_fee(source, *, actor=None) -> None:
    if not source.platform_fee_cents or source.attempts.filter(
        action=DisputeEscrowAllocationAttempt.ACTION_FEE,
        status=DisputeEscrowAllocationAttempt.STATUS_SUCCEEDED,
    ).exists():
        return
    attempt = _start_attempt(
        source,
        DisputeEscrowAllocationAttempt.ACTION_FEE,
        int(source.platform_fee_cents),
        f"dispute-allocation-fee:{source.allocation_id}:{source.payment_id}",
        actor=actor,
    )
    _finish_attempt(attempt, status=DisputeEscrowAllocationAttempt.STATUS_SUCCEEDED)


def _execute_source(source_id: int, stripe, *, actor=None) -> None:
    source = DisputeEscrowAllocationSource.objects.select_related(
        "allocation__dispute__agreement__contractor", "payment"
    ).get(pk=source_id)
    allocation, payment = source.allocation, source.payment
    agreement = allocation.dispute.agreement

    if source.homeowner_refund_cents and not source.stripe_refund_id:
        key = f"dispute-allocation-refund:{allocation.id}:{payment.id}:{allocation.idempotency_key}"
        attempt = _start_attempt(source, DisputeEscrowAllocationAttempt.ACTION_REFUND, int(source.homeowner_refund_cents), key, actor=actor)
        try:
            result = stripe.Refund.create(
                payment_intent=str(payment.stripe_payment_intent_id),
                amount=int(source.homeowner_refund_cents),
                reason="requested_by_customer",
                idempotency_key=key,
                metadata={
                    "kind": "dispute_escrow_allocation",
                    "dispute_id": str(allocation.dispute_id),
                    "allocation_id": str(allocation.id),
                    "agreement_id": str(agreement.id),
                    "source_payment_id": str(payment.id),
                },
            )
            refund_id = _stripe_id(result)
            if not refund_id:
                raise RuntimeError("Stripe did not return a refund identifier.")
            with transaction.atomic():
                locked = DisputeEscrowAllocationSource.objects.select_for_update().get(pk=source.pk)
                locked.stripe_refund_id = refund_id
                locked.status = DisputeEscrowAllocationSource.STATUS_PARTIAL
                locked.execution_error = ""
                locked.updated_at = timezone.now()
                locked.save(update_fields=["stripe_refund_id", "status", "execution_error", "updated_at"])
                Refund.objects.update_or_create(
                    stripe_refund_id=refund_id,
                    defaults={
                        "payment": payment,
                        "created_by": actor,
                        "amount_cents": int(source.homeowner_refund_cents),
                        "currency": allocation.currency.lower(),
                        "reason": "Authorized dispute allocation",
                        "note": f"Dispute #{allocation.dispute_id}, allocation #{allocation.id}",
                        "status": "succeeded",
                        "error_message": "",
                    },
                )
            _finish_attempt(attempt, status=DisputeEscrowAllocationAttempt.STATUS_SUCCEEDED, reference=refund_id)
        except Exception as exc:
            _finish_attempt(attempt, status=DisputeEscrowAllocationAttempt.STATUS_FAILED, error=str(exc))
            DisputeEscrowAllocationSource.objects.filter(pk=source.pk).update(
                status=DisputeEscrowAllocationSource.STATUS_FAILED,
                execution_error=str(exc)[:4000], updated_at=timezone.now()
            )
            raise ValueError("Stripe customer refund failed; no later transfer was attempted for this funding source.") from exc

    source.refresh_from_db()
    if source.contractor_payout_cents and not source.stripe_transfer_id:
        destination = str(getattr(agreement.contractor, "stripe_account_id", "") or "").strip()
        if not destination:
            raise ValueError("The contractor does not have a connected payout account.")
        key = f"dispute-allocation-transfer:{allocation.id}:{payment.id}:{allocation.idempotency_key}"
        attempt = _start_attempt(source, DisputeEscrowAllocationAttempt.ACTION_TRANSFER, int(source.contractor_payout_cents), key, actor=actor)
        try:
            result = stripe.Transfer.create(
                amount=int(source.contractor_payout_cents),
                currency=allocation.currency.lower(),
                destination=destination,
                source_transaction=str(payment.stripe_charge_id),
                idempotency_key=key,
                metadata={
                    "kind": "dispute_escrow_allocation",
                    "dispute_id": str(allocation.dispute_id),
                    "allocation_id": str(allocation.id),
                    "agreement_id": str(agreement.id),
                    "source_payment_id": str(payment.id),
                    "gross_contractor_cents": str(source.contractor_gross_cents),
                    "platform_fee_cents": str(source.platform_fee_cents),
                },
            )
            transfer_id = _stripe_id(result)
            if not transfer_id:
                raise RuntimeError("Stripe did not return a transfer identifier.")
            DisputeEscrowAllocationSource.objects.filter(pk=source.pk).update(
                stripe_transfer_id=transfer_id,
                status=DisputeEscrowAllocationSource.STATUS_EXECUTED,
                execution_error="", updated_at=timezone.now()
            )
            _finish_attempt(attempt, status=DisputeEscrowAllocationAttempt.STATUS_SUCCEEDED, reference=transfer_id)
        except Exception as exc:
            _finish_attempt(attempt, status=DisputeEscrowAllocationAttempt.STATUS_FAILED, error=str(exc))
            DisputeEscrowAllocationSource.objects.filter(pk=source.pk).update(
                status=DisputeEscrowAllocationSource.STATUS_FAILED,
                execution_error=str(exc)[:4000], updated_at=timezone.now()
            )
            raise ValueError("Stripe contractor transfer failed. The recorded source can be retried safely.") from exc
    source.refresh_from_db()
    if (not source.homeowner_refund_cents or source.stripe_refund_id) and (
        not source.contractor_payout_cents or source.stripe_transfer_id
    ):
        DisputeEscrowAllocationSource.objects.filter(pk=source.pk).update(
            status=DisputeEscrowAllocationSource.STATUS_EXECUTED,
            execution_error="", updated_at=timezone.now()
        )
    source.refresh_from_db()
    _record_fee(source, actor=actor)


def _finalize_allocation(allocation_id: int) -> DisputeEscrowAllocation:
    with transaction.atomic():
        allocation = DisputeEscrowAllocation.objects.select_for_update().select_related(
            "dispute__agreement", "payment_hold__milestone", "payment_hold__invoice"
        ).get(pk=allocation_id)
        if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
            return allocation
        sources = list(allocation.funding_sources.select_for_update())
        if not sources or sum(int(row.source_amount_cents) for row in sources) != int(allocation.source_amount_cents):
            raise ValueError("Escrow source records are incomplete.")
        if any(row.homeowner_refund_cents and not row.stripe_refund_id for row in sources):
            raise ValueError("A customer refund is still incomplete.")
        if any(row.contractor_payout_cents and not row.stripe_transfer_id for row in sources):
            raise ValueError("A contractor transfer is still incomplete.")

        now = timezone.now()
        refund_ids = [row.stripe_refund_id for row in sources if row.stripe_refund_id]
        transfer_ids = [row.stripe_transfer_id for row in sources if row.stripe_transfer_id]
        fee_cents = sum(int(row.platform_fee_cents) for row in sources)
        payout_cents = sum(int(row.contractor_payout_cents) for row in sources)
        invoice = allocation.settlement_invoice or _source_invoice(allocation.payment_hold)
        milestone = allocation.payment_hold.milestone
        if invoice is None:
            invoice = Invoice.objects.create(
                agreement=allocation.dispute.agreement,
                amount=Decimal(allocation.source_amount_cents) / 100,
                status=InvoiceStatus.SETTLED,
                approved_at=now,
                escrow_released=True,
                escrow_released_at=now,
                stripe_transfer_id=";".join(transfer_ids)[:255],
                platform_fee_cents=fee_cents,
                payout_cents=payout_cents,
                disputed=False,
                milestone_id_snapshot=getattr(milestone, "id", None),
                milestone_title_snapshot=getattr(milestone, "title", "") or "",
                milestone_description_snapshot=getattr(milestone, "description", "") or "",
                milestone_completion_notes=f"Settled through authorized Dispute #{allocation.dispute_id} allocation.",
            )
            if milestone is not None:
                milestone.invoice = invoice
                milestone.is_invoiced = True
                milestone.completed = True
                milestone.completed_at = milestone.completed_at or now
                milestone.save(update_fields=["invoice", "is_invoiced", "completed", "completed_at"])
        else:
            invoice.status = InvoiceStatus.SETTLED
            invoice.approved_at = invoice.approved_at or now
            invoice.escrow_released = True
            invoice.escrow_released_at = now
            invoice.stripe_transfer_id = ";".join(transfer_ids)[:255]
            invoice.platform_fee_cents = fee_cents
            invoice.payout_cents = payout_cents
            invoice.disputed = False
            invoice.save(update_fields=[
                "status", "approved_at", "escrow_released", "escrow_released_at",
                "stripe_transfer_id", "platform_fee_cents", "payout_cents", "disputed",
            ])

        allocation.status = DisputeEscrowAllocation.STATUS_EXECUTED
        allocation.executed_at = now
        allocation.settlement_invoice = invoice
        allocation.homeowner_refund_id = ";".join(refund_ids)[:255]
        allocation.contractor_transfer_id = ";".join(transfer_ids)[:255]
        allocation.execution_reference = ";".join(
            [*[f"refund:{value}" for value in refund_ids], *[f"transfer:{value}" for value in transfer_ids]]
        )[:255] or "no_external_movement"
        allocation.execution_error = ""
        allocation.updated_at = now
        allocation.save(update_fields=[
            "status", "executed_at", "settlement_invoice", "homeowner_refund_id",
            "contractor_transfer_id", "execution_reference", "execution_error", "updated_at",
        ])

        dispute = allocation.dispute
        dispute.approved_amount = Decimal(allocation.contractor_amount_cents) / 100
        dispute.disputed_remainder = Decimal(allocation.homeowner_amount_cents) / 100
        if not allocation.homeowner_amount_cents:
            dispute.financial_disposition = dispute.FINANCIAL_ELIGIBLE_RELEASE
            dispute.resolution_type = dispute.RESOLUTION_CONTRACTOR_PREVAILS
            dispute.status = "resolved_contractor"
        elif not allocation.contractor_amount_cents:
            dispute.financial_disposition = dispute.FINANCIAL_ELIGIBLE_REFUND
            dispute.resolution_type = dispute.RESOLUTION_CUSTOMER_PREVAILS
            dispute.status = "resolved_homeowner"
        else:
            dispute.financial_disposition = dispute.FINANCIAL_PARTIAL_MANUAL
            dispute.resolution_type = dispute.RESOLUTION_PARTIAL
            dispute.status = "resolved_partial"
        dispute.resolved_at = now
        dispute.escrow_frozen = False
        dispute.workflow_stage = dispute.STAGE_CLOSED
        dispute.save(update_fields=[
            "approved_amount", "disputed_remainder", "financial_disposition", "resolution_type",
            "status", "resolved_at", "escrow_frozen", "workflow_stage", "updated_at",
        ])
        hold = allocation.payment_hold
        hold.status = DisputePaymentHold.STATUS_RELEASED
        hold.released_at = now
        hold.release_reason = "Executed the authorized exact-dollar escrow allocation."
        hold.save(update_fields=["status", "released_at", "release_reason"])
        return allocation


def execute_dispute_escrow_allocation(allocation_id: int, *, actor=None) -> DisputeEscrowAllocation:
    """Execute with durable source and retry records around each Stripe call."""
    if not getattr(settings, "DISPUTE_ESCROW_ALLOCATION_EXECUTION_ENABLED", False):
        raise ValueError("Escrow allocation execution is disabled until production payment operations enable it.")
    allocation = _prepare_sources(allocation_id, actor=actor)
    if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
        return allocation
    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("Stripe is not configured.")
    import stripe

    stripe.api_key = stripe_key
    try:
        source_ids = allocation.funding_sources.order_by(
            "payment__created_at", "payment_id"
        ).values_list("id", flat=True)
        for source_id in source_ids:
            _execute_source(source_id, stripe, actor=actor)
    except ValueError as exc:
        DisputeEscrowAllocation.objects.filter(pk=allocation_id).update(
            execution_error=str(exc)[:4000], updated_at=timezone.now()
        )
        raise
    return _finalize_allocation(allocation_id)
