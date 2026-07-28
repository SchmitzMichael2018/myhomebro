from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db import models as django_models
from django.db.models import Count, Q
from django.db.models.functions import Length
from django.utils import timezone as django_timezone


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_inventory(*, file_sample_limit: int = 25) -> dict:
    models = {}
    missing_files = []
    duplicate_keys = []
    blank_required_values = []
    timestamp_anomalies = []
    large_text_rows = []
    for model in sorted(
        apps.get_models(include_auto_created=False),
        key=lambda item: item._meta.label_lower,
    ):
        if model._meta.proxy or not model._meta.managed:
            continue
        label = model._meta.label_lower
        queryset = model._default_manager.all()
        count = queryset.count()
        models[label] = {"rows": count}

        for field in model._meta.concrete_fields:
            if (
                isinstance(field, (django_models.CharField, django_models.TextField))
                and not field.blank
            ):
                blank_count = queryset.filter(**{field.name: ""}).count()
                if blank_count:
                    blank_required_values.append(
                        {"model": label, "field": field.name, "rows": blank_count}
                    )
            if isinstance(field, django_models.DateTimeField):
                lower_bound = datetime(1970, 1, 1, tzinfo=timezone.utc)
                upper_bound = django_timezone.now() + timedelta(days=1)
                suspicious = queryset.filter(
                    Q(**{f"{field.name}__lt": lower_bound})
                    | Q(**{f"{field.name}__gt": upper_bound})
                ).count()
                if suspicious:
                    timestamp_anomalies.append(
                        {"model": label, "field": field.name, "rows": suspicious}
                    )
            if isinstance(field, django_models.TextField):
                large_count = (
                    queryset.annotate(_readiness_length=Length(field.name))
                    .filter(_readiness_length__gt=1024 * 1024)
                    .count()
                )
                if large_count:
                    large_text_rows.append(
                        {"model": label, "field": field.name, "rows": large_count}
                    )
            if field.unique and not field.primary_key:
                duplicates = list(
                    queryset.exclude(**{f"{field.name}__isnull": True})
                    .values(field.name)
                    .annotate(total=Count("pk"))
                    .filter(total__gt=1)
                    .values_list("total", flat=True)[:10]
                )
                if duplicates:
                    duplicate_keys.append(
                        {"model": label, "field": field.name, "groups": len(duplicates)}
                    )
            if hasattr(field, "upload_to") and len(missing_files) < file_sample_limit:
                for value in queryset.exclude(**{field.name: ""}).values_list(
                    field.name, flat=True
                )[:file_sample_limit]:
                    if value and not field.storage.exists(value):
                        missing_files.append(
                            {"model": label, "field": field.name, "name": str(value)}
                        )
                        if len(missing_files) >= file_sample_limit:
                            break
    return {
        "engine": connection.vendor,
        "models": models,
        "total_rows": sum(item["rows"] for item in models.values()),
        "duplicate_unique_keys": duplicate_keys,
        "missing_file_references": missing_files,
        "blank_required_values": blank_required_values,
        "timestamp_anomalies": timestamp_anomalies,
        "large_text_rows": large_text_rows,
    }


def table_inventory() -> dict:
    tables = sorted(connection.introspection.table_names())
    models = {}
    with connection.cursor() as cursor:
        for table in tables:
            quoted = connection.ops.quote_name(table)
            cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
            models[table] = {"rows": cursor.fetchone()[0]}
    return {
        "engine": connection.vendor,
        "inventory_type": "database_tables",
        "models": models,
        "total_rows": sum(item["rows"] for item in models.values()),
        "duplicate_unique_keys": [],
        "missing_file_references": [],
    }


def migration_status() -> dict:
    executor = MigrationExecutor(connection)
    targets = executor.loader.graph.leaf_nodes()
    plan = executor.migration_plan(targets)
    return {
        "applied": len(executor.loader.applied_migrations),
        "leaf_migrations": [f"{app}.{name}" for app, name in targets],
        "unapplied": [f"{migration.app_label}.{migration.name}" for migration, _ in plan],
    }


