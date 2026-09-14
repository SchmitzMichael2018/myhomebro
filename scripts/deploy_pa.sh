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

echo "==> Install backend requirements"
pip install -r "$BACKEND_DIR/requirements.txt"

echo "==> Apply migrations"
python "$BACKEND_DIR/manage.py" migrate --noinput
echo "==> Ensure shared database cache table exists"
python "$BACKEND_DIR/manage.py" createcachetable --database default

echo "==> Build frontend"
cd "$FRONTEND_DIR"
echo "Build will use: node $(node -v), npm $(npm -v)"
if [ -z "${VITE_PWA_ENABLED:-}" ]; then
  VITE_PWA_ENABLED="$(python "$BACKEND_DIR/manage.py" shell -c "from django.conf import settings; print(str(bool(settings.PWA_ENABLED)).lower())" | tail -n 1)"
  export VITE_PWA_ENABLED
fi
echo "PWA build enabled: $VITE_PWA_ENABLED"

install_frontend_dependencies() {
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
}

if ! install_frontend_dependencies || ! "$FRONTEND_DIR/node_modules/.bin/esbuild" --version >/dev/null 2>&1; then
  echo "Frontend dependency install is unhealthy; rebuilding the scoped dependency directory and npm cache"
  NODE_MODULES_DIR="$(readlink -f "$FRONTEND_DIR/node_modules")"
  if [ "$NODE_MODULES_DIR" != "$FRONTEND_DIR/node_modules" ]; then
    echo "Refusing to remove unexpected dependency path: $NODE_MODULES_DIR"
    exit 1
  fi
  chmod -R u+rwX "$NODE_MODULES_DIR" 2>/dev/null || true
  rm -rf -- "$NODE_MODULES_DIR"
  npm cache clean --force
  install_frontend_dependencies
  "$FRONTEND_DIR/node_modules/.bin/esbuild" --version >/dev/null
fi

# A build artifact copied from another machine may retain read-only directory
# permissions. Vite must be able to replace its previous output safely.
if [ -d "$FRONTEND_DIR/dist" ]; then
  DIST_DIR="$(readlink -f "$FRONTEND_DIR/dist")"
  if [ "$DIST_DIR" != "$FRONTEND_DIR/dist" ]; then
    echo "Refusing to modify unexpected build output path: $DIST_DIR"
    exit 1
  fi
  chmod -R u+rwX "$DIST_DIR"
fi
npm run build

echo "==> Verify async services and generated PWA assets"
REPO_ROOT="$REPO_DIR" \
PYTHON_BIN="$(command -v python)" \
bash "$REPO_DIR/scripts/check_async_readiness.sh"

echo "==> Clean old generated assets"
rm -rf "$REPO_DIR/staticfiles/assets"/* || true

echo "==> collectstatic"
cd "$BACKEND_DIR"
python manage.py collectstatic --noinput

echo "==> Reload app"
PYTHONANYWHERE_WSGI_FILE="${PYTHONANYWHERE_WSGI_FILE:-/var/www/www_myhomebro_com_wsgi.py}"
if [ -f "$PYTHONANYWHERE_WSGI_FILE" ]; then
  touch "$PYTHONANYWHERE_WSGI_FILE"
else
  echo "PythonAnywhere WSGI file not found at $PYTHONANYWHERE_WSGI_FILE; touching Django wsgi.py instead"
  touch "$BACKEND_DIR/wsgi.py"
fi

if [ -f "$HOME/backend/.env" ]; then
  chmod 600 "$HOME/backend/.env"
elif [ -f "$HOME/backend/backend/.env" ]; then
  chmod 600 "$HOME/backend/backend/.env"
else
  echo "No .env file found to chmod (skipping)"
fi

echo "==> Done."
