from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Iterable


OPEN_STATUS_KEYS = {
    "draft",
    "sent_for_signature",
    "signed",
    "escrow_needed",
    "funded",
    "in_progress",
    "awaiting_review",
    "payment_pending",
    "disputed",
}

CLOSED_STATUS_KEYS = {"completed", "closed"}


def _text(value) -> str:
    return ("" if value is None else str(value)).strip()


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or "0").replace("$", "").replace(",", "").strip() or "0")
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def _status(payment: dict) -> str:
    return f"{_text(payment.get('status'))} {_text(payment.get('status_label'))}".lower()


def _kind(payment: dict) -> str:
    return f"{_text(payment.get('record_type'))} {_text(payment.get('record_type_label'))} {_text(payment.get('reference'))}".lower()


def _mode(payment: dict) -> str:
    return f"{_text(payment.get('payment_mode'))} {_text(payment.get('payment_mode_label'))}".lower()


def _ledger_value(payment: dict, key: str) -> Decimal:
    ledger = payment.get("escrow_ledger") or {}
    if not isinstance(ledger, dict):
        return Decimal("0.00")
    return _money(ledger.get(key))


def is_invoice(payment: dict) -> bool:
    return "invoice" in _kind(payment)


def is_escrow_funding(payment: dict) -> bool:
    if payment.get("escrow_funding_record") is True:
        return True
    status = _status(payment)
    kind = _kind(payment)
    return (
        kind == "escrow"
        or "escrow funding" in kind
        or "funding" in kind
        or _text(payment.get("reference")) == "escrow_funded"
        or ("funded" in status and _ledger_value(payment, "funded") > 0)
    )


def is_refund(payment: dict) -> bool:
    status = _status(payment)
    kind = _kind(payment)
    return "refund" in kind or "refund" in status or _money(payment.get("amount") or payment.get("amount_label")) < 0


def is_escrow_release(payment: dict) -> bool:
    if payment.get("released_to_contractor") is True:
        return not (is_escrow_funding(payment) or is_refund(payment))
    if payment.get("released_to_contractor") is False:
        return False
    status = _status(payment)
    kind = _kind(payment)
    mode = _mode(payment)
    if is_escrow_funding(payment) or is_refund(payment):
        return False
    if "draw" in kind or "reimbursement" in kind:
        return "paid" in status or "released" in status
    return is_invoice(payment) and "escrow" in mode and ("paid" in status or "released" in status)


def is_customer_payment(payment: dict) -> bool:
    if payment.get("customer_payment_recorded") is True:
        return not (is_escrow_funding(payment) or is_escrow_release(payment) or is_refund(payment))
    status = _status(payment)
    mode = _mode(payment)
    if is_escrow_funding(payment) or is_escrow_release(payment) or is_refund(payment):
        return False
    return is_invoice(payment) and "escrow" not in mode and "paid" in status


def is_reviewable(payment: dict) -> bool:
    status = _status(payment)
    kind = _kind(payment)
    return "draw" in kind and ("submitted" in status or "review" in status or "pending" in status)


def is_actionable_payment(payment: dict) -> bool:
    if payment.get("is_actionable") is False:
        return False
    if is_escrow_funding(payment) or is_refund(payment):
        return False
    return not (is_escrow_release(payment) or is_customer_payment(payment)) and _money(payment.get("amount") or payment.get("amount_label")) > 0


