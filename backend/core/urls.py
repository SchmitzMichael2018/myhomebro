from django.contrib import admin
from django.urls import path, include, re_path

from projects.views.stripe_webhook import stripe_webhook
from rest_framework_simplejwt.views import TokenRefreshView
from accounts.email_verification_views import EmailVerificationView
from projects.views.frontend import StaticIndexView  # <-- import your new static view

urlpatterns = [
    # Admin and auth endpoints
    path('admin/', admin.site.urls),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # REST APIs — give each app its own prefix!
    path('api/accounts/', include('accounts.urls')),
    path('api/projects/', include('projects.urls')),
    # path('api/chat/', include('chat.urls')),  # if you add chat APIs

    # Email verification & Stripe webhooks
    path(
        'verify-email/<uidb64>/<token>/',
        EmailVerificationView.as_view(),
        name='email_verify'
    ),
    path('stripe/webhook/', stripe_webhook),

    # Root: serve your React “shell” (the static index.html)
    path('', StaticIndexView.as_view(), name='home'),

    # Catch-all for SPA fallback
    re_path(
        r'^(?!admin|api|static|media|verify-email|stripe).*$',
        StaticIndexView.as_view(),
        name='spa-fallback'
    ),
]
