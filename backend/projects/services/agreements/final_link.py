# backend/projects/services/agreements/final_link.py
from __future__ import annotations

import sys
from typing import Optional

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.utils.timezone import now

from projects.models import Agreement
from projects.services.mailer import email_final_agreement_copy
from projects.services.sms import sms_link_to_parties


_PUBLIC_SIGN_SALT = "agreements.public.sign.v1"

# "Send final email only once per pdf_version" guard (cache-based, no migrations)
_FINAL_EMAIL_GUARD_TTL_SECONDS = 60 * 60 * 24 * 365  # 365 days


def _final_email_cache_key(agreement: Agreement) -> str:
    pdf_v = int(getattr(agreement, "pdf_version", 0) or 0)
    return f"mhb:final_email_sent:agreement:{agreement.id}:pdfv:{pdf_v}"


def _final_email_already_sent_for_version(agreement: Agreement) -> bool:
    try:
        return bool(cache.get(_final_email_cache_key(agreement)))
    except Exception:
        # If cache is not configured, fail open (do not block sending)
        return False


def _mark_final_email_sent_for_version(agreement: Agreement) -> None:
    try:
        cache.set(_final_email_cache_key(agreement), True, timeout=_FINAL_EMAIL_GUARD_TTL_SECONDS)
    except Exception:
        pass


def _is_fully_signed(ag: Agreement) -> bool:
    return bool(
        getattr(ag, "signed_by_contractor", False)
        and getattr(ag, "signed_by_homeowner", False)
    )


def send_final_link_for_agreement(ag: Agreement, *, force_send: bool = False) -> dict:
    """Send a public VIEW link for the FINAL signed agreement.

    Guard:
      - If force_send=False, email sends only once per pdf_version (cache guard).
      - If force_send=True, always sends (manual resend).

    Returns:
      { ok: bool, view_url: str, email_sent: bool }
    """
    if not _is_fully_signed(ag):
        raise ValueError("Agreement must be fully signed before sending a final copy link.")

    homeowner = getattr(ag, "homeowner", None)
    homeowner_email = getattr(homeowner, "email", None)
    if not homeowner_email:
        raise ValueError("Agreement has no homeowner email.")

    signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
    token_payload = {"agreement_id": ag.id, "ts": float(now().timestamp())}
    token = signer.sign_object(token_payload)

    domain = (
        getattr(settings, "PUBLIC_APP_ORIGIN", None)
        or getattr(settings, "SITE_URL", None)
        or "https://www.myhomebro.com"
    ).rstrip("/")

    view_url = f"{domain}/public-sign/{token}?mode=final"

    should_send_email = force_send or (not _final_email_already_sent_for_version(ag))

    if should_send_email:
        try:
            # final-copy email + attach PDF by default
            email_final_agreement_copy(ag, view_url=view_url, attach_pdf=True)
            _mark_final_email_sent_for_version(ag)
        except Exception as e:
            print("send_final_link_for_agreement email error:", repr(e), file=sys.stderr)

    # SMS can still be sent; it’s okay if this is called manually multiple times
    try:
        sms_sent = sms_link_to_parties(
            ag,
            link_url=view_url,
            note="Here is a copy of your final signed MyHomeBro agreement.",
        )
        print(f"send_final_link_for_agreement SMS sent count: {sms_sent}", file=sys.stderr)
    except Exception as e:
        print("send_final_link_for_agreement SMS error:", repr(e), file=sys.stderr)

    return {"ok": True, "view_url": view_url, "email_sent": bool(should_send_email)}
