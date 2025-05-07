from django.urls import path

urlpatterns = [
    # Contractor-related endpoints will go here
]
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ContractorViewSet

router = DefaultRouter()
router.register(r'contractors', ContractorViewSet)

urlpatterns = [
    path('api/', include(router.urls)),
]
