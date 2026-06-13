"""
Infrastructure tests for SQLite hardening and environment loading safety.

Run with:
    python manage.py test core.tests.test_infrastructure --verbosity=2
"""
import os
import sqlite3
import tempfile
from io import StringIO
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings


# ─────────────────────────────────────────────────────────────────────────────
# 1. SQLite PRAGMA helpers
# ─────────────────────────────────────────────────────────────────────────────

class SQLitePragmaTests(TestCase):
    """Verify that the connection_created signal applies the expected PRAGMAs."""

    databases = ["default"]

    def _current_journal_mode(self):
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA journal_mode;")
            return cursor.fetchone()[0].lower()

    def _current_synchronous(self):
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA synchronous;")
            return cursor.fetchone()[0]  # integer: 0=OFF 1=NORMAL 2=FULL 3=EXTRA

    def test_journal_mode_is_not_wal(self):
        """journal_mode should be DELETE (or similar) — never WAL — after signal fires."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        mode = self._current_journal_mode()
        self.assertNotEqual(
            mode,
            "wal",
            "journal_mode should not be WAL on production SQLite. "
            "Check that core.apps.CoreConfig is in INSTALLED_APPS.",
        )

    def test_pragma_helper_does_not_change_journal_mode(self):
        """The connection signal must not attempt journal_mode changes at startup."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        from core.apps import _apply_sqlite_pragmas

        fake_cursor = mock.MagicMock()
        fake = mock.MagicMock()
        fake.vendor = "sqlite"
        fake.cursor.return_value.__enter__.return_value = fake_cursor

        _apply_sqlite_pragmas(sender=None, connection=fake)

        executed = [call.args[0] for call in fake_cursor.execute.call_args_list]
        self.assertNotIn("PRAGMA journal_mode=DELETE;", executed)

    def test_synchronous_is_full(self):
        """synchronous should be 2 (FULL) as set by the connection signal."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        sync = self._current_synchronous()
        self.assertEqual(sync, 2, f"Expected synchronous=2 (FULL), got {sync}")

    def test_pragma_helper_function_directly(self):
        """_apply_sqlite_pragmas should call cursor() on a SQLite connection without raising."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        from core.apps import _apply_sqlite_pragmas
        # Can't call on the live Django connection inside a test transaction
        # (PRAGMA synchronous is rejected inside a transaction). Test via mock.
        fake = mock.MagicMock()
        fake.vendor = "sqlite"
        _apply_sqlite_pragmas(sender=None, connection=fake)
        fake.cursor.assert_called_once()

    def test_pragma_helper_skips_non_sqlite(self):
        """_apply_sqlite_pragmas must be a no-op for non-SQLite connections."""
        from core.apps import _apply_sqlite_pragmas
        fake_conn = mock.MagicMock()
        fake_conn.vendor = "postgresql"
        _apply_sqlite_pragmas(sender=None, connection=fake_conn)
        fake_conn.cursor.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 2. SQLite OPTIONS timeout
# ─────────────────────────────────────────────────────────────────────────────

class SQLiteOptionsTests(TestCase):

    def test_sqlite_timeout_is_set(self):
        """DATABASES['default'] OPTIONS must include timeout=20 for SQLite."""
        from django.conf import settings
        db = settings.DATABASES["default"]
        if db.get("ENGINE") != "django.db.backends.sqlite3":
            self.skipTest("SQLite-only test")
        timeout = db.get("OPTIONS", {}).get("timeout")
        self.assertIsNotNone(timeout, "OPTIONS['timeout'] should be set for SQLite.")
        self.assertGreaterEqual(timeout, 20, "timeout should be at least 20 seconds.")


# ─────────────────────────────────────────────────────────────────────────────
# 3. .env.local not loaded in production
# ─────────────────────────────────────────────────────────────────────────────

