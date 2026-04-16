from __future__ import annotations

import os
import hashlib
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from projects.models import Agreement, Contractor, ContractorActivityEvent, Homeowner, Invoice, Milestone
from projects.models_sms import SMSConsent

try:
    from twilio.base.exceptions import TwilioRestException
    from twilio.rest import Client
except Exception:  # pragma: no cover
    TwilioRestException = Exception
    Client = None


OPT_OUT_KEYWORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"}
HELP_KEYWORDS = {"HELP", "INFO"}
OPT_IN_KEYWORDS = {"START", "UNSTOP"}
HELP_RESPONSE = (
    "MyHomeBro alerts: project updates, payments, and customer-care messages only. "
    "Reply STOP to opt out or START to opt back in. Help: support@myhomebro.com"
)
STOP_RESPONSE = "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to opt back in."
START_RESPONSE = "MyHomeBro: SMS notifications are enabled again."


def normalize_phone_to_e164(value: str | None) -> str:
    raw = "".join(ch for ch in str(value or "").strip() if ch.isdigit() or ch == "+")
    if not raw:
        return ""
    if raw.startswith("+"):
        return raw
    digits_only = "".join(ch for ch in raw if ch.isdigit())
    if len(digits_only) == 10:
        return f"+1{digits_only}"
    if len(digits_only) == 11 and digits_only.startswith("1"):
        return f"+{digits_only}"
    return raw


