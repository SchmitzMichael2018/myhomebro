# backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import path, include, re_path
from django.views.generic import RedirectView

from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from payments.webhooks import stripe_webhook  # noqa: F401  (imported elsewhere historically)
from projects.views.sms_webhook import sms_webhook

from .views_legal import TermsOfServiceView, PrivacyPolicyView

try:
    from payments.return_views import stripe_return, ok as stripe_ok  # type: ignore
except Exception:
    def stripe_return(_request):
        return HttpResponse(
            "Stripe return handler not configured.",
            status=501,
            content_type="text/plain",
        )

    def stripe_ok(_request):
        return HttpResponse("ok", content_type="text/plain")


try:
    from core.pdfviewer import viewer as pdf_viewer  # type: ignore
except Exception:
    def pdf_viewer(_request):
        return HttpResponse(
            "PDF viewer unavailable",
            status=404,
            content_type="text/plain",
        )


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
  <body class="bg-slate-50">
    <div id="root"></div>
    <script type="module" src="/static/assets/index.js"></script>
  </body>
</html>"""
    return HttpResponse(html, content_type="text/html; charset=utf-8")



def favicon(_request):
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

    # Auth (JWT) — legacy aliases kept
    path("api/auth/login",    TokenObtainPairView.as_view(), name="auth-login-noslash"),
    path("api/auth/login/",   TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh",  TokenRefreshView.as_view(),    name="auth-refresh-noslash"),
    path("api/auth/refresh/", TokenRefreshView.as_view(),    name="auth-refresh"),
    path("api/auth/verify",   TokenVerifyView.as_view(),     name="auth-verify-noslash"),
    path("api/auth/verify/",  TokenVerifyView.as_view(),     name="auth-verify"),
    path("api/token",         TokenObtainPairView.as_view(), name="auth-login-alias-noslash"),
    path("api/token/",         TokenObtainPairView.as_view(), name="auth-login-alias"),
    path("api/token/refresh", TokenRefreshView.as_view(),    name="auth-refresh-alias-noslash"),
    path("api/token/refresh/", TokenRefreshView.as_view(),    name="auth-refresh-alias"),

    # Primary APIs
    path("api/sms/webhook/", sms_webhook, name="sms-webhook"),
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),

    # ✅ FIX: mount accounts under /api/accounts/ (matches frontend calls)
    path("api/accounts/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # ✅ Back-compat: if anything old still calls /api/auth/... keep it working
    path(
        "api/auth/",
        RedirectView.as_view(url="/api/accounts/auth/", permanent=False),
        name="accounts-auth-redirect",
    ),

    path("api/payments/", include(("payments.urls", "payments"), namespace="payments")),

    # Stripe
    path("stripe/return/", stripe_return, name="stripe-return"),
    path("stripe/ok", stripe_ok, name="stripe-ok"),

    # Calendar aliases
    path(
        "api/milestones/calendar/",
        RedirectView.as_view(
            url="/api/projects/milestones/calendar/",
            permanent=False,
            query_string=True,
        ),
        name="milestones-calendar-alias",
    ),
    path(
        "api/agreements/calendar/",
        RedirectView.as_view(
            url="/api/projects/agreements/calendar/",
            permanent=False,
            query_string=True,
        ),
        name="agreements-calendar-alias",
    ),

    # Invoice aliases
    path(
        "api/invoices/",
        RedirectView.as_view(
            url="/api/projects/invoices/",
            permanent=False,
            query_string=True,
        ),
        name="invoice-list-alias",
    ),
    path(
        "api/invoices/<int:pk>/",
        RedirectView.as_view(
            url="/api/projects/invoices/%(pk)s/",
            permanent=False,
            query_string=True,
        ),
        name="invoice-detail-alias",
    ),

    # PDF viewer
    path("pdf/viewer/", pdf_viewer, name="pdf-viewer"),

    # Favicon
    path("favicon.ico", favicon, name="favicon"),

    # Legal pages
    path("legal/terms-of-service/", TermsOfServiceView.as_view(), name="terms-of-service"),
    path("legal/privacy-policy/", PrivacyPolicyView.as_view(), name="privacy-policy"),

    # SPA shell & fallback
    path("", spa_index, name="spa_index"),
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]

if settings.DEBUG and dj_static:
    urlpatterns += dj_static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
