# backend/core/views_frontend.py
from pathlib import Path
from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound, HttpResponseServerError

def spa(request, *args, **kwargs):
    """
    Serve the built React index.html directly from disk (no Django templates).
    This avoids {% static %} lookups and manifest errors for PWA assets like masked-icon.svg.
    """
    try:
        # Adjust if your project layout differs:
        index_file = Path(settings.BASE_DIR) / "frontend" / "dist" / "index.html"
        if not index_file.exists():
            return HttpResponseNotFound(
                "index.html not found. Build the frontend and run collectstatic."
            )
        content = index_file.read_text(encoding="utf-8")
        return HttpResponse(content, content_type="text/html; charset=utf-8")
    except Exception as exc:
        # Safe guard to surface any unexpected errors
        return HttpResponseServerError(f"SPA render error: {exc}")
