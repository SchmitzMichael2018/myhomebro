from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
ContractorViewSet,
ProjectViewSet,
AgreementViewSet,
InvoiceViewSet,
MessageViewSet,
MilestoneViewSet,
ExpenseViewSet,
MilestoneFileViewSet,
lookup_homeowner,
AIChatView,
ContractorOnboardingView,
AgreementCalendarView,
MilestoneCalendarView,
MagicAccessView,
AgreementSignView,
AgreementSignSuccessView,
MagicFundEscrowView,
AgreementMagicPdfView, 
)

router = DefaultRouter()
router.register(r'contractors',    ContractorViewSet,    basename='contractor')
router.register(r'projects',       ProjectViewSet,       basename='project')
router.register(r'agreements',     AgreementViewSet,     basename='agreement')
router.register(r'milestones',     MilestoneViewSet,     basename='milestone')
router.register(r'invoices',       InvoiceViewSet,       basename='invoice')
router.register(r'messages',       MessageViewSet,       basename='message')
router.register(r'milestone-files',MilestoneFileViewSet, basename='milestone-file')

urlpatterns = [
# 1) Contractor onboarding
path(
    'contractors/onboard/',
    ContractorOnboardingView.as_view(),
    name='contractor-onboarding'
),

# 2) Homeowner lookup
path(
    'homeowners/lookup/',
    lookup_homeowner,
    name='homeowner-lookup'
),

# 3) AI-chat endpoint
path(
    'ai-chat/',
    AIChatView.as_view(),
    name='ai-chat'
),

# 4) Calendar endpoints (pre-router)
path(
    'agreements/calendar/',
    AgreementCalendarView.as_view(),
    name='agreement-calendar'
),
path(
    'milestones/calendar/',
    MilestoneCalendarView.as_view(),
    name='milestone-calendar'
),

# 5) Nested expenses under an agreement
path(
    'agreements/<int:agreement_id>/expenses/',
    ExpenseViewSet.as_view({'get': 'list', 'post': 'create'}),
    name='agreement-expenses-list'
),
path(
    'agreements/<int:agreement_id>/expenses/<int:pk>/',
    ExpenseViewSet.as_view({
        'get': 'retrieve',
        'put': 'update',
        'patch': 'partial_update',
        'delete': 'destroy'
    }),
    name='agreement-expenses-detail'
),

# 6) Magic-link endpoints (must come before router)
path(
    'agreements/access/<uuid:token>/',
    MagicAccessView.as_view(),
    name='agreement-magic-access'
),

 path(
        "agreements/access/<uuid:token>/pdf/",
        AgreementMagicPdfView.as_view(),
        name="agreement-magic-pdf",
    ),
    
path(
    'agreements/access/<uuid:token>/sign/',
    AgreementSignView.as_view(),
    name='agreement-sign-page'
),
path(
    'agreements/access/<uuid:token>/signed-success/',
    AgreementSignSuccessView.as_view(),
    name='agreement-sign-success'
),

path(
    'agreements/access/<uuid:token>/fund_escrow/',
    MagicFundEscrowView.as_view(),
    name='agreement-magic-fund-escrow'
),

# 7) Standard ViewSet routes
path('', include(router.urls)),
]
