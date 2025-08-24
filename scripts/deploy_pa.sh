#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/backend"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
VENV="$REPO_DIR/venv"

echo "==> Activate venv"
source "$VENV/bin/activate"

echo "==> Ensure Node via nvm"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install >/dev/null
nvm use >/dev/null

echo "==> Pull latest main"
cd "$REPO_DIR"
git fetch origin
git checkout main
git pull --ff-only

echo "==> Build frontend"
cd "$FRONTEND_DIR"
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi
npm run build

echo "==> Clean old generated assets"
rm -rf "$REPO_DIR/staticfiles/assets"/* || true

echo "==> collectstatic"
cd "$BACKEND_DIR"
python manage.py collectstatic --noinput

echo "==> Reload app"
touch "$BACKEND_DIR/wsgi.py"

echo "==> Done."