class EnvLocalGatingTests(TestCase):
    """
    Verify the load_local_env gating logic from settings.py / manage.py.
    We test the flag logic in isolation — we do not re-execute settings.py.
    """

    def _should_load_local(self, debug_value, load_local_value=None):
        """Replicate the gating expression from settings.py."""
        env = {}
        if debug_value is not None:
            env["DEBUG"] = debug_value
        if load_local_value is not None:
            env["LOAD_LOCAL_ENV"] = load_local_value

        with mock.patch.dict(os.environ, env, clear=True):
            debug_truthy = os.getenv("DEBUG", "false").lower() in (
                "1", "true", "t", "yes", "y", "on"
            )
            load_local_truthy = os.getenv("LOAD_LOCAL_ENV", "false").lower() in (
                "1", "true", "t", "yes", "y", "on"
            )
            return debug_truthy or load_local_truthy

    def test_production_debug_false_skips_local(self):
        self.assertFalse(self._should_load_local("false"))

    def test_production_debug_unset_skips_local(self):
        self.assertFalse(self._should_load_local(None))

    def test_production_debug_0_skips_local(self):
        self.assertFalse(self._should_load_local("0"))

    def test_local_debug_true_loads_local(self):
        self.assertTrue(self._should_load_local("true"))

    def test_local_debug_1_loads_local(self):
        self.assertTrue(self._should_load_local("1"))

    def test_explicit_load_local_env_overrides(self):
        """LOAD_LOCAL_ENV=1 forces .env.local even when DEBUG=false (opt-in escape hatch)."""
        self.assertTrue(self._should_load_local("false", load_local_value="1"))

    def test_neither_flag_set_skips_local(self):
        self.assertFalse(self._should_load_local(None, load_local_value=None))

    def test_env_local_example_does_not_exist(self):
        """backend/.env.local.example should have been deleted."""
        repo_root = Path(__file__).resolve().parents[3]
        example = repo_root / "backend" / ".env.local.example"
        self.assertFalse(
            example.exists(),
            f".env.local.example still exists at {example}. Delete it to avoid confusion.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. db_health_check command
# ─────────────────────────────────────────────────────────────────────────────

class DbHealthCheckCommandTests(TestCase):
    """Smoke-test the management command against the live test database."""

    databases = ["default"]

    def _run_command(self, *args):
        from django.core.management import call_command
        out = StringIO()
        err = StringIO()
        call_command("db_health_check", *args, stdout=out, stderr=err)
        return out.getvalue(), err.getvalue()

    def test_command_runs_without_error(self):
        out, err = self._run_command()
        self.assertIn("passed", out.lower(), f"Expected 'passed' in output.\nstdout: {out}\nstderr: {err}")

    def test_command_reports_migration_count(self):
        out, _ = self._run_command()
        self.assertRegex(out, r"Migrations applied\s*:\s*\d+")

    def test_command_reports_user_count(self):
        out, _ = self._run_command()
        self.assertRegex(out, r"Users in database\s*:\s*\d+")

    def test_command_json_output_is_valid(self):
        import json as _json
        out, _ = self._run_command("--json")
        try:
            data = _json.loads(out)
        except _json.JSONDecodeError as exc:
            self.fail(f"--json output is not valid JSON: {exc}\nOutput: {out!r}")
        self.assertTrue(data.get("passed"), f"JSON result.passed is not True: {data}")
        self.assertIn("migrations", data)
        self.assertIn("users", data)

    def test_command_full_flag_runs(self):
        """--full should run integrity_check and still pass."""
        out, err = self._run_command("--full")
        self.assertIn("passed", out.lower(), f"stdout: {out}\nstderr: {err}")

    def test_command_shows_journal_mode(self):
        """journal_mode should be reported in output for SQLite."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        out, _ = self._run_command()
        self.assertIn("journal_mode", out.lower())

    def test_command_exits_nonzero_on_locked_db(self):
        """Command should exit 1 when the database cannot be read."""
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-only test")
        from django.core.management import call_command
        from django.db import connections
        out, err = StringIO(), StringIO()

        # override_settings doesn't update already-established connections.
        # Patch settings_dict in-place so the command sees a missing file path.
        with mock.patch.dict(connections["default"].settings_dict, {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": "/nonexistent/path/totally-missing.sqlite3",
        }):
            with self.assertRaises(SystemExit) as cm:
                call_command("db_health_check", stdout=out, stderr=err)
            self.assertEqual(cm.exception.code, 1)
