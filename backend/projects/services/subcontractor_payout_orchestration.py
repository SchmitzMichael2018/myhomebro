from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.utils import timezone

from payments.models import ConnectedAccount
from projects.models import Milestone, MilestonePayout, MilestonePayoutExecutionMode, MilestonePayoutStatus
from projects.models_dispute import Dispute
from projects.models_subcontractor import (
    SubcontractorMilestoneAgreement,
    SubcontractorMilestoneAgreementStatus,
    SubcontractorPaymentReleaseMode,
)
from projects.services.activity_feed import create_activity_event
from projects.services.milestone_payout_execution import execute_milestone_payout
from projects.services.milestone_payouts import (
    payout_customer_condition_satisfied,
    payout_payment_settled,
    payout_amount_cents_for_milestone,
    sync_milestone_payout,
)
from projects.services.subcontractor_notifications import create_subcontractor_activity_notification
from projects.services.subcontractor_payout_accounts import has_ready_connected_payout_account
from projects.services.subcontractor_milestone_agreements import (
    get_latest_subcontractor_milestone_agreement,
    serialize_subcontractor_milestone_agreement,
)
from projects.services.notification_center import create_notification


SUBCONTRACTOR_PAYOUT_STATES = {
    "not_due",
    "blocked",
    "ready",
    "scheduled",
    "processing",
    "paid",
    "failed",
    "cancelled",
}


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _normalize_money(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return _quantize_money(value)
    try:
        return _quantize_money(Decimal(str(value)))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def _agreement_release_mode(agreement: SubcontractorMilestoneAgreement | None) -> str:
    if agreement is None:
        return SubcontractorPaymentReleaseMode.MANUAL_RELEASE
    return str(getattr(agreement, "payment_release_mode", "") or SubcontractorPaymentReleaseMode.MANUAL_RELEASE)


def _agreement_display_name(agreement: SubcontractorMilestoneAgreement | None) -> str:
    if agreement is None:
        return "Subcontractor payout"
    milestone = getattr(agreement, "milestone", None)
    title = getattr(milestone, "title", "") or "Subcontractor payout"
    return title


def _agreement_customer_total(agreement: SubcontractorMilestoneAgreement | None) -> Decimal:
    milestone = getattr(agreement, "milestone", None)
    return _normalize_money(getattr(milestone, "amount", 0))


def _is_accepted(agreement: SubcontractorMilestoneAgreement | None) -> bool:
    return bool(agreement and agreement.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.ACCEPTED)


def _is_work_submitted(milestone: Milestone) -> bool:
    status = str(getattr(milestone, "subcontractor_completion_status", "") or "").strip().lower()
    return status in {"submitted_for_review", "approved"}


def _is_work_approved(milestone: Milestone) -> bool:
    return str(getattr(milestone, "subcontractor_completion_status", "") or "").strip().lower() == "approved"


def _has_active_dispute(agreement: SubcontractorMilestoneAgreement | None) -> bool:
    milestone = getattr(agreement, "milestone", None)
    agreement_obj = getattr(agreement, "agreement", None)
    if milestone is None or agreement_obj is None:
        return False

    active_statuses = {"initiated", "open", "under_review"}
    if Dispute.objects.filter(agreement=agreement_obj, status__in=active_statuses).exists():
        return True
    if Dispute.objects.filter(milestone=milestone, status__in=active_statuses).exists():
        return True

    invoice = getattr(milestone, "invoice", None)
    if invoice is not None:
        invoice_status = str(getattr(invoice, "status", "") or "").strip().lower()
        if bool(getattr(invoice, "disputed", False)) or invoice_status == "disputed":
            return True
    return False


def _agreement_payout_user(agreement: SubcontractorMilestoneAgreement | None):
    invitation = getattr(agreement, "subcontractor_invitation", None)
    return getattr(invitation, "accepted_by_user", None) if invitation is not None else None


def _payout_for_milestone(milestone: Milestone) -> MilestonePayout | None:
    payout = getattr(milestone, "payout_record", None)
    if payout is not None:
        return payout
    try:
        return MilestonePayout.objects.select_related("milestone").filter(milestone=milestone).first()
    except Exception:
        return None


def _status_from_payout(payout: MilestonePayout | None) -> str:
    if payout is None:
        return "not_due"
    if payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip():
        return "paid"
    if payout.status == MilestonePayoutStatus.FAILED:
        return "failed"
    if payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT:
        if payout.execution_mode == MilestonePayoutExecutionMode.AUTOMATIC:
            return "scheduled"
        return "ready"
    if payout.status == MilestonePayoutStatus.ELIGIBLE:
        return "not_due"
    return "not_due"


def _friendly_reason(reason: str, *, agreement: SubcontractorMilestoneAgreement | None = None) -> str:
    if reason == "agreement_not_accepted":
        return "The subcontractor agreement has not been accepted yet."
    if reason == "work_not_submitted":
        return "The subcontractor has not submitted work for review yet."
    if reason == "contractor_not_approved":
        return "The contractor has not approved the subcontractor work yet."
    if reason == "customer_not_approved_or_paid":
        return "Customer approval or payment release is still pending."
    if reason == "active_dispute":
        return "A dispute is active, so subcontractor payment is paused."
    if reason == "missing_payout_setup":
        return "The subcontractor payout account is not ready."
    if reason == "amount_invalid":
        return "The subcontractor pay amount is invalid."
    if reason == "payout_already_paid":
        return "This subcontractor payment has already been paid."
    if reason == "manual_release_required":
        return "Manual release is required for this agreement."
    return reason.replace("_", " ").strip().capitalize()


def evaluate_subcontractor_payout_eligibility(
    subcontractor_agreement: SubcontractorMilestoneAgreement | None,
) -> dict[str, Any]:
    if subcontractor_agreement is None:
        return {
            "eligible": False,
            "next_status": "not_due",
            "blocking_reasons": ["agreement_not_accepted"],
            "can_manual_release": False,
            "can_auto_release": False,
            "safe_summary": "No subcontractor payout agreement exists yet.",
        }

    milestone = getattr(subcontractor_agreement, "milestone", None)
    payout = _payout_for_milestone(milestone) if milestone is not None else None
    payout_user = _agreement_payout_user(subcontractor_agreement)
    release_mode = _agreement_release_mode(subcontractor_agreement)
    accepted = _is_accepted(subcontractor_agreement)
    amount_cents = payout_amount_cents_for_milestone(milestone) if milestone is not None else 0

    blocking_reasons: list[str] = []
    hard_blockers: set[str] = set()

    if not accepted:
        blocking_reasons.append("agreement_not_accepted")

    if milestone is None:
        blocking_reasons.append("work_not_submitted")
    else:
        if not _is_work_submitted(milestone):
            blocking_reasons.append("work_not_submitted")
        elif not _is_work_approved(milestone):
            blocking_reasons.append("contractor_not_approved")

    customer_ready = bool(milestone and payout_customer_condition_satisfied(milestone) and payout_payment_settled(milestone))
    if milestone is not None and _is_work_approved(milestone) and not customer_ready:
        blocking_reasons.append("customer_not_approved_or_paid")

    if _has_active_dispute(subcontractor_agreement):
        blocking_reasons.append("active_dispute")
        hard_blockers.add("active_dispute")

    if payout_user is None or not has_ready_connected_payout_account(payout_user):
        blocking_reasons.append("missing_payout_setup")
        hard_blockers.add("missing_payout_setup")

    if amount_cents <= 0:
        blocking_reasons.append("amount_invalid")
        hard_blockers.add("amount_invalid")

    if payout is not None and (
        payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip()
    ):
        blocking_reasons.append("payout_already_paid")
        hard_blockers.add("payout_already_paid")

    next_status = "not_due"
    if "payout_already_paid" in hard_blockers:
        next_status = "paid"
    elif "active_dispute" in hard_blockers:
        next_status = "cancelled"
    elif payout is not None and payout.status == MilestonePayoutStatus.FAILED:
        next_status = "failed"
    elif hard_blockers:
        next_status = "blocked"
    elif not customer_ready:
        next_status = "not_due"
    elif release_mode == SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL:
        next_status = "scheduled"
    else:
        next_status = "ready"

    can_manual_release = (
        accepted
        and customer_ready
        and release_mode == SubcontractorPaymentReleaseMode.MANUAL_RELEASE
        and "active_dispute" not in hard_blockers
        and "missing_payout_setup" not in hard_blockers
        and "amount_invalid" not in hard_blockers
        and "payout_already_paid" not in hard_blockers
    )
    can_auto_release = (
        accepted
        and customer_ready
        and release_mode == SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL
        and "active_dispute" not in hard_blockers
        and "missing_payout_setup" not in hard_blockers
        and "amount_invalid" not in hard_blockers
        and "payout_already_paid" not in hard_blockers
    )

    eligible = bool(can_manual_release or can_auto_release)
    if (
        payout is not None
        and payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT
        and payout.execution_mode == MilestonePayoutExecutionMode.AUTOMATIC
        and next_status not in {"blocked", "cancelled", "failed", "paid"}
    ):
        next_status = "scheduled"
    if (
        payout is not None
        and payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT
        and release_mode == SubcontractorPaymentReleaseMode.MANUAL_RELEASE
        and next_status not in {"blocked", "cancelled", "failed", "paid"}
    ):
        next_status = "ready"

    if payout is not None and payout.status == MilestonePayoutStatus.ELIGIBLE and next_status == "ready":
        next_status = "ready"

    safe_summary = " ".join(
        [
            _friendly_reason(blocking_reasons[0]) if blocking_reasons else (
                "Ready for contractor release." if next_status == "ready" else
                "Auto-release is scheduled once the customer release is complete." if next_status == "scheduled" else
                "Payout is paid." if next_status == "paid" else
                "Waiting for customer approval or release."
            )
        ]
    )

    payout_state = _status_from_payout(payout)
    if next_status == "paid":
        payout_state = "paid"
    elif next_status == "failed":
        payout_state = "failed"
    elif next_status == "cancelled":
        payout_state = "cancelled"
    elif next_status in {"ready", "scheduled"}:
        payout_state = next_status

    return {
        "eligible": eligible,
        "next_status": next_status if next_status in SUBCONTRACTOR_PAYOUT_STATES else "not_due",
        "state": payout_state if payout_state in SUBCONTRACTOR_PAYOUT_STATES else "not_due",
        "blocking_reasons": blocking_reasons,
        "blocking_reasons_labels": [_friendly_reason(reason) for reason in blocking_reasons],
        "can_manual_release": can_manual_release,
        "can_auto_release": can_auto_release,
        "safe_summary": safe_summary,
        "payment_release_mode": release_mode,
        "payment_release_mode_label": subcontractor_agreement.get_payment_release_mode_display()
        if hasattr(subcontractor_agreement, "get_payment_release_mode_display")
        else release_mode,
        "payout_amount": f"{Decimal(amount_cents) / Decimal('100'):.2f}",
        "payout_amount_cents": amount_cents,
        "payout_status": getattr(payout, "status", None),
        "payout_ready": bool(payout and payout.status == MilestonePayoutStatus.READY_FOR_PAYOUT),
        "payout_eligible": bool(payout and payout.status in {MilestonePayoutStatus.ELIGIBLE, MilestonePayoutStatus.READY_FOR_PAYOUT, MilestonePayoutStatus.PAID}),
        "payout_eligible_at": getattr(payout, "eligible_at", None),
        "payout_ready_for_payout_at": getattr(payout, "ready_for_payout_at", None),
        "payout_paid_at": getattr(payout, "paid_at", None),
        "payout_failed_at": getattr(payout, "failed_at", None),
        "payout_stripe_transfer_id": getattr(payout, "stripe_transfer_id", "") or "",
        "payout_failure_reason": getattr(payout, "failure_reason", "") or "",
        "payout_execution_mode": getattr(payout, "execution_mode", "") or "",
    }


def serialize_subcontractor_payout_orchestration(
    subcontractor_agreement: SubcontractorMilestoneAgreement | None,
    *,
    contractor_view: bool = False,
    subcontractor_view: bool = False,
) -> dict[str, Any] | None:
    if subcontractor_agreement is None:
        return None

    eligibility = evaluate_subcontractor_payout_eligibility(subcontractor_agreement)
    milestone = getattr(subcontractor_agreement, "milestone", None)
    agreement = getattr(subcontractor_agreement, "agreement", None)
    payload = {
        "agreement_id": getattr(subcontractor_agreement, "agreement_id", None),
        "milestone_id": getattr(subcontractor_agreement, "milestone_id", None),
        "subcontractor_agreement_id": getattr(subcontractor_agreement, "id", None),
        "subcontractor_display_name": getattr(
            getattr(getattr(subcontractor_agreement, "subcontractor_invitation", None), "accepted_by_user", None),
            "get_full_name",
            lambda: "",
        )()
        or getattr(getattr(subcontractor_agreement, "subcontractor_invitation", None), "invite_name", "")
        or getattr(getattr(subcontractor_agreement, "subcontractor_invitation", None), "invite_email", ""),
        "subcontractor_email": getattr(getattr(subcontractor_agreement, "subcontractor_invitation", None), "invite_email", "") or "",
        "agreed_pay": f"{_normalize_money(getattr(subcontractor_agreement, 'agreed_pay', 0)):.2f}",
        "payout_amount": eligibility["payout_amount"],
        "payout_amount_cents": eligibility["payout_amount_cents"],
        "payment_release_mode": eligibility["payment_release_mode"],
        "payment_release_mode_label": eligibility["payment_release_mode_label"],
        "payout_status": eligibility["payout_status"],
        "payout_state": eligibility["state"],
        "next_status": eligibility["next_status"],
        "blocking_reasons": eligibility["blocking_reasons"],
        "blocking_reasons_labels": [_friendly_reason(reason) for reason in eligibility["blocking_reasons"]],
        "can_manual_release": eligibility["can_manual_release"],
        "can_auto_release": eligibility["can_auto_release"],
        "safe_summary": eligibility["safe_summary"],
        "payout_eligible": eligibility["payout_eligible"],
        "payout_ready": eligibility["payout_ready"],
        "payout_eligible_at": eligibility["payout_eligible_at"],
        "payout_ready_for_payout_at": eligibility["payout_ready_for_payout_at"],
        "payout_paid_at": eligibility["payout_paid_at"],
        "payout_failed_at": eligibility["payout_failed_at"],
        "payout_stripe_transfer_id": eligibility["payout_stripe_transfer_id"],
        "payout_failure_reason": eligibility["payout_failure_reason"],
        "payout_execution_mode": eligibility["payout_execution_mode"],
    }

    if contractor_view:
        payload["customer_milestone_amount"] = f"{_normalize_money(getattr(milestone, 'amount', 0)):.2f}" if milestone else "0.00"
        payload["customer_agreement_total"] = f"{_normalize_money(getattr(agreement, 'total_cost', 0)):.2f}" if agreement else "0.00"

    if subcontractor_view:
        payload.pop("customer_milestone_amount", None)
        payload.pop("customer_agreement_total", None)

    return payload


def _latest_agreement_for_milestone(milestone: Milestone) -> SubcontractorMilestoneAgreement | None:
    invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
    if invitation is None:
        return None
    return get_latest_subcontractor_milestone_agreement(milestone, invitation)


def _send_payout_notifications(
    *,
    agreement: SubcontractorMilestoneAgreement,
    state: str,
    actor_user=None,
    detail: str = "",
) -> None:
    milestone = getattr(agreement, "milestone", None)
    contractor = getattr(getattr(agreement, "agreement", None), "contractor", None)
    subcontractor_user = getattr(getattr(agreement, "subcontractor_invitation", None), "accepted_by_user", None)
    if milestone is None or contractor is None:
        return

    if state == "ready":
        try:
            create_activity_event(
                contractor=contractor,
                actor_user=actor_user,
                agreement=agreement.agreement,
                milestone=milestone,
                event_type="subcontractor_payout_ready",
                title="Subcontractor payout ready",
                summary=f"{_agreement_display_name(agreement)} is ready for manual release.",
                severity="info",
                related_label=_agreement_display_name(agreement),
                icon_hint="payment",
                navigation_target=f"/app/agreements/{agreement.agreement_id}",
                metadata={"agreement_id": agreement.agreement_id, "milestone_id": milestone.id},
                dedupe_key=f"subcontractor_payout_ready:{agreement.id}:{milestone.id}:{getattr(getattr(milestone, 'payout_record', None), 'id', milestone.id)}",
            )
        except Exception:
            pass
        try:
            create_notification(
                contractor=contractor,
                user=getattr(contractor, "user", None),
                category="subcontractor_payout_ready",
                title="Subcontractor payout ready",
                body=f"{_agreement_display_name(agreement)} is ready for manual release.",
                link=f"/app/agreements/{agreement.agreement_id}",
                agreement=agreement.agreement,
                milestone=milestone,
            )
        except Exception:
            pass
        if subcontractor_user is not None:
            try:
                create_subcontractor_activity_notification(
                    milestone=milestone,
                    actor_user=actor_user or subcontractor_user,
                    event_type="subcontractor_payout_ready",
                )
            except Exception:
                pass

    elif state == "scheduled":
        try:
            create_activity_event(
                contractor=contractor,
                actor_user=actor_user,
                agreement=agreement.agreement,
                milestone=milestone,
                event_type="subcontractor_payout_scheduled",
                title="Subcontractor payout scheduled",
                summary=f"{_agreement_display_name(agreement)} is scheduled for automatic release.",
                severity="info",
                related_label=_agreement_display_name(agreement),
                icon_hint="payment",
                navigation_target=f"/app/agreements/{agreement.agreement_id}",
                metadata={"agreement_id": agreement.agreement_id, "milestone_id": milestone.id},
                dedupe_key=f"subcontractor_payout_scheduled:{agreement.id}:{milestone.id}:{getattr(getattr(milestone, 'payout_record', None), 'id', milestone.id)}",
            )
        except Exception:
            pass
        try:
            create_notification(
                contractor=contractor,
                user=getattr(contractor, "user", None),
                category="subcontractor_payout_scheduled",
                title="Subcontractor payout scheduled",
                body=f"{_agreement_display_name(agreement)} is scheduled for automatic release.",
                link=f"/app/agreements/{agreement.agreement_id}",
                agreement=agreement.agreement,
                milestone=milestone,
            )
        except Exception:
            pass
        if subcontractor_user is not None:
            try:
                create_notification(
                    contractor=None,
                    user=subcontractor_user,
                    category="subcontractor_payout_ready",
                    title="Payment pending",
                    body=f"Payment for {milestone.title} is pending release.",
                    link="/app/subcontractor/assigned-work",
                    agreement=agreement.agreement,
                    milestone=milestone,
                )
            except Exception:
                pass

    elif state == "paid":
        try:
            create_activity_event(
                contractor=contractor,
                actor_user=actor_user,
                agreement=agreement.agreement,
                milestone=milestone,
                event_type="subcontractor_payout_paid",
                title="Subcontractor payout paid",
                summary=f"{_agreement_display_name(agreement)} has been paid.",
                severity="success",
                related_label=_agreement_display_name(agreement),
                icon_hint="payment",
                navigation_target=f"/app/agreements/{agreement.agreement_id}",
                metadata={"agreement_id": agreement.agreement_id, "milestone_id": milestone.id},
                dedupe_key=f"subcontractor_payout_paid:{agreement.id}:{milestone.id}:{getattr(getattr(milestone, 'payout_record', None), 'id', milestone.id)}",
            )
        except Exception:
            pass
        try:
            create_notification(
                contractor=contractor,
                user=getattr(contractor, "user", None),
                category="subcontractor_payout_paid",
                title="Subcontractor payout paid",
                body=f"{_agreement_display_name(agreement)} has been paid.",
                link=f"/app/agreements/{agreement.agreement_id}",
                agreement=agreement.agreement,
                milestone=milestone,
            )
        except Exception:
            pass
        if subcontractor_user is not None:
            try:
                create_notification(
                    contractor=None,
                    user=subcontractor_user,
                    category="subcontractor_payout_paid",
                    title="Payment sent",
                    body=f"Your payment for {milestone.title} has been released.",
                    link="/app/subcontractor/assigned-work",
                    agreement=agreement.agreement,
                    milestone=milestone,
                )
            except Exception:
                pass

    elif state == "failed":
        try:
            create_activity_event(
                contractor=contractor,
                actor_user=actor_user,
                agreement=agreement.agreement,
                milestone=milestone,
                event_type="subcontractor_payout_failed",
                title="Subcontractor payout failed",
                summary=f"{_agreement_display_name(agreement)} payout failed: {detail or 'Review required.'}",
                severity="warning",
                related_label=_agreement_display_name(agreement),
                icon_hint="payment",
                navigation_target=f"/app/agreements/{agreement.agreement_id}",
                metadata={"agreement_id": agreement.agreement_id, "milestone_id": milestone.id},
                dedupe_key=f"subcontractor_payout_failed:{agreement.id}:{milestone.id}:{getattr(getattr(milestone, 'payout_record', None), 'id', milestone.id)}",
            )
        except Exception:
            pass
        try:
            create_notification(
                contractor=contractor,
                user=getattr(contractor, "user", None),
                category="subcontractor_payout_failed",
                title="Subcontractor payout failed",
                body=f"{_agreement_display_name(agreement)} payout failed. {detail or ''}".strip(),
                link=f"/app/agreements/{agreement.agreement_id}",
                agreement=agreement.agreement,
                milestone=milestone,
            )
        except Exception:
            pass
        if subcontractor_user is not None:
            try:
                create_notification(
                    contractor=None,
                    user=subcontractor_user,
                    category="subcontractor_payout_failed",
                    title="Payment delayed",
                    body=f"Your payment for {milestone.title} needs attention.",
                    link="/app/subcontractor/assigned-work",
                    agreement=agreement.agreement,
                    milestone=milestone,
                )
            except Exception:
                pass

    elif state == "cancelled":
        try:
            create_activity_event(
                contractor=contractor,
                actor_user=actor_user,
                agreement=agreement.agreement,
                milestone=milestone,
                event_type="subcontractor_payout_cancelled",
                title="Subcontractor payout cancelled",
                summary=f"{_agreement_display_name(agreement)} payout was cancelled because of a dispute.",
                severity="warning",
                related_label=_agreement_display_name(agreement),
                icon_hint="alert",
                navigation_target=f"/app/agreements/{agreement.agreement_id}",
                metadata={"agreement_id": agreement.agreement_id, "milestone_id": milestone.id},
                dedupe_key=f"subcontractor_payout_cancelled:{agreement.id}:{milestone.id}:{getattr(getattr(milestone, 'payout_record', None), 'id', milestone.id)}",
            )
        except Exception:
            pass


@transaction.atomic
def orchestrate_subcontractor_payout_for_milestone(
    milestone: Milestone | int,
    *,
    trigger: str,
    actor_user=None,
) -> dict[str, Any] | None:
    milestone_id = getattr(milestone, "id", milestone)
    if not milestone_id:
        return None

    locked = (
        Milestone.objects.select_for_update()
        .select_related(
            "agreement",
            "agreement__project",
            "agreement__project__contractor",
            "agreement__contractor",
            "invoice",
            "assigned_subcontractor_invitation",
            "assigned_subcontractor_invitation__accepted_by_user",
            "payout_record",
        )
        .get(pk=milestone_id)
    )
    agreement = _latest_agreement_for_milestone(locked)
    if agreement is None:
        return None

    payout_before = _payout_for_milestone(locked)
    payout_before_status = getattr(payout_before, "status", None)
    payout_before_ready = getattr(payout_before, "ready_for_payout_at", None)
    payout_before_paid = getattr(payout_before, "paid_at", None)

    payout = sync_milestone_payout(locked.id)
    agreement = _latest_agreement_for_milestone(locked) or agreement
    eligibility = evaluate_subcontractor_payout_eligibility(agreement)
    payout = _payout_for_milestone(locked) or payout

    if payout is None:
        return None

    release_mode = _agreement_release_mode(agreement)
    payment_ready = bool(eligibility["can_manual_release"] or eligibility["can_auto_release"])

    if eligibility["next_status"] == "cancelled":
        if payout.status not in {MilestonePayoutStatus.PAID, MilestonePayoutStatus.FAILED}:
            payout.status = MilestonePayoutStatus.NOT_ELIGIBLE
            payout.failure_reason = "Cancelled due to active dispute."
            payout.save(update_fields=["status", "failure_reason", "updated_at"])
        _send_payout_notifications(agreement=agreement, state="cancelled", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

    if payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip():
        _send_payout_notifications(agreement=agreement, state="paid", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

    if release_mode == SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL and payment_ready:
        connected = _agreement_payout_user(agreement)
        if connected is None or not has_ready_connected_payout_account(connected):
            _send_payout_notifications(
                agreement=agreement,
                state="blocked",
                actor_user=actor_user,
                detail="Subcontractor payout account is not ready.",
            )
            return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

        try:
            released = execute_milestone_payout(
                payout.id,
                execution_mode=MilestonePayoutExecutionMode.AUTOMATIC,
            )
        except ValueError as exc:
            payout = _payout_for_milestone(locked) or payout
            payout.failure_reason = str(exc)
            payout.status = MilestonePayoutStatus.FAILED
            payout.failed_at = timezone.now()
            payout.save(update_fields=["status", "failed_at", "failure_reason", "updated_at"])
            _send_payout_notifications(agreement=agreement, state="failed", actor_user=actor_user, detail=str(exc))
            return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

        _send_payout_notifications(agreement=agreement, state="paid", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

    if payment_ready and release_mode == SubcontractorPaymentReleaseMode.MANUAL_RELEASE:
        if payout.status != MilestonePayoutStatus.READY_FOR_PAYOUT:
            payout.status = MilestonePayoutStatus.READY_FOR_PAYOUT
            payout.ready_for_payout_at = payout.ready_for_payout_at or timezone.now()
            payout.execution_mode = payout.execution_mode or MilestonePayoutExecutionMode.MANUAL
            payout.save(
                update_fields=[
                    "status",
                    "ready_for_payout_at",
                    "execution_mode",
                    "updated_at",
                ]
            )
        if payout_before_status != MilestonePayoutStatus.READY_FOR_PAYOUT or not payout_before_ready:
            _send_payout_notifications(agreement=agreement, state="ready", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

    if eligibility["next_status"] == "scheduled":
        if payout_before_status != MilestonePayoutStatus.READY_FOR_PAYOUT or not payout_before_ready:
            _send_payout_notifications(agreement=agreement, state="scheduled", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)

    if eligibility["blocking_reasons"]:
        _send_payout_notifications(
            agreement=agreement,
            state="blocked",
            actor_user=actor_user,
            detail=", ".join(eligibility["blocking_reasons_labels"]),
        )

    return serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)


def release_subcontractor_payment(
    subcontractor_agreement: SubcontractorMilestoneAgreement,
    *,
    actor_user,
    allow_staff_override: bool = False,
) -> dict[str, Any]:
    eligibility = evaluate_subcontractor_payout_eligibility(subcontractor_agreement)
    payout_user = _agreement_payout_user(subcontractor_agreement)
    release_mode = _agreement_release_mode(subcontractor_agreement)
    if release_mode != SubcontractorPaymentReleaseMode.MANUAL_RELEASE and not allow_staff_override:
        raise ValueError("Manual release is only available for manual release agreements.")

    if not eligibility["can_manual_release"] and not allow_staff_override:
        raise ValueError(", ".join(eligibility["blocking_reasons_labels"]) or "Payout is not ready.")

    milestone = getattr(subcontractor_agreement, "milestone", None)
    if milestone is None:
        raise ValueError("Milestone is missing.")

    payout = sync_milestone_payout(milestone.id)
    if payout is None:
        raise ValueError("No subcontractor payout record exists for this milestone.")

    if payout.status == MilestonePayoutStatus.PAID or payout.paid_at or (payout.stripe_transfer_id or "").strip():
        _send_payout_notifications(agreement=subcontractor_agreement, state="paid", actor_user=actor_user)
        return serialize_subcontractor_payout_orchestration(subcontractor_agreement, contractor_view=True)

    if payout_user is None or not has_ready_connected_payout_account(payout_user):
        raise ValueError("Subcontractor payout account is not ready.")

    released = execute_milestone_payout(
        payout.id,
        execution_mode=MilestonePayoutExecutionMode.MANUAL,
    )
    if released.status == MilestonePayoutStatus.PAID:
        _send_payout_notifications(agreement=subcontractor_agreement, state="paid", actor_user=actor_user)
    elif released.status == MilestonePayoutStatus.FAILED:
        _send_payout_notifications(
            agreement=subcontractor_agreement,
            state="failed",
            actor_user=actor_user,
            detail=getattr(released, "failure_reason", "") or "",
        )
    return serialize_subcontractor_payout_orchestration(subcontractor_agreement, contractor_view=True)
