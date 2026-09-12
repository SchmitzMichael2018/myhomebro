# backend/projects/services/dispute_notifications.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms


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
        f"Escrow hold active: {'Yes' if dispute.escrow_frozen else 'No'}\n\n"
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
        f"Qualification: {getattr(dispute, 'qualification_status', 'not recorded')}\n"
        f"Escrow hold active: {'Yes' if dispute.escrow_frozen else 'No'}\n\n"
        f"— MyHomeBro"
    )

    return _send(subject, body, admin_email)


def notify_homeowner_qualification(dispute, event: str) -> dict:
    """Send the same source-scoped qualification message by available channels."""
    agreement = dispute.agreement
    homeowner = getattr(agreement, "homeowner", None)
    email = _guess_homeowner_email(agreement)
    phone = normalize_phone_to_e164(getattr(homeowner, "phone_number", ""))
    base = (getattr(settings, "PUBLIC_APP_BASE_URL", "") or "https://www.myhomebro.com").rstrip("/")
    link = f"{base}/disputes/{dispute.id}?token={dispute.public_token}"
    due = getattr(dispute, "qualification_due_at", None)
    due_label = timezone.localtime(due).strftime("%b %d, %Y at %I:%M %p %Z") if due else "the displayed deadline"
    copy = {
        "submitted": (
            "Temporary dispute hold started",
            f"Your concern was recorded. Only the identified payment source is on a temporary administrative hold. To continue the hold, provide the requested information by {due_label}. Safety, unauthorized payment, active property damage, and similar reports may require human review.",
        ),
        "reminder_48h": (
            "Dispute information due in about 48 hours",
            f"Information needed to qualify the payment hold is due by {due_label}.",
        ),
        "reminder_24h": (
            "Final dispute qualification reminder",
            f"Unless qualifying information is received by {due_label}, the temporary payment hold will enter its final expiration period.",
        ),
        "expiration_pending": (
            "Dispute payment hold expiration pending",
            "The qualification deadline passed. A final grace period is active before the payment hold closes.",
        ),
        "expired": (
            "Dispute payment hold closed",
            "The required information was not completed by the deadline, so the immediate payment hold closed. The payment may continue through its normal process. This does not decide separate warranty rights or the underlying merits.",
        ),
        "qualified": (
            "Dispute qualified for continued hold",
            "The submitted information is sufficient for the contractor-response stage. Only the identified payment source remains held.",
        ),
    }
    subject, message = copy.get(event, copy["submitted"])
    missing = [str(item).strip() for item in (getattr(dispute, "missing_information", None) or []) if str(item).strip()]
    if missing and event in {"submitted", "reminder_48h", "reminder_24h", "expiration_pending"}:
        message = f"{message}\n\nInformation requested:\n" + "\n".join(f"- {item}" for item in missing)
    body = f"{message}\n\nReview the case: {link}\n\n— MyHomeBro"
    email_sent = _send(f"MyHomeBro: {subject}", body, email)
    sms_result = {"ok": False, "reason_code": "no_phone"}
    if phone:
        sms_result = send_compliant_sms(
            phone,
            f"MyHomeBro: {message} Review: {link}",
            related_object=agreement,
            category="customer_care",
            dedupe_key=f"dispute-qualification:{dispute.id}:{event}",
        )
    return {"email_sent": email_sent, "sms": sms_result}
