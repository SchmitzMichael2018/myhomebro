from __future__ import annotations


TERMINAL_DISPUTE_STATUSES = {
    "resolved",
    "resolved_contractor",
    "resolved_customer",
    "resolved_homeowner",
    "closed",
    "canceled",
    "cancelled",
}


def normalize_dispute_status(value) -> str:
    return str(value or "").strip().lower()


def is_terminal_dispute_status(value) -> bool:
    status = normalize_dispute_status(value)
    if not status:
        return False
    if status in TERMINAL_DISPUTE_STATUSES:
        return True
    return status.startswith("resolved_")


def is_active_dispute_status(value) -> bool:
    return not is_terminal_dispute_status(value)
