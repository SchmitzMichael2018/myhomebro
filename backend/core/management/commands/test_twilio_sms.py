# core/management/commands/test_twilio_sms.py
# v2025-12-01 — Simple Twilio test command for MyHomeBro
#
# Usage:
#   python manage.py test_twilio_sms +1XXXXXXXXXX "Test from MyHomeBro"
#
# This uses the same TWILIO_* settings as core/notifications.py and will
# send a single SMS to the provided phone number.

from __future__ import annotations

import logging

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

try:
    from twilio.rest import Client as TwilioClient
except ImportError as exc:
    raise ImportError(
        "The 'twilio' package is not installed. "
        "Run `pip install twilio` in your virtualenv."
    ) from exc

from projects.services.sms_service import send_compliant_sms

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Send a test SMS via Twilio using TWILIO_* settings."

    def add_arguments(self, parser):
        parser.add_argument(
            "phone_number",
            type=str,
            help="Destination phone number in E.164 format (e.g. +12105551234).",
        )
        parser.add_argument(
            "message",
            type=str,
            nargs="?",
            default="Test SMS from MyHomeBro via Twilio.",
            help="Optional message text (default: 'Test SMS from MyHomeBro via Twilio.')",
        )

    def handle(self, *args, **options):
        phone_number = options["phone_number"]
        message = options["message"]

        account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
        auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
        from_number = getattr(settings, "TWILIO_PHONE_NUMBER", "") or getattr(settings, "TWILIO_FROM_NUMBER", "")
        messaging_service_sid = getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", "")

        if messaging_service_sid:
            self.stdout.write(self.style.NOTICE("Using compliant SMS sender path (messaging service sid configured)."))
            result = send_compliant_sms(
                phone_number,
                message,
                category="customer_care",
                dedupe_key=f"test_twilio_sms:{phone_number}",
            )
            self.stdout.write(f"  Status: {result.get('status')}")
            self.stdout.write(f"  Reason: {result.get('reason_code') or 'n/a'}")
            self.stdout.write(f"  Detail: {result.get('detail')}")
            self.stdout.write(f"  Phone: {result.get('phone_number_e164')}")
            if result.get("ok"):
                self.stdout.write(self.style.SUCCESS(f"SMS sent successfully! Twilio SID: {result.get('twilio_sid')}"))
                return
            raise CommandError(
                f"Compliant SMS was not sent: {result.get('detail') or result.get('reason_code') or 'unknown reason'}"
            )

        # Basic sanity checks
        if not account_sid or not auth_token or not from_number:
            raise CommandError(
                "Missing Twilio configuration. Please ensure TWILIO_ACCOUNT_SID, "
                "TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER/TWILIO_FROM_NUMBER are set in settings/env."
            )

        self.stdout.write(self.style.NOTICE("Twilio configuration:"))
        self.stdout.write(f"  TWILIO_ACCOUNT_SID: {account_sid[:6]}... (truncated)")
        self.stdout.write(f"  TWILIO_PHONE_NUMBER/TWILIO_FROM_NUMBER: {from_number}")
        self.stdout.write(f"  Destination: {phone_number}")
        self.stdout.write(f"  Message: {message}")
        self.stdout.write("")

        try:
            client = TwilioClient(account_sid, auth_token)
        except Exception as exc:
            raise CommandError(f"Failed to initialize Twilio client: {exc}") from exc

        self.stdout.write("Sending SMS via Twilio...")

        try:
            msg = client.messages.create(
                body=message,
                from_=from_number,
                to=phone_number,
            )
        except Exception as exc:
            logger.error("Twilio send error: %s", exc)
            raise CommandError(f"Failed to send SMS via Twilio: {exc}") from exc

        self.stdout.write(self.style.SUCCESS("SMS sent successfully!"))
        self.stdout.write(f"  Twilio SID: {msg.sid}")
        self.stdout.write(f"  Status (initial): {msg.status}")
        self.stdout.write("Check your phone to confirm receipt.")