def build_customer_payment_model(payment_rows: Iterable[dict]) -> dict:
    rows = list(payment_rows or [])
    contractor_invoices = sum(
        (_money(row.get("amount") or row.get("amount_label")) for row in rows if is_invoice(row) and not is_escrow_funding(row)),
        Decimal("0.00"),
    )
    escrow_funding_rows_total = sum((_money(row.get("amount") or row.get("amount_label")) for row in rows if is_escrow_funding(row)), Decimal("0.00"))
    escrow_ledger_funded = max([Decimal("0.00")] + [_ledger_value(row, "funded") for row in rows])
    escrow_ledger_available = max([Decimal("0.00")] + [_ledger_value(row, "available") for row in rows])
    escrow_funded = max(escrow_funding_rows_total, escrow_ledger_funded)
    released_to_contractor = sum((_money(row.get("amount") or row.get("amount_label")) for row in rows if is_escrow_release(row)), Decimal("0.00"))
    customer_payments = sum((_money(row.get("amount") or row.get("amount_label")) for row in rows if is_customer_payment(row)), Decimal("0.00"))
    refunds = abs(sum((_money(row.get("amount") or row.get("amount_label")) for row in rows if is_refund(row)), Decimal("0.00")))
    pending_review = sum((_money(row.get("amount") or row.get("amount_label")) for row in rows if is_reviewable(row)), Decimal("0.00"))
    pending_payment = sum(
        (_money(row.get("amount") or row.get("amount_label")) for row in rows if is_actionable_payment(row) and not is_reviewable(row)),
        Decimal("0.00"),
    )
    calculated_remaining = max(Decimal("0.00"), escrow_funded - released_to_contractor - refunds)
    remaining_in_escrow = min(escrow_ledger_available, calculated_remaining) if escrow_ledger_available else calculated_remaining

    return {
        "project_value": "0.00",
        "escrow_funded": str(escrow_funded.quantize(Decimal("0.01"))),
        "released_to_contractor": str(released_to_contractor.quantize(Decimal("0.01"))),
        "remaining_in_escrow": str(remaining_in_escrow.quantize(Decimal("0.01"))),
        "pending_review": str(pending_review.quantize(Decimal("0.01"))),
        "pending_payment": str(pending_payment.quantize(Decimal("0.01"))),
        "contractor_invoices": str(contractor_invoices.quantize(Decimal("0.01"))),
        "customer_payments": str(customer_payments.quantize(Decimal("0.01"))),
        "refunds_adjustments": str(refunds.quantize(Decimal("0.01"))),
    }


def derive_customer_status(record: dict, agreement: dict | None = None, payment_rows: Iterable[dict] | None = None) -> dict:
    agreement = agreement or {}
    payments = list(payment_rows or [])
    haystack = " ".join(
        _text(value).lower()
        for value in [
            agreement.get("status"),
            agreement.get("status_label"),
            record.get("status"),
            record.get("status_label"),
            agreement.get("customer_visible_reason"),
            record.get("customer_visible_reason"),
        ]
    )
    fully_signed = bool(
        agreement.get("is_fully_signed")
        or record.get("is_fully_signed")
        or (
            (agreement.get("signed_by_contractor") or record.get("signed_by_contractor"))
            and (agreement.get("signed_by_homeowner") or record.get("signed_by_homeowner"))
        )
    )
    homeowner_signed = bool(agreement.get("signed_by_homeowner") or record.get("signed_by_homeowner"))
    contractor_signed = bool(agreement.get("signed_by_contractor") or record.get("signed_by_contractor"))
    milestones = record.get("milestones") or agreement.get("milestones") or []
    completed_milestones = [
        row for row in milestones if "complete" in _text(row.get("status")).lower() or bool(row.get("completed"))
    ]
    active_milestones = [
        row
        for row in milestones
        if _text(row.get("status"))
        and "complete" not in _text(row.get("status")).lower()
        and "cancel" not in _text(row.get("status")).lower()
        and "closed" not in _text(row.get("status")).lower()
    ]
    payment_mode = _text(agreement.get("payment_mode") or agreement.get("payment_mode_label") or record.get("payment_mode")).lower()
    payment_model = build_customer_payment_model(payments)
    escrow_funded = (
        _money(payment_model.get("escrow_funded")) > 0
        or _money(record.get("escrow_funded_amount") or agreement.get("escrow_funded_amount")) > 0
        or bool(record.get("escrow_funded") or agreement.get("escrow_funded"))
    )
    released_or_paid = _money(payment_model.get("released_to_contractor")) > 0 or _money(payment_model.get("customer_payments")) > 0

    if any(_text(row.get("dispute_status")).lower() not in {"", "none", "no dispute"} for row in payments) or "dispute" in haystack:
        return {"customer_status_key": "disputed", "customer_status_label": "Disputed", "customer_status_group": "open"}
    if any(is_reviewable(row) for row in payments) or "review" in haystack:
        return {"customer_status_key": "awaiting_review", "customer_status_label": "Awaiting Review", "customer_status_group": "open"}
    if any(is_actionable_payment(row) for row in payments):
        return {"customer_status_key": "payment_pending", "customer_status_label": "Payment Pending", "customer_status_group": "open"}
    if any(value in haystack for value in ["cancel", "archiv", "closed"]):
        return {"customer_status_key": "closed", "customer_status_label": "Closed", "customer_status_group": "closed"}
    if "complete" in haystack or record.get("completed_at") or agreement.get("completed_at"):
        return {"customer_status_key": "completed", "customer_status_label": "Completed", "customer_status_group": "closed"}
    if "funded" in haystack or escrow_funded:
        label = "In Progress" if active_milestones or completed_milestones else "Funded"
        key = "in_progress" if label == "In Progress" else "funded"
        return {"customer_status_key": key, "customer_status_label": label, "customer_status_group": "open"}
    if fully_signed or "signed" in haystack:
        if "escrow" in payment_mode and not released_or_paid and not escrow_funded:
            return {"customer_status_key": "escrow_needed", "customer_status_label": "Escrow Needed", "customer_status_group": "open"}
        if released_or_paid or active_milestones or completed_milestones:
            return {"customer_status_key": "in_progress", "customer_status_label": "In Progress", "customer_status_group": "open"}
        return {"customer_status_key": "signed", "customer_status_label": "Signed", "customer_status_group": "open"}
    if contractor_signed or homeowner_signed or "sent" in haystack or "signature" in haystack:
        return {"customer_status_key": "sent_for_signature", "customer_status_label": "Sent for Signature", "customer_status_group": "open"}
    if "draft" in haystack:
        return {"customer_status_key": "draft", "customer_status_label": "Draft", "customer_status_group": "open"}
    return {"customer_status_key": "in_progress", "customer_status_label": "In Progress", "customer_status_group": "open"}


