from django.core.management.base import BaseCommand
from receipts.models import Receipt


class Command(BaseCommand):
    help = "Generate missing receipt PDFs"

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true")
        parser.add_argument("--limit", type=int, default=0)

    def handle(self, *args, **opts):
        qs = Receipt.objects.order_by("-id")
        if opts["limit"]:
            qs = qs[: opts["limit"]]

        generated = 0
        for r in qs:
            if r.generate_pdf(force=opts["force"]):
                generated += 1
                self.stdout.write(
                    self.style.SUCCESS(f"Generated PDF for {r.receipt_number}")
                )
            else:
                self.stdout.write(f"Skipped {r.receipt_number}")

        self.stdout.write(self.style.SUCCESS(f"Done. Generated {generated} PDFs."))
