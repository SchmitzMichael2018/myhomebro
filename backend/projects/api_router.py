# backend/projects/api_router.py
from rest_framework.routers import DefaultRouter
from .viewsets import HomeownerViewSet  # adjust import to your actual module
# If you also support a legacy "Customer" concept, import its viewset too:
# from .viewsets import CustomerViewSet

def build_projects_router() -> DefaultRouter:
    """
    Register all public project API endpoints here once, then mount the router
    under multiple URL prefixes (e.g., /api/projects/ and /api/).
    """
    router = DefaultRouter()
    # Primary, current endpoint
    router.register(r'homeowners', HomeownerViewSet, basename='homeowner')

    # Optional legacy alias so older UIs can still call /customers/
    # If you don't have a separate Customer model, you can point this
    # to the same HomeownerViewSet, or comment it out.
    # router.register(r'customers', CustomerViewSet, basename='customer')

    return router
