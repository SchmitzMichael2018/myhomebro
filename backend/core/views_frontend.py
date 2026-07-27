# backend/core/views_frontend.py
import os
from pathlib import Path

from django.shortcuts import render
from django.http import FileResponse, Http404, HttpResponseServerError
from django.conf import settings


def spa(request, *args, **kwargs):
    """
    Serve the SPA shell via the Django template system.

    The template (templates/index.html at the repo root, or
    backend/templates/index.html) uses the {% vite_entry_js %} and
    {% vite_entry_css %} template tags which read frontend/dist/.vite/manifest.json
    to inject the correct content-hashed asset URLs.  This means every
    `npm run build` automatically picks up new filenames — no manual edits needed.
    """
    try:
        google_maps_api_key = (
            getattr(settings, "VITE_GOOGLE_MAPS_API_KEY", "")
            or os.getenv("VITE_GOOGLE_MAPS_API_KEY", "")
            or getattr(settings, "GOOGLE_MAPS_API_KEY", "")
            or os.getenv("GOOGLE_MAPS_API_KEY", "")
            or getattr(settings, "GOOGLE_PLACES_API_KEY", "")
            or os.getenv("GOOGLE_PLACES_API_KEY", "")
        )
        return render(
            request,
            "index.html",
            {"google_maps_api_key": google_maps_api_key},
        )
    except Exception as exc:
        return HttpResponseServerError(f"SPA render error: {exc}")


def pwa_asset(request, filename):
    if not getattr(settings, "PWA_ENABLED", False):
        raise Http404("PWA is disabled.")
    allowed = {
        "sw.js": "application/javascript",
        "manifest.webmanifest": "application/manifest+json",
        "offline.html": "text/html",
    }
    if filename not in allowed:
        raise Http404("PWA asset not found.")
    path = Path(settings.REPO_DIR) / "frontend" / "dist" / filename
    if not path.is_file():
        raise Http404("PWA asset not built.")
    response = FileResponse(path.open("rb"), content_type=allowed[filename])
    response["Cache-Control"] = (
        "no-cache, no-store, must-revalidate"
        if filename == "sw.js"
        else "public, max-age=300"
    )
    if filename == "sw.js":
        response["Service-Worker-Allowed"] = "/"
    response["X-Content-Type-Options"] = "nosniff"
    return response
