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
        from_number = getattr(settings, "TWILIO_PHONE_NUMBER", "")

        # Basic sanity checks
        if not account_sid or not auth_token or not from_number:
            raise CommandError(
                "Missing Twilio configuration. Please ensure TWILIO_ACCOUNT_SID, "
                "TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set in settings/env."
            )

        self.stdout.write(self.style.NOTICE("Twilio configuration:"))
        self.stdout.write(f"  TWILIO_ACCOUNT_SID: {account_sid[:6]}... (truncated)")
        self.stdout.write(f"  TWILIO_PHONE_NUMBER: {from_number}")
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
