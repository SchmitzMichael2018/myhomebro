# backend/projects/views/frontend.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound
from django.views import View


def _dist_dir() -> Path:
    """
    Resolve the Vite build directory:
    - Prefer settings.FRONTEND_DIST_DIR if present (as in the settings I sent)
    - Otherwise fall back to ~/backend/frontend/dist
    """
    dist = getattr(settings, "FRONTEND_DIST_DIR", None)
    if dist:
        return Path(dist)
    # BASE_DIR is ~/backend/backend → parent is ~/backend
    return Path(settings.BASE_DIR).parent / "frontend" / "dist"


def _index_path() -> Path:
    return _dist_dir() / "index.html"


class StaticIndexView(View):
    """
    Serves the built SPA index.html from frontend/dist without using Django templates.
    This keeps all Vite-generated asset paths untouched.
    """

    def get(self, request, *args, **kwargs):
        idx = _index_path()
        if idx.exists():
            with open(idx, "rb") as f:
                resp = HttpResponse(f.read(), content_type="text/html; charset=utf-8")
                # Do not cache the HTML shell; hashed assets are cached by WhiteNoise
                resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                resp["Pragma"] = "no-cache"
                return resp

        return HttpResponseNotFound(
            f"Frontend build not found at: {idx}. "
            f"Run `npm run build` in the frontend/ directory."
        )


# Convenience function view if you prefer function-based routing
def spa_index(request, *args, **kwargs):
    return StaticIndexView.as_view()(request, *args, **kwargs)
