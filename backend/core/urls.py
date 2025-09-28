# backend/backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import path, include, re_path
from django.views.generic import RedirectView

# Frame-exempt PDF.js viewer
from core.pdfviewer import viewer as pdf_viewer

# JWT (SimpleJWT)
from rest_framework_simplejwt.views import (
    TokenObtainPairView, TokenRefreshView, TokenVerifyView
)

# EXPLICIT function views for agreement subroutes (bind these FIRST)
from projects.views.agreements import (
    agreement_milestones,   # auth
    agreement_attachments,  # auth
)

# Other views already used
from projects.views.calendar import MilestoneCalendarView, AgreementCalendarView
from projects.views.invoice import InvoiceViewSet
from projects.views.contractor_me import ContractorMeView

# Optional: serve media in DEBUG
try:
    from django.conf.urls.static import static as dj_static
except Exception:
    dj_static = None


def health(_request):
    return HttpResponse("ok", content_type="text/plain")


def spa_index(_request):
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
    # Try collected static first
    if getattr(settings, "STATIC_ROOT", None):
        fav = Path(settings.STATIC_ROOT) / "favicon.ico"
        if fav.exists():
            with open(fav, "rb") as f:
                return FileResponse(f, content_type="image/x-icon")
    # Then Vite dist (useful during transitions)
    dist_fav = Path(settings.BASE_DIR) / "frontend" / "dist" / "favicon.ico"
    if dist_fav.exists():
        with open(dist_fav, "rb") as f:
            return FileResponse(f, content_type="image/x-icon")
    raise Http404("favicon.ico not found")


# Stable invoice aliases (avoid heavy imports at startup)
invoice_list_view = InvoiceViewSet.as_view({"get": "list", "post": "create"})
invoice_detail_view = InvoiceViewSet.as_view(
    {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
)

urlpatterns = [
    # ───────────────────────────────────────────────────────────────
    # EXPLICIT agreement subroutes FIRST (regex; with/without slash)
    # These are the exact paths the frontend calls.
    # ───────────────────────────────────────────────────────────────
    re_path(r"^api/projects/agreements/(?P<pk>\d+)/attachments/?$",
            agreement_attachments, name="agreement-attachments"),
    re_path(r"^api/projects/agreements/(?P<pk>\d+)/milestones/?$",
            agreement_milestones,  name="agreement-milestones"),

    # Optional flat aliases (if FE ever calls /api/agreements/... directly)
    re_path(r"^api/agreements/(?P<pk>\d+)/attachments/?$",
            RedirectView.as_view(url="/api/projects/agreements/%(pk)s/attachments/", permanent=False),
            name="agreements-attachments-alias"),
    re_path(r"^api/agreements/(?P<pk>\d+)/milestones/?$",
            RedirectView.as_view(url="/api/projects/agreements/%(pk)s/milestones/", permanent=False),
            name="agreements-milestones-alias"),

    # Admin & health
    path("admin/", admin.site.urls),
    path("healthz", health),

    # JWT (SimpleJWT)
    path("api/auth/login/",   TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(),    name="auth-refresh"),
    path("api/auth/verify/",  TokenVerifyView.as_view(),     name="auth-verify"),

    # Projects API (DRF routers live here)
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),

    # Accounts (if you have a separate app)
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # Flat aliases commonly used by the frontend
    path("api/contractors/me/", ContractorMeView.as_view(), name="contractor-me-alias"),
    path("api/milestones/calendar/", MilestoneCalendarView.as_view(), name="milestones-calendar-alias"),
    path("api/agreements/calendar/", AgreementCalendarView.as_view(), name="agreements-calendar-alias"),
    path("api/invoices/", invoice_list_view, name="invoice-list-alias"),
    path("api/invoices/<int:pk>/", invoice_detail_view, name="invoice-detail-alias"),

    # SAEF/legacy expenses aliases (clean redirects)
    path("api/expenses/", RedirectView.as_view(url="/api/projects/expenses/", permanent=False), name="expense-list-alias"),
    re_path(r"^api/expenses/(?P<pk>\d+)/$", RedirectView.as_view(url="/api/projects/expenses/%(pk)s/", permanent=False), name="expense-detail-alias"),

    # Frame-exempt PDF.js viewer
    path("pdf/viewer/", pdf_viewer, name="pdf-viewer"),

    # Favicon + SPA shell/fallback
    path("favicon.ico", favicon, name="favicon"),
    path("", spa_index, name="spa_index"),
    # SPA fallback: exclude admin, api, static, media
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]

# Serve /media/ in DEBUG (local dev convenience)
if settings.DEBUG and dj_static:
    urlpatterns += dj_static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
