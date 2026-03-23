from __future__ import annotations

import logging

from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from twilio.twiml.messaging_response import MessagingResponse

from projects.models_sms import SMSConsentStatus
from projects.services.sms import (
    classify_inbound_keyword,
    handle_incoming_user_message,
    normalize_inbound_body,
    normalize_phone_number,
    upsert_sms_consent_status,
    validate_twilio_webhook_request,
)

logger = logging.getLogger(__name__)

OPT_OUT_RESPONSE = (
    "MyHomeBro: You have been unsubscribed from SMS notifications. "
    "Reply START to re-subscribe. Reply HELP for help."
)
HELP_RESPONSE = (
    "MyHomeBro alerts: project updates, payments, and messages. Msg frequency varies. "
    "Reply STOP to opt out. Reply START to opt back in. Help: support@myhomebro.com"
)
OPT_IN_RESPONSE = "MyHomeBro: You have been re-subscribed to SMS notifications."
DEFAULT_RESPONSE = "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out."


def _twiml_response(message: str) -> HttpResponse:
    twiml = MessagingResponse()
    twiml.message(message)
    return HttpResponse(str(twiml), content_type="text/xml", status=200)


@csrf_exempt
def sms_webhook(request):
    if request.method != "POST":
        logger.info("Twilio SMS webhook received non-POST request", extra={"method": request.method})
        return _twiml_response(DEFAULT_RESPONSE)

    branch = SMSConsentStatus.KEYWORD_DEFAULT
    from_number = ""
    normalized_body = ""
    message_sid = ""

    try:
        validate_twilio_webhook_request(request)

        from_number = normalize_phone_number(request.POST.get("From", ""))
        raw_body = request.POST.get("Body", "")
        normalized_body = normalize_inbound_body(raw_body)
        message_sid = (request.POST.get("MessageSid", "") or "").strip()

        branch = classify_inbound_keyword(raw_body)
        response_text = DEFAULT_RESPONSE

        if branch == SMSConsentStatus.KEYWORD_OPT_OUT:
            response_text = OPT_OUT_RESPONSE
        elif branch == SMSConsentStatus.KEYWORD_HELP:
            response_text = HELP_RESPONSE
        elif branch == SMSConsentStatus.KEYWORD_OPT_IN:
            response_text = OPT_IN_RESPONSE

        upsert_sms_consent_status(
            phone_number=from_number,
            message_sid=message_sid,
            body=raw_body,
            keyword_type=branch,
        )

        if branch == SMSConsentStatus.KEYWORD_DEFAULT:
            handle_incoming_user_message(from_number, normalized_body, message_sid)

        logger.info(
            "Processed inbound Twilio SMS webhook",
            extra={
                "from_number": from_number,
                "normalized_body": normalized_body,
                "message_sid": message_sid,
                "branch": branch,
            },
        )
        return _twiml_response(response_text)
    except Exception:
        logger.exception(
            "Inbound Twilio SMS webhook failed",
            extra={
                "from_number": from_number,
                "normalized_body": normalized_body,
                "message_sid": message_sid,
                "branch": "error",
            },
        )
        try:
            if from_number:
                upsert_sms_consent_status(
                    phone_number=from_number,
                    message_sid=message_sid,
                    body=normalized_body,
                    keyword_type=SMSConsentStatus.KEYWORD_ERROR,
                )
        except Exception:
            logger.exception("Failed to persist SMS webhook error audit", extra={"from_number": from_number})
        return _twiml_response(DEFAULT_RESPONSE)
