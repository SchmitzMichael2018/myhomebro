from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.models_customer_portal import NotificationRule
from projects.services.home_system_reminders import dispatch_home_system_reminders


class Command(BaseCommand):
    help = "Dispatch advisory home-system maintenance reminders for Customer Portal properties."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report eligible reminders without creating notifications.")
        parser.add_argument(
            "--channel",
            choices=["email", "sms", NotificationRule.CHANNEL_EMAIL_STUB, NotificationRule.CHANNEL_SMS_STUB],
            help="Limit dispatch to one channel.",
        )
        parser.add_argument("--limit", type=int, help="Maximum number of systems to scan.")
        parser.add_argument("--property-id", type=int, help="Limit to one PropertyProfile ID.")
        parser.add_argument("--customer-email", default="", help="Limit to one customer email.")

    def handle(self, *args, **options):
        result = dispatch_home_system_reminders(
            dry_run=bool(options.get("dry_run")),
            channel=options.get("channel") or None,
            limit=options.get("limit"),
            property_id=options.get("property_id"),
            customer_email=options.get("customer_email") or "",
        )
        payload = result.as_dict()
        self.stdout.write(
            self.style.SUCCESS(
                "Home-system reminders: "
                f"scanned={payload['scanned']} eligible={payload['eligible']} "
                f"sent={payload['sent']} skipped={payload['skipped']} "
                f"errors={payload['errors']} dry_run={payload['dry_run']}"
            )
        )
        for detail in payload["details"][:20]:
            self.stdout.write(str(detail))
