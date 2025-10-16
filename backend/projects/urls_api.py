# backend/projects/urls_api.py
from django.urls import path, include
from .api_router import build_projects_router

router = build_projects_router()

urlpatterns = [
    path('', include(router.urls)),
]
