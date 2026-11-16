from django.core.management.base import BaseCommand
from accounts.models import AdminSignupSMS
from accounts.services.signup_alerts import deliver_signup_alert


class Command(BaseCommand):
    help = "Recover existing signup alert records; never alert on historical accounts."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true")
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        states = ["pending", "failed"] if options["retry_failed"] else ["pending"]
        ids = list(AdminSignupSMS.objects.filter(status__in=states).order_by("created_at")
                   .values_list("pk", flat=True)[:max(0, options["limit"])])
        results = {}
        for delivery_id in ids:
            status = deliver_signup_alert(delivery_id)
            results[status] = results.get(status, 0) + 1
        self.stdout.write(str(results))
