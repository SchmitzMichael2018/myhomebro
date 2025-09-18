# backend/backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import path, include, re_path
from django.views.generic import RedirectView

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView
from projects.views.calendar import MilestoneCalendarView, AgreementCalendarView
from projects.views.invoice import InvoiceViewSet
from projects.views.contractor_me import ContractorMeView

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
    if getattr(settings, "STATIC_ROOT", None):
        fav = Path(settings.STATIC_ROOT) / "favicon.ico"
        if fav.exists():
            return FileResponse(open(fav, "rb"))
    dist_fav = Path(settings.BASE_DIR) / "frontend" / "dist" / "favicon.ico"
    if dist_fav.exists():
        return FileResponse(open(dist_fav, "rb"))
    raise Http404("favicon.ico not found")

# Stable invoice aliases
invoice_list_view = InvoiceViewSet.as_view({"get": "list", "post": "create"})
invoice_detail_view = InvoiceViewSet.as_view(
    {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", health),

    # JWT
    path("api/auth/login/",   TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(),    name="auth-refresh"),
    path("api/auth/verify/",  TokenVerifyView.as_view(),     name="auth-verify"),

    # Projects router (provides /api/projects/expenses/ when registered) :contentReference[oaicite:5]{index=5}
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),

    # Accounts
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # Flat aliases used by frontend
    path("api/contractors/me/", ContractorMeView.as_view(), name="contractor-me-alias"),
    path("api/milestones/calendar/", MilestoneCalendarView.as_view(), name="milestones-calendar-alias"),
    path("api/agreements/calendar/", AgreementCalendarView.as_view(), name="agreements-calendar-alias"),
    path("api/invoices/", invoice_list_view, name="invoice-list-alias"),
    path("api/invoices/<int:pk>/", invoice_detail_view, name="invoice-detail-alias"),

    # SAFE expenses aliases (redirects; no risky imports at startup)
    path("api/expenses/", RedirectView.as_view(url="/api/projects/expenses/", permanent=False), name="expense-list-alias"),
    re_path(r"^api/expenses/(?P<pk>\d+)/$", RedirectView.as_view(url="/api/projects/expenses/%(pk)s/", permanent=False), name="expense-detail-alias"),

    # Favicon + SPA
    path("favicon.ico", favicon),
    path("", spa_index, name="spa_index"),
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]
