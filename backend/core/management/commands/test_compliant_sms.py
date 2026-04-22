from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from projects.services.sms_service import send_compliant_sms


class Command(BaseCommand):
    help = "Send a test SMS through MyHomeBro's compliant SMS sender."

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
            default="Test SMS from MyHomeBro compliant sender.",
            help="Optional message text.",
        )
        parser.add_argument(
            "--dedupe-key",
            type=str,
            default="test_compliant_sms",
            help="Optional dedupe key to keep repeated test sends from duplicating.",
        )

    def handle(self, *args, **options):
        phone_number = options["phone_number"]
        message = options["message"]
        dedupe_key = options["dedupe_key"]

        result = send_compliant_sms(
            phone_number,
            message,
            category="customer_care",
            dedupe_key=dedupe_key,
        )

        self.stdout.write(f"Result: {result.get('status')} ({result.get('reason_code') or 'no reason'})")
        self.stdout.write(f"Detail: {result.get('detail')}")
        self.stdout.write(f"Phone: {result.get('phone_number_e164')}")

        if result.get("ok"):
            self.stdout.write(self.style.SUCCESS(f"SMS sent successfully. Twilio SID: {result.get('twilio_sid')}"))
            return

        raise CommandError(
            f"Compliant SMS was not sent: {result.get('detail') or result.get('reason_code') or 'unknown reason'}"
        )
