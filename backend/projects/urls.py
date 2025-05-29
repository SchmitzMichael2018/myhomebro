from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ContractorViewSet,
    ProjectViewSet,
    AgreementViewSet,
    InvoiceViewSet,
    MessageViewSet,
    lookup_homeowner,
    AIChatView,
    ContractorOnboardingView,
)

router = DefaultRouter()
router.register(r'contractors', ContractorViewSet, basename='contractor')
router.register(r'agreements', AgreementViewSet, basename='agreement')
router.register(r'invoices', InvoiceViewSet, basename='invoice')
router.register(r'messages', MessageViewSet, basename='message')
router.register(r'projects', ProjectViewSet, basename='project')

urlpatterns = [
    path('', include(router.urls)),
    # Stripe Connect Onboarding (POST only)
    path('contractors/onboard/', ContractorOnboardingView.as_view(), name='contractor-onboarding'),

    # Homeowner lookup endpoint (by email)
    path('homeowners/lookup/', lookup_homeowner, name='homeowner-lookup'),

    # AI Chat Endpoint
    path('ai-chat/', AIChatView.as_view(), name='ai-chat'),
]















