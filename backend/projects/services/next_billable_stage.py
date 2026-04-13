from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional

from projects.models import (
    Agreement,
    AgreementPaymentMode,
    AgreementProjectClass,
    InvoiceStatus,
)


def _to_decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _friendly_stage_title(milestone) -> str:
    title = str(getattr(milestone, "title", "") or "").strip()
    if title:
        return title
    order = getattr(milestone, "order", None)
    if order is not None:
        return f"Stage {order}"
    return "Next stage"


def _invoice_is_settled(invoice) -> bool:
    if not invoice:
        return False
    status = str(getattr(invoice, "status", "") or "").strip().lower()
    if status == InvoiceStatus.PAID:
        return True
    if bool(getattr(invoice, "escrow_released", False)):
        return True
    if getattr(invoice, "direct_pay_paid_at", None):
        return True
    return False


def _invoice_is_disputed(invoice) -> bool:
    if not invoice:
        return False
    if bool(getattr(invoice, "disputed", False)):
        return True
    return str(getattr(invoice, "status", "") or "").strip().lower() == InvoiceStatus.DISPUTED


def _build_status_payload(
    *,
    agreement: Agreement,
    milestone,
    status: str,
    status_label: str,
    tone: str,
    message: str,
) -> Dict[str, Any]:
    return {
        "available": True,
        "status": status,
        "status_label": status_label,
        "tone": tone,
        "message": message,
        "milestone_id": getattr(milestone, "id", None),
        "title": _friendly_stage_title(milestone),
        "order": getattr(milestone, "order", None),
        "amount": str(_to_decimal(getattr(milestone, "amount", None))),
        "completed": bool(getattr(milestone, "completed", False)),
        "is_invoiced": bool(getattr(milestone, "is_invoiced", False)),
        "payment_mode": str(getattr(agreement, "payment_mode", "") or "").strip().lower(),
        "payment_structure": str(getattr(agreement, "payment_structure", "") or "").strip().lower(),
    }


def build_next_billable_stage(agreement: Agreement) -> Optional[Dict[str, Any]]:
    if agreement is None:
        return None

    project_class = str(getattr(agreement, "project_class", "") or "").strip().lower()
    if project_class != AgreementProjectClass.COMMERCIAL:
        return None

    milestones = list(
        agreement.milestones.select_related("invoice").order_by("order", "id")
    )

    if not milestones:
        return {
            "available": False,
            "status": "no_milestones",
            "status_label": "Add stages to begin planning",
            "tone": "neutral",
            "message": "Add at least one commercial stage so billing readiness can be tracked here.",
        }

    payment_mode = str(getattr(agreement, "payment_mode", "") or "").strip().lower()
    escrow_required = payment_mode == AgreementPaymentMode.ESCROW
    escrow_funded = bool(getattr(agreement, "escrow_funded", False))

    for milestone in milestones:
        invoice = getattr(milestone, "invoice", None)

        if _invoice_is_settled(invoice):
            continue

        if _invoice_is_disputed(invoice):
            return _build_status_payload(
                agreement=agreement,
                milestone=milestone,
                status="attention_needed",
                status_label="Needs billing review",
                tone="warn",
                message="This stage has an active billing issue. Resolve it before moving into the next commercial billing step.",
            )

        if invoice is not None:
            invoice_status = str(getattr(invoice, "status", "") or "").strip().lower()
            if invoice_status in {
                InvoiceStatus.INCOMPLETE,
                InvoiceStatus.SENT,
                InvoiceStatus.PENDING,
            }:
                return _build_status_payload(
                    agreement=agreement,
                    milestone=milestone,
                    status="awaiting_approval",
                    status_label="Awaiting approval",
                    tone="neutral",
                    message="This stage is already billed. Approval should happen before the next structured billing step.",
                )
            if invoice_status == InvoiceStatus.APPROVED:
                return _build_status_payload(
                    agreement=agreement,
                    milestone=milestone,
                    status="approved_pending_payment",
                    status_label="Approved, awaiting payment",
                    tone="good",
                    message="This stage has been approved. Payment confirmation is the next milestone before moving ahead.",
                )

        if not bool(getattr(milestone, "completed", False)):
            return _build_status_payload(
                agreement=agreement,
                milestone=milestone,
                status="not_ready",
                status_label="Not ready yet",
                tone="neutral",
                message="Complete this stage first. Once the work is done, it becomes the next billable step.",
            )

        if escrow_required and not escrow_funded:
            return _build_status_payload(
                agreement=agreement,
                milestone=milestone,
                status="blocked_by_funding",
                status_label="Funding needed first",
                tone="warn",
                message="This stage is complete, but escrow funding still needs to be in place before billing can move forward.",
            )

        return _build_status_payload(
            agreement=agreement,
            milestone=milestone,
            status="ready_to_bill",
            status_label="Ready to bill",
            tone="good",
            message="This stage looks ready for the next commercial billing step when you're ready to invoice it.",
        )

    return {
        "available": False,
        "status": "all_settled",
        "status_label": "All current stages are settled",
        "tone": "good",
        "message": "All current commercial stages are already billed or settled. Add the next stage when more work is ready.",
    }
