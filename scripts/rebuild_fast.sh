#!/usr/bin/env bash
# ~/backend/scripts/rebuild_fast.sh
# Rebuild backend + frontend WITHOUT pip/npm installs (fast path).

set -euo pipefail

REPO_ROOT="$HOME/backend"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
STATIC_ROOT="${STATIC_ROOT_OVERRIDE:-$REPO_ROOT/staticfiles}"
ASSETS_DIR="$STATIC_ROOT/assets"

log(){ printf "\n\033[1;34m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }

# 0) venv
log "Activating virtualenv…"
source "$REPO_ROOT/venv/bin/activate"

# 1) Backend: migrate only (no pip)
log "Applying Django migrations…"
python "$BACKEND_DIR/manage.py" migrate --noinput

# 2) Frontend: build only (no npm i/ci)
log "Building frontend with Vite (no installs)…"
cd "$FRONTEND_DIR"
npx vite build

# 2.5) Publish index.html
log "Publishing index.html …"
rsync -av "$FRONTEND_DIR/dist/index.html" "$STATIC_ROOT/index.html"


# 3) Publish assets (hashed -> stable)
log "Publishing assets to $ASSETS_DIR …"
mkdir -p "$ASSETS_DIR"
rsync -av --delete "$FRONTEND_DIR/dist/assets/" "$ASSETS_DIR/"

cd "$ASSETS_DIR"
JS_HASHED="$(ls -1t index-*.js 2>/dev/null | head -n1 || true)"
CSS_HASHED="$(ls -1t index-*.css 2>/dev/null | head -n1 || true)"
[[ -n "$JS_HASHED"  ]] && ln -sf "$JS_HASHED" index.js
[[ -n "$CSS_HASHED" ]] && ln -sf "$CSS_HASHED" index.css
log "index.js -> ${JS_HASHED:-missing}"
log "index.css -> ${CSS_HASHED:-missing}"

# 4) Reload app
log "Reloading WSGI…"
touch "$BACKEND_DIR/wsgi.py" || true

log "Done ✅ (fast rebuild)"
