from __future__ import annotations

from typing import Iterable, Optional
from datetime import date

from django.core.management.base import BaseCommand, CommandParser
from django.db import transaction
from django.db.models import Prefetch, Q

from projects.models import Agreement, Milestone, ProjectStatus


class Command(BaseCommand):
    help = (
        "Backfill Agreement.start and Agreement.end from related Milestones. "
        "By default this is a DRY RUN (no writes). Use --commit to persist changes.\n"
        "You can also recompute status and milestone_count."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Persist changes to the database (omit for dry run).",
        )
        parser.add_argument(
            "--only-missing",
            action="store_true",
            help="Only set start/end when they are currently NULL (do not overwrite existing values).",
        )
        parser.add_argument(
            "--recompute-status",
            action="store_true",
            help="Also recompute Agreement.status based on signatures/escrow/milestone completion.",
        )
        parser.add_argument(
            "--ids",
            type=str,
            default="",
            help="Comma-separated list of Agreement IDs to limit the operation, e.g. --ids=1,2,3",
        )
        parser.add_argument(
            "--min-id",
            type=int,
            default=None,
            help="Process agreements with id >= MIN_ID",
        )
        parser.add_argument(
            "--max-id",
            type=int,
            default=None,
            help="Process agreements with id <= MAX_ID",
        )

    def handle(self, *args, **opts) -> None:
        commit: bool = bool(opts.get("commit"))
        only_missing: bool = bool(opts.get("only_missing"))
        recompute_status: bool = bool(opts.get("recompute_status"))

        ids_str: str = (opts.get("ids") or "").strip()
        min_id: Optional[int] = opts.get("min_id")
        max_id: Optional[int] = opts.get("max_id")

        qs = Agreement.objects.all().select_related("project", "contractor").prefetch_related(
            Prefetch("milestones", queryset=Milestone.objects.only("id", "start_date", "completion_date", "completed"))
        )

        # optional filters
        if ids_str:
            try:
                ids = [int(x.strip()) for x in ids_str.split(",") if x.strip()]
                qs = qs.filter(id__in=ids)
            except ValueError:
                self.stderr.write(self.style.ERROR("Invalid --ids argument; must be comma-separated integers."))
                return

        if min_id is not None:
            qs = qs.filter(id__gte=min_id)
        if max_id is not None:
            qs = qs.filter(id__lte=max_id)

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.WARNING("No agreements matched the filters. Nothing to do."))
            return

        self.stdout.write(f"Found {total} agreement(s). {'(DRY RUN)' if not commit else '(COMMIT)'}")
        if only_missing:
            self.stdout.write("Mode: only updating missing start/end.")
        if recompute_status:
            self.stdout.write("Mode: recomputing status from signatures/escrow/milestones.")

        changed_dates = 0
        changed_status = 0
        changed_mcount = 0

        # For safety, do small atomic batches
        batch_size = 200
        processed = 0

        def infer_status(a: Agreement) -> str:
            """
            Basic status inference (keep this aligned with your UI filters):
            - funded -> FUNDED
            - fully signed (but not funded) -> SIGNED
            - any milestone completed -> IN_PROGRESS
            - else -> existing or DRAFT
            """
            if a.escrow_funded:
                return ProjectStatus.FUNDED
            if a.signed_by_contractor and a.signed_by_homeowner:
                return ProjectStatus.SIGNED
            # If any milestone completed, and current status is earlier than IN_PROGRESS, bump to IN_PROGRESS
            ms_completed = any(getattr(m, "completed", False) for m in a.milestones.all())
            if ms_completed:
                return ProjectStatus.IN_PROGRESS
            return a.status or ProjectStatus.DRAFT

        # Iterate with .iterator() to keep memory stable
        qs_iter: Iterable[Agreement] = qs.order_by("id").iterator(chunk_size=batch_size)

        to_update: list[Agreement] = []

        for a in qs_iter:
            processed += 1

            # compute new start/end from milestones
            starts = [m.start_date for m in a.milestones.all() if getattr(m, "start_date", None)]
            ends = [m.completion_date for m in a.milestones.all() if getattr(m, "completion_date", None)]

            new_start: Optional[date] = min(starts) if starts else None
            new_end: Optional[date] = max(ends) if ends else None

            do_dates = False
            if only_missing:
                if a.start is None and new_start is not None:
                    a.start = new_start
                    do_dates = True
                if a.end is None and new_end is not None:
                    a.end = new_end or a.end
                    do_dates = True
            else:
                # overwrite even if present
                if (new_start is not None and a.start != new_start) or (new_end is not None and a.end != new_end):
                    a.start = new_start or a.start
                    a.end = new_end or a.end
                    do_dates = True

            if do_dates:
                changed_dates += 1

            # milestone_count
            mcount_before = a.milestone_count
            mcount_now = len(a.milestones.all())
            if mcount_now != mcount_before:
                a.milestone_count = mcount_now
                changed_mcount += 1

            # status inference
            if recompute_status:
                status_now = infer_status(a)
                if status_now != a.status:
                    a.status = status_now
                    changed_status += 1

            # enqueue update if anything changed
            if do_dates or (recompute_status and changed_status) or (mcount_now != mcount_before):
                to_update.append(a)

            if processed % batch_size == 0:
                self._flush(to_update, commit)
                to_update.clear()
                self.stdout.write(f"Processed {processed}/{total}...")

        # flush tail
        self._flush(to_update, commit)

        # summary
        self.stdout.write(self.style.SUCCESS("Done."))
        self.stdout.write(
            f"Agreements processed: {processed} | "
            f"start/end updated: {changed_dates} | "
            f"status updated: {changed_status} | "
            f"milestone_count updated: {changed_mcount} | "
            f"mode: {'COMMIT' if commit else 'DRY RUN'}"
        )

    def _flush(self, items: list[Agreement], commit: bool) -> None:
        if not items:
            return
        if not commit:
            # show a small preview in dry run mode
            preview = items[:3]
            for a in preview:
                self.stdout.write(
                    f"[DRY RUN] Agreement #{a.id}: start={a.start} end={a.end} "
                    f"status={a.status} milestone_count={a.milestone_count}"
                )
            return
        with transaction.atomic():
            for a in items:
                a.save(update_fields=["start", "end", "status", "milestone_count", "updated_at"])
