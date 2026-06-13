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
    Apply lightweight SQLite PRAGMAs on every new connection.

    Do not change journal_mode here. Switching journal modes can require an
    exclusive lock, so doing that during app startup or request handling can
    make an already-busy PythonAnywhere SQLite database harder to recover.
    Journal mode is reported by startup logging and db_health_check instead.

    busy_timeout is belt-and-suspenders alongside OPTIONS["timeout"]; SQLite
    will retry for up to 20s before surfacing OperationalError to Django.
    """
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA synchronous=FULL;")
        cursor.execute("PRAGMA busy_timeout=20000;")
