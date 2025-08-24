# backend/core/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.http import HttpResponse
from django.conf import settings
from django.conf.urls.static import static

from rest_framework_simplejwt.views import TokenRefreshView
from accounts.email_verification_views import EmailVerificationView
from projects.views.stripe_webhook import stripe_webhook
from projects.views.frontend import spa_index  # serves frontend/dist/index.html


def healthz(_request):
    return HttpResponse("ok")


urlpatterns = [
    # Admin & health
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),

    # Auth/JWT
    path("api/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/", include(("accounts.auth_urls", "auth"), namespace="auth")),

    # App APIs
    path("api/accounts/", include(("accounts.urls", "accounts"), namespace="accounts")),
    path("api/projects/", include(("projects.urls", "projects"), namespace="projects")),
    # path("api/chat/", include(("chat.urls", "chat"), namespace="chat")),  # enable when ready

    # Email verification & Stripe webhooks
    path("verify-email/<uidb64>/<token>/", EmailVerificationView.as_view(), name="email_verify"),
    path("stripe/webhook/", stripe_webhook),

    # SPA shell (root and client-side routes)
    path("", spa_index, name="spa_index"),
    re_path(r"^(?!admin/|api/|static/|media/|verify-email/|stripe/).*$", spa_index, name="spa_fallback"),
]

# In DEBUG, serve media files
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
