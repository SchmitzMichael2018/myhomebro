from __future__ import annotations

from datetime import date, datetime
from typing import Any

from django.utils import timezone

from projects.models import AgreementPaymentMode, ProjectStatus
from projects.services.agreement_locking import is_completed_agreement, is_signed_or_locked_agreement


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _is_signature_satisfied(agreement: Any) -> bool:
    try:
        v = getattr(agreement, "signature_is_satisfied")
        if isinstance(v, bool):
            return v
        if v is not None:
            return bool(v)
    except Exception:
        pass
    try:
        return bool(
            getattr(agreement, "signed_by_contractor", False)
            or getattr(agreement, "contractor_signed", False)
        ) and bool(
            getattr(agreement, "signed_by_homeowner", False)
            or getattr(agreement, "homeowner_signed", False)
        )
    except Exception:
        return False


def agreement_requires_escrow(agreement: Any) -> bool:
    mode = _normalize_text(getattr(agreement, "payment_mode", "") or AgreementPaymentMode.ESCROW)
    return mode != AgreementPaymentMode.DIRECT


def agreement_milestones_are_active(agreement: Any) -> bool:
    if agreement is None:
        return False

    status = _normalize_text(getattr(agreement, "status", ""))
    if status in {
        ProjectStatus.DRAFT,
        "pending_signature",
        "signature_pending",
        "awaiting_signature",
        "sent",
        "review",
    }:
        return False

    if is_completed_agreement(agreement):
        return True

    if not _is_signature_satisfied(agreement):
        return False

    if agreement_requires_escrow(agreement) and not bool(getattr(agreement, "escrow_funded", False)):
        return False

    if is_signed_or_locked_agreement(agreement):
        return True

    return bool(status) and status not in {ProjectStatus.DRAFT}


def _milestone_primary_date(milestone: Any):
    for attr in ("completion_date", "due_date", "scheduled_date", "scheduled_service_date", "start_date"):
        value = getattr(milestone, attr, None)
        if value:
            return value
    return None


def milestone_lifecycle_state(milestone: Any, *, today: date | None = None) -> str:
    """
    Returns one of: planned, scheduled, active, overdue.
    Draft / unsigned / not-funded milestones remain planned.
    """
    agreement = getattr(milestone, "agreement", None)
    if not agreement_milestones_are_active(agreement):
        return "planned"

    if bool(getattr(milestone, "completed", False)) or getattr(milestone, "completed_at", None):
        return "active"

    current = today or timezone.localdate()
    primary = _milestone_primary_date(milestone)
    if primary is None:
        return "scheduled"

    if isinstance(primary, datetime):
        primary = primary.date()

    if not isinstance(primary, date):
        return "scheduled"

    if primary < current:
        return "overdue"

    start_date = getattr(milestone, "start_date", None)
    if isinstance(start_date, datetime):
        start_date = start_date.date()
    if isinstance(start_date, date) and start_date <= current:
        return "active"

    return "scheduled"


def milestone_is_overdue(milestone: Any, *, today: date | None = None) -> bool:
    return milestone_lifecycle_state(milestone, today=today) == "overdue"


def should_show_active_calendar_entry(milestone: Any) -> bool:
    return milestone_lifecycle_state(milestone) != "planned"
