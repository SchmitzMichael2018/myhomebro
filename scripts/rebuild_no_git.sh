#!/usr/bin/env bash
# ~/backend/scripts/rebuild_no_git.sh
# Rebuild backend + frontend on PythonAnywhere WITHOUT pulling from git.

set -euo pipefail

REPO_ROOT="$HOME/backend"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
STATIC_ROOT="${STATIC_ROOT_OVERRIDE:-$REPO_ROOT/staticfiles}"
ASSETS_DIR="$STATIC_ROOT/assets"

log() { printf "\n\033[1;34m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }

# 0) venv
log "Activating virtualenv…"
source "$REPO_ROOT/venv/bin/activate"

# 1) Backend deps (optional) + migrate
log "Installing backend requirements (optional)…"
if [[ -f "$REPO_ROOT/requirements.txt" ]]; then
  pip install -r "$REPO_ROOT/requirements.txt"
fi

log "Applying Django migrations…"
python "$BACKEND_DIR/manage.py" migrate --noinput

# 2) Frontend build
log "Building frontend with Vite…"
cd "$FRONTEND_DIR"

# fix CRLF in any local scripts (no-op if not present)
if command -v dos2unix >/dev/null 2>&1; then
  find . -type f -name "*.sh" -exec dos2unix {} + || true
else
  find . -type f -name "*.sh" -exec sed -i 's/\r$//' {} + || true
fi

# npm install (ci if lock present)
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm i
fi

npx vite build

# 3) Publish assets (hashed → stable)
log "Publishing assets to $ASSETS_DIR …"
mkdir -p "$ASSETS_DIR"
rsync -av --delete "$FRONTEND_DIR/dist/assets/" "$ASSETS_DIR/"

# stable symlinks consumed by your spa_index
cd "$ASSETS_DIR"
JS_HASHED="$(ls -1t index-*.js 2>/dev/null | head -n1 || true)"
CSS_HASHED="$(ls -1t index-*.css 2>/dev/null | head -n1 || true)"
if [[ -n "$JS_HASHED" ]]; then ln -sf "$JS_HASHED" index.js; fi
if [[ -n "$CSS_HASHED" ]]; then ln -sf "$CSS_HASHED" index.css; fi
log "index.js -> ${JS_HASHED:-missing}"
log "index.css -> ${CSS_HASHED:-missing}"

# 4) (optional) collectstatic — enable if your settings require it
# log "Collecting static…"
# python "$BACKEND_DIR/manage.py" collectstatic --noinput

# 5) Reload app
log "Reloading WSGI…"
touch "$BACKEND_DIR/wsgi.py" || true

log "Done ✅"
