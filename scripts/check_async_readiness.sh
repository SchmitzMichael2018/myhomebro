#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$HOME/backend}"
BACKEND_DIR="$REPO_ROOT/backend"
PYTHON_BIN="${PYTHON_BIN:-$REPO_ROOT/venv/bin/python}"
READINESS_TIMEOUT="${ASYNC_READINESS_TIMEOUT_SECONDS:-10}"

"$PYTHON_BIN" "$BACKEND_DIR/manage.py" check --deploy
"$PYTHON_BIN" "$BACKEND_DIR/manage.py" check_async_services --mode configuration
"$PYTHON_BIN" "$BACKEND_DIR/manage.py" check_async_services --mode broker --timeout "$READINESS_TIMEOUT"
"$PYTHON_BIN" "$BACKEND_DIR/manage.py" check_async_services --mode worker --timeout "$READINESS_TIMEOUT"
"$PYTHON_BIN" "$BACKEND_DIR/manage.py" check_async_services --mode pdf --timeout "$READINESS_TIMEOUT"
