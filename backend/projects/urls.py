from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ContractorViewSet,
    AgreementViewSet,
    InvoiceViewSet,
    ProjectViewSet,
    lookup_homeowner  # ✅ Include the lookup view
)

router = DefaultRouter()
router.register(r'contractors', ContractorViewSet)
router.register(r'agreements', AgreementViewSet)
router.register(r'invoices', InvoiceViewSet)
router.register(r'projects', ProjectViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('homeowners/lookup/', lookup_homeowner, name='homeowner-lookup'),
]






