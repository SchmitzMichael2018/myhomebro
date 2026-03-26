from __future__ import annotations

from types import SimpleNamespace

from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from core.notifications import _build_from_and_reply_to


def _project_location(lead) -> str:
    parts = [lead.project_address or "", lead.city or "", lead.state or ""]
    return ", ".join(part.strip() for part in parts if str(part or "").strip())


def _request_summary(lead) -> str:
    return (lead.project_description or "").strip() or (lead.project_type or "").strip()


def _send_email(*, lead, subject: str, template_prefix: str, context: dict) -> None:
    recipient = SimpleNamespace(email=lead.email)
    from_email, reply_to = _build_from_and_reply_to(recipient, context)
    text_body = render_to_string(f"{template_prefix}.txt", context)
    html_body = render_to_string(f"{template_prefix}.html", context)
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=[lead.email],
        reply_to=reply_to,
    )
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def send_public_lead_accept_email(lead) -> dict:
    if lead.accepted_email_sent_at:
        return {"sent": False, "detail": "Customer acceptance email was already sent."}
    if not lead.email:
        return {"sent": False, "detail": "No customer email was available, so no notification was sent."}

    contractor_name = (
        getattr(lead.contractor, "business_name", "")
        or getattr(lead.contractor, "name", "")
        or getattr(lead.contractor, "email", "")
        or "Your contractor"
    )
    context = {
        "contractor": lead.contractor,
        "contractor_name": contractor_name,
        "project_type": (lead.project_type or "").strip(),
        "project_location": _project_location(lead),
        "request_summary": _request_summary(lead),
    }
    _send_email(
        lead=lead,
        subject=f"{contractor_name} accepted your MyHomeBro project request",
        template_prefix="emails/public_lead_accepted",
        context=context,
    )
    lead.accepted_email_sent_at = timezone.now()
    lead.save(update_fields=["accepted_email_sent_at", "updated_at"])
    return {"sent": True, "detail": "Customer was notified by email."}


def send_public_lead_reject_email(lead) -> dict:
    if lead.rejected_email_sent_at:
        return {"sent": False, "detail": "Customer rejection email was already sent."}
    if not lead.email:
        return {"sent": False, "detail": "No customer email was available, so no notification was sent."}

    contractor_name = (
        getattr(lead.contractor, "business_name", "")
        or getattr(lead.contractor, "name", "")
        or getattr(lead.contractor, "email", "")
        or "Your contractor"
    )
    context = {
        "contractor": lead.contractor,
        "contractor_name": contractor_name,
        "project_type": (lead.project_type or "").strip(),
        "project_location": _project_location(lead),
        "request_summary": _request_summary(lead),
    }
    _send_email(
        lead=lead,
        subject=f"{contractor_name} is unable to take on your MyHomeBro request",
        template_prefix="emails/public_lead_rejected",
        context=context,
    )
    lead.rejected_email_sent_at = timezone.now()
    lead.save(update_fields=["rejected_email_sent_at", "updated_at"])
    return {"sent": True, "detail": "Customer was notified by email."}
