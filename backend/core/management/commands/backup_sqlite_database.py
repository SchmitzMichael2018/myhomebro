from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from core.database_readiness import create_sqlite_backup


class Command(BaseCommand):
    help = "Create and verify an online SQLite backup using SQLite's backup API."

    def add_arguments(self, parser):
        parser.add_argument("--output-dir", required=True)

    def handle(self, *args, **options):
        if connection.vendor != "sqlite":
            raise CommandError("This command supports SQLite sources only.")
        source = Path(settings.DATABASES["default"]["NAME"])
        output_dir = Path(options["output_dir"]).expanduser().resolve()
        if not source.is_file():
            raise CommandError("Configured SQLite database does not exist.")
        result = create_sqlite_backup(source, output_dir)
        self.stdout.write(f"Backup: {result['backup']}")
        self.stdout.write(f"Metadata: {result['metadata']}")
        self.stdout.write(f"SHA-256: {result['details']['sha256']}")
        self.stdout.write(self.style.SUCCESS("SQLite backup and integrity verification passed."))
