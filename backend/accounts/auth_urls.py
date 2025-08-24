# backend/accounts/auth_urls.py

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import EmailLoginView

urlpatterns = [
    # POST /api/auth/login/
    path("login/", EmailLoginView.as_view(), name="jwt_email_login"),
    # POST /api/auth/refresh/
    path("refresh/", TokenRefreshView.as_view(), name="jwt_refresh"),
]
