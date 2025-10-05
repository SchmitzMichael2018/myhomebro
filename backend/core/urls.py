# backend/backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import path, include, re_path
from django.views.generic import RedirectView, TemplateView

# JWT (SimpleJWT) — safe to import
from rest_framework_simplejwt.views import (
    TokenObtainPairView, TokenRefreshView, TokenVerifyView
)

# Try to import the frame-exempt PDF viewer.
# If it fails for any reason, fall back to a simple 404 responder to avoid 500s.
try:
    from core.pdfviewer import viewer as pdf_viewer  # type: ignore
except Exception:
    def pdf_viewer(_request):
        return HttpResponse("PDF viewer unavailable", status=404, content_type="text/plain")

# Optional: serve media in DEBUG
try:
    from django.conf.urls.static import static as dj_static
except Exception:  # pragma: no cover
    dj_static = None


def health(_request):
    return HttpResponse("ok", content_type="text/plain")


def spa_index(_request):
    """
    Inline SPA shell so we don't depend on template files at runtime.
    Prevents 500 TemplateDoesNotExist on '/'. Static assets are served via WhiteNoise.
    """
    html = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>MyHomeBro</title>
    <link rel="icon" href="/static/favicon.ico"/>
    <link rel="stylesheet" href="/static/assets/index.css"/>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/static/assets/index.js"></script>
  </body>
</html>"""
    return HttpResponse(html, content_type="text/html; charset=utf-8")


def favicon(_request):
    """
    Serve /favicon.ico from a stable location. Any I/O issue returns 404 (not 500).
    Priority:
      1) STATIC_ROOT/favicon.ico (collected static)
      2) frontend/dist/favicon.ico (during transitions)
    """
    try:
        static_root = getattr(settings, "STATIC_ROOT", None)
        if static_root:
            p = Path(static_root) / "favicon.ico"
            if p.exists() and p.is_file():
                return FileResponse(open(p, "rb"), content_type="image/x-icon")

        dist_fav = Path(settings.BASE_DIR) / "frontend" / "dist" / "favicon.ico"
        if dist_fav.exists() and dist_fav.is_file():
            return FileResponse(open(dist_fav, "rb"), content_type="image/x-icon")
    except Exception:
        pass
    raise Http404("favicon.ico not found")


urlpatterns = [
    # Admin & health
    path("admin/", admin.site.urls),
    path("healthz", health),

    # JWT (SimpleJWT)
    path("api/auth/login/",   TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(),    name="auth-refresh"),
    path("api/auth/verify/",  TokenVerifyView.as_view(),     name="auth-verify"),

    # === Primary API mountpoints ===
    # All DRF routers (agreements, attachments, invoices, calendars, etc.) live inside projects.urls.
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # === Lightweight alias redirects (no heavy imports) ===
    # Contractor "me"
    path("api/contractors/me/", RedirectView.as_view(
        url="/api/projects/contractors/me/", permanent=False), name="contractor-me-alias"),

    # Calendars
    path("api/milestones/calendar/", RedirectView.as_view(
        url="/api/projects/milestones/calendar/", permanent=False), name="milestones-calendar-alias"),
    path("api/agreements/calendar/", RedirectView.as_view(
        url="/api/projects/agreements/calendar/", permanent=False), name="agreements-calendar-alias"),

    # Invoices
    path("api/invoices/", RedirectView.as_view(
        url="/api/projects/invoices/", permanent=False), name="invoice-list-alias"),
    path("api/invoices/<int:pk>/", RedirectView.as_view(
        url="/api/projects/invoices/%(pk)s/", permanent=False), name="invoice-detail-alias"),

    # Frame-exempt PDF.js viewer (guarded above)
    path("pdf/viewer/", pdf_viewer, name="pdf-viewer"),

    # Favicon
    path("favicon.ico", favicon, name="favicon"),

    # SPA shell
    path("", spa_index, name="spa_index"),
    # SPA fallback for any non-API, non-admin, non-static, non-media routes
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]

# Serve /media/ in DEBUG (local dev convenience)
if settings.DEBUG and dj_static:
    urlpatterns += dj_static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
