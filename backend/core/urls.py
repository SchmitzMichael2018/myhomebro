# backend/backend/core/urls.py
from __future__ import annotations

from pathlib import Path
from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.urls import path, include, re_path

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

# Bring in views for flat /api/* aliases
from projects.views.calendar import MilestoneCalendarView, AgreementCalendarView
from projects.views.invoice import InvoiceViewSet
from projects.views.contractor_me import ContractorMeView

# ---------- Health ----------
def health(_request):
    return HttpResponse("ok", content_type="text/plain")

# ---------- SPA index & favicon ----------
def _spa_index_path() -> Path:
    base_dir = Path(__file__).resolve().parent.parent
    return base_dir.parent / "frontend" / "dist" / "index.html"

def spa_index(_request):
    p = _spa_index_path()
    if not p.exists():
        raise Http404(f"SPA build not found at {p}. Run `npm run build` and collectstatic.")
    return FileResponse(open(p, "rb"))

def favicon(_request):
    if getattr(settings, "STATIC_ROOT", None):
        fav = Path(settings.STATIC_ROOT) / "favicon.ico"
        if fav.exists():
            return FileResponse(open(fav, "rb"))
    dist_fav = _spa_index_path().parent / "favicon.ico"
    if dist_fav.exists():
        return FileResponse(open(dist_fav, "rb"))
    raise Http404("favicon.ico not found")

# ---------- ViewSet action wrappers for /api/invoices/ aliases ----------
invoice_list_view = InvoiceViewSet.as_view({'get': 'list', 'post': 'create'})
invoice_detail_view = InvoiceViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'})

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", health),

    # JWT auth (so frontend login works out-of-the-box)
    path("api/auth/login/", TokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/verify/", TokenVerifyView.as_view(), name="auth-verify"),

    # Your existing app namespaces
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),

    # Flat /api/* aliases that your frontend calls:
    path("api/contractors/me/", ContractorMeView.as_view(), name="contractor-me-alias"),
    path("api/milestones/calendar/", MilestoneCalendarView.as_view(), name="milestones-calendar-alias"),
    path("api/agreements/calendar/", AgreementCalendarView.as_view(), name="agreements-calendar-empty"),
    path("api/invoices/", invoice_list_view, name="invoice-list-alias"),
    path("api/invoices/<int:pk>/", invoice_detail_view, name="invoice-detail-alias"),

    # Favicon + SPA
    path("favicon.ico", favicon),
    path("", spa_index, name="spa_index"),
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa_index, name="spa_fallback"),
]
