# backend/projects/services/sms.py
from __future__ import annotations

import os
import logging
from typing import Iterable

from django.conf import settings

try:
    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException
except Exception:  # pragma: no cover
    Client = None  # allow import even if twilio not installed yet
    TwilioRestException = Exception

logger = logging.getLogger(__name__)


def _twilio_enabled() -> bool:
    """
    Return True if Twilio is configured and the client class is importable.
    """
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")
    from_ = getattr(settings, "TWILIO_PHONE_NUMBER", None) or os.getenv("TWILIO_PHONE_NUMBER")
    enabled = bool(sid and token and from_ and Client is not None)

    if not enabled:
        logger.info(
            "Twilio SMS disabled: sid=%r token_present=%s from_=%r client=%r",
            bool(sid),
            bool(token),
            bool(from_),
            Client is not None,
        )
    return enabled


def _twilio_client() -> Client:
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")
    return Client(sid, token)


def _normalize_phone(to: str) -> str:
    """
    Very simple normalizer for US-style numbers.

    - Strips spaces and hyphens
    - If it looks like 10 digits (e.g. 2105551234), treat as US and prefix +1
    - If it already starts with '+', leave as-is.
    """
    if not to:
        return ""

    raw = str(to).strip().replace(" ", "").replace("-", "")
    if raw.startswith("+"):
        return raw

    # Very basic: 10 digits -> assume US
    digits_only = "".join(ch for ch in raw if ch.isdigit())
    if len(digits_only) == 10:
        return f"+1{digits_only}"

    # Fallback to whatever was passed
    return raw


def send_sms(to: str, body: str) -> bool:
    """
    Send a single SMS. Returns True on success.
    If Twilio is not configured, returns False.
    Logs errors instead of failing silently.
    """
    if not _twilio_enabled():
        logger.warning("send_sms called but Twilio is not enabled; to=%r body=%r", to, body)
        return False

    normalized_to = _normalize_phone(to)
    from_ = getattr(settings, "TWILIO_PHONE_NUMBER", None) or os.getenv("TWILIO_PHONE_NUMBER")

    try:
        client = _twilio_client()
        logger.info("Sending SMS via Twilio: from=%s to=%s body=%s", from_, normalized_to, body)
        msg = client.messages.create(to=normalized_to, from_=from_, body=body)
        logger.info("Twilio SMS queued: sid=%s status=%s", getattr(msg, "sid", None), getattr(msg, "status", None))
        return True
    except TwilioRestException as exc:  # type: ignore[misc]
        logger.error("TwilioRestException sending SMS to %s: %s", normalized_to, exc)
        return False
    except Exception as exc:  # pragma: no cover
        logger.error("Unexpected error sending SMS to %s: %s", normalized_to, exc)
        return False


def sms_link_to_parties(agreement, *, link_url: str, note: str = "") -> int:
    """
    Sends a short message with a link to both parties if phone numbers are present.
    Returns count of successfully queued messages.
    """
    if not _twilio_enabled():
        logger.warning(
            "sms_link_to_parties called but Twilio is not enabled; agreement_id=%r",
            getattr(agreement, "id", None),
        )
        return 0

    # Collect numbers
    nums: list[str] = []

    # homeowner phone (may be a field or a property on Agreement)
    hp = getattr(agreement, "homeowner_phone", None)
    if hp:
        nums.append(str(hp).strip())

    # contractor phone from Contractor model
    contractor = getattr(agreement, "contractor", None)
    cp = getattr(contractor, "phone", None) if contractor else None
    if cp:
        nums.append(str(cp).strip())

    # de-dupe
    seen = set()
    final_numbers: list[str] = []
    for n in nums:
        if n and n not in seen:
            seen.add(n)
            final_numbers.append(n)

    logger.info(
        "sms_link_to_parties: agreement_id=%r numbers=%r",
        getattr(agreement, "id", None),
        final_numbers,
    )

    if not final_numbers:
        logger.info(
            "sms_link_to_parties: no phone numbers found for agreement_id=%r",
            getattr(agreement, "id", None),
        )
        return 0

    msg = f"MyHomeBro: {note} {link_url}".strip()
    ok_count = 0
    for n in final_numbers:
        if send_sms(n, msg):
            ok_count += 1

    logger.info(
        "sms_link_to_parties: sent %d/%d SMS messages for agreement_id=%r",
        ok_count,
        len(final_numbers),
        getattr(agreement, "id", None),
    )
    return ok_count
