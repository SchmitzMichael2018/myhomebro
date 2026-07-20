from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from projects.models import ContractorSubAccount

User = get_user_model()

TEAM_ACCOUNT_SETUP_COOLDOWN_SECONDS = 60


def team_account_setup_cooldown_seconds() -> int:
    return int(getattr(settings, "TEAM_ACCOUNT_SETUP_COOLDOWN_SECONDS", TEAM_ACCOUNT_SETUP_COOLDOWN_SECONDS))


def team_account_setup_timeout_seconds() -> int:
    return int(getattr(settings, "PASSWORD_RESET_TIMEOUT", 60 * 60 * 24 * 3))


def team_account_setup_expires_at(subaccount: ContractorSubAccount):
    if not subaccount.setup_sent_at:
        return None
    return subaccount.setup_sent_at + timedelta(seconds=team_account_setup_timeout_seconds())


def team_account_setup_status(subaccount: ContractorSubAccount) -> str:
    user = getattr(subaccount, "user", None)
    if user is None:
        return "access_not_created"
    if not subaccount.is_active:
        return "access_disabled"
    if user.has_usable_password() and user.is_active:
        return "access_active"
    if not subaccount.setup_sent_at:
        return "setup_link_not_sent"
    expires_at = team_account_setup_expires_at(subaccount)
    if expires_at and timezone.now() > expires_at:
        return "setup_link_expired"
    return "setup_pending"


def team_account_setup_status_label(subaccount: ContractorSubAccount) -> str:
    labels = {
        "access_not_created": "Access Not Created",
        "setup_link_not_sent": "Setup Link Not Sent",
        "setup_pending": "Setup Pending",
        "setup_link_expired": "Setup Link Expired",
        "access_active": "Access Active",
        "access_disabled": "Access Disabled",
    }
    return labels.get(team_account_setup_status(subaccount), "Setup Link Not Sent")


def can_resend_team_account_setup(subaccount: ContractorSubAccount) -> tuple[bool, int]:
    if not subaccount.setup_sent_at:
        return True, 0
    elapsed = (timezone.now() - subaccount.setup_sent_at).total_seconds()
    remaining = max(team_account_setup_cooldown_seconds() - int(elapsed), 0)
    return remaining <= 0, remaining


def build_team_account_setup_url(user: User) -> str:
    base_url = getattr(settings, "FRONTEND_BASE_URL", "https://www.myhomebro.com").rstrip("/")
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{base_url}/team-account-setup/{uid}/{token}/"


def send_team_account_setup_email(subaccount: ContractorSubAccount) -> None:
    user = subaccount.user
    setup_url = build_team_account_setup_url(user)
    business_name = getattr(subaccount.parent_contractor, "business_name", "") or "your contractor"
    expires_hours = max(round(team_account_setup_timeout_seconds() / 3600), 1)
    subject = "Set up your MyHomeBro team account"
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")
    text_body = (
        f"Hi {subaccount.display_name or 'there'},\n\n"
        f"{business_name} created a MyHomeBro team account for you.\n\n"
        "Use the secure link below to choose your password and activate access:\n\n"
        f"{setup_url}\n\n"
        f"This setup link expires in about {expires_hours} hours. If it expires, ask your contractor to send a new setup link.\n\n"
        "The MyHomeBro Team\n"
    )
    html_body = (
        f"<p>Hi {subaccount.display_name or 'there'},</p>"
        f"<p>{business_name} created a MyHomeBro team account for you.</p>"
        f"<p><a href=\"{setup_url}\">Set up your MyHomeBro team account</a></p>"
        f"<p>This setup link expires in about {expires_hours} hours. If it expires, ask your contractor to send a new setup link.</p>"
    )
    msg = EmailMultiAlternatives(subject=subject, body=text_body, from_email=from_email, to=[user.email])
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)


def issue_team_account_setup_link(subaccount: ContractorSubAccount, *, enforce_cooldown: bool = True) -> dict:
    allowed, retry_after_seconds = can_resend_team_account_setup(subaccount)
    if enforce_cooldown and not allowed:
        return {"sent": False, "retry_after_seconds": retry_after_seconds}

    user = subaccount.user
    user.set_unusable_password()
    user.is_active = False
    user.save(update_fields=["password", "is_active"])

    subaccount.setup_sent_at = timezone.now()
    subaccount.setup_completed_at = None
    subaccount.save(update_fields=["setup_sent_at", "setup_completed_at", "updated_at"])

    send_team_account_setup_email(subaccount)
    return {"sent": True, "retry_after_seconds": 0}
