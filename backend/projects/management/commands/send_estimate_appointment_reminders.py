from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError

from projects.services.estimate_appointment_notifications import dispatch_due_reminders


class Command(BaseCommand):
    help = "Send due Estimate appointment reminders without sending obsolete schedule versions."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--batch-size", type=int, default=100)

    def handle(self, *args, **options):
        batch_size = max(1, min(int(options["batch_size"]), 1000))
        lock_key = "estimate-appointment-reminders-command-lock"
        if not cache.add(lock_key, "running", timeout=14 * 60):
            self.stdout.write("Estimate appointment reminders: another run is active; skipped.")
            return
        try:
            counts = dispatch_due_reminders(dry_run=options["dry_run"], batch_size=batch_size)
        except Exception as exc:
            raise CommandError("Estimate appointment reminder command failed.") from exc
        finally:
            cache.delete(lock_key)
        self.stdout.write(self.style.SUCCESS(
            "Estimate appointment reminders: "
            f"eligible={counts.eligible} sent={counts.sent} skipped={counts.skipped} "
            f"failed={counts.failed} suppressed={counts.suppressed} dry_run={bool(options['dry_run'])}"
        ))
