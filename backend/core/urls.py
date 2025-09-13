# backend/backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import path, include, re_path

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

# Bring in views for flat /api/* aliases
from projects.views.calendar import MilestoneCalendarView, AgreementCalendarView
from projects.views.invoice import InvoiceViewSet
from projects.views.contractor_me import ContractorMeView


# ---------- Health ----------
def health(_request):
    return HttpResponse("ok", content_type="text/plain")


# ---------- SPA: return minimal HTML that points to stable static assets ----------
def spa_index(_request):
    """
    Serve a tiny HTML shell that loads the Vite build via STABLE asset names:
      /static/assets/index.css
      /static/assets/index.js

    This avoids Django templates and {% static %} so missing manifest entries
    (e.g., masked-icon.svg) can never crash the page.
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
</html>
"""
    return HttpResponse(html, content_type="text/html; charset=utf-8")


# ---------- Favicon ----------
def favicon(_request):
    # Prefer STATIC_ROOT/favicon.ico if present; else fall back to dist copy
    if getattr(settings, "STATIC_ROOT", None):
        fav = Path(settings.STATIC_ROOT) / "favicon.ico"
        if fav.exists():
            return FileResponse(open(fav, "rb"))
    # optional: probe vite dist if you still keep one around
    dist_fav = Path(settings.BASE_DIR) / "frontend" / "dist" / "favicon.ico"
    if dist_fav.exists():
        return FileResponse(open(dist_fav, "rb"))
    raise Http404("favicon.ico not found")


# ---------- ViewSet action wrappers for /api/invoices/ aliases ----------
invoice_list_view = InvoiceViewSet.as_view({"get": "list", "post": "create"})
invoice_detail_view = InvoiceViewSet.as_view(
    {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", health),

    # JWT auth (frontend login)
    path("api/auth/login/", TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/verify/", TokenVerifyView.as_view(), name="auth-verify"),

    # App namespaces
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # Flat /api/* aliases used by the frontend
    path("api/contractors/me/", ContractorMeView.as_view(), name="contractor-me-alias"),
    path("api/milestones/calendar/", MilestoneCalendarView.as_view(), name="milestones-calendar-alias"),
    path("api/agreements/calendar/", AgreementCalendarView.as_view(), name="agreements-calendar-empty"),
    path("api/invoices/", invoice_list_view, name="invoice-list-alias"),
    path("api/invoices/<int:pk>/", invoice_detail_view, name="invoice-detail-alias"),

    # Favicon + SPA
    path("favicon.ico", favicon),

    # Root -> SPA
    path("", spa_index, name="spa_index"),

    # Catch-all (exclude admin/api/static/media) -> SPA
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]
