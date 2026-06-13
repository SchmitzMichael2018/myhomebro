"""
python manage.py db_health_check

Diagnoses the configured SQLite database without modifying any data.
Exits nonzero when the database is locked, corrupt, or unreadable.

Options:
  --full       Run integrity_check instead of quick_check (thorough but slower).
  --json       Emit a single JSON object to stdout (useful for scripted health checks).
"""
import json
import sqlite3
import sys
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import OperationalError, connection, connections


class Command(BaseCommand):
    help = "Check SQLite database health: path, integrity, PRAGMAs, user and migration counts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--full",
            action="store_true",
            default=False,
            help="Run integrity_check instead of quick_check (slower, more thorough).",
        )
        parser.add_argument(
            "--json",
            dest="output_json",
            action="store_true",
            default=False,
            help="Write a JSON result object to stdout.",
        )

    def handle(self, *args, **options):
        run_full = options["full"]
        output_json = options["output_json"]

        db_cfg = connections["default"].settings_dict
        engine = db_cfg.get("ENGINE", "")
        db_name = db_cfg.get("NAME", "")

        result = {
            "engine": engine,
            "db_path": str(db_name),
            "integrity": None,
            "journal_mode": None,
            "synchronous": None,
            "migrations": None,
            "users": None,
            "sessions": None,
            "passed": False,
            "errors": [],
        }

        if not output_json:
            self._hr()
            self.stdout.write(f"  Engine  : {engine}")
            self.stdout.write(f"  DB Path : {db_name}")
            self._hr()

        is_sqlite = engine == "django.db.backends.sqlite3"
        # In-memory URIs (test runner, :memory:) have no file on disk; skip
        # file-level checks but still run ORM readability checks.
        is_memory = str(db_name) in (":memory:", "") or "mode=memory" in str(db_name)

        if is_sqlite and not is_memory:
            db_path = Path(str(db_name))
            if not db_path.exists():
                msg = f"Database file not found: {db_path}"
                result["errors"].append(msg)
                self._finish(result, output_json)
                sys.exit(1)

            check_pragma = "integrity_check" if run_full else "quick_check"

            # --- integrity / quick check -----------------------------------------
            try:
                raw = sqlite3.connect(str(db_path), timeout=10)
                rows = raw.execute(f"PRAGMA {check_pragma};").fetchall()
                raw.close()
                integrity_result = ", ".join(r[0] for r in rows) if rows else "ok"
                result["integrity"] = integrity_result
                ok = integrity_result.strip().lower() == "ok"
                if not output_json:
                    style = self.style.SUCCESS if ok else self.style.ERROR
                    self.stdout.write(style(f"  {check_pragma}: {integrity_result}"))
                if not ok:
                    result["errors"].append(f"{check_pragma} failed: {integrity_result}")
                    self._finish(result, output_json)
                    sys.exit(1)
            except sqlite3.OperationalError as exc:
                msg = f"PRAGMA {check_pragma} failed: {exc}"
                result["errors"].append(msg)
                if not output_json:
                    self.stderr.write(self.style.ERROR(f"  {msg}"))
                    self.stderr.write(self.style.ERROR(
                        "  The database may be locked or corrupt. "
                        "Check for stale .sqlite3-wal / .sqlite3-shm files."
                    ))
                self._finish(result, output_json)
                sys.exit(1)

            # --- PRAGMA state -----------------------------------------------------
            try:
                raw = sqlite3.connect(str(db_path), timeout=10)
                journal = raw.execute("PRAGMA journal_mode;").fetchone()
                sync = raw.execute("PRAGMA synchronous;").fetchone()
                raw.close()

                journal_mode = journal[0] if journal else "unknown"
                sync_val = sync[0] if sync else "unknown"
                sync_labels = {0: "OFF", 1: "NORMAL", 2: "FULL", 3: "EXTRA"}
                sync_label = sync_labels.get(sync_val, str(sync_val))

                result["journal_mode"] = journal_mode
                result["synchronous"] = sync_label

                if not output_json:
                    journal_ok = journal_mode.lower() in ("delete", "truncate", "off", "memory")
                    jstyle = self.style.SUCCESS if journal_ok else self.style.WARNING
                    self.stdout.write(jstyle(f"  journal_mode : {journal_mode}"))
                    self.stdout.write(f"  synchronous  : {sync_label} ({sync_val})")
                    if not journal_ok:
                        self.stdout.write(self.style.WARNING(
                            "  WARNING: journal_mode is WAL. "
                            "Stale -wal/-shm files can cause 'database is locked' on PythonAnywhere. "
                            "Switch journal_mode during a controlled maintenance window if needed."
                        ))
            except sqlite3.OperationalError as exc:
                result["errors"].append(f"PRAGMA read failed: {exc}")
                if not output_json:
                    self.stdout.write(self.style.WARNING(f"  Could not read PRAGMAs: {exc}"))

        elif is_sqlite:
            # In-memory DB (test runner): read PRAGMAs via Django connection.
            try:
                with connection.cursor() as cursor:
                    cursor.execute("PRAGMA journal_mode;")
                    journal_mode = cursor.fetchone()[0]
                    cursor.execute("PRAGMA synchronous;")
                    sync_val = cursor.fetchone()[0]

                sync_labels = {0: "OFF", 1: "NORMAL", 2: "FULL", 3: "EXTRA"}
                sync_label = sync_labels.get(sync_val, str(sync_val))
                result["journal_mode"] = journal_mode
                result["synchronous"] = sync_label

                if not output_json:
                    self.stdout.write(f"  journal_mode : {journal_mode}")
                    self.stdout.write(f"  synchronous  : {sync_label} ({sync_val})")
            except Exception as exc:
                result["errors"].append(f"PRAGMA read failed: {exc}")

        else:
            if not output_json:
                self.stdout.write(self.style.WARNING(
                    "Non-SQLite engine — SQLite checks skipped."
                ))

        # --- ORM / table readability -----------------------------------------
        if not output_json:
            self.stdout.write("\nChecking ORM readability...")

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM django_migrations;")
                migration_count = cursor.fetchone()[0]
            result["migrations"] = migration_count
            if not output_json:
                self.stdout.write(self.style.SUCCESS(
                    f"  Migrations applied : {migration_count}"
                ))
        except OperationalError as exc:
            msg = f"django_migrations unreadable: {exc}"
            result["errors"].append(msg)
            if not output_json:
                self.stderr.write(self.style.ERROR(f"  {msg}"))
            self._finish(result, output_json)
            sys.exit(1)

        try:
            User = get_user_model()
            user_count = User.objects.count()
            result["users"] = user_count
            if not output_json:
                self.stdout.write(self.style.SUCCESS(
                    f"  Users in database  : {user_count}"
                ))
        except OperationalError as exc:
            msg = f"User table unreadable: {exc}"
            result["errors"].append(msg)
            if not output_json:
                self.stderr.write(self.style.ERROR(f"  {msg}"))
            self._finish(result, output_json)
            sys.exit(1)

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM django_session;")
                session_count = cursor.fetchone()[0]
            result["sessions"] = session_count
            if not output_json:
                self.stdout.write(f"  Sessions           : {session_count}")
        except OperationalError:
            # sessions table may not exist in all configurations
            if not output_json:
                self.stdout.write(self.style.WARNING("  Sessions table not found."))

        result["passed"] = True
        self._finish(result, output_json)

    # -------------------------------------------------------------------------
    def _hr(self):
        self.stdout.write("-" * 60)

    def _finish(self, result: dict, output_json: bool):
        if output_json:
            self.stdout.write(json.dumps(result, indent=2))
        elif result["passed"]:
            self.stdout.write(self.style.SUCCESS("\nDatabase health check passed.\n"))
        else:
            errors = "; ".join(result["errors"]) or "unknown error"
            self.stderr.write(self.style.ERROR(f"\nDatabase health check FAILED: {errors}\n"))
