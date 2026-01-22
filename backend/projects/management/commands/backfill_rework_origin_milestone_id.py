# backend/projects/management/commands/backfill_rework_origin_milestone_id.py
# v2026-01-19
#
# One-time backfill:
#   Milestone.rework_origin_milestone_id = Dispute.milestone_id
# for milestones created as rework from disputes.
#
# Data sources:
#   DisputeWorkOrder.rework_milestone_id -> milestone.id
#   DisputeWorkOrder.dispute -> dispute.milestone_id (original disputed milestone)
#
# Safe + idempotent:
# - only fills when milestone.rework_origin_milestone_id is NULL
# - skips when original milestone is missing
# - supports --dry-run
#
# Usage:
#   python manage.py backfill_rework_origin_milestone_id --dry-run
#   python manage.py backfill_rework_origin_milestone_id
#   python manage.py backfill_rework_origin_milestone_id --limit 50
#   python manage.py backfill_rework_origin_milestone_id --verbose

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from projects.models import Milestone
from projects.models_dispute import DisputeWorkOrder


class Command(BaseCommand):
    help = "Backfill Milestone.rework_origin_milestone_id for existing rework milestones created from disputes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change, but do not write to the database.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional limit to number of milestones to backfill (0 = no limit).",
        )
        parser.add_argument(
            "--verbose",
            action="store_true",
            help="Print every updated milestone row.",
        )

    def handle(self, *args, **options):
        dry_run: bool = bool(options["dry_run"])
        limit: int = int(options["limit"] or 0)
        verbose: bool = bool(options["verbose"])

        # Guard: field must exist on the model
        if not hasattr(Milestone, "rework_origin_milestone_id"):
            self.stderr.write(
                self.style.ERROR(
                    "Milestone model does not have rework_origin_milestone_id. "
                    "Did you apply the migration?"
                )
            )
            return

        qs = (
            DisputeWorkOrder.objects.select_related("dispute")
            .exclude(rework_milestone_id__isnull=True)
            .order_by("id")
        )

        total_workorders = qs.count()
        updated = 0
        skipped_missing_milestone = 0
        skipped_already_set = 0
        skipped_missing_origin = 0
        processed = 0

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"Backfill rework_origin_milestone_id (dry_run={dry_run})"
            )
        )
        self.stdout.write(f"WorkOrders with rework_milestone_id: {total_workorders}")

        # Do updates in a transaction (unless dry-run)
        ctx = transaction.atomic() if not dry_run else _NullContext()

        with ctx:
            for wo in qs.iterator(chunk_size=200):
                if limit and processed >= limit:
                    break
                processed += 1

                rework_mid = wo.rework_milestone_id
                dispute = getattr(wo, "dispute", None)
                origin_mid = getattr(dispute, "milestone_id", None) if dispute else None

                if not rework_mid:
                    continue

                try:
                    m = Milestone.objects.get(id=rework_mid)
                except Milestone.DoesNotExist:
                    skipped_missing_milestone += 1
                    continue

                current = getattr(m, "rework_origin_milestone_id", None)
                if current:
                    skipped_already_set += 1
                    continue

                if not origin_mid:
                    skipped_missing_origin += 1
                    continue

                if dry_run:
                    updated += 1
                    if verbose:
                        self.stdout.write(
                            f"[DRY] milestone #{m.id} '{m.title}' -> origin #{origin_mid} (dispute #{getattr(dispute, 'id', None)})"
                        )
                    continue

                m.rework_origin_milestone_id = origin_mid
                m.save(update_fields=["rework_origin_milestone_id"])
                updated += 1

                if verbose:
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Updated milestone #{m.id} -> origin #{origin_mid} (dispute #{getattr(dispute, 'id', None)})"
                        )
                    )

            # If dry-run, roll back implicitly by not using transaction.atomic()
            # If not dry-run, commit happens here.

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        self.stdout.write(f"Processed workorders: {processed}")
        self.stdout.write(self.style.SUCCESS(f"Updated milestones: {updated}"))
        self.stdout.write(f"Skipped (milestone missing): {skipped_missing_milestone}")
        self.stdout.write(f"Skipped (already set): {skipped_already_set}")
        self.stdout.write(f"Skipped (origin milestone missing on dispute): {skipped_missing_origin}")

        if dry_run:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "Dry-run complete. No database changes were written."
                )
            )


class _NullContext:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False
