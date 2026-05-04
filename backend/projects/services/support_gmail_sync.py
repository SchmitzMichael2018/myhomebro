from __future__ import annotations

import imaplib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone
from email import message_from_bytes
from email.header import decode_header
from email.utils import parsedate_to_datetime, parseaddr

from django.conf import settings
from django.utils import timezone

from projects.models_support import (
    SupportTicket,
    SupportTicketMessage,
    SupportTicketMessageSenderType,
)

logger = logging.getLogger(__name__)

TICKET_NUMBER_RE = re.compile(r"\bMHB-\d{6}\b")


@dataclass(slots=True)
class InboundSupportEmail:
    gmail_message_id: str = ""
    gmail_thread_id: str = ""
    subject: str = ""
    body: str = ""
    sender_email: str = ""
    sent_at: datetime | None = None


def extract_ticket_number(text: str | None) -> str:
    if not text:
        return ""
    match = TICKET_NUMBER_RE.search(str(text))
    return match.group(0) if match else ""


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    parts: list[str] = []
    for chunk, encoding in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(encoding or "utf-8", errors="replace"))
        else:
            parts.append(chunk)
    return "".join(parts).strip()


def _extract_plain_text(email_message) -> str:
    if email_message.is_multipart():
        for part in email_message.walk():
            content_type = (part.get_content_type() or "").lower()
            content_disposition = (part.get_content_disposition() or "").lower()
            if content_disposition == "attachment":
                continue
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace").strip()
    payload = email_message.get_payload(decode=True)
    if payload:
        charset = email_message.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="replace").strip()
    payload = email_message.get_payload()
    if isinstance(payload, str):
        return payload.strip()
    return ""


def _normalize_message_id(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    return text.strip("<>").strip()


def _sender_type_for_email(sender_email: str) -> str:
    support_email = (getattr(settings, "SUPPORT_EMAIL", "") or "").strip().lower()
    normalized = (sender_email or "").strip().lower()
    if not normalized:
        return SupportTicketMessageSenderType.SYSTEM
    if support_email and normalized == support_email:
        return SupportTicketMessageSenderType.SUPPORT
    return SupportTicketMessageSenderType.USER


def iter_inbound_support_emails_from_imap() -> list[InboundSupportEmail]:
    if not getattr(settings, "SUPPORT_INBOUND_SYNC_ENABLED", False):
        return []

    host = getattr(settings, "SUPPORT_GMAIL_IMAP_HOST", "") or ""
    username = getattr(settings, "SUPPORT_GMAIL_USERNAME", "") or ""
    password = getattr(settings, "SUPPORT_GMAIL_PASSWORD", "") or ""
    folder = getattr(settings, "SUPPORT_GMAIL_FOLDER", "INBOX") or "INBOX"
    port = int(getattr(settings, "SUPPORT_GMAIL_IMAP_PORT", 993) or 993)
    lookback_days = int(getattr(settings, "SUPPORT_GMAIL_SYNC_LOOKBACK_DAYS", 14) or 14)

    if not host or not username or not password:
        logger.warning("Support Gmail sync skipped: IMAP credentials are not configured.")
        return []

    since_date = (timezone.now() - timedelta(days=lookback_days)).date()
    since_token = since_date.strftime("%d-%b-%Y")

    messages: list[InboundSupportEmail] = []
    mailbox_cls = imaplib.IMAP4_SSL if getattr(settings, "SUPPORT_GMAIL_USE_SSL", True) else imaplib.IMAP4
    with mailbox_cls(host, port) as mailbox:
        mailbox.login(username, password)
        mailbox.select(folder)
        status, data = mailbox.search(None, f"SINCE {since_token}")
        if status != "OK":
            return []

        for raw_id in data[0].split():
            fetch_status, fetch_data = mailbox.fetch(raw_id, "(RFC822)")
            if fetch_status != "OK" or not fetch_data:
                continue
            raw_bytes = next((chunk[1] for chunk in fetch_data if isinstance(chunk, tuple) and len(chunk) > 1), b"")
            if not raw_bytes:
                continue
            parsed = message_from_bytes(raw_bytes)
            subject = _decode_header_value(parsed.get("Subject", ""))
            body = _extract_plain_text(parsed)
            sender_name, sender_email = parseaddr(parsed.get("From", "") or "")
            sent_at = None
            try:
                sent_at = parsedate_to_datetime(parsed.get("Date", "") or "")
                if sent_at is not None and sent_at.tzinfo is None:
                    sent_at = sent_at.replace(tzinfo=dt_timezone.utc)
            except Exception:
                sent_at = None

            message_id = _normalize_message_id(parsed.get("Message-ID", ""))
            messages.append(
                InboundSupportEmail(
                    gmail_message_id=message_id,
                    gmail_thread_id=_normalize_message_id(parsed.get("X-GM-THRID", "")),
                    subject=subject,
                    body=body,
                    sender_email=sender_email or sender_name or "",
                    sent_at=sent_at,
                )
            )

    return messages


def import_support_message_from_inbound_email(payload: InboundSupportEmail) -> tuple[bool, str]:
    ticket_number = extract_ticket_number(payload.subject) or extract_ticket_number(payload.body)
    if not ticket_number:
        logger.warning("Skipping support email without ticket number: subject=%s", payload.subject)
        return False, "skipped_unknown_ticket"

    try:
        ticket = SupportTicket.objects.get(ticket_number=ticket_number)
    except SupportTicket.DoesNotExist:
        logger.warning("Skipping support email for unknown ticket number %s", ticket_number)
        return False, "skipped_unknown_ticket"

    gmail_message_id = _normalize_message_id(payload.gmail_message_id)
    if gmail_message_id and SupportTicketMessage.objects.filter(gmail_message_id=gmail_message_id).exists():
        return False, "duplicate"

    sender_email = (payload.sender_email or "").strip()
    sender_type = _sender_type_for_email(sender_email)
    message_text = (payload.body or payload.subject or "").strip()
    if not message_text:
        return False, "skipped_empty_body"

    SupportTicketMessage.objects.create(
        ticket=ticket,
        sender=None,
        sender_type=sender_type,
        sender_email=sender_email,
        message=message_text,
        gmail_message_id=gmail_message_id,
        gmail_thread_id=_normalize_message_id(payload.gmail_thread_id),
        sent_at=payload.sent_at or timezone.now(),
        is_internal=False,
    )
    return True, "created"


def sync_support_inbound_emails(messages: list[InboundSupportEmail] | None = None) -> dict[str, int]:
    inbound_messages = messages if messages is not None else iter_inbound_support_emails_from_imap()
    results = {
        "created": 0,
        "duplicate": 0,
        "skipped_unknown_ticket": 0,
        "skipped_empty_body": 0,
    }
    for payload in inbound_messages:
        created, reason = import_support_message_from_inbound_email(payload)
        if created:
            results["created"] = results.get("created", 0) + 1
        else:
            results[reason] = results.get(reason, 0) + 1
    return results
