# backend/core/views_frontend.py
from django.shortcuts import render
from django.http import HttpResponseServerError


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
        return render(request, "index.html")
    except Exception as exc:
        return HttpResponseServerError(f"SPA render error: {exc}")
