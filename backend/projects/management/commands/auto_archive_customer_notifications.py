from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.services.customer_notification_cleanup import auto_archive_customer_notifications, run_due_customer_notification_cleanup


class Command(BaseCommand):
    help = "Auto-archive stale read customer portal notifications without deleting history."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report eligible notifications without archiving them.")
        parser.add_argument("--limit", type=int, default=None, help="Maximum notifications to scan.")
        parser.add_argument("--customer-email", default="", help="Limit cleanup to one customer email.")
        parser.add_argument("--days", type=int, default=None, help="Override the category-specific age threshold.")
        parser.add_argument("--due-only", action="store_true", help="Only process customers whose next cleanup run is due.")
        parser.add_argument("--force", action="store_true", help="Run even when a customer's next scheduled cleanup is not due.")

    def handle(self, *args, **options):
        if options["due_only"] or options["force"] or not options.get("customer_email"):
            report = run_due_customer_notification_cleanup(
                dry_run=options["dry_run"],
                limit=options.get("limit"),
                customer_email=options.get("customer_email") or "",
                days=options.get("days"),
                due_only=options["due_only"],
                force=options["force"],
            )
        else:
            report = auto_archive_customer_notifications(
                dry_run=options["dry_run"],
                limit=options.get("limit"),
                customer_email=options.get("customer_email") or "",
                days=options.get("days"),
            )
        summary = report.as_dict()
        self.stdout.write(
            self.style.SUCCESS(
                "Customer notification auto-archive: "
                f"scanned={summary['scanned']} eligible={summary['eligible']} "
                f"archived={summary['archived']} skipped={summary['skipped']} dry_run={summary['dry_run']}"
            )
        )
