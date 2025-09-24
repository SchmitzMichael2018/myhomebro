from __future__ import annotations

from typing import Iterable, Optional, List, Tuple
from datetime import date

from django.core.management.base import BaseCommand, CommandParser
from django.db import transaction
from django.db.models import Prefetch

from projects.models import Agreement, Milestone

try:
    from projects.models import ProjectStatus  # type: ignore
except Exception:  # pragma: no cover
    class ProjectStatus:
        DRAFT = "draft"
        SIGNED = "signed"
        FUNDED = "funded"
        IN_PROGRESS = "in_progress"


def _field_names(model) -> set[str]:
    return {f.name for f in model._meta.get_fields()}


def _compute_dates(milestones: Iterable[Milestone]) -> Tuple[Optional[date], Optional[date]]:
    """
    Compute Agreement.start/end from milestones.

    start := min(m.start_date or m.scheduled_date)
    end   := max(m.completion_date or m.scheduled_date or m.start_date)

    All lookups are guarded; missing attrs simply act like None.
    """
    earliest: Optional[date] = None
    latest: Optional[date] = None
    for m in milestones:
        s = getattr(m, "start_date", None) or getattr(m, "scheduled_date", None)
        e = (
            getattr(m, "completion_date", None)
            or getattr(m, "scheduled_date", None)
            or getattr(m, "start_date", None)
        )
        if s and (earliest is None or s < earliest):
            earliest = s
        if e and (latest is None or e > latest):
            latest = e
    return earliest, latest


def _infer_status(a: Agreement) -> str:
    if getattr(a, "escrow_funded", False):
        return ProjectStatus.FUNDED
    if getattr(a, "signed_by_contractor", False) and getattr(a, "signed_by_homeowner", False):
        return ProjectStatus.SIGNED
    ms_completed = any(getattr(m, "completed", False) for m in a.milestones.all())
    if ms_completed:
        return ProjectStatus.IN_PROGRESS
    return getattr(a, "status", ProjectStatus.DRAFT) or ProjectStatus.DRAFT


class Command(BaseCommand):
    help = (
        "Backfill Agreement.start and Agreement.end from related Milestones. "
        "DRY RUN by default (no writes). Use --commit to persist. "
        "Options: --only-missing, --recompute-status, --ids=1,2,3, --min-id, --max-id"
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--commit", action="store_true", help="Persist changes (omit for dry run).")
        parser.add_argument("--only-missing", action="store_true", help="Only set start/end when currently NULL.")
        parser.add_argument("--recompute-status", action="store_true", help="Also recompute Agreement.status.")
        parser.add_argument("--ids", type=str, default="", help="Comma-separated Agreement IDs, e.g. 1,2,3")
        parser.add_argument("--min-id", type=int, default=None, help="Process agreements with id >= MIN_ID")
        parser.add_argument("--max-id", type=int, default=None, help="Process agreements with id <= MAX_ID")

    def handle(self, *args, **opts) -> None:
        commit: bool = bool(opts.get("commit"))
        only_missing: bool = bool(opts.get("only_missing"))
        recompute_status: bool = bool(opts.get("recompute_status"))

        ids_str: str = (opts.get("ids") or "").strip()
        min_id: Optional[int] = opts.get("min_id")
        max_id: Optional[int] = opts.get("max_id")

        # Build a safe .only() list based on *actual* Milestone fields
        m_fields = _field_names(Milestone)
        only_fields: List[str] = ["id"]
        for cand in ("start_date", "completion_date", "scheduled_date", "completed"):
            if cand in m_fields:
                only_fields.append(cand)

        qs = Agreement.objects.all().select_related("project", "contractor").prefetch_related(
            Prefetch("milestones", queryset=Milestone.objects.only(*only_fields))
        )

        # filters
        if ids_str:
            try:
                ids = [int(x.strip()) for x in ids_str.split(",") if x.strip()]
                qs = qs.filter(id__in=ids)
            except ValueError:
                self.stderr.write(self.style.ERROR("Invalid --ids; must be comma-separated integers."))
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
        changed_status_total = 0
        changed_mcount_total = 0

        batch_size = 200
        processed = 0
        to_update: List[Agreement] = []

        def _save_batch(batch: List[Agreement]) -> None:
            if not batch:
                return
            if not commit:
                for a in batch[:3]:
                    self.stdout.write(
                        f"[DRY RUN] Agreement #{a.id}: start={getattr(a,'start',None)} "
                        f"end={getattr(a,'end',None)} status={getattr(a,'status',None)} "
                        f"mcount={getattr(a,'milestone_count', None)}"
                    )
                return
            with transaction.atomic():
                for a in batch:
                    update_fields = []
                    if hasattr(a, "start"):
                        update_fields.append("start")
                    if hasattr(a, "end"):
                        update_fields.append("end")
                    if hasattr(a, "status"):
                        update_fields.append("status")
                    if hasattr(a, "milestone_count"):
                        update_fields.append("milestone_count")
                    if hasattr(a, "updated_at"):
                        update_fields.append("updated_at")
                    a.save(update_fields=update_fields)

        for a in qs.order_by("id").iterator(chunk_size=batch_size):
            processed += 1

            new_start, new_end = _compute_dates(a.milestones.all())

            row_changed = False
            dates_changed_here = False
            status_changed_here = False
            mcount_changed_here = False

            if only_missing:
                if getattr(a, "start", None) is None and new_start is not None and hasattr(a, "start"):
                    a.start = new_start
                    row_changed = dates_changed_here = True
                if getattr(a, "end", None) is None and new_end is not None and hasattr(a, "end"):
                    a.end = new_end
                    row_changed = dates_changed_here = True
            else:
                if hasattr(a, "start") and (new_start is not None) and (a.start != new_start):
                    a.start = new_start
                    row_changed = dates_changed_here = True
                if hasattr(a, "end") and (new_end is not None) and (a.end != new_end):
                    a.end = new_end
                    row_changed = dates_changed_here = True

            if hasattr(a, "milestone_count"):
                mcount_now = len(a.milestones.all())
                if a.milestone_count != mcount_now:
                    a.milestone_count = mcount_now
                    row_changed = mcount_changed_here = True

            if recompute_status and hasattr(a, "status"):
                status_now = _infer_status(a)
                if status_now != a.status:
                    a.status = status_now
                    row_changed = status_changed_here = True

            if dates_changed_here:
                changed_dates += 1
            if status_changed_here:
                changed_status_total += 1
            if mcount_changed_here:
                changed_mcount_total += 1

            if row_changed:
                to_update.append(a)

            if processed % batch_size == 0:
                _save_batch(to_update)
                to_update.clear()
                self.stdout.write(f"Processed {processed}/{total}...")

        _save_batch(to_update)

        self.stdout.write(self.style.SUCCESS("Done."))
        self.stdout.write(
            f"Agreements processed: {processed} | "
            f"start/end updated: {changed_dates} | "
            f"status updated: {changed_status_total} | "
            f"milestone_count updated: {changed_mcount_total} | "
            f"mode: {'COMMIT' if commit else 'DRY RUN'}"
        )
