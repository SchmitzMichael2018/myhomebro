# backend/projects/api_router.py

from rest_framework.routers import DefaultRouter

from .viewsets import HomeownerViewSet
from .views.project_intake import ProjectIntakeViewSet


def build_projects_router() -> DefaultRouter:
    """
    Register all public project API endpoints here once, then mount the router
    under multiple URL prefixes (e.g., /api/projects/ and /api/).
    """

    router = DefaultRouter()

    # ─────────────────────────────────────────────────────────
    # Homeowners (customers)
    # ─────────────────────────────────────────────────────────
    router.register(
        r'homeowners',
        HomeownerViewSet,
        basename='homeowner'
    )

    # ─────────────────────────────────────────────────────────
    # Project Intake
    # ─────────────────────────────────────────────────────────
    router.register(
        r'intakes',
        ProjectIntakeViewSet,
        basename='project-intake'
    )

    # Optional legacy alias so older UIs can still call /customers/
    # router.register(r'customers', CustomerViewSet, basename='customer')

    return router