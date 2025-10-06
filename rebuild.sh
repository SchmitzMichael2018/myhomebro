# 1) Recreate the script with Unix (LF) line endings
cat > ~/backend/rebuild.sh <<'BASH'
#!/usr/bin/env bash
# ~/backend/rebuild.sh
set -euo pipefail

APP_ROOT="$HOME/backend"
DJANGO_DIR="$APP_ROOT/backend"
FRONTEND_DIR="$APP_ROOT/frontend"
STATIC_OUT="$APP_ROOT/staticfiles/assets"
VENV_BIN="$APP_ROOT/venv/bin"

echo "==> Activating virtualenv"
source "$VENV_BIN/activate"

echo "==> Django check/migrations"
python "$DJANGO_DIR/manage.py" check
python "$DJANGO_DIR/manage.py" makemigrations --noinput
python "$DJANGO_DIR/manage.py" migrate --noinput

echo "==> Building frontend (Vite)"
cd "$FRONTEND_DIR"
npm run build

echo "==> Collecting static"
cd "$DJANGO_DIR"
python "$DJANGO_DIR/manage.py" collectstatic --noinput

echo "==> Promoting latest hashed assets"
cd "$STATIC_OUT"
LATEST_JS="$(ls -t index-*.js 2>/dev/null | head -1 || true)"
LATEST_CSS="$(ls -t index-*.css 2>/dev/null | head -1 || true)"
if [[ -n "${LATEST_JS:-}" ]]; then cp -f "$LATEST_JS" index.js; echo "JS -> $LATEST_JS"; else echo "WARN: no index-*.js"; fi
if [[ -n "${LATEST_CSS:-}" ]]; then cp -f "$LATEST_CSS" index.css; echo "CSS -> $LATEST_CSS"; else echo "WARN: no index-*.css"; fi

echo "==> Touching WSGI"
touch "$DJANGO_DIR/wsgi.py"

echo "✅ Rebuild complete."
BASH

# 2) Make it executable and run
chmod +x ~/backend/rebuild.sh
bash ~/backend/rebuild.sh
