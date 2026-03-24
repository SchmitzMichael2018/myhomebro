from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from projects.models import InvoiceStatus, Milestone, MilestonePayout, MilestonePayoutStatus
from projects.services.milestone_workflow import ROLE_SUBCONTRACTOR, get_assigned_worker


def _money_to_cents(value) -> int:
    if value is None or value == "":
        return 0
    try:
        return int((Decimal(str(value)) * Decimal("100")).quantize(Decimal("1")))
    except (InvalidOperation, TypeError, ValueError):
        try:
            return int(round(float(value) * 100))
        except Exception:
            return 0


def payout_amount_cents_for_milestone(milestone: Milestone) -> int:
    configured = getattr(milestone, "subcontractor_payout_amount_cents", None)
    if configured is not None:
        try:
            return max(int(configured), 0)
        except Exception:
            return 0
    return max(_money_to_cents(getattr(milestone, "amount", 0)), 0)


def payout_customer_condition_satisfied(milestone: Milestone) -> bool:
    invoice = getattr(milestone, "invoice", None)
    if invoice is None:
        return False

    payment_mode = str(getattr(getattr(milestone, "agreement", None), "payment_mode", "") or "escrow").strip().lower()
    invoice_status = str(getattr(invoice, "status", "") or "").strip().lower()

    if payment_mode == "direct":
        return bool(getattr(invoice, "direct_pay_paid_at", None) or invoice_status == InvoiceStatus.PAID)

    return bool(
        getattr(invoice, "approved_at", None)
        or invoice_status in {InvoiceStatus.APPROVED, InvoiceStatus.PAID}
        or getattr(invoice, "escrow_released", False)
        or getattr(invoice, "escrow_released_at", None)
    )


def payout_payment_settled(milestone: Milestone) -> bool:
    invoice = getattr(milestone, "invoice", None)
    if invoice is None:
        return False

    invoice_status = str(getattr(invoice, "status", "") or "").strip().lower()
    payment_mode = str(getattr(getattr(milestone, "agreement", None), "payment_mode", "") or "escrow").strip().lower()

    if payment_mode == "direct":
        return bool(getattr(invoice, "direct_pay_paid_at", None) or invoice_status == InvoiceStatus.PAID)

    return bool(
        getattr(invoice, "escrow_released", False)
        or getattr(invoice, "escrow_released_at", None)
        or invoice_status == InvoiceStatus.PAID
    )


def _desired_payout_status(milestone: Milestone) -> str:
    if str(getattr(milestone, "subcontractor_completion_status", "") or "") != "approved":
        return MilestonePayoutStatus.NOT_ELIGIBLE
    if not payout_customer_condition_satisfied(milestone):
        return MilestonePayoutStatus.NOT_ELIGIBLE
    if payout_payment_settled(milestone):
        return MilestonePayoutStatus.READY_FOR_PAYOUT
    return MilestonePayoutStatus.ELIGIBLE


def sync_milestone_payout(milestone: Milestone | int) -> MilestonePayout | None:
    milestone_id = getattr(milestone, "id", milestone)
    if not milestone_id:
        return None

    with transaction.atomic():
        locked = (
            Milestone.objects.select_for_update()
            .select_related(
                "agreement",
                "invoice",
                "assigned_subcontractor_invitation",
                "assigned_subcontractor_invitation__accepted_by_user",
                "subaccount_assignment",
                "subaccount_assignment__subaccount",
                "subaccount_assignment__subaccount__user",
            )
            .get(pk=milestone_id)
        )

        worker = get_assigned_worker(locked)
        if worker is None or worker.kind != ROLE_SUBCONTRACTOR or getattr(worker.user, "id", None) is None:
            MilestonePayout.objects.filter(milestone=locked).delete()
            return None

        amount_cents = payout_amount_cents_for_milestone(locked)
        payout, _ = MilestonePayout.objects.get_or_create(
            milestone=locked,
            defaults={
                "subcontractor_user": worker.user,
                "amount_cents": amount_cents,
            },
        )

        desired_status = _desired_payout_status(locked)
        update_fields: list[str] = []

        if payout.subcontractor_user_id != getattr(worker.user, "id", None):
            payout.subcontractor_user = worker.user
            update_fields.append("subcontractor_user")

        if payout.amount_cents != amount_cents:
            payout.amount_cents = amount_cents
            update_fields.append("amount_cents")

        if payout.status not in {MilestonePayoutStatus.PAID, MilestonePayoutStatus.FAILED} and payout.status != desired_status:
            payout.status = desired_status
            update_fields.append("status")

        if desired_status == MilestonePayoutStatus.ELIGIBLE:
            if payout.eligible_at is None:
                payout.eligible_at = timezone.now()
                update_fields.append("eligible_at")
            if payout.ready_for_payout_at is not None:
                payout.ready_for_payout_at = None
                update_fields.append("ready_for_payout_at")
        elif desired_status == MilestonePayoutStatus.READY_FOR_PAYOUT:
            if payout.eligible_at is None:
                payout.eligible_at = timezone.now()
                update_fields.append("eligible_at")
            if payout.ready_for_payout_at is None:
                payout.ready_for_payout_at = timezone.now()
                update_fields.append("ready_for_payout_at")
        elif desired_status == MilestonePayoutStatus.NOT_ELIGIBLE and payout.status not in {
            MilestonePayoutStatus.PAID,
            MilestonePayoutStatus.FAILED,
        }:
            if payout.eligible_at is not None:
                payout.eligible_at = None
                update_fields.append("eligible_at")
            if payout.ready_for_payout_at is not None:
                payout.ready_for_payout_at = None
                update_fields.append("ready_for_payout_at")

        if update_fields:
            payout.save(update_fields=sorted(set(update_fields)))

        return payout


def sync_payout_for_invoice(invoice) -> MilestonePayout | None:
    milestone = getattr(invoice, "source_milestone", None)
    if milestone is not None:
        return sync_milestone_payout(milestone.id)

    milestone_id = getattr(invoice, "milestone_id_snapshot", None)
    if milestone_id:
        try:
            return sync_milestone_payout(int(milestone_id))
        except Exception:
            return None
    return None


def serialize_payout_for_milestone(milestone: Milestone) -> dict | None:
    payout = getattr(milestone, "payout_record", None)
    if payout is None:
        return None
    return {
        "payout_amount_cents": payout.amount_cents,
        "payout_amount": f"{Decimal(payout.amount_cents) / Decimal('100'):.2f}",
        "payout_status": payout.status,
        "payout_eligible": payout.status in {
            MilestonePayoutStatus.ELIGIBLE,
            MilestonePayoutStatus.READY_FOR_PAYOUT,
            MilestonePayoutStatus.PAID,
        },
        "payout_ready": payout.status in {
            MilestonePayoutStatus.READY_FOR_PAYOUT,
            MilestonePayoutStatus.PAID,
        },
    }
