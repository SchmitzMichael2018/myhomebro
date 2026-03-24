from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from payments.models import ConnectedAccount
from payments.stripe_config import stripe
from projects.models import (
    MilestonePayout,
    MilestonePayoutExecutionMode,
    MilestonePayoutStatus,
)
from projects.services.milestone_workflow import ROLE_SUBCONTRACTOR, get_assigned_worker


def _payout_attempt_key(payout: MilestonePayout) -> str:
    marker = (
        getattr(payout, "ready_for_payout_at", None)
        or getattr(payout, "failed_at", None)
        or getattr(payout, "updated_at", None)
        or getattr(payout, "created_at", None)
    )
    marker_text = getattr(marker, "isoformat", lambda: str(marker or ""))()
    return f"milestone-payout:{payout.id}:{payout.status}:{marker_text}"


def execute_milestone_payout(
    payout_id: int,
    *,
    allow_failed_retry: bool = False,
    execution_mode: str = MilestonePayoutExecutionMode.MANUAL,
) -> MilestonePayout:
    with transaction.atomic():
        payout = (
            MilestonePayout.objects.select_for_update()
            .select_related(
                "milestone",
                "milestone__agreement",
                "milestone__agreement__project",
                "milestone__agreement__project__contractor",
                "milestone__assigned_subcontractor_invitation",
                "milestone__assigned_subcontractor_invitation__accepted_by_user",
                "subcontractor_user",
            )
            .get(pk=payout_id)
        )

        if payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip():
            raise ValueError("This payout has already been executed.")

        if payout.status == MilestonePayoutStatus.FAILED and allow_failed_retry:
            payout.failed_at = None
            payout.failure_reason = ""
            payout.execution_mode = execution_mode or payout.execution_mode or ""
            payout.save(update_fields=["failed_at", "failure_reason", "execution_mode", "updated_at"])
            payout.refresh_from_db()
        elif payout.status != MilestonePayoutStatus.READY_FOR_PAYOUT:
            raise ValueError("Only payouts marked ready_for_payout can be executed.")

        worker = get_assigned_worker(payout.milestone)
        if worker is None or worker.kind != ROLE_SUBCONTRACTOR:
            raise ValueError("Only subcontractor milestone payouts can be executed.")

        if getattr(worker.user, "id", None) != payout.subcontractor_user_id:
            raise ValueError("Payout recipient no longer matches the assigned subcontractor.")

        connected = ConnectedAccount.objects.filter(user=payout.subcontractor_user).first()
        acct_id = str(getattr(connected, "stripe_account_id", "") or "").strip()
        if not acct_id or not bool(getattr(connected, "payouts_enabled", False)):
            message = "Subcontractor payout account is not ready to receive payouts."
            payout.status = MilestonePayoutStatus.FAILED
            payout.failed_at = timezone.now()
            payout.failure_reason = message
            payout.execution_mode = execution_mode or payout.execution_mode or ""
            payout.save(update_fields=["status", "failed_at", "failure_reason", "execution_mode", "updated_at"])
            return payout

        try:
            transfer = stripe.Transfer.create(
                amount=int(payout.amount_cents),
                currency="usd",
                destination=acct_id,
                metadata={
                    "kind": "subcontractor_milestone_payout",
                    "milestone_payout_id": str(payout.id),
                    "milestone_id": str(getattr(payout.milestone, "id", "")),
                    "agreement_id": str(getattr(payout.milestone, "agreement_id", "")),
                    "subcontractor_user_id": str(payout.subcontractor_user_id),
                },
                idempotency_key=_payout_attempt_key(payout),
            )
        except Exception as exc:
            payout.status = MilestonePayoutStatus.FAILED
            payout.failed_at = timezone.now()
            payout.failure_reason = str(exc)
            payout.execution_mode = execution_mode or payout.execution_mode or ""
            payout.save(update_fields=["status", "failed_at", "failure_reason", "execution_mode", "updated_at"])
            return payout

        payout.status = MilestonePayoutStatus.PAID
        payout.paid_at = timezone.now()
        payout.stripe_transfer_id = str(transfer.get("id") or "")
        payout.failed_at = None
        payout.failure_reason = ""
        payout.execution_mode = execution_mode or payout.execution_mode or ""
        payout.save(
            update_fields=[
                "status",
                "paid_at",
                "stripe_transfer_id",
                "failed_at",
                "failure_reason",
                "execution_mode",
                "updated_at",
            ]
        )
        return payout


def reset_failed_milestone_payout(payout_id: int) -> MilestonePayout:
    with transaction.atomic():
        payout = (
            MilestonePayout.objects.select_for_update()
            .select_related(
                "milestone",
                "milestone__assigned_subcontractor_invitation",
                "milestone__assigned_subcontractor_invitation__accepted_by_user",
                "subcontractor_user",
            )
            .get(pk=payout_id)
        )

        if payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip():
            raise ValueError("Paid payouts cannot be reset.")

        if payout.status != MilestonePayoutStatus.FAILED:
            raise ValueError("Only failed payouts can be reset.")

        worker = get_assigned_worker(payout.milestone)
        if worker is None or worker.kind != ROLE_SUBCONTRACTOR:
            raise ValueError("Only subcontractor milestone payouts can be reset.")

        if getattr(worker.user, "id", None) != payout.subcontractor_user_id:
            raise ValueError("Payout recipient no longer matches the assigned subcontractor.")

        payout.status = MilestonePayoutStatus.READY_FOR_PAYOUT
        payout.ready_for_payout_at = payout.ready_for_payout_at or timezone.now()
        payout.failed_at = None
        payout.failure_reason = ""
        payout.save(
            update_fields=[
                "status",
                "ready_for_payout_at",
                "failed_at",
                "failure_reason",
                "updated_at",
            ]
        )
        return payout
