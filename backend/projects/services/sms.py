# backend/projects/services/sms.py
from __future__ import annotations

import os
import logging
from typing import Iterable
from urllib.parse import urlsplit, urlunsplit

from django.conf import settings
from django.utils import timezone

from projects.models_sms import SMSConsentStatus

try:
    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException
    from twilio.request_validator import RequestValidator
except Exception:  # pragma: no cover
    Client = None  # allow import even if twilio not installed yet
    TwilioRestException = Exception
    RequestValidator = None

logger = logging.getLogger(__name__)

OPT_OUT_KEYWORDS = {
    "STOP",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "REVOKE",
    "OPTOUT",
}
HELP_KEYWORDS = {"HELP", "INFO"}
OPT_IN_KEYWORDS = {"START", "UNSTOP"}


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


def normalize_phone_number(to: str) -> str:
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


def _normalize_phone(to: str) -> str:
    return normalize_phone_number(to)


def normalize_inbound_body(body: str | None) -> str:
    return " ".join(str(body or "").strip().split())


def classify_inbound_keyword(body: str | None) -> str:
    normalized = normalize_inbound_body(body).upper()
    if normalized in OPT_OUT_KEYWORDS:
        return SMSConsentStatus.KEYWORD_OPT_OUT
    if normalized in HELP_KEYWORDS:
        return SMSConsentStatus.KEYWORD_HELP
    if normalized in OPT_IN_KEYWORDS:
        return SMSConsentStatus.KEYWORD_OPT_IN
    return SMSConsentStatus.KEYWORD_DEFAULT


def upsert_sms_consent_status(
    *,
    phone_number: str,
    message_sid: str,
    body: str,
    keyword_type: str,
) -> SMSConsentStatus:
    normalized_phone = normalize_phone_number(phone_number)
    if not normalized_phone:
        raise ValueError("phone_number is required")
    normalized_body = normalize_inbound_body(body)

    consent, _ = SMSConsentStatus.objects.get_or_create(
        phone_number=normalized_phone,
        defaults={
            "is_subscribed": True,
            "last_inbound_message_sid": message_sid or "",
            "last_inbound_body": normalized_body,
            "last_keyword_type": keyword_type,
        },
    )

    consent.last_inbound_message_sid = message_sid or ""
    consent.last_inbound_body = normalized_body
    consent.last_keyword_type = keyword_type

    now = timezone.now()
    was_subscribed = bool(consent.is_subscribed)
    if keyword_type == SMSConsentStatus.KEYWORD_OPT_OUT:
        consent.is_subscribed = False
        if consent.opted_out_at is None:
            consent.opted_out_at = now
    elif keyword_type == SMSConsentStatus.KEYWORD_OPT_IN:
        consent.is_subscribed = True
        if consent.opted_in_at is None or not was_subscribed:
            consent.opted_in_at = now

    consent.save()
    return consent


def is_sms_subscribed(phone_number: str) -> bool:
    normalized_phone = normalize_phone_number(phone_number)
    if not normalized_phone:
        return True
    consent = SMSConsentStatus.objects.filter(phone_number=normalized_phone).only("is_subscribed").first()
    if consent is None:
        return True
    return bool(consent.is_subscribed)


def handle_incoming_user_message(from_number: str, body: str, message_sid: str) -> None:
    # Placeholder for future conversation routing once inbound SMS is connected to project/chat threads.
    logger.info(
        "Inbound SMS routed to placeholder handler",
        extra={
            "from_number": normalize_phone_number(from_number),
            "message_sid": message_sid or "",
        },
    )


def validate_twilio_webhook_request(request) -> bool:
    """
    Non-blocking request validation helper.

    If Twilio auth token or signature validation support is unavailable, we log and allow
    the request so local/dev environments and staged rollouts keep working. Tighten this
    in production once the deployed URL/signing configuration is finalized.
    """
    signature = (request.headers.get("X-Twilio-Signature") or "").strip()
    auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")

    if not signature or not auth_token or RequestValidator is None:
        logger.info(
            "Twilio signature validation skipped",
            extra={
                "has_signature": bool(signature),
                "has_auth_token": bool(auth_token),
                "validator_available": RequestValidator is not None,
            },
        )
        return True

    try:
        validator = RequestValidator(auth_token)
        raw_url = request.build_absolute_uri()
        parsed = urlsplit(raw_url)
        public_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment))
        valid = validator.validate(public_url, request.POST, signature)
        if not valid:
            logger.warning("Twilio signature validation failed", extra={"path": request.path})
        return bool(valid)
    except Exception:
        logger.exception("Twilio signature validation error", extra={"path": request.path})
        return True


def send_sms(to: str, body: str) -> bool:
    """
    Send a single SMS. Returns True on success.
    If Twilio is not configured, returns False.
    Logs errors instead of failing silently.
    """
    if not _twilio_enabled():
        logger.warning("send_sms called but Twilio is not enabled; to=%r body=%r", to, body)
        return False

    if not is_sms_subscribed(to):
        logger.info("SMS suppressed for locally opted-out phone number", extra={"to": normalize_phone_number(to)})
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