def derive_contractor_status(record: dict, agreement: dict | None = None, payment_rows: Iterable[dict] | None = None) -> dict:
    customer = derive_customer_status(record, agreement, payment_rows)
    key = customer["customer_status_key"]
    label_map = {
        "draft": "Draft",
        "sent_for_signature": "Awaiting Signature",
        "signed": "Signed",
        "escrow_needed": "Escrow Needed",
        "funded": "Funded",
        "in_progress": "In Progress",
        "awaiting_review": "Awaiting Customer Review",
        "payment_pending": "Payment Pending",
        "disputed": "Disputed",
        "completed": "Completed",
        "closed": "Closed",
    }
    return {
        "contractor_status_key": key,
        "contractor_status_label": label_map.get(key, customer["customer_status_label"]),
        "contractor_status_group": customer["customer_status_group"],
    }


def enrich_customer_portal_rows(project_rows: list[dict], agreement_rows: list[dict], payment_rows: list[dict]) -> None:
    agreements_by_id = {str(row.get("id")): row for row in agreement_rows if row.get("id") is not None}
    for row in agreement_rows:
        related_payments = [payment for payment in payment_rows if str(payment.get("agreement_id") or "") == str(row.get("id") or "")]
        model = build_customer_payment_model(related_payments)
        agreement_funded = _money(row.get("escrow_funded_amount"))
        if agreement_funded > _money(model.get("escrow_funded")):
            model["escrow_funded"] = str(agreement_funded.quantize(Decimal("0.01")))
            released = _money(model.get("released_to_contractor"))
            refunds = _money(model.get("refunds_adjustments"))
            model["remaining_in_escrow"] = str(max(Decimal("0.00"), agreement_funded - released - refunds).quantize(Decimal("0.01")))
        model["project_value"] = str(_money(row.get("total_cost")).quantize(Decimal("0.01")))
        row["payment_summary"] = model
        row.update(derive_customer_status(row, row, related_payments))

    for row in project_rows:
        agreement = agreements_by_id.get(str(row.get("agreement_id") or "")) or {}
        related_payments = [
            payment
            for payment in payment_rows
            if (row.get("agreement_id") and str(payment.get("agreement_id") or "") == str(row.get("agreement_id")))
            or (_text(payment.get("project_title")) and _text(payment.get("project_title")) == _text(row.get("title")))
        ]
        model = build_customer_payment_model(related_payments)
        agreement_funded = _money(row.get("escrow_funded_amount") or agreement.get("escrow_funded_amount"))
        if agreement_funded > _money(model.get("escrow_funded")):
            model["escrow_funded"] = str(agreement_funded.quantize(Decimal("0.01")))
            released = _money(model.get("released_to_contractor"))
            refunds = _money(model.get("refunds_adjustments"))
            model["remaining_in_escrow"] = str(max(Decimal("0.00"), agreement_funded - released - refunds).quantize(Decimal("0.01")))
        model["project_value"] = str(_money(row.get("total_cost") or agreement.get("total_cost")).quantize(Decimal("0.01")))
        row["payment_summary"] = model
        row.update(derive_customer_status(row, agreement, related_payments))
