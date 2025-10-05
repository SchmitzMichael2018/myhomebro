#!/usr/bin/env bash
set -euo pipefail

BACKEND="$HOME/backend/backend"
FRONTEND="$HOME/backend/frontend"
ASSETS="$HOME/backend/staticfiles/assets"
WSGI="$HOME/backend/backend/wsgi.py"
PY="$HOME/backend/venv/bin/python"

echo "==> Backend: migrations"
cd "$BACKEND"
$PY manage.py makemigrations --noinput
$PY manage.py migrate --noinput

echo
echo "==> Frontend: Vite build (clean cache)"
cd "$FRONTEND"
# If deps changed recently, uncomment:
# npm ci
rm -rf node_modules/.vite 2>/dev/null || true
npm run build

echo
echo "==> Collectstatic -> WhiteNoise"
cd "$BACKEND"
$PY manage.py collectstatic --noinput

echo
echo "==> Pin newest hashed assets to stable names"
cd "$ASSETS"
JS=$(ls -t index-*.js 2>/dev/null | head -1 || ls -t *.js 2>/dev/null | head -1 || true)
CSS=$(ls -t index-*.css 2>/dev/null | head -1 || ls -t *.css 2>/dev/null | head -1 || true)

if [[ -n "${JS:-}" && -f "$JS" ]]; then
  cp -f "$JS" index.js
  echo "Pinned JS: $JS -> index.js"
else
  echo "WARN: No JS to pin"
fi

if [[ -n "${CSS:-}" && -f "$CSS" ]]; then
  cp -f "$CSS" index.css
  echo "Pinned CSS: $CSS -> index.css"
else
  echo "WARN: No CSS to pin"
fi

echo
echo "==> Ensure favicon"
if [[ ! -f "$HOME/backend/staticfiles/favicon.ico" && -f "$FRONTEND/dist/favicon.ico" ]]; then
  cp -f "$FRONTEND/dist/favicon.ico" "$HOME/backend/staticfiles/favicon.ico"
  echo "Copied favicon.ico from dist"
fi

echo
echo "==> Reload WSGI"
touch "$WSGI"

echo
echo "==> Done. Quick checks (open in browser or curl):"
echo "https://www.myhomebro.com/"
echo "https://www.myhomebro.com/static/assets/index.js"
echo "https://www.myhomebro.com/api/projects/attachments/?agreement=5"
echo "Note: auth may be required for 200s on API."
