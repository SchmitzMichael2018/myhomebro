from __future__ import annotations

from typing import Any, Dict

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def get_site_url(request) -> str:
    site = (getattr(settings, "SITE_URL", "") or "").strip()
    if site:
        return site.rstrip("/")
    try:
        return request.build_absolute_uri("/").rstrip("/")
    except Exception:
        return "http://localhost:5173"


def build_accept_url(request, token: str) -> str:
    return f"{get_site_url(request)}/subcontractor-invitations/accept/{token}"


def send_subcontractor_invitation_email(*, request, invitation: SubcontractorInvitation) -> Dict[str, Any]:
    invite_url = build_accept_url(request, invitation.token)
    subject = f"MyHomeBro subcontractor invite for {invitation.agreement}"
    greeting_name = (invitation.invite_name or "").strip() or invitation.invite_email
    agreement_title = getattr(invitation.agreement, "project", None)
    agreement_label = getattr(agreement_title, "title", "") or str(invitation.agreement)
    message = (
        f"You've been invited to collaborate on '{agreement_label}' in MyHomeBro.\n\n"
        f"Open your invite:\n{invite_url}\n"
    )
    if invitation.invited_message:
        message += f"\nMessage from the contractor:\n{invitation.invited_message}\n"

    html_message = (
        "<div style='font-family:Arial,sans-serif'>"
        f"<p>Hello {greeting_name},</p>"
        f"<p>You've been invited to collaborate on <strong>{agreement_label}</strong> in MyHomeBro.</p>"
        f"<p><a href='{invite_url}'>Open invitation</a></p>"
        "</div>"
    )

    from_email = (
        getattr(settings, "DEFAULT_FROM_EMAIL", "") or getattr(settings, "POSTMARK_FROM_EMAIL", "") or None
    )

    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=from_email,
            recipient_list=[invitation.invite_email],
            html_message=html_message,
            fail_silently=False,
        )
        return {"attempted": True, "ok": True, "message": "Invitation email sent.", "invite_url": invite_url}
    except Exception as exc:
        return {
            "attempted": True,
            "ok": False,
            "message": str(exc),
            "invite_url": invite_url,
        }


def invitation_status(invitation: SubcontractorInvitation) -> str:
    invitation.refresh_expired_status(save=False)
    if invitation.is_expired:
        return SubcontractorInvitationStatus.EXPIRED
    return invitation.status


def serialize_invitation_summary(invitation: SubcontractorInvitation, *, request=None) -> Dict[str, Any]:
    user = invitation.accepted_by_user
    accepted_name = ""
    if user is not None:
        accepted_name = getattr(user, "get_full_name", lambda: "")() or getattr(user, "email", "") or ""
    return {
        "id": invitation.id,
        "agreement": invitation.agreement_id,
        "contractor": invitation.contractor_id,
        "invite_email": invitation.invite_email,
        "invite_name": invitation.invite_name,
        "status": invitation_status(invitation),
        "invited_message": invitation.invited_message,
        "invited_at": invitation.invited_at,
        "expires_at": invitation.expires_at,
        "accepted_at": invitation.accepted_at,
        "accepted_by_user": invitation.accepted_by_user_id,
        "accepted_name": accepted_name,
        "invite_url": build_accept_url(request, invitation.token) if request is not None else "",
    }


def serialize_acceptance_payload(invitation: SubcontractorInvitation, *, request, user=None) -> Dict[str, Any]:
    current_email = normalize_email(getattr(user, "email", None)) if user is not None else ""
    invited_email = normalize_email(invitation.invite_email)
    return {
        "token": invitation.token,
        "status": invitation_status(invitation),
        "invite_email": invitation.invite_email,
        "invite_name": invitation.invite_name,
        "invited_message": invitation.invited_message,
        "invited_at": invitation.invited_at,
        "expires_at": invitation.expires_at,
        "accepted_at": invitation.accepted_at,
        "agreement": {
            "id": invitation.agreement_id,
            "title": getattr(invitation.agreement.project, "title", "") or str(invitation.agreement),
        },
        "contractor": {
            "id": invitation.contractor_id,
            "business_name": getattr(invitation.contractor, "business_name", "") or getattr(invitation.contractor, "name", ""),
        },
        "invite_url": build_accept_url(request, invitation.token),
        "email_match": bool(current_email and invited_email and current_email == invited_email),
        "signed_in": bool(user and getattr(user, "is_authenticated", False)),
    }
