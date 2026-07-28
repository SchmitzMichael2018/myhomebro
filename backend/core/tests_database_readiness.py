import json
import os
import sqlite3
import subprocess
import sys
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from core.database_readiness import (
    create_sqlite_backup,
    reconcile_inventories,
    sha256_file,
    sqlite_integrity,
    sqlite_sequence_readiness,
)


class DatabaseReadinessUtilityTests(SimpleTestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.sqlite3"
        raw = sqlite3.connect(self.source)
        raw.execute("CREATE TABLE sample (id integer primary key, value text unique)")
        raw.execute("INSERT INTO sample(value) VALUES ('one'), ('two')")
        raw.commit()
        raw.close()

    def tearDown(self):
        self.temporary.cleanup()

    def test_sqlite_integrity_and_checksum(self):
        report = sqlite_integrity(self.source)
        self.assertEqual(report["integrity"], ["ok"])
        self.assertEqual(report["foreign_key_violations"], [])
        self.assertEqual(len(sha256_file(self.source)), 64)
        sequence = sqlite_sequence_readiness(self.source)
        self.assertEqual(sequence, [])

    def test_safe_backup_uses_valid_snapshot_and_checksum(self):
        from unittest.mock import patch

        with patch(
            "core.database_readiness.migration_status",
            return_value={"applied": 1, "leaf_migrations": ["core.0001"], "unapplied": []},
        ), patch(
            "core.database_readiness.table_inventory",
            return_value={"engine": "sqlite", "models": {}, "total_rows": 0},
        ):
            result = create_sqlite_backup(self.source, self.root / "backups")

        backup = result["backup"]
        self.assertTrue(backup.is_file())
        self.assertEqual(sqlite_integrity(backup)["integrity"], ["ok"])
        self.assertEqual(result["details"]["sha256"], sha256_file(backup))
        metadata = json.loads(result["metadata"].read_text(encoding="utf-8"))
        self.assertEqual(metadata["source_engine"], "sqlite")
        self.assertTrue(metadata["backup_reconciliation"]["matched"])
        self.assertEqual(metadata["backup_reconciliation"]["total_rows"], 2)

    def test_invalid_sqlite_backup_is_detected(self):
        invalid = self.root / "invalid.sqlite3"
        invalid.write_bytes(b"not a sqlite database")
        with self.assertRaises(sqlite3.DatabaseError):
            sqlite_integrity(invalid)

    def test_reconciliation_detects_mismatch(self):
        source = {"engine": "sqlite", "models": {"projects.agreement": {"rows": 3}}}
        destination = {
            "engine": "postgresql",
            "models": {"projects.agreement": {"rows": 2}},
        }
        report = reconcile_inventories(source, destination)
        self.assertFalse(report["matched"])
        self.assertEqual(report["models"][0]["difference"], -1)

    def test_postgresql_intent_without_url_fails_closed(self):
        environment = os.environ.copy()
        environment.update(
            {
                "DATABASE_ENGINE": "postgresql",
                "DATABASE_URL": "",
                "SECRET_KEY": "test-only",
            }
        )
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import os; os.environ['DJANGO_SETTINGS_MODULE']='core.settings'; "
                "import django; django.setup()",
            ],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DATABASE_URL is required", result.stderr)

    @override_settings(
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "private_name",
                "USER": "private_user",
                "PASSWORD": "private_password",
                "HOST": "private_host",
            }
        },
        DEPLOYMENT_ENVIRONMENT="staging",
    )
    def test_startup_diagnostics_redact_database_credentials(self):
        from unittest.mock import patch

        from core.apps import _log_startup

        with patch("core.apps.logger.info") as log:
            _log_startup()
        rendered = " ".join(str(value) for value in log.call_args.args)
        self.assertIn("postgresql", rendered)
        self.assertNotIn("private_password", rendered)
        self.assertNotIn("private_user", rendered)
        self.assertNotIn("private_host", rendered)


class DatabaseIntegrityCommandTests(TestCase):
    def test_integrity_command_succeeds_on_migrated_test_database(self):
        output = StringIO()
        call_command("check_database_integrity", stdout=output)
        self.assertIn("Database integrity checks passed", output.getvalue())
