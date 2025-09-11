# backend/accounts/auth_urls.py
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import EmailLoginView, ContractorRegistrationView

app_name = "auth"

urlpatterns = [
    path("login/",   EmailLoginView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("register/", ContractorRegistrationView.as_view(), name="register"),
]
