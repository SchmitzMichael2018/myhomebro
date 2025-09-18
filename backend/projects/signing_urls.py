# backend/projects/signing_urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from projects.views.signing import AgreementSigningViewSet

router = DefaultRouter()
router.register(r"agreements", AgreementSigningViewSet, basename="agreement-signing")

urlpatterns = [
    path("", include(router.urls)),
]
