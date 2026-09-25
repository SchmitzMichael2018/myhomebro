from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from projects.services.marketplace_request_lifecycle import process_marketplace_request_lifecycle


class Command(BaseCommand):
    help = "Process unanswered Marketplace request reminders, archival, retention, and safe purge."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--at", help="Optional ISO-8601 processing time for deterministic operation.")

    def handle(self, *args, **options):
        limit = int(options["limit"])
        if limit < 1 or limit > 5000:
            raise CommandError("--limit must be between 1 and 5000.")
        now = timezone.now()
        if options.get("at"):
            now = parse_datetime(options["at"])
            if now is None or timezone.is_naive(now):
                raise CommandError("--at must be an ISO-8601 timestamp with a timezone.")
        counts = process_marketplace_request_lifecycle(
            now=now,
            limit=limit,
            dry_run=bool(options["dry_run"]),
        )
        line = " ".join(f"{name}={value}" for name, value in vars(counts).items())
        self.stdout.write(f"Marketplace request lifecycle: {line} dry_run={bool(options['dry_run'])}")
        if counts.failed:
            raise CommandError(f"Marketplace request lifecycle completed with {counts.failed} failure(s).")
