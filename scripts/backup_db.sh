#!/usr/bin/env bash
# Explicit, non-rotating SQLite online backup wrapper.
# Backups are never deleted automatically; retention is an operator decision.

set -euo pipefail

REPO_ROOT="${PROJECT_ROOT:-$HOME/backend}"
BACKEND_DIR="$REPO_ROOT/backend"
DEST_DIR="${1:-$REPO_ROOT/backups/sqlite}"

source "$REPO_ROOT/venv/bin/activate"
cd "$BACKEND_DIR"
python manage.py backup_sqlite_database --output-dir "$DEST_DIR"
