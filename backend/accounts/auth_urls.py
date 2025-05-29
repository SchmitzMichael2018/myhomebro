"""
accounts/auth_urls.py

JWT-based authentication routes for the accounts app.
"""

# accounts/auth_urls.py

from django.urls import path
from .token_views import EmailTokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView

app_name = "auth"

urlpatterns = [
    # POST /api/auth/login/   → { access, refresh }
    path('login/',   EmailTokenObtainPairView.as_view(), name='login'),

    # POST /api/auth/refresh/ → { access }
    path('refresh/', TokenRefreshView.as_view(),    name='refresh'),
]