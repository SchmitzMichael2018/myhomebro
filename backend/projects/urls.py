# projects/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter

from .views import (
    ContractorViewSet,
    ProjectViewSet,
    AgreementViewSet,
    InvoiceViewSet,
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
    ExpenseViewSet,
    AIChatView,
    ContractorOnboardingView,
    AgreementCalendarView,
    MilestoneCalendarView,
    MagicAccessView,
    AgreementSignView,
    AgreementSignSuccessView,
    MagicFundEscrowView,
    AgreementMagicPdfView,
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)

router = DefaultRouter()
router.register(r'contractors',     ContractorViewSet,    basename='contractor')
router.register(r'projects',        ProjectViewSet,       basename='project')
router.register(r'agreements',      AgreementViewSet,     basename='agreement')
router.register(r'milestones',      MilestoneViewSet,     basename='milestone')
router.register(r'invoices',        InvoiceViewSet,       basename='invoice')
router.register(r'milestone-files', MilestoneFileViewSet, basename='milestone-file')
router.register(
    r'milestone-comments',
    MilestoneCommentViewSet,
    basename='milestone-comments'
)

# Nested comments under /milestones/{pk}/comments/
milestone_router = NestedDefaultRouter(router, r'milestones', lookup='milestone')
milestone_router.register(
    r'comments',
    MilestoneCommentViewSet,
    basename='milestone-comments'
)

urlpatterns = [
    # DRF browsable‐api login/logout
    path('api-auth/', include(('rest_framework.urls', 'rest_framework')), name='rest_framework'),

    # ─── Public “magic‐link” invoice endpoints ────────────────────
    # These must come *before* the router registration for 'invoices'
    path(
        'invoices/<int:pk>/',
        MagicInvoiceView.as_view(),
        name='magic-invoice-detail'
    ),
    path(
        'invoices/<int:pk>/approve/',
        MagicInvoiceApproveView.as_view(),
        name='magic-invoice-approve'
    ),
    path(
        'invoices/<int:pk>/dispute/',
        MagicInvoiceDisputeView.as_view(),
        name='magic-invoice-dispute'
    ),

    # ─── Contractor onboarding
    path(
        'contractors/onboard/',
        ContractorOnboardingView.as_view(),
        name='contractor-onboarding'
    ),

    # ─── AI chat
    path(
        'ai-chat/',
        AIChatView.as_view(),
        name='ai-chat'
    ),

    # ─── Calendar endpoints
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

    # ─── Expenses nested under agreement
    path(
        'agreements/<int:agreement_id>/expenses/',
        ExpenseViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='agreement-expenses-list'
    ),
    path(
        'agreements/<int:agreement_id>/expenses/<int:pk>/',
        ExpenseViewSet.as_view({
            'get':    'retrieve',
            'put':    'update',
            'patch':  'partial_update',
            'delete': 'destroy'
        }),
        name='agreement-expenses-detail'
    ),

    # ─── Public agreement magic link
    path(
        'agreements/access/<uuid:token>/',
        MagicAccessView.as_view(),
        name='agreement-magic-access'
    ),
    path(
        'agreements/access/<uuid:token>/pdf/',
        AgreementMagicPdfView.as_view(),
        name='agreement-magic-pdf'
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

    # ─── Finally include all of the router’s own endpoints
    path('', include(router.urls)),
    path('', include(milestone_router.urls)),
]
