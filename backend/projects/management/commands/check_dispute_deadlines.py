# backend/projects/management/commands/check_dispute_deadlines.py
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from projects.models_dispute import Dispute


class Command(BaseCommand):
    help = "Escalate disputes past response/proposal deadlines to under_review (no money movement)."

    def handle(self, *args, **options):
        now = timezone.now()
        updated = 0

        # Overdue response deadline
        qs1 = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lt=now,
        )

        for d in qs1.iterator():
            # Decide who missed: if homeowner initiated, contractor is expected; else homeowner expected
            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"

            d.status = "under_review"
            d.deadline_missed_by = missed_by
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            updated += 1

        # Overdue proposal decision deadline (homeowner decision)
        qs2 = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lt=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "canceled"])

        for d in qs2.iterator():
            d.status = "under_review"
            d.deadline_missed_by = "homeowner"
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            updated += 1

        self.stdout.write(self.style.SUCCESS(f"check_dispute_deadlines: updated {updated} dispute(s)."))
