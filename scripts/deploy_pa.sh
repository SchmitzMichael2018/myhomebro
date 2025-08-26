#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/backend"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
VENV="$REPO_DIR/venv"

echo "==> Activate venv"
source "$VENV/bin/activate"

echo "==> Ensure Node via nvm (force nvm Node even if ~/.n/bin is first)"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"

  TARGET_NODE="20"
  if [ -f "$REPO_DIR/.nvmrc" ]; then
    TARGET_NODE="$(cat "$REPO_DIR/.nvmrc")"
  fi

  nvm install "$TARGET_NODE" >/dev/null
  nvm use "$TARGET_NODE" >/dev/null

  NVM_NODE_BIN="$(dirname "$(nvm which "$TARGET_NODE")")"
  export PATH="$NVM_NODE_BIN:$PATH"
  hash -r

  echo "Using Node: $(node -v)"
  echo "Using npm:  $(npm -v)"
  echo "Node path:  $(which node)"
  echo "npm path:   $(which npm)"
else
  echo "nvm not found; using system Node: $(node -v 2>/dev/null || echo 'not installed')"
fi

echo "==> Pull latest main"
cd "$REPO_DIR"
git fetch origin
git checkout main
git pull --ff-only

echo "==> Build frontend"
cd "$FRONTEND_DIR"
echo "Build will use: node $(node -v), npm $(npm -v)"
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

if [ -f "$HOME/backend/.env" ]; then
  chmod 600 "$HOME/backend/.env"
elif [ -f "$HOME/backend/backend/.env" ]; then
  chmod 600 "$HOME/backend/backend/.env"
else
  echo "No .env file found to chmod (skipping)"
fi

echo "==> Done."
