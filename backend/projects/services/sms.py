# backend/projects/services/sms.py
from __future__ import annotations
import os
from typing import Iterable
from django.conf import settings

try:
    from twilio.rest import Client
except Exception:  # pragma: no cover
    Client = None  # allow import even if twilio not installed yet

def _twilio_enabled() -> bool:
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")
    from_ = getattr(settings, "TWILIO_PHONE_NUMBER", None) or os.getenv("TWILIO_PHONE_NUMBER")
    return bool(sid and token and from_ and Client is not None)

def _twilio_client():
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")
    return Client(sid, token)

def send_sms(to: str, body: str) -> bool:
    """
    Send a single SMS. Returns True on success. If Twilio is not configured, returns False.
    """
    if not _twilio_enabled():
        return False
    try:
        client = _twilio_client()
        from_ = getattr(settings, "TWILIO_PHONE_NUMBER", None) or os.getenv("TWILIO_PHONE_NUMBER")
        client.messages.create(to=to, from_=from_, body=body)
        return True
    except Exception:
        return False

def sms_link_to_parties(agreement, *, link_url: str, note: str = "") -> int:
    """
    Sends a short message with a link to both parties if phone numbers are present.
    Returns count of successfully queued messages.
    """
    if not _twilio_enabled():
        return 0

    # Collect numbers
    nums: list[str] = []
    # homeowner phone
    hp = getattr(agreement, "homeowner_phone", None)
    if hp:
        nums.append(str(hp).strip())
    # contractor phone
    contractor = getattr(agreement, "contractor", None)
    cp = getattr(contractor, "phone", None) if contractor else None
    if cp:
        nums.append(str(cp).strip())

    # de-dupe
    seen = set()
    final_numbers = []
    for n in nums:
        if n and n not in seen:
            seen.add(n)
            final_numbers.append(n)

    if not final_numbers:
        return 0

    msg = f"MyHomeBro: {note} {link_url}".strip()
    ok_count = 0
    for n in final_numbers:
        if send_sms(n, msg):
            ok_count += 1
    return ok_count
