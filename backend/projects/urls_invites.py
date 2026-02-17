# projects/urls_invites.py
from rest_framework.routers import DefaultRouter
from projects.views.views_invite import ContractorInviteViewSet

router = DefaultRouter()
router.register(r"invites", ContractorInviteViewSet, basename="invites")

urlpatterns = router.urls
