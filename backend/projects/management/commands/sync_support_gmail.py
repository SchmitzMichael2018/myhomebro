from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand

from projects.services.support_gmail_sync import sync_support_inbound_emails


class Command(BaseCommand):
    help = "Sync inbound support replies from Gmail or a configured mailbox provider."

    def handle(self, *args, **options):
        if not getattr(settings, "SUPPORT_INBOUND_SYNC_ENABLED", False):
            self.stdout.write(self.style.WARNING("Support Gmail sync is disabled."))
            return

        results = sync_support_inbound_emails()
        self.stdout.write(
            self.style.SUCCESS(
                "Support Gmail sync complete: "
                f"created={results.get('created', 0)} "
                f"duplicate={results.get('duplicate', 0)} "
                f"skipped_unknown_ticket={results.get('skipped_unknown_ticket', 0)} "
                f"skipped_empty_body={results.get('skipped_empty_body', 0)}"
            )
        )
