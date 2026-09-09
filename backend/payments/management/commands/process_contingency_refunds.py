from django.core.management.base import BaseCommand

from payments.services.contingency_refunds import process_due_contingency_refunds


class Command(BaseCommand):
    help = "Return unused contingency to homeowners after the closeout grace period."

    def handle(self, *args, **options):
        result = process_due_contingency_refunds()
        self.stdout.write(
            self.style.SUCCESS(
                "Contingency closeout: "
                f"checked={result['checked']} requested={result['requested']} "
                f"skipped={result['skipped']} failed={result['failed']}"
            )
        )