def _twilio_ready() -> bool:
    return bool(
        (getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID"))
        and (getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN"))
        and (getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", None) or os.getenv("TWILIO_MESSAGING_SERVICE_SID"))
        and Client is not None
    )


def _twilio_client():
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", None) or os.getenv("TWILIO_ACCOUNT_SID")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None) or os.getenv("TWILIO_AUTH_TOKEN")
    return Client(sid, token)


def _messaging_service_sid() -> str:
    return (
        getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", None)
        or os.getenv("TWILIO_MESSAGING_SERVICE_SID")
        or ""
    ).strip()


def _activity_preview(body: str) -> str:
    text = str(body or "").strip()
    return text[:120]


def _sms_dedupe_cache_key(*, phone_number_e164: str, dedupe_key: str) -> str:
    raw = f"{phone_number_e164}|{dedupe_key}".strip()
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest() if raw else ""
    return f"mhb:sms_dedupe:{digest}" if digest else ""


def _resolve_related_context(related_object=None) -> dict[str, Any]:
    agreement = None
    milestone = None
    invoice = None
    contractor = None
    homeowner = None
    if isinstance(related_object, Invoice):
        invoice = related_object
        agreement = related_object.agreement
    elif isinstance(related_object, Milestone):
        milestone = related_object
        agreement = related_object.agreement
    elif isinstance(related_object, Agreement):
        agreement = related_object
    elif isinstance(related_object, Homeowner):
        homeowner = related_object
    elif isinstance(related_object, Contractor):
        contractor = related_object

    if agreement is not None:
        contractor = agreement.contractor
        homeowner = agreement.homeowner
    elif milestone is not None and agreement is None:
        agreement = milestone.agreement
        contractor = agreement.contractor if agreement is not None else contractor
        homeowner = agreement.homeowner if agreement is not None else homeowner

    if homeowner is not None and contractor is None:
        contractor = getattr(homeowner, "created_by", None)

    return {
        "agreement": agreement,
        "milestone": milestone,
        "invoice": invoice,
        "contractor": contractor,
        "homeowner": homeowner,
    }


def _log_sms_activity(
    *,
    event_type: str,
    title: str,
    summary: str,
    phone: str,
    contractor: Contractor | None,
    agreement: Agreement | None = None,
    milestone: Milestone | None = None,
    metadata: dict[str, Any] | None = None,
    navigation_target: str = "",
    dedupe_key: str = "",
):
    from projects.services.activity_feed import create_activity_event

    create_activity_event(
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        event_type=event_type,
        title=title,
        summary=summary,
        severity=(
            ContractorActivityEvent.Severity.WARNING
            if event_type in {"sms_blocked", "sms_help_requested"}
            else ContractorActivityEvent.Severity.CRITICAL
            if event_type == "sms_failed"
            else ContractorActivityEvent.Severity.SUCCESS
        ),
        related_label=phone,
        icon_hint="sms",
        navigation_target=navigation_target,
        metadata=metadata or {},
        dedupe_key=dedupe_key,
    )


def get_sms_consent(phone_number: str | None) -> SMSConsent | None:
    normalized = normalize_phone_to_e164(phone_number)
    if not normalized:
        return None
    return SMSConsent.objects.filter(phone_number_e164=normalized).select_related("contractor", "homeowner").first()


def get_sms_status_payload(*, phone_number: str | None = None, contractor: Contractor | None = None, homeowner: Homeowner | None = None) -> dict[str, Any]:
    normalized = normalize_phone_to_e164(
        phone_number
        or getattr(homeowner, "phone_number", "")
        or getattr(contractor, "phone", "")
    )
    consent = get_sms_consent(normalized)
    if consent is None and homeowner is not None:
        consent = homeowner.sms_consents.order_by("-updated_at", "-id").first()
    if consent is None and contractor is not None:
        consent = contractor.sms_consents.order_by("-updated_at", "-id").first()
    related_contractor = contractor or getattr(homeowner, "created_by", None) or getattr(consent, "contractor", None)
    last_event = None
    if related_contractor is not None and normalized:
        last_event = (
            related_contractor.activity_events.filter(
                event_type__in=["sms_sent", "sms_blocked", "sms_opt_in", "sms_opt_out", "sms_help_requested", "sms_failed"],
                metadata__phone=normalized,
            )
            .order_by("-created_at", "-id")
            .first()
        )
    return {
        "phone_number_e164": normalized,
        "sms_enabled": bool(consent and consent.can_send_sms and not consent.opted_out),
        "sms_opted_out": bool(consent.opted_out) if consent else False,
        "can_send_sms": bool(consent.can_send_sms) if consent else False,
        "opted_in_at": consent.opted_in_at.isoformat() if consent and consent.opted_in_at else None,
        "opted_out_at": consent.opted_out_at.isoformat() if consent and consent.opted_out_at else None,
        "last_inbound_keyword": consent.last_inbound_keyword if consent else "",
        "last_sms_event": {
            "event_type": last_event.event_type,
            "created_at": last_event.created_at.isoformat() if last_event and last_event.created_at else None,
            "summary": last_event.summary if last_event else "",
        }
        if last_event
        else None,
    }


def set_sms_opt_in(
    *,
    phone_number: str,
    contractor: Contractor | None = None,
    homeowner: Homeowner | None = None,
    source: str = SMSConsent.OPT_IN_SOURCE_ADMIN,
    consent_text_snapshot: str = "",
    consent_source_page: str = "",
) -> SMSConsent:
    normalized = normalize_phone_to_e164(phone_number)
    if not normalized:
        raise ValueError("Valid phone number is required.")
    consent, _ = SMSConsent.objects.get_or_create(phone_number_e164=normalized)
    consent.contractor = contractor or consent.contractor or getattr(homeowner, "created_by", None)
    consent.homeowner = homeowner or consent.homeowner
    consent.can_send_sms = True
    consent.opted_out = False
    consent.opted_in_at = timezone.now()
    consent.opted_in_source = source
    consent.last_inbound_keyword = "START" if source == SMSConsent.OPT_IN_SOURCE_INBOUND_START else consent.last_inbound_keyword
    if consent_text_snapshot:
        consent.consent_text_snapshot = consent_text_snapshot
    if consent_source_page:
        consent.consent_source_page = consent_source_page
    consent.save()
    related_contractor = consent.contractor or getattr(consent.homeowner, "created_by", None)
    _log_sms_activity(
        event_type="sms_opt_in",
        title="SMS opt-in recorded",
        summary="SMS notifications are enabled for this phone number.",
        phone=normalized,
        contractor=related_contractor,
        agreement=None,
        milestone=None,
        metadata={"phone": normalized, "source": source},
        dedupe_key=f"sms_opt_in:{normalized}:{consent.opted_in_at.isoformat() if consent.opted_in_at else ''}",
    )
    return consent


def set_sms_opt_out(
    *,
    phone_number: str,
    contractor: Contractor | None = None,
    homeowner: Homeowner | None = None,
    source: str = SMSConsent.OPT_OUT_SOURCE_API,
    keyword: str = "STOP",
) -> SMSConsent:
    normalized = normalize_phone_to_e164(phone_number)
    if not normalized:
        raise ValueError("Valid phone number is required.")
    consent, _ = SMSConsent.objects.get_or_create(phone_number_e164=normalized)
    consent.contractor = contractor or consent.contractor or getattr(homeowner, "created_by", None)
    consent.homeowner = homeowner or consent.homeowner
    consent.can_send_sms = False
    consent.opted_out = True
    consent.opted_out_at = timezone.now()
    consent.opted_out_source = source
    consent.last_inbound_keyword = keyword
    consent.save()
    related_contractor = consent.contractor or getattr(consent.homeowner, "created_by", None)
    _log_sms_activity(
        event_type="sms_opt_out",
        title="SMS opt-out recorded",
        summary="SMS notifications were disabled for this phone number.",
        phone=normalized,
        contractor=related_contractor,
        metadata={"phone": normalized, "source": source, "keyword": keyword},
        dedupe_key=f"sms_opt_out:{normalized}:{consent.opted_out_at.isoformat() if consent.opted_out_at else ''}",
    )
    return consent


def send_compliant_sms(
    to_phone,
    body,
    *,
    related_object=None,
    category="customer_care",
    dedupe_key: str = "",
) -> dict[str, Any]:
    text = str(body or "").strip()
    normalized_phone = normalize_phone_to_e164(to_phone)
    related = _resolve_related_context(related_object)
    contractor = related["contractor"]
    agreement = related["agreement"]
    milestone = related["milestone"]

    result = {
        "ok": False,
        "blocked": False,
        "status": "blocked",
        "detail": "",
        "phone_number_e164": normalized_phone,
        "twilio_sid": "",
        "category": category,
    }

    consent = get_sms_consent(normalized_phone)
    if not normalized_phone or not text:
        result["blocked"] = True
        result["detail"] = "Phone number and message body are required."
    elif dedupe_key:
        cache_key = _sms_dedupe_cache_key(phone_number_e164=normalized_phone, dedupe_key=dedupe_key)
        try:
            if cache_key and cache.get(cache_key):
                result["blocked"] = True
                result["status"] = "duplicate"
                result["detail"] = "Duplicate SMS suppressed."
        except Exception:
            pass
    elif consent is None:
        result["blocked"] = True
        result["detail"] = "No SMS consent is on file for this phone number."
    elif consent.opted_out or not consent.can_send_sms:
        result["blocked"] = True
        result["detail"] = "SMS cannot be sent because this phone number is opted out or not consented."
        contractor = contractor or consent.contractor or getattr(consent.homeowner, "created_by", None)

    if result["blocked"]:
        _log_sms_activity(
            event_type="sms_blocked",
            title="SMS blocked",
            summary=result["detail"],
            phone=normalized_phone,
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            metadata={
                "phone": normalized_phone,
                "message_preview": _activity_preview(text),
                "category": category,
                "dedupe_key": dedupe_key,
            },
        )
        return result

    contractor = contractor or consent.contractor or getattr(consent.homeowner, "created_by", None)
    if not _twilio_ready():
        result["status"] = "failed"
        result["detail"] = "Twilio Messaging Service is not configured."
        _log_sms_activity(
            event_type="sms_failed",
            title="SMS failed",
            summary=result["detail"],
            phone=normalized_phone,
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            metadata={"phone": normalized_phone, "message_preview": _activity_preview(text), "category": category},
        )
        return result

    try:
        message = _twilio_client().messages.create(
            to=normalized_phone,
            body=text,
            messaging_service_sid=_messaging_service_sid(),
        )
        sid = str(getattr(message, "sid", "") or "")
        result.update({"ok": True, "blocked": False, "status": "sent", "detail": "SMS queued.", "twilio_sid": sid})
        if dedupe_key:
            try:
                cache_key = _sms_dedupe_cache_key(phone_number_e164=normalized_phone, dedupe_key=dedupe_key)
                if cache_key:
                    cache.set(cache_key, True, timeout=60 * 60 * 24 * 365)
            except Exception:
                pass
        _log_sms_activity(
            event_type="sms_sent",
            title="SMS sent",
            summary="A compliant SMS notification was queued.",
            phone=normalized_phone,
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            metadata={
                "phone": normalized_phone,
                "message_preview": _activity_preview(text),
                "twilio_sid": sid,
                "category": category,
                "delivery_status": str(getattr(message, "status", "") or ""),
                "dedupe_key": dedupe_key,
            },
            navigation_target=f"/app/agreements/{agreement.id}" if agreement is not None else "",
            dedupe_key=f"sms_sent:{sid}" if sid else "",
        )
        return result
    except TwilioRestException as exc:  # type: ignore[misc]
        error_code = str(getattr(exc, "code", "") or "")
        if error_code in {"21610", "30007"} and consent is not None:
            consent.can_send_sms = False
            consent.opted_out = True
            consent.opted_out_at = timezone.now()
            consent.opted_out_source = SMSConsent.OPT_OUT_SOURCE_TWILIO_ERROR
            consent.save(update_fields=["can_send_sms", "opted_out", "opted_out_at", "opted_out_source", "updated_at"])
        result.update({"status": "failed", "detail": str(exc)})
    except Exception as exc:  # pragma: no cover
        result.update({"status": "failed", "detail": str(exc)})

    _log_sms_activity(
        event_type="sms_failed",
        title="SMS failed",
        summary=result["detail"] or "Twilio rejected the SMS request.",
        phone=normalized_phone,
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        metadata={
            "phone": normalized_phone,
            "message_preview": _activity_preview(text),
            "category": category,
            "twilio_sid": result["twilio_sid"],
            "dedupe_key": dedupe_key,
        },
    )
    return result


def maybe_send_sms_for_activity_event(event) -> dict[str, Any] | None:
    trigger_map = {
        "payment_released": lambda e: f"Your payment for Agreement #{e.agreement_id} has been released.",
        "invoice_approved": lambda e: f"Your invoice for Agreement #{e.agreement_id} was approved.",
        "escrow_funded": lambda e: f"Escrow funding was received for Agreement #{e.agreement_id}.",
        "milestone_pending_approval": lambda e: f"A milestone was submitted for approval on Agreement #{e.agreement_id}.",
        "agreement_sent": lambda e: f"Agreement #{e.agreement_id} is ready for your review.",
    }
    builder = trigger_map.get(getattr(event, "event_type", ""))
    agreement = getattr(event, "agreement", None)
    if builder is None or agreement is None:
        return None
    homeowner = getattr(agreement, "homeowner", None)
    phone = normalize_phone_to_e164(getattr(homeowner, "phone_number", ""))
    if not phone:
        return None
    return send_compliant_sms(phone, builder(event), related_object=agreement, category="customer_care")


def handle_inbound_sms(*, from_phone: str, body: str, message_sid: str = "") -> dict[str, Any]:
    normalized_phone = normalize_phone_to_e164(from_phone)
    keyword = str(body or "").strip().upper()
    consent = get_sms_consent(normalized_phone)
    contractor = getattr(consent, "contractor", None) if consent else None
    homeowner = getattr(consent, "homeowner", None) if consent else None
    if keyword in OPT_OUT_KEYWORDS:
        set_sms_opt_out(
            phone_number=normalized_phone,
            contractor=contractor,
            homeowner=homeowner,
            source=SMSConsent.OPT_OUT_SOURCE_INBOUND_STOP,
            keyword=keyword,
        )
        return {"message": STOP_RESPONSE, "keyword": "STOP", "phone_number_e164": normalized_phone}
    if keyword in OPT_IN_KEYWORDS:
        set_sms_opt_in(
            phone_number=normalized_phone,
            contractor=contractor,
            homeowner=homeowner,
            source=SMSConsent.OPT_IN_SOURCE_INBOUND_START,
        )
        return {"message": START_RESPONSE, "keyword": "START", "phone_number_e164": normalized_phone}
    if keyword in HELP_KEYWORDS:
        if consent is not None:
            consent.last_inbound_keyword = keyword
            consent.save(update_fields=["last_inbound_keyword", "updated_at"])
        _log_sms_activity(
            event_type="sms_help_requested",
            title="SMS help requested",
            summary="The contact replied HELP and received the standard support guidance.",
            phone=normalized_phone,
            contractor=contractor or getattr(homeowner, "created_by", None),
            metadata={"phone": normalized_phone, "message_sid": message_sid},
            dedupe_key=f"sms_help_requested:{normalized_phone}:{message_sid or timezone.now().isoformat()}",
        )
        return {"message": HELP_RESPONSE, "keyword": "HELP", "phone_number_e164": normalized_phone}
    if consent is not None:
        consent.last_inbound_keyword = keyword
        consent.save(update_fields=["last_inbound_keyword", "updated_at"])
    return {"message": HELP_RESPONSE, "keyword": "DEFAULT", "phone_number_e164": normalized_phone}


def handle_sms_status_callback(*, message_sid: str, message_status: str, to_phone: str = "", error_code: str = "") -> dict[str, Any]:
    normalized_phone = normalize_phone_to_e164(to_phone)
    event = ContractorActivityEvent.objects.filter(
        event_type="sms_sent",
        metadata__twilio_sid=message_sid,
    ).order_by("-created_at", "-id").first()
    if event is not None:
        metadata = dict(event.metadata or {})
        metadata["delivery_status"] = message_status
        if error_code:
            metadata["error_code"] = error_code
        event.metadata = metadata
        event.save(update_fields=["metadata"])
    if message_status in {"failed", "undelivered"}:
        consent = get_sms_consent(normalized_phone)
        if consent is not None and error_code in {"21610", "30007"}:
            consent.can_send_sms = False
            consent.opted_out = True
            consent.opted_out_at = timezone.now()
            consent.opted_out_source = SMSConsent.OPT_OUT_SOURCE_TWILIO_ERROR
            consent.save(update_fields=["can_send_sms", "opted_out", "opted_out_at", "opted_out_source", "updated_at"])
        _log_sms_activity(
            event_type="sms_failed",
            title="SMS delivery failed",
            summary=f"Twilio reported {message_status} for the message delivery.",
            phone=normalized_phone,
            contractor=getattr(event, "contractor", None) if event else None,
            agreement=getattr(event, "agreement", None) if event else None,
            milestone=getattr(event, "milestone", None) if event else None,
            metadata={"phone": normalized_phone, "twilio_sid": message_sid, "delivery_status": message_status, "error_code": error_code},
            dedupe_key=f"sms_failed:{message_sid}:{message_status}",
        )
    return {"ok": True, "message_sid": message_sid, "message_status": message_status, "phone_number_e164": normalized_phone}
