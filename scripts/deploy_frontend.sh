#!/usr/bin/env bash
# COMPLETE FILE — Frontend deploy for MyHomeBro on PythonAnywhere (Vite 6 + stable aliases)
set -euo pipefail

say() { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m❌ %s\033[0m\n" "$*" >&2; }

say "Enter project root"
cd "$HOME/backend"

# --- Node build ---
export NODE_OPTIONS="--max-old-space-size=4096"
if [ -f frontend/package-lock.json ]; then
  say "npm ci"
  npm --prefix frontend ci || npm --prefix frontend install
else
  say "npm install"
  npm --prefix frontend install
fi

say "vite build (with fallback)"
npm --prefix frontend run build || (cd frontend && npm run build)

DIST="$HOME/backend/frontend/dist"
ASSETS="$DIST/assets"

say "Build artifacts:"
ls -lh "$DIST" || true
ls -lh "$DIST/.vite" 2>/dev/null || true
ls -lh "$ASSETS" 2>/dev/null || true

# --- Normalize Vite 6 manifest path ---
NEW_MANIFEST="$DIST/.vite/manifest.json"
OLD_MANIFEST="$DIST/manifest.json"
if [ -f "$NEW_MANIFEST" ]; then
  say "Detected Vite 6 manifest at .vite/manifest.json"
  cp -f "$NEW_MANIFEST" "$OLD_MANIFEST"
elif [ -f "$OLD_MANIFEST" ]; then
  say "Detected legacy manifest at dist/manifest.json"
else
  err "Build artifacts missing: $NEW_MANIFEST or $OLD_MANIFEST"
  exit 1
fi

if [ ! -f "$DIST/index.html" ]; then
  err "Build artifact missing: $DIST/index.html"
  exit 1
fi

# --- Create stable aliases for main CSS/JS ---
say "Create stable aliases for main CSS/JS (index.css / index.js)"
mkdir -p "$ASSETS"

# Find the newest main css/js produced by Vite (prefixed with "index-")
MAIN_CSS=$(ls -t "$ASSETS"/index-*.css 2>/dev/null | head -1 || true)
MAIN_JS=$(ls -t "$ASSETS"/index-*.js  2>/dev/null | head -1 || true)

if [ -n "${MAIN_CSS:-}" ]; then
  cp -f "$MAIN_CSS" "$ASSETS/index.css"
  say "Aliased CSS: $(basename "$MAIN_CSS") -> assets/index.css"
else
  say "No index-*.css found; skipping alias"
fi

if [ -n "${MAIN_JS:-}" ]; then
  cp -f "$MAIN_JS" "$ASSETS/index.js"
  say "Aliased JS:  $(basename "$MAIN_JS") -> assets/index.js"
else
  say "No index-*.js found; skipping alias"
fi

# --- Django collectstatic ---
say "Activate venv"
source "$HOME/backend/venv/bin/activate"

# Optional: clear old staticfiles (prevents stale .br/.gz)
say "Remove previously collected staticfiles to avoid stale assets"
rm -rf "$HOME/backend/staticfiles" || true
mkdir -p "$HOME/backend/staticfiles"

say "collectstatic"
cd "$HOME/backend/backend"
python manage.py collectstatic --noinput

# --- Reload web worker ---
say "Reload WSGI"
touch "$HOME/backend/backend/wsgi.py"

say "Frontend deployed. If you changed JS/CSS, hard-refresh the browser (Ctrl/Cmd+Shift+R)."
