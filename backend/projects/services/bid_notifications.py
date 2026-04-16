from __future__ import annotations

from typing import Iterable

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

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


def _frontend_base_url() -> str:
    return str(
        getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "")
        or getattr(settings, "FRONTEND_URL", "")
        or ""
    ).rstrip("/")


def _absolute_frontend_url(path: str) -> str:
    base = _frontend_base_url()
    path = str(path or "").strip()
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if base:
        return f"{base}{path}"
    return path


def _bid_project_title(lead: PublicContractorLead, agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", None))
        or _safe_text(getattr(agreement, "project_title", None))
        or _safe_text(getattr(lead, "project_type", None))
        or _safe_text(getattr(lead, "project_description", None))
        or f"Bid #{getattr(lead, 'id', '')}"
    )


def _send_bid_outcome_email(*, recipient_email: str, subject: str, template_prefix: str, context: dict) -> None:
    if not recipient_email:
        return

    text_body = render_to_string(f"{template_prefix}.txt", context)
    html_body = render_to_string(f"{template_prefix}.html", context)
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com"),
        to=[recipient_email],
        reply_to=[email for email in [getattr(settings, "SUPPORT_EMAIL", "")] if email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)


def create_bid_awarded_notification(*, lead: PublicContractorLead, agreement) -> Notification | None:
    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None
    notification, created = Notification.objects.get_or_create(
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
    if created:
        try:
            project_title = _bid_project_title(lead, agreement)
            _send_bid_outcome_email(
                recipient_email=_safe_text(getattr(contractor, "email", "")),
                subject="Your bid was selected on MyHomeBro",
                template_prefix="emails/bid_outcome_awarded",
                context={
                    "contractor_name": _contractor_name(lead),
                    "project_title": project_title,
                    "agreement_url": _absolute_frontend_url(f"/app/agreements/{getattr(agreement, 'id', '')}"),
                    "site_name": "MyHomeBro",
                },
            )
        except Exception:
            pass
    return notification


def create_bid_not_selected_notification(*, lead: PublicContractorLead, agreement=None) -> Notification | None:
    contractor = getattr(lead, "contractor", None)
    if contractor is None:
        return None
    notification, created = Notification.objects.get_or_create(
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
    if created:
        try:
            project_title = _bid_project_title(lead, agreement)
            _send_bid_outcome_email(
                recipient_email=_safe_text(getattr(contractor, "email", "")),
                subject="Your bid was not selected on MyHomeBro",
                template_prefix="emails/bid_outcome_not_selected",
                context={
                    "contractor_name": _contractor_name(lead),
                    "project_title": project_title,
                    "bids_url": _absolute_frontend_url("/app/bids"),
                    "site_name": "MyHomeBro",
                },
            )
        except Exception:
            pass
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
        notification = create_bid_not_selected_notification(lead=competitor, agreement=agreement)
        if notification is not None:
            notifications.append(notification)
    return notifications
