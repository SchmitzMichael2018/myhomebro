from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.services.sms_automation import process_deferred_sms_automation


class Command(BaseCommand):
    help = "Process deferred SMS automation records that are ready to send."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)

    def handle(self, *args, **options):
        results = process_deferred_sms_automation(limit=options.get("limit") or 50)
        self.stdout.write(self.style.SUCCESS(f"Processed {len(results)} deferred SMS automation record(s)."))

