"""Refresh explicitly selected, unedited seed drafts against a saved baseline."""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from projects.management.commands.prepare_homeowner_guides import CATALOG, draft_fields
from projects.models_templates import ProjectTemplate


def milestones(guide):
    return [
        (title, body, index)
        for index, (key, title, body) in enumerate(guide["sections"], start=1)
        if key.startswith("diy-") and key[4:].isdigit()
    ]


class Command(BaseCommand):
    help = "Refresh selected unreviewed seed drafts only when all baseline fields and milestones still match. Default dry run."

    def add_arguments(self, parser):
        parser.add_argument("--baseline-catalog", required=True)
        parser.add_argument("--slug", action="append", required=True)
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            baseline = {g["slug"]: g for g in json.loads(Path(options["baseline_catalog"]).read_text(encoding="utf-8"))}
            current = {g["slug"]: g for g in json.loads(CATALOG.read_text(encoding="utf-8"))}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CommandError("Cannot read valid baseline/current catalogs.") from exc
        pending = []
        for slug in dict.fromkeys(options["slug"]):
            if slug not in baseline or slug not in current:
                raise CommandError(f"Missing catalog slug: {slug}")
            article = ProjectTemplate.objects.select_for_update().filter(public_slug=slug).first()
            if article is None:
                raise CommandError(f"Missing existing draft: {slug}")
            if (article.public_publication_status != "ready_for_review"
                    or article.public_reviewed_at or article.public_reviewed_by_id
                    or article.public_published_at or article.is_published or article.allow_discovery):
                raise CommandError(f"Refusing reviewed, published or non-seed state: {slug}")
            rows = list(article.milestones.order_by("sort_order", "pk"))
            actual_steps = [(r.title, r.description, r.sort_order) for r in rows]
            new_fields = draft_fields(current[slug])
            if all(getattr(article, k) == v for k, v in new_fields.items()) and actual_steps == milestones(current[slug]):
                self.stdout.write(f"ALREADY CURRENT: {slug}")
                continue
            old_fields = draft_fields(baseline[slug])
            changed = [k for k, v in old_fields.items() if getattr(article, k) != v]
            if changed or actual_steps != milestones(baseline[slug]):
                raise CommandError(f"Refusing to overwrite edits: {slug}; fields={','.join(changed)}; check milestones too.")
            new_steps = milestones(current[slug])
            if len(rows) != len(new_steps):
                raise CommandError(f"Milestone count changed; manual migration needed: {slug}")
            for k, v in new_fields.items():
                setattr(article, k, v)
            article.full_clean()
            pending.append((article, rows, new_steps))
        for article, rows, new_steps in pending:
            if options["apply"]:
                article.save()
                for row, (title, body, order) in zip(rows, new_steps):
                    row.title, row.description, row.sort_order = title, body, order
                    row.save(update_fields=["title", "description", "sort_order"])
            self.stdout.write(f"{'UPDATED DRAFT' if options['apply'] else 'DRY RUN valid refresh'}: {article.public_slug}")
        self.stdout.write("No review recorded. No articles published. Existing milestone IDs preserved.")
