# PWA Deployment

MyHomeBro serves root-scoped PWA files through explicit, anonymous Django
routes. The files remain generated artifacts in `frontend/dist`; Django does
not regenerate them. PythonAnywhere's `/static/` mapping continues to serve
ordinary Vite bundles.

Production paths are derived from Django settings:

- `BASE_DIR`: repository `backend/`
- `REPO_DIR`: repository root
- `PWA_BUILD_DIR`: `FRONTEND_DIST_DIR`, normally `frontend/dist`
- `STATIC_ROOT`: `staticfiles`

The PWA routes are declared before the SPA fallback. They serve only the
approved worker, manifest, offline shell, icons, and filenames matching
`workbox-[A-Za-z0-9_-]+.js`. The generated worker precaches Vite bundles from
`/static/assets/`; `/api/` and `/media/` remain `NetworkOnly`.

## Deploy

```bash
cd ~/backend
git pull --ff-only
set -a
source ~/backend/.env
set +a
bash scripts/rebuild_fast.sh
cd ~/backend/backend
python manage.py check_pwa_deployment
touch ~/backend/backend/wsgi.py
```

The fast rebuild fails if only one of `PWA_ENABLED` and `VITE_PWA_ENABLED` is
enabled, or if an enabled build omits a required PWA artifact.

## Verify

Use GET requests because they exercise the same path used by browsers:

```bash
curl -sS -D - https://myhomebro.pythonanywhere.com/sw.js -o /dev/null
curl -sS -D - https://myhomebro.pythonanywhere.com/manifest.webmanifest -o /dev/null
curl -sS -D - https://myhomebro.pythonanywhere.com/workbox-<hash>.js -o /dev/null
curl -sS -D - https://myhomebro.com/sw.js -o /dev/null
curl -sS -D - https://myhomebro.com/manifest.webmanifest -o /dev/null
curl -sS -D - https://myhomebro.com/workbox-<hash>.js -o /dev/null
```

Expected worker headers include `Content-Type: application/javascript`,
`Service-Worker-Allowed: /`, and `Cache-Control: no-cache, no-store,
must-revalidate`.
