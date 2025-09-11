# backend/projects/urls_homeowners.py
from rest_framework.routers import DefaultRouter
from projects.views.homeowner import HomeownerViewSet  # <-- singular module

router = DefaultRouter()
router.register(r"homeowners", HomeownerViewSet, basename="homeowners")

urlpatterns = router.urls
