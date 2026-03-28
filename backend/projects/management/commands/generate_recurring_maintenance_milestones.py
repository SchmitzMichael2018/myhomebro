from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.models import Agreement
from projects.services.recurring_maintenance import ensure_recurring_milestones


class Command(BaseCommand):
    help = "Generate due recurring maintenance milestone occurrences for active maintenance agreements."

    def handle(self, *args, **options):
        created_total = 0
        agreement_count = 0

        qs = Agreement.objects.filter(
            recurring_service_enabled=True,
            agreement_mode="maintenance",
        ).order_by("id")

        for agreement in qs.iterator():
            agreement_count += 1
            created = ensure_recurring_milestones(agreement, horizon=1)
            created_total += len(created)

        self.stdout.write(
            self.style.SUCCESS(
                f"Processed {agreement_count} maintenance agreement(s); created {created_total} recurring milestone occurrence(s)."
            )
        )
