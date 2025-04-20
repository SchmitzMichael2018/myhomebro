from django.urls import path, include
from rest_framework.routers import DefaultRouter
from accounts.token_views import EmailTokenObtainPairView
from .views import (
    ProjectListCreateView,
    AgreementListCreateView,
    InvoiceListCreateView,
    ContractorViewSet,AgreementViewSet,InvoiceViewSet
)

router = DefaultRouter()
router.register(r'agreements', AgreementViewSet, basename='agreement')
router.register(r'contractors', ContractorViewSet, basename='contractor')
router.register(r'invoices', InvoiceViewSet, basename='invoice')

urlpatterns = [
    path('', include(router.urls)),
    path('projects/', ProjectListCreateView.as_view(), name='project-list-create'),
    path('agreements/', AgreementListCreateView.as_view(), name='agreement-list-create'),
    path('invoices/', InvoiceListCreateView.as_view(), name='invoice-list-create'),


    # Updated JWT login
    path('api/token/', EmailTokenObtainPairView.as_view(), name='token_obtain_pair'),
]


