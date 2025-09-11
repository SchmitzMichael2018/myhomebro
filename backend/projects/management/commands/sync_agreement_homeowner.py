from django.core.management.base import BaseCommand, CommandParser
from django.db import transaction
from projects.models import Agreement

class Command(BaseCommand):
    help = ("Copy Agreement.project.homeowner → Agreement.homeowner for rows where it's null. "
            "Dry-run by default; use --commit to save.")

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--commit", action="store_true", help="Persist changes")

    def handle(self, *args, **opts):
        commit = bool(opts.get("commit"))
        qs = Agreement.objects.select_related("project", "project__homeowner").filter(homeowner__isnull=True)
        count = qs.count()
        if count == 0:
            self.stdout.write("No agreements need homeowner sync.")
            return
        self.stdout.write(f"Found {count} agreement(s) with null homeowner. {'(COMMIT)' if commit else '(DRY RUN)'}")

        updated = 0
        with transaction.atomic():
            for a in qs:
                ho = getattr(getattr(a, "project", None), "homeowner", None)
                if ho:
                    a.homeowner = ho
                    updated += 1
                    if commit:
                        a.save(update_fields=["homeowner", "updated_at"])
            if not commit:
                self.stdout.write(f"[DRY RUN] Would update {updated} agreement(s).")
                transaction.set_rollback(True)
        if commit:
            self.stdout.write(self.style.SUCCESS(f"Updated {updated} agreement(s)."))
