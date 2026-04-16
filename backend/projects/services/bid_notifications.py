from __future__ import annotations

from typing import Iterable

from projects.models import Notification, PublicContractorLead


def _safe_text(value) -> str:
    return ("" if value is None else str(value)).strip()


def _contractor_name(lead: PublicContractorLead) -> str:
    contractor = getattr(lead, "contractor", None)
    return (
        _safe_text(getattr(contractor, "business_name", ""))
        or _safe_text(getattr(contractor, "name", ""))
        or _safe_text(getattr(contractor, "email", ""))
        or "Contractor"
    )


def create_bid_awarded_notification(*, lead: PublicContractorLead, agreement) -> Notification | None:
    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None
    notification, _ = Notification.objects.get_or_create(
        contractor=contractor,
        event_type=Notification.EVENT_BID_AWARDED,
        public_lead=lead,
        defaults={
            "agreement": agreement,
            "actor_user": None,
            "actor_display_name": _contractor_name(lead),
            "actor_email": _safe_text(getattr(lead, "email", "")),
            "title": "Bid Awarded",
            "message": "Your bid was selected for this project.",
        },
    )
    return notification


def create_bid_not_selected_notification(*, lead: PublicContractorLead, agreement=None) -> Notification | None:
    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None
    notification, _ = Notification.objects.get_or_create(
        contractor=contractor,
        event_type=Notification.EVENT_BID_NOT_SELECTED,
        public_lead=lead,
        defaults={
            "agreement": agreement,
            "actor_user": None,
            "actor_display_name": _contractor_name(lead),
            "actor_email": _safe_text(getattr(lead, "email", "")),
            "title": "Bid Not Selected",
            "message": "Another contractor was selected for this project.",
        },
    )
    return notification


def create_bid_outcome_notifications(
    *,
    accepted_lead: PublicContractorLead,
    agreement,
    competing_leads: Iterable[PublicContractorLead] = (),
) -> list[Notification]:
    notifications: list[Notification] = []
    winner = create_bid_awarded_notification(lead=accepted_lead, agreement=agreement)
    if winner is not None:
        notifications.append(winner)
    for competitor in competing_leads:
        notification = create_bid_not_selected_notification(lead=competitor)
        if notification is not None:
            notifications.append(notification)
    return notifications
