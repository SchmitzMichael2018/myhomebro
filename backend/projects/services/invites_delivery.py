from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional, Tuple

import requests
from django.conf import settings


def _get_site_url_fallback(request) -> str:
    site = getattr(settings, "SITE_URL", "").strip()
    if site:
        return site.rstrip("/")
    try:
        return request.build_absolute_uri("/").rstrip("/")
    except Exception:
        return "https://www.myhomebro.com"


def build_invite_url(request, token) -> str:
    base = _get_site_url_fallback(request)
    return f"{base}/login?invite={token}"


def build_resend_url(request, invite) -> str:
    base = _get_site_url_fallback(request)
    return f"{base}/api/projects/invites/{invite.token}/resend/{invite.resend_token}/"


def _resolve_postmark_from_email() -> str:
    """
    Resolve From email in this order:
    1) POSTMARK_FROM_EMAIL (explicit)
    2) DEFAULT_FROM_EMAIL (Django standard)
    3) env DEFAULT_FROM_EMAIL
    """
    return (
        getattr(settings, "POSTMARK_FROM_EMAIL", "").strip()
        or os.getenv("POSTMARK_FROM_EMAIL", "").strip()
        or getattr(settings, "DEFAULT_FROM_EMAIL", "").strip()
        or os.getenv("DEFAULT_FROM_EMAIL", "").strip()
    )


def send_postmark_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Sends email via Postmark REST API.
    Requires POSTMARK_SERVER_TOKEN and a resolvable From email.
    """
    token = (
        getattr(settings, "POSTMARK_SERVER_TOKEN", "").strip()
        or os.getenv("POSTMARK_SERVER_TOKEN", "").strip()
    )
    from_email = _resolve_postmark_from_email()

    if not token:
        return False, "Postmark not configured (POSTMARK_SERVER_TOKEN missing)."

    if not from_email:
        return False, "Postmark not configured (no From email configured)."

    url = "https://api.postmarkapp.com/email"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
    }

    payload: Dict[str, Any] = {
        "From": from_email,
        "To": to_email,
        "Subject": subject,
        "TextBody": text_body,
    }

    if html_body:
        payload["HtmlBody"] = html_body

    try:
        r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=15)
        if 200 <= r.status_code < 300:
            return True, "Postmark email sent."
        return False, f"Postmark error {r.status_code}: {r.text[:500]}"
    except Exception as e:
        return False, f"Postmark exception: {e}"


def _normalize_phone(raw: str) -> str:
    if not raw:
        return ""
    digits = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if digits.startswith("+"):
        return digits
    only = "".join(ch for ch in raw if ch.isdigit())
    if len(only) == 10:
        return "+1" + only
    if len(only) == 11 and only.startswith("1"):
        return "+" + only
    return raw


def send_twilio_sms(*, to_phone: str, body: str) -> Tuple[bool, str]:
    if getattr(settings, "TWILIO_INVITES_ENABLED", False) is False:
        return False, "Twilio invites disabled (TWILIO_INVITES_ENABLED=False)."

    try:
        from twilio.rest import Client  # type: ignore
    except Exception:
        return False, "Twilio library not installed."

    sid = getattr(settings, "TWILIO_ACCOUNT_SID", "") or os.getenv("TWILIO_ACCOUNT_SID", "")
    auth = getattr(settings, "TWILIO_AUTH_TOKEN", "") or os.getenv("TWILIO_AUTH_TOKEN", "")
    from_num = getattr(settings, "TWILIO_FROM_NUMBER", "") or os.getenv("TWILIO_FROM_NUMBER", "")

    if not sid or not auth or not from_num:
        return False, "Twilio not configured."

    try:
        client = Client(sid, auth)
        client.messages.create(to=_normalize_phone(to_phone), from_=from_num, body=body)
        return True, "Twilio SMS sent."
    except Exception as e:
        return False, f"Twilio exception: {e}"


def deliver_invite_notifications(*, request, invite) -> Dict[str, Any]:
    invite_url = build_invite_url(request, invite.token)

    subject = f"MyHomeBro invite — {invite.homeowner_name} invited you"
    text_body = (
        "You’ve been invited to use MyHomeBro for secure escrow payments.\n\n"
        f"Accept invite:\n{invite_url}\n"
    )
    html_body = (
        "<div style='font-family:Arial'>"
        "<h2>You’ve been invited to MyHomeBro</h2>"
        f"<p><a href='{invite_url}'>Accept Invite</a></p>"
        "</div>"
    )

    results: Dict[str, Any] = {
        "invite_url": invite_url,
        "email": {"attempted": False, "ok": False, "message": ""},
        "sms": {"attempted": False, "ok": False, "message": ""},
    }

    if invite.contractor_email:
        results["email"]["attempted"] = True
        ok, msg = send_postmark_email(
            to_email=invite.contractor_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
        results["email"]["ok"] = ok
        results["email"]["message"] = msg

    if invite.contractor_phone:
        results["sms"]["attempted"] = True
        ok, msg = send_twilio_sms(
            to_phone=invite.contractor_phone,
            body=f"MyHomeBro invite: {invite_url}",
        )
        results["sms"]["ok"] = ok
        results["sms"]["message"] = msg

    return results


def deliver_homeowner_confirmation(*, request, invite) -> Dict[str, Any]:
    if not invite.homeowner_email:
        return {"attempted": False, "ok": False, "message": "No homeowner email."}

    resend_url = build_resend_url(request, invite)

    ok, msg = send_postmark_email(
        to_email=invite.homeowner_email,
        subject="MyHomeBro — Invite sent",
        text_body=f"Your invite was sent.\nResend:\n{resend_url}",
        html_body=f"<p>Your invite was sent.</p><a href='{resend_url}'>Resend Invite</a>",
    )

    return {"attempted": True, "ok": ok, "message": msg, "resend_url": resend_url}
