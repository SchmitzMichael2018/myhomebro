from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from projects.models_support import SupportMessage, SupportTicket

logger = logging.getLogger(__name__)


def _support_email() -> str:
    return (
        getattr(settings, "SUPPORT_EMAIL", None)
        or getattr(settings, "DEFAULT_FROM_EMAIL", None)
        or "support@myhomebro.com"
    )


def _default_from_email() -> str:
    return getattr(settings, "DEFAULT_FROM_EMAIL", None) or "info@myhomebro.com"


def _absolute_media_url(request, file_obj) -> str:
    if not file_obj or not getattr(file_obj, "url", ""):
        return ""

    url = file_obj.url
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            pass

    base = getattr(settings, "SITE_URL", "") or getattr(settings, "FRONTEND_URL", "") or ""
    return f"{base.rstrip('/')}{url}" if base else url


def _ticket_context(ticket: SupportTicket, request=None) -> dict:
    submitted_by = getattr(ticket, "submitted_by", None)
    submitted_by_name = ""
    if submitted_by is not None:
        submitted_by_name = (
            getattr(submitted_by, "get_full_name", lambda: "")()  # type: ignore[misc]
            or getattr(submitted_by, "first_name", "")
            or getattr(submitted_by, "email", "")
            or ""
        )

    attachment = getattr(ticket, "attachment", None)
    attachment_name = getattr(attachment, "name", "") if attachment else ""
    attachment_url = _absolute_media_url(request, attachment)

    return {
        "ticket": ticket,
        "ticket_number": ticket.ticket_number or "",
        "subject": ticket.subject,
        "category": ticket.get_category_display(),
        "priority": ticket.get_priority_display(),
        "status": ticket.get_status_display(),
        "message": ticket.message,
        "email": ticket.email,
        "user_role": ticket.user_role or "unknown",
        "submitted_by_name": submitted_by_name,
        "related_object_type": ticket.related_object_type or "",
        "related_object_id": ticket.related_object_id or "",
        "related_object_label": (
            f"{ticket.related_object_type} {ticket.related_object_id}".strip()
            if ticket.related_object_type or ticket.related_object_id
            else ""
        ),
        "attachment_name": attachment_name,
        "attachment_url": attachment_url,
        "support_email": _support_email(),
        "site_name": getattr(settings, "SITE_NAME", "MyHomeBro"),
    }


def _send_email(*, subject: str, body: str, to_email: str, html_body: str = "", reply_to: list[str] | None = None) -> bool:
    if not to_email:
        return False

    try:
        message = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=_default_from_email(),
            to=[to_email],
            reply_to=reply_to or [],
        )
        if html_body:
            message.attach_alternative(html_body, "text/html")
        message.send(fail_silently=False)
        return True
    except Exception:
        logger.exception("Failed to send support ticket email to %s", to_email)
        return False


def send_support_ticket_notifications(ticket: SupportTicket, request=None) -> dict[str, bool]:
    ctx = _ticket_context(ticket, request=request)

    confirmation_subject = f"MyHomeBro Support Request Received – Ticket {ctx['ticket_number']}"
    confirmation_text = render_to_string("emails/support_ticket_confirmation.txt", ctx)
    confirmation_html = render_to_string("emails/support_ticket_confirmation.html", ctx)
    confirmation_sent = _send_email(
        subject=confirmation_subject,
        body=confirmation_text,
        html_body=confirmation_html,
        to_email=ctx["email"],
        reply_to=[ctx["support_email"]] if ctx["support_email"] else [],
    )

    internal_subject = f"MyHomeBro Support Ticket {ctx['ticket_number']} Submitted"
    internal_text = render_to_string("emails/support_ticket_internal.txt", ctx)
    internal_html = render_to_string("emails/support_ticket_internal.html", ctx)
    internal_sent = _send_email(
        subject=internal_subject,
        body=internal_text,
        html_body=internal_html,
        to_email=ctx["support_email"],
        reply_to=[ctx["email"]] if ctx["email"] else [],
    )

    return {
        "confirmation_sent": confirmation_sent,
        "internal_sent": internal_sent,
    }


def send_support_ticket_reply_notification(ticket: SupportTicket, message: SupportMessage, request=None) -> bool:
    ctx = _ticket_context(ticket, request=request)
    subject = f"Re: {ctx['ticket_number']} – {ctx['subject']}"
    body_lines = [
        f"Support ticket: {ctx['ticket_number']}",
        f"Subject: {ctx['subject']}",
        "",
        message.message_text,
    ]
    if getattr(message, "sender_role", "") == "support":
        body_lines.insert(3, "Sender: Support")
    elif getattr(message, "sender", None) is not None:
        sender = getattr(message, "sender", None)
        sender_name = (
            getattr(sender, "get_full_name", lambda: "")()
            or getattr(sender, "first_name", "")
            or getattr(sender, "email", "")
            or "User"
        )
        body_lines.insert(3, f"Sender: {sender_name}")

    return _send_email(
        subject=subject,
        body="\n".join(body_lines),
        to_email=ctx["support_email"],
        reply_to=[ctx["email"]] if ctx["email"] else [],
    )
