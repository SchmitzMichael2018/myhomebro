# backend/core/urls.py
from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse, Http404
from django.shortcuts import redirect
from django.urls import path, include, re_path
from django.views.generic import RedirectView

from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from payments.webhooks import stripe_webhook  # noqa: F401  (imported elsewhere historically)
from projects.views.sms_webhook import sms_webhook
from projects.views.public_presence import PublicContractorRatingView
from projects.services.proposal_customer_review import ReviewAccessError, resolve_short_code, token_for
from projects.services.estimate_appointment_notifications import (
    confirmation_token,
    resolve_appointment_short_code,
)
from projects.views.notifications import (
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationMarkReadView,
    NotificationUnreadCountView,
)
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .views_legal import TermsOfServiceView, PrivacyPolicyView
from .views_frontend import pwa_asset, spa as spa_index
from .views_health import async_services_readiness

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


class ProposalReviewShortLinkView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "proposal_review_short_link"

    def get(self, _request, code):
        try:
            review = resolve_short_code(code)
        except ReviewAccessError as exc:
            raise Http404(str(exc)) from exc
        # The destination is entirely server-generated; callers cannot supply a redirect target.
        return redirect(f"/estimate-review/{token_for(review)}")


class EstimateAppointmentShortLinkView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "appointment_short_link"

    def get(self, _request, code):
        appointment = resolve_appointment_short_code(code)
        if appointment is None:
            raise Http404("This appointment link is invalid or no longer available.")
        # The signed token remains the authorization boundary and the destination
        # is entirely server-generated; the short code never contains customer data.
        return redirect(f"/appointment-confirmation/{confirmation_token(appointment)}")

urlpatterns = [
    # Admin & health
    path("healthz", health),
    path("r/<str:code>", ProposalReviewShortLinkView.as_view(), name="proposal-review-short-link"),
    path("a/<str:code>", EstimateAppointmentShortLinkView.as_view(), name="appointment-short-link"),
    path("admin/health/async-services/", async_services_readiness, name="async-services-readiness"),
    path("admin/", admin.site.urls),

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
    path("api/notifications/", NotificationListView.as_view(), name="notifications-list"),
    path("api/notifications/unread-count/", NotificationUnreadCountView.as_view(), name="notifications-unread-count"),
    path("api/notifications/<int:pk>/read/", NotificationMarkReadView.as_view(), name="notifications-mark-read"),
    path("api/notifications/mark-all-read/", NotificationMarkAllReadView.as_view(), name="notifications-mark-all-read"),
    path("api/contractors/<slug:slug>/rating/", PublicContractorRatingView.as_view(), name="contractor-rating"),

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

    # Root-scoped public PWA files must precede the SPA fallback.
    path("sw.js", pwa_asset, {"filename": "sw.js"}, name="pwa-service-worker"),
    path("manifest.webmanifest", pwa_asset, {"filename": "manifest.webmanifest"}, name="pwa-manifest"),
    path("offline.html", pwa_asset, {"filename": "offline.html"}, name="pwa-offline"),
    re_path(
        r"^(?P<filename>workbox-[A-Za-z0-9_-]+\.js)$",
        pwa_asset,
        name="pwa-workbox",
    ),
    re_path(r"^(?P<filename>workbox-.*)$", pwa_asset, name="pwa-workbox-rejected"),
    path("favicon.ico", pwa_asset, {"filename": "favicon.ico"}, name="favicon"),
    path("favicon-192x192.png", pwa_asset, {"filename": "favicon-192x192.png"}, name="pwa-icon-192"),
    path("favicon-512x512.png", pwa_asset, {"filename": "favicon-512x512.png"}, name="pwa-icon-512"),
    path("apple-touch-icon.png", pwa_asset, {"filename": "apple-touch-icon.png"}, name="pwa-apple-icon"),
    path("pwa-maskable-512x512.png", pwa_asset, {"filename": "pwa-maskable-512x512.png"}, name="pwa-maskable-icon"),

    # Legal pages
    path("legal/terms-of-service/", TermsOfServiceView.as_view(), name="terms-of-service"),
    path("legal/privacy-policy/", PrivacyPolicyView.as_view(), name="privacy-policy"),

    # SPA shell & fallback
    path("", spa_index, name="spa_index"),
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]

if settings.DEBUG and dj_static:
    urlpatterns += dj_static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
