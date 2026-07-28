import json

from django.core.management.base import BaseCommand

from core.database_readiness import migration_status, model_inventory, table_inventory


class Command(BaseCommand):
    help = "Output sanitized per-model database counts and anomaly summaries."

    def add_arguments(self, parser):
        parser.add_argument("--output")

    def handle(self, *args, **options):
        migrations = migration_status()
        inventory = table_inventory() if migrations["unapplied"] else model_inventory()
        inventory["migration_state"] = migrations
        payload = json.dumps(inventory, indent=2, sort_keys=True)
        if options["output"]:
            with open(options["output"], "x", encoding="utf-8") as handle:
                handle.write(payload + "\n")
        self.stdout.write(payload)
