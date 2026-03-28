from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.services.project_learning import (
    backfill_completed_agreement_snapshots,
    rebuild_project_benchmarks,
)


class Command(BaseCommand):
    help = "Backfill completed agreement outcome snapshots and rebuild benchmark aggregates."

    def add_arguments(self, parser):
        parser.add_argument(
            "--agreement-id",
            dest="agreement_ids",
            action="append",
            type=int,
            help="Optional agreement id to refresh before rebuilding benchmarks. Can be repeated.",
        )
        parser.add_argument(
            "--skip-snapshot-refresh",
            action="store_true",
            help="Rebuild aggregate tables from existing snapshots without refreshing completed agreements first.",
        )

    def handle(self, *args, **options):
        agreement_ids = options.get("agreement_ids") or None
        skip_snapshot_refresh = bool(options.get("skip_snapshot_refresh"))

        refreshed = 0
        if not skip_snapshot_refresh:
            refreshed = backfill_completed_agreement_snapshots(agreement_ids=agreement_ids)
            self.stdout.write(self.style.NOTICE(f"Refreshed {refreshed} completed agreement snapshots."))

        aggregate_count = rebuild_project_benchmarks()
        self.stdout.write(
            self.style.SUCCESS(
                f"Rebuilt {aggregate_count} benchmark aggregate rows from normalized snapshots."
            )
        )
