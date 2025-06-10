# core/urls.py

from django.contrib import admin
from django.urls import path, include
from django.views.static import serve
from django.conf import settings

from projects.views import stripe_webhook
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
    # 1) Django admin
    path('admin/', admin.site.urls),

    # 2) Stripe webhook endpoint (no /api/ prefix)
    path('stripe/webhook/', stripe_webhook, name='stripe-webhook'),

    # 3) Accounts app (registration, password reset, email verification…)
    path(
        'api/accounts/',
        include(('accounts.urls', 'accounts_api'), namespace='accounts_api')
    ),

    # 4) JWT auth endpoints
    path(
        'api/auth/login/',
        TokenObtainPairView.as_view(),
        name='auth_login'
    ),
    path(
        'api/auth/refresh/',
        TokenRefreshView.as_view(),
        name='auth_refresh'
    ),

    # 5) Main API
    path(
        'api/',
        include(('projects.urls', 'projects_api'), namespace='projects_api')
    ),

    # 6) DRF’s browsable API login/logout
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),

    # 7) Static (development only)
    path(
        'static/<path:path>',
        serve,
        {'document_root': settings.STATIC_ROOT}
    ),
]
