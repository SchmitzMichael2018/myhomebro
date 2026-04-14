from __future__ import annotations

from typing import Any

from projects.models import DrawRequestStatus, ExternalPaymentStatus


def _normalized_status(value: Any) -> str:
    return str(value or "").strip().lower()


def _active_payment_records(draw) -> list[Any]:
    prefetched = getattr(draw, "_prefetched_objects_cache", {}).get("external_payment_records")
    if prefetched is not None:
        return [
            record
            for record in prefetched
            if _normalized_status(getattr(record, "status", "")) != ExternalPaymentStatus.VOIDED
        ]
    return list(draw.external_payment_records.exclude(status=ExternalPaymentStatus.VOIDED))


def derive_draw_workflow_status(draw) -> str:
    payments = _active_payment_records(draw)
    payment_statuses = {_normalized_status(getattr(record, "status", "")) for record in payments}
    raw_status = _normalized_status(getattr(draw, "status", ""))
    payment_mode = _normalized_status(getattr(getattr(draw, "agreement", None), "payment_mode", ""))

    if ExternalPaymentStatus.DISPUTED in payment_statuses:
        return "disputed"
    if raw_status == DrawRequestStatus.PAID or getattr(draw, "paid_at", None):
        return "paid"
    if raw_status == DrawRequestStatus.RELEASED or getattr(draw, "released_at", None):
        return "released"
    if payment_statuses.intersection({ExternalPaymentStatus.RECORDED, ExternalPaymentStatus.VERIFIED}):
        return "paid"
    if raw_status == DrawRequestStatus.AWAITING_RELEASE:
        return "awaiting_release"
    if raw_status == DrawRequestStatus.APPROVED:
        return "payment_pending" if payment_mode == "direct" else "approved"
    if raw_status == DrawRequestStatus.REJECTED:
        return "rejected"
    if raw_status == DrawRequestStatus.CHANGES_REQUESTED:
        return "changes_requested"
    if raw_status == DrawRequestStatus.SUBMITTED:
        return "submitted"
    if raw_status == DrawRequestStatus.DRAFT:
        return "draft"
    return raw_status or "draft"


def draw_workflow_label(workflow_status: str) -> str:
    mapping = {
        "draft": "Draft",
        "submitted": "Submitted",
        "approved": "Approved",
        "awaiting_release": "Awaiting Release",
        "payment_pending": "Payment Pending",
        "released": "Released",
        "paid": "Paid",
        "rejected": "Rejected",
        "changes_requested": "Changes Requested",
        "disputed": "Disputed",
    }
    normalized = _normalized_status(workflow_status)
    return mapping.get(normalized, normalized.replace("_", " ").title() or "Draft")


def draw_workflow_message(draw) -> str:
    workflow_status = derive_draw_workflow_status(draw)
    if workflow_status == "submitted":
        return "Submitted for owner review."
    if workflow_status == "approved":
        return "Approved and ready for the next commercial billing step."
    if workflow_status == "awaiting_release":
        return "Approved by the owner. Escrow release is the next step."
    if workflow_status == "payment_pending":
        return "Approved by the owner. Payment is still pending through MyHomeBro."
    if workflow_status == "released":
        return "Escrow funds have been released for this draw."
    if workflow_status == "paid":
        return "Payment has been recorded for this draw."
    if workflow_status == "rejected":
        return "This draw was rejected."
    if workflow_status == "changes_requested":
        return "The owner requested changes before payment moves forward."
    if workflow_status == "disputed":
        return "A payment issue is under review for this draw."
    return "Draft draw. Not yet sent for owner review."


def serialize_draw_workflow(draw) -> dict[str, Any]:
    workflow_status = derive_draw_workflow_status(draw)
    return {
        "workflow_status": workflow_status,
        "workflow_status_label": draw_workflow_label(workflow_status),
        "workflow_message": draw_workflow_message(draw),
        "is_payment_pending": workflow_status == "payment_pending",
        "is_awaiting_release": workflow_status == "awaiting_release",
    }
