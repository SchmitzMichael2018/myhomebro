from django.contrib import admin
from django.urls import path, include

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
]












