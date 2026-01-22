# backend/projects/services/dispute_notifications.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.conf import settings
from django.core.mail import send_mail


@dataclass
class EmailTarget:
    email: str
    name: str = ""


def _send(subject: str, body: str, to_email: str) -> bool:
    """
    Safe email sender. Never raises.
    """
    if not to_email:
        return False

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "") or getattr(settings, "SERVER_EMAIL", "") or ""
    if not from_email:
        # Avoid crashing if email not configured.
        # You can set DEFAULT_FROM_EMAIL in settings.py later.
        return False

    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=from_email,
            recipient_list=[to_email],
            fail_silently=True,
        )
        return True
    except Exception:
        return False


def _get_agreement_total(agreement) -> str:
    for attr in ("total_cost", "total_amount", "total", "amount"):
        v = getattr(agreement, attr, None)
        if v not in (None, ""):
            return str(v)
    return "—"


def _guess_homeowner_email(agreement) -> str:
    """
    Agreement schema varies. Try common patterns:
      - agreement.homeowner_email (str)
      - agreement.homeowner.email (FK)
      - agreement.homeowner_email.email (FK named homeowner_email)
    """
    # homeowner_email as string
    v = getattr(agreement, "homeowner_email", None)
    if isinstance(v, str) and v.strip():
        return v.strip()

    # homeowner FK
    homeowner = getattr(agreement, "homeowner", None)
    email = getattr(homeowner, "email", None)
    if isinstance(email, str) and email.strip():
        return email.strip()

    # homeowner_email FK
    homeowner_email_fk = getattr(agreement, "homeowner_email", None)
    email2 = getattr(homeowner_email_fk, "email", None)
    if isinstance(email2, str) and email2.strip():
        return email2.strip()

    return ""


def _guess_homeowner_name(agreement) -> str:
    for attr in ("homeowner_name", "customer_name", "client_name", "homeowner_full_name"):
        v = getattr(agreement, attr, None)
        if isinstance(v, str) and v.strip():
            return v.strip()
    homeowner = getattr(agreement, "homeowner", None)
    name = getattr(homeowner, "name", None) or getattr(homeowner, "full_name", None)
    if isinstance(name, str) and name.strip():
        return name.strip()
    return ""


def _guess_project_title(agreement) -> str:
    for attr in ("project_title", "title", "project_name", "name"):
        v = getattr(agreement, attr, None)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _build_decision_link(dispute_id: int, public_token: str) -> str:
    # Use your live domain if set, otherwise fall back to relative.
    base = getattr(settings, "PUBLIC_APP_BASE_URL", "") or "https://www.myhomebro.com"
    return f"{base}/disputes/{dispute_id}/decision?token={public_token}"


def email_homeowner_proposal_sent(dispute) -> bool:
    """
    Homeowner gets decision link when contractor proposal is sent.
    """
    agreement = dispute.agreement
    to_email = _guess_homeowner_email(agreement)
    homeowner_name = _guess_homeowner_name(agreement)
    project_title = _guess_project_title(agreement) or f"Agreement #{agreement.id}"
    total = _get_agreement_total(agreement)

    decision_link = _build_decision_link(dispute.id, dispute.public_token)

    subject = f"MyHomeBro: Proposal ready for your decision (Dispute #{dispute.id})"
    body = (
        f"Hello{(' ' + homeowner_name) if homeowner_name else ''},\n\n"
        f"A proposal has been submitted for your dispute.\n\n"
        f"Project: {project_title}\n"
        f"Agreement Total: {total}\n"
        f"Dispute: #{dispute.id}\n\n"
        f"Review and respond here:\n{decision_link}\n\n"
        f"If you have questions, reply to this email.\n\n"
        f"— MyHomeBro"
    )

    return _send(subject, body, to_email)


def email_contractor_status_update(dispute, contractor_email: str, event_label: str, extra: str = "") -> bool:
    """
    Contractor receives updates for accept/reject/escalations.
    """
    agreement = dispute.agreement
    project_title = _guess_project_title(agreement) or f"Agreement #{agreement.id}"

    subject = f"MyHomeBro: Dispute #{dispute.id} update — {event_label}"
    body = (
        f"Dispute #{dispute.id} has an update.\n\n"
        f"Project: {project_title}\n"
        f"Status: {dispute.status}\n"
        f"Escrow frozen: {'Yes' if dispute.escrow_frozen else 'No'}\n\n"
        f"{extra}\n\n"
        f"— MyHomeBro"
    )

    return _send(subject, body, contractor_email)


def email_admin_dispute_update(dispute, admin_email: str, event_label: str) -> bool:
    """
    Optional: send admin alerts if you set DISPUTE_ADMIN_EMAIL in settings.
    """
    if not admin_email:
        return False

    agreement = dispute.agreement
    project_title = _guess_project_title(agreement) or f"Agreement #{agreement.id}"

    subject = f"MyHomeBro Admin: Dispute #{dispute.id} — {event_label}"
    body = (
        f"Dispute #{dispute.id} event: {event_label}\n\n"
        f"Project: {project_title}\n"
        f"Initiator: {dispute.initiator}\n"
        f"Status: {dispute.status}\n"
        f"Fee paid: {'Yes' if dispute.fee_paid else 'No'}\n"
        f"Escrow frozen: {'Yes' if dispute.escrow_frozen else 'No'}\n\n"
        f"— MyHomeBro"
    )

    return _send(subject, body, admin_email)
