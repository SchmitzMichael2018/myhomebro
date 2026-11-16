from django.core.management.base import BaseCommand

from accounts.models import ContractorWelcomeEmail
from accounts.services.welcome import deliver_welcome


class Command(BaseCommand):
    help = "Send existing pending welcomes; never enroll existing users."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true")
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        statuses = ["pending", "failed"] if options["retry_failed"] else ["pending"]
        ids = list(ContractorWelcomeEmail.objects.filter(status__in=statuses)
                   .order_by("created_at").values_list("pk", flat=True)[:max(0, options["limit"])])
        sent = failed = 0
        for delivery_id in ids:
            try:
                sent += bool(deliver_welcome(delivery_id))
            except Exception:
                failed += 1
        self.stdout.write(f"Sent: {sent}; failed: {failed}; inspected: {len(ids)}")
