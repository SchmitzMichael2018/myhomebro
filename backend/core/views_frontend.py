# backend/core/views_frontend.py
import os
import logging
import re
import secrets
from pathlib import Path

from django.shortcuts import render
from django.http import FileResponse, Http404, HttpResponseServerError
from django.conf import settings

logger = logging.getLogger("myhomebro")

PWA_PUBLIC_ASSETS = {
    "sw.js": "application/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "offline.html": "text/html; charset=utf-8",
    "favicon.ico": "image/x-icon",
    "favicon-192x192.png": "image/png",
    "favicon-512x512.png": "image/png",
    "apple-touch-icon.png": "image/png",
    "pwa-maskable-512x512.png": "image/png",
}
WORKBOX_FILENAME_RE = re.compile(r"workbox-[A-Za-z0-9_-]+\.js\Z")


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
        # FullCalendar 6 injects its official component CSS into a trusted
        # style element and reads CSSStyleSheet.cssRules during module load.
        # Its supported CSP integration discovers this per-response nonce via
        # meta[name="csp-nonce"].
        csp_nonce = secrets.token_urlsafe(24)
        return render(
            request,
            "index.html",
            {"google_maps_api_key": google_maps_api_key, "csp_nonce": csp_nonce},
        )
    except Exception as exc:
        return HttpResponseServerError(f"SPA render error: {exc}")


def pwa_asset(request, filename):
    if not getattr(settings, "PWA_ENABLED", False):
        raise Http404("PWA is disabled.")
    if filename not in PWA_PUBLIC_ASSETS and not WORKBOX_FILENAME_RE.fullmatch(filename):
        raise Http404("PWA asset not found.")
    build_dir = Path(settings.PWA_BUILD_DIR)
    path = build_dir / filename
    if not path.is_file():
        logger.error("PWA asset is missing from the configured build directory: %s", filename)
        raise Http404("PWA asset not built.")
    content_type = (
        "application/javascript; charset=utf-8"
        if WORKBOX_FILENAME_RE.fullmatch(filename)
        else PWA_PUBLIC_ASSETS[filename]
    )
    response = FileResponse(path.open("rb"), content_type=content_type)
    if filename == "sw.js":
        response["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response["Pragma"] = "no-cache"
        response["Expires"] = "0"
    elif WORKBOX_FILENAME_RE.fullmatch(filename):
        response["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response["Cache-Control"] = "public, max-age=300"
    if filename == "sw.js":
        response["Service-Worker-Allowed"] = "/"
    response["X-Content-Type-Options"] = "nosniff"
    return response
