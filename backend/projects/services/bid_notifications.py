from __future__ import annotations

from typing import Iterable

from django.conf import settings
from django.core.cache import cache
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


def _agreement_customer_email(agreement) -> str:
    homeowner = getattr(agreement, "homeowner", None)
    if homeowner and _safe_text(getattr(homeowner, "email", "")):
        return _safe_text(getattr(homeowner, "email", ""))
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project is not None else None
    if project_homeowner and _safe_text(getattr(project_homeowner, "email", "")):
        return _safe_text(getattr(project_homeowner, "email", ""))
    return ""


def _agreement_customer_name(agreement) -> str:
    homeowner = getattr(agreement, "homeowner", None)
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project is not None else None
    return (
        _safe_text(getattr(homeowner, "full_name", ""))
        or _safe_text(getattr(homeowner, "company_name", ""))
        or _safe_text(getattr(project_homeowner, "full_name", ""))
        or _safe_text(getattr(project_homeowner, "company_name", ""))
        or _safe_text(getattr(homeowner, "email", ""))
        or _safe_text(getattr(project_homeowner, "email", ""))
        or "Customer"
    )


def _agreement_project_title(agreement, lead: PublicContractorLead | None = None) -> str:
    project = getattr(agreement, "project", None)
    lead_title = ""
    lead_description = ""
    if lead is not None:
        lead_title = _safe_text(getattr(lead, "project_type", None))
        lead_description = _safe_text(getattr(lead, "project_description", None))
    return (
        _safe_text(getattr(project, "title", None))
        or _safe_text(getattr(agreement, "project_title", None))
        or lead_title
        or lead_description
        or "Your project"
    )


def _customer_confirmation_cache_key(agreement) -> str:
    return f"mhb:bid_customer_confirmation_sent:agreement:{getattr(agreement, 'id', '')}"


def _customer_confirmation_already_sent(agreement) -> bool:
    try:
        return bool(cache.get(_customer_confirmation_cache_key(agreement)))
    except Exception:
        return False


def _mark_customer_confirmation_sent(agreement) -> None:
    try:
        cache.set(_customer_confirmation_cache_key(agreement), True, timeout=60 * 60 * 24 * 365)
    except Exception:
        pass


def _send_customer_confirmation_email(*, agreement, lead: PublicContractorLead | None = None) -> bool:
    recipient_email = _agreement_customer_email(agreement)
    if not recipient_email:
        return False
    if _customer_confirmation_already_sent(agreement):
        return False

    agreement_token = getattr(agreement, "homeowner_access_token", None)
    agreement_url = ""
    if agreement_token:
        agreement_url = _absolute_frontend_url(f"/agreements/magic/{agreement_token}")
    if not agreement_url:
        agreement_url = _absolute_frontend_url("/app/bids")

    project_title = _agreement_project_title(agreement, lead=lead)
    contractor = getattr(agreement, "contractor", None)
    contractor_name = (
        _safe_text(getattr(contractor, "business_name", ""))
        or _safe_text(getattr(contractor, "name", ""))
        or _safe_text(getattr(contractor, "email", ""))
        or "Your contractor"
    )

    text_body = render_to_string(
        "emails/bid_customer_confirmation.txt",
        {
            "customer_name": _agreement_customer_name(agreement),
            "project_title": project_title,
            "contractor_name": contractor_name,
            "agreement_url": agreement_url,
        },
    )
    html_body = render_to_string(
        "emails/bid_customer_confirmation.html",
        {
            "customer_name": _agreement_customer_name(agreement),
            "project_title": project_title,
            "contractor_name": contractor_name,
            "agreement_url": agreement_url,
        },
    )
    msg = EmailMultiAlternatives(
        subject="Your contractor has been selected on MyHomeBro",
        body=text_body,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com"),
        to=[recipient_email],
        reply_to=[email for email in [getattr(settings, "SUPPORT_EMAIL", "")] if email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)
    _mark_customer_confirmation_sent(agreement)
    return True


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
    try:
        _send_customer_confirmation_email(agreement=agreement, lead=accepted_lead)
    except Exception:
        pass
    return notifications