def sqlite_integrity(path: Path) -> dict:
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    raw = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        integrity = [row[0] for row in raw.execute("PRAGMA integrity_check;")]
        foreign_keys = [
            {"table": row[0], "rowid": row[1], "parent": row[2], "fk_index": row[3]}
            for row in raw.execute("PRAGMA foreign_key_check;")
        ]
        journal = raw.execute("PRAGMA journal_mode;").fetchone()
    finally:
        raw.close()
    return {
        "integrity": integrity,
        "foreign_key_violations": foreign_keys,
        "journal_mode": journal[0] if journal else "unknown",
    }


def sqlite_sequence_readiness(path: Path) -> list[dict]:
    raw = sqlite3.connect(str(path), timeout=10)
    try:
        sequence_table = raw.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone()
        if not sequence_table:
            return []
        results = []
        for table, sequence in raw.execute("SELECT name, seq FROM sqlite_sequence"):
            quoted = '"' + table.replace('"', '""') + '"'
            maximum = raw.execute(f"SELECT COALESCE(MAX(rowid), 0) FROM {quoted}").fetchone()[0]
            results.append(
                {
                    "table": table,
                    "sequence": sequence,
                    "maximum_rowid": maximum,
                    "ready": sequence >= maximum,
                }
            )
        return results
    finally:
        raw.close()


def sqlite_table_counts(path: Path) -> dict[str, int]:
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    raw = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        tables = [
            row[0]
            for row in raw.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        counts = {}
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            counts[table] = raw.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
        return counts
    finally:
        raw.close()


def create_sqlite_backup(source: Path, destination_dir: Path) -> dict:
    source = source.resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = destination_dir / f"myhomebro-{timestamp}.sqlite3"
    if destination.exists():
        raise FileExistsError(destination)

    source_connection = sqlite3.connect(str(source), timeout=30)
    destination_connection = sqlite3.connect(str(destination))
    try:
        source_connection.backup(destination_connection)
    except Exception:
        destination_connection.close()
        source_connection.close()
        destination.unlink(missing_ok=True)
        raise
    else:
        destination_connection.close()
        source_connection.close()

    try:
        os.chmod(destination, 0o600)
    except OSError:
        pass
    verification = sqlite_integrity(destination)
    if verification["integrity"] != ["ok"] or verification["foreign_key_violations"]:
        destination.unlink(missing_ok=True)
        raise RuntimeError("Backup integrity validation failed.")
    source_counts = sqlite_table_counts(source)
    backup_counts = sqlite_table_counts(destination)
    if source_counts != backup_counts:
        destination.unlink(missing_ok=True)
        raise RuntimeError("Backup row-count reconciliation failed.")

    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_engine": "sqlite",
        "source_size_bytes": source.stat().st_size,
        "backup_size_bytes": destination.stat().st_size,
        "backup_filename": destination.name,
        "sha256": sha256_file(destination),
        "migration_state": migration_status(),
        "inventory": table_inventory(),
        "backup_reconciliation": {
            "matched": True,
            "tables": len(source_counts),
            "total_rows": sum(source_counts.values()),
        },
        "integrity": verification,
    }
    metadata_path = Path(f"{destination}.metadata.json")
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")
    try:
        os.chmod(metadata_path, 0o600)
    except OSError:
        pass
    Path(f"{destination}.sha256").write_text(
        f"{metadata['sha256']}  {destination.name}\n", encoding="ascii"
    )
    return {"backup": destination, "metadata": metadata_path, "details": metadata}


def reconcile_inventories(source: dict, destination: dict) -> dict:
    labels = sorted(set(source.get("models", {})) | set(destination.get("models", {})))
    rows = []
    for label in labels:
        source_count = source.get("models", {}).get(label, {}).get("rows", 0)
        destination_count = destination.get("models", {}).get(label, {}).get("rows", 0)
        rows.append(
            {
                "model": label,
                "source": source_count,
                "destination": destination_count,
                "difference": destination_count - source_count,
                "status": "matched" if source_count == destination_count else "mismatch",
            }
        )
    return {
        "matched": all(row["status"] == "matched" for row in rows),
        "models": rows,
        "source_engine": source.get("engine"),
        "destination_engine": destination.get("engine"),
    }
