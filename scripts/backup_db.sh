#!/usr/bin/env bash
# backup_db.sh — Safe SQLite online backup using the .backup API.
#
# Usage:
#   bash scripts/backup_db.sh [DEST_DIR]
#
# Environment overrides:
#   DB_PATH   Path to db.sqlite3 (default: /home/myhomebro/backend/db.sqlite3)
#   KEEP      Number of most-recent backups to keep (default: 30)
#
# The SQLite .backup command is safe to run while the database is in use;
# it uses the online backup API and produces a consistent snapshot.
# Never use `cp` on a live SQLite file — it can copy mid-write.

set -euo pipefail

DB_PATH="${DB_PATH:-/home/myhomebro/backend/db.sqlite3}"
DEST_DIR="${1:-/home/myhomebro/backend/backups}"
KEEP="${KEEP:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST_FILE="$DEST_DIR/db-$TIMESTAMP.sqlite3"

# ── Preflight ──────────────────────────────────────────────────────────────
if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: Database not found at $DB_PATH" >&2
    exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
    echo "ERROR: sqlite3 is not installed or not on PATH" >&2
    exit 1
fi

mkdir -p "$DEST_DIR"

# ── Integrity check before backup ─────────────────────────────────────────
echo "Running quick_check on $DB_PATH ..."
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA quick_check;" 2>&1) || {
    echo "ERROR: sqlite3 could not open database — $INTEGRITY" >&2
    exit 1
}

if [ "$INTEGRITY" != "ok" ]; then
    echo "ERROR: Database integrity check failed: $INTEGRITY" >&2
    echo "       Backup aborted — do not copy a corrupt database." >&2
    exit 1
fi

echo "  quick_check: ok"

# ── Online backup ──────────────────────────────────────────────────────────
echo "Writing backup to $DEST_FILE ..."
sqlite3 "$DB_PATH" ".backup '$DEST_FILE'"

if [ ! -f "$DEST_FILE" ]; then
    echo "ERROR: Backup file was not created at $DEST_FILE" >&2
    exit 1
fi

SIZE=$(du -sh "$DEST_FILE" 2>/dev/null | cut -f1 || echo "?")
echo "  Backup written: $DEST_FILE ($SIZE)"

# ── Verify the backup itself is readable ──────────────────────────────────
BACKUP_CHECK=$(sqlite3 "$DEST_FILE" "PRAGMA quick_check;" 2>&1) || {
    echo "WARNING: Could not verify backup file — $BACKUP_CHECK" >&2
}
if [ "${BACKUP_CHECK:-}" != "ok" ]; then
    echo "WARNING: Backup quick_check returned: $BACKUP_CHECK" >&2
fi

# ── Rotate old backups ─────────────────────────────────────────────────────
cd "$DEST_DIR"
BACKUP_COUNT=$(ls -1 db-*.sqlite3 2>/dev/null | wc -l || echo 0)
if [ "$BACKUP_COUNT" -gt "$KEEP" ]; then
    REMOVE_COUNT=$(( BACKUP_COUNT - KEEP ))
    echo "Removing $REMOVE_COUNT old backup(s) (keeping $KEEP most recent) ..."
    ls -t db-*.sqlite3 2>/dev/null | tail -n +"$(( KEEP + 1 ))" | xargs -r rm -f
fi

echo "Backup complete."
