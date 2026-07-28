from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from core.database_readiness import (
    migration_status,
    model_inventory,
    sqlite_sequence_readiness,
    sqlite_integrity,
    table_inventory,
)


class Command(BaseCommand):
    help = "Run sanitized database, migration, relationship, and storage integrity checks."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", dest="output_json")

    def handle(self, *args, **options):
        connection.ensure_connection()
        migrations = migration_status()
        inventory = table_inventory() if migrations["unapplied"] else model_inventory()
        result = {
            "engine": connection.vendor,
            "database_size_bytes": None,
            "writable": False,
            "migrations": migrations,
            "inventory": inventory,
            "sqlite": None,
            "blocking_issues": [],
        }
        if connection.vendor == "sqlite":
            path = Path(settings.DATABASES["default"]["NAME"])
            if path.is_file():
                result["database_size_bytes"] = path.stat().st_size
                result["sqlite"] = sqlite_integrity(path)
                result["sqlite"]["sequences"] = sqlite_sequence_readiness(path)
                if result["sqlite"]["integrity"] != ["ok"]:
                    result["blocking_issues"].append("SQLite integrity_check failed")
                if result["sqlite"]["foreign_key_violations"]:
                    result["blocking_issues"].append("SQLite foreign-key violations found")
                if any(not row["ready"] for row in result["sqlite"]["sequences"]):
                    result["blocking_issues"].append("SQLite sequence is behind table row IDs")

        try:
            with connection.cursor() as cursor:
                cursor.execute("CREATE TEMPORARY TABLE myhomebro_write_probe (id integer)")
                cursor.execute("DROP TABLE myhomebro_write_probe")
            result["writable"] = True
        except Exception:
            result["blocking_issues"].append("Database is not writable")
        if migrations["unapplied"]:
            result["blocking_issues"].append("Unapplied Django migrations exist")
        if inventory["duplicate_unique_keys"]:
            result["blocking_issues"].append("Duplicate values violate uniqueness assumptions")
        if inventory["missing_file_references"]:
            result["blocking_issues"].append("Missing referenced files found in sample")

        rendered = json.dumps(result, indent=2, sort_keys=True)
        self.stdout.write(rendered)
        if result["blocking_issues"]:
            raise CommandError("Database integrity checks found blocking issues.")
        self.stdout.write(self.style.SUCCESS("Database integrity checks passed."))
