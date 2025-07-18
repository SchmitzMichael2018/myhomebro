from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView

urlpatterns = [
    path('admin/', admin.site.urls),

    # Accounts: registration, password, profile, email verification
    path(
        'api/accounts/',
        include(('accounts.urls', 'accounts_api')),
        name='accounts_api'
    ),

    # JWT authentication endpoints (login, refresh, etc.)
    path(
        'api/auth/',
        include(('accounts.auth_urls', 'auth_api')),
        name='auth_api'
    ),

    # Project/business logic endpoints
    path(
        'api/projects/',
        include(('projects.urls', 'projects_api')),
        name='projects_api'
    ),

    # Optional: DRF browsable-API login/logout
    path(
        'api-auth/',
        include('rest_framework.urls', namespace='rest_framework')
    ),

    # 🟢 Serve React build at root URL
    re_path(r'^$', TemplateView.as_view(template_name="index.html")),
]













