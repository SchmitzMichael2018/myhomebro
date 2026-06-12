import logging
import os
import sqlite3

from django.apps import AppConfig

logger = logging.getLogger("myhomebro")


class CoreConfig(AppConfig):
    name = "core"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.db.backends.signals import connection_created
        connection_created.connect(_apply_sqlite_pragmas)
        _log_startup()


def _log_startup():
    from django.conf import settings

    db_cfg = settings.DATABASES.get("default", {})
    db_name = str(db_cfg.get("NAME", ""))
    is_sqlite = db_cfg.get("ENGINE") == "django.db.backends.sqlite3"
    is_memory = "mode=memory" in db_name or db_name in (":memory:", "")

    load_local = os.getenv("LOAD_LOCAL_ENV", "false").lower() in (
        "1", "true", "t", "yes", "y", "on"
    )

    journal_mode = "n/a"
    if is_sqlite and not is_memory:
        try:
            raw = sqlite3.connect(db_name, timeout=5)
            row = raw.execute("PRAGMA journal_mode;").fetchone()
            raw.close()
            journal_mode = row[0] if row else "unknown"
        except Exception:
            journal_mode = "unknown"

    logger.info(
        "\n[MyHomeBro Startup]\nDB: %s\nDEBUG: %s\nLOAD_LOCAL_ENV: %s\nJournal Mode: %s\n",
        db_name,
        settings.DEBUG,
        load_local,
        journal_mode,
    )


def _apply_sqlite_pragmas(sender, connection, **kwargs):
    """
    Apply PRAGMAs on every new SQLite connection to prevent stale-lock issues
    on PythonAnywhere (and any single-file SQLite deployment).

    WAL mode + an unexpected process death leaves db.sqlite3-wal and
    db.sqlite3-shm behind; the next connection cannot acquire a shared lock
    and raises OperationalError: database is locked even though no process is
    actively writing.  Forcing DELETE journal mode eliminates those sidecar
    files entirely.

    busy_timeout is belt-and-suspenders alongside OPTIONS["timeout"]; SQLite
    will retry for up to 20 s before surfacing OperationalError to Django.
    """
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA journal_mode=DELETE;")
        cursor.execute("PRAGMA synchronous=FULL;")
        cursor.execute("PRAGMA busy_timeout=20000;")
