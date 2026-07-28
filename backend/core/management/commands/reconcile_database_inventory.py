import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from core.database_readiness import reconcile_inventories


class Command(BaseCommand):
    help = "Compare sanitized source and destination database inventory reports."

    def add_arguments(self, parser):
        parser.add_argument("source")
        parser.add_argument("destination")
        parser.add_argument("--output")

    def handle(self, *args, **options):
        source = json.loads(Path(options["source"]).read_text(encoding="utf-8"))
        destination = json.loads(Path(options["destination"]).read_text(encoding="utf-8"))
        report = reconcile_inventories(source, destination)
        rendered = json.dumps(report, indent=2, sort_keys=True)
        if options["output"]:
            Path(options["output"]).write_text(rendered + "\n", encoding="utf-8")
        self.stdout.write(rendered)
        if not report["matched"]:
            raise CommandError("Database inventories do not reconcile.")
