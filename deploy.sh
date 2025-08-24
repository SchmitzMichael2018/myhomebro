#!/usr/bin/env bash
# ~/backend/deploy.sh
# One-shot deploy for MyHomeBro on PythonAnywhere:
# - Builds the Vite frontend
# - Creates stable aliases index.js/index.css
# - Collects static into Django STATIC_ROOT
# - (Optional) runs migrations if you pass --migrate

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT="${PROJECT_ROOT:-$HOME/backend}"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$PROJECT_ROOT/venv"

PYTHON_BIN="$VENV_DIR/bin/python"
MANAGE="$BACKEND_DIR/manage.py"

# ── Helpers ───────────────────────────────────────────────────────────────────
log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
die() { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ── Preflight checks ──────────────────────────────────────────────────────────
[ -d "$FRONTEND_DIR" ] || die "Frontend not found at $FRONTEND_DIR"
[ -d "$BACKEND_DIR" ]  || die "Backend not found at  $BACKEND_DIR"
[ -x "$PYTHON_BIN" ]   || die "Venv Python not found at $PYTHON_BIN (check $VENV_DIR)"

# Optional flag to run migrations, e.g. ./deploy.sh --migrate
RUN_MIGRATIONS=false
if [[ "${1:-}" == "--migrate" ]]; then
  RUN_MIGRATIONS=true
fi

# ── 1) Build frontend ─────────────────────────────────────────────────────────
log "Building frontend (Vite)"
cd "$FRONTEND_DIR"

# Prefer npm install (not ci) since lockfile may not exist on PA
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build

# ── 2) Create stable aliases index.js / index.css ─────────────────────────────
log "Creating stable aliases for latest hashed bundles"
ASSETS_DIR="$FRONTEND_DIR/dist/assets"
[ -d "$ASSETS_DIR" ] || die "Assets dir missing at $ASSETS_DIR (build failed?)"

cd "$ASSETS_DIR"
JS_FILE="$(ls -1 index-*.js 2>/dev/null | head -n1 || true)"
CSS_FILE="$(ls -1 index-*.css 2>/dev/null | head -n1 || true)"

[ -n "${JS_FILE:-}" ]  || die "No index-*.js bundle found in $ASSETS_DIR"
ln -sf "$JS_FILE" index.js
ok "index.js -> $JS_FILE"

if [ -n "${CSS_FILE:-}" ]; then
  ln -sf "$CSS_FILE" index.css
  ok "index.css -> $CSS_FILE"
else
  log "No CSS bundle found (ok if your build inlines styles)"
fi

# ── 3) (Optional) Django migrations ───────────────────────────────────────────
cd "$BACKEND_DIR"
if $RUN_MIGRATIONS; then
  log "Applying Django migrations"
  "$PYTHON_BIN" "$MANAGE" migrate
  ok "Migrations applied"
fi

# ── 4) Collect static ─────────────────────────────────────────────────────────
log "Collecting static files into STATIC_ROOT"
"$PYTHON_BIN" "$MANAGE" collectstatic --noinput
ok "collectstatic complete"

# ── 5) Summary ────────────────────────────────────────────────────────────────
STATIC_ROOT="$("$PYTHON_BIN" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE","core.settings")
django.setup()
from django.conf import settings
print(settings.STATIC_ROOT)
PY
)"
log "Done."
echo "Static root: ${STATIC_ROOT}"
echo "Make sure your PA Web tab has:"
echo "  • Virtualenv: $VENV_DIR"
echo "  • (If using static mapping) /static/ -> ${STATIC_ROOT}"
echo "Then click Reload in the Web tab."
