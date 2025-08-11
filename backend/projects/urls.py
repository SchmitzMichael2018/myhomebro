from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter  # type: ignore

# --- Imports ---
from .views.calendar import AgreementCalendarView, MilestoneCalendarView
from .views.contractor import ContractorViewSet
from .views.homeowner import HomeownerViewSet
from .views.project import ProjectViewSet
from .views.agreements import AgreementViewSet, agreement_pdf
from .views.invoice import InvoiceViewSet, InvoicePDFView
from .views.milestone import MilestoneViewSet, MilestoneFileViewSet, MilestoneCommentViewSet
from .views.expense import ExpenseViewSet
from .views.contractors.public import ContractorPublicProfileView
from .views.notifications import NotificationListView
from .views.public_sign import (
    MagicAccessView, AgreementSignView, AgreementSignSuccessView,
    AgreementMagicPdfView, MagicFundEscrowView
)
from .views.magic_invoice import (
    MagicInvoiceView, MagicInvoiceApproveView, MagicInvoiceDisputeView,
)
from .views.stripe_onboarding import ContractorOnboardingView, ContractorOnboardingStatusView


# --- Router Configuration ---
router = DefaultRouter()
router.register(r'contractors', ContractorViewSet, basename='contractor')
router.register(r'homeowners', HomeownerViewSet, basename='homeowner')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'agreements', AgreementViewSet, basename='agreement')
router.register(r'invoices', InvoiceViewSet, basename='invoice')
router.register(r'milestones', MilestoneViewSet, basename='milestone')
router.register(r'milestone-files', MilestoneFileViewSet, basename='milestone-file')

# --- Nested Routers ---
agreement_router = NestedDefaultRouter(router, r'agreements', lookup='agreement')
agreement_router.register(r'expenses', ExpenseViewSet, basename='agreement-expenses')

milestone_router = NestedDefaultRouter(router, r'milestones', lookup='milestone')
milestone_router.register(r'comments', MilestoneCommentViewSet, basename='milestone-comments')

# --- URL Patterns ---
app_name = "projects_api"

urlpatterns = [

    path('notifications/', NotificationListView.as_view(), name='notifications'),

    # Standalone & Calendar
    path('agreements/calendar/', AgreementCalendarView.as_view(), name='agreement-calendar'),
    path('milestones/calendar/', MilestoneCalendarView.as_view(), name='milestone-calendar'),

    # PDF endpoints
    path('agreements/<int:agreement_id>/pdf/', agreement_pdf, name='agreement-pdf'),
    path('invoices/<int:pk>/pdf/', InvoicePDFView.as_view(), name='invoice-pdf'),

    # Public contractor profiles
    path('contractors/<int:pk>/public/', ContractorPublicProfileView.as_view(), name='contractor-public-profile'),

    # Magic Agreement Access
    path('agreements/access/<uuid:token>/', MagicAccessView.as_view(), name='agreement-magic-access'),
    path('agreements/access/<uuid:token>/pdf/', AgreementMagicPdfView.as_view(), name='agreement-magic-pdf'),
    path('agreements/access/<uuid:token>/sign/', AgreementSignView.as_view(), name='agreement-sign-page'),
    path('agreements/access/<uuid:token>/signed-success/', AgreementSignSuccessView.as_view(), name='agreement-sign-success'),
    path('agreements/access/<uuid:token>/fund-escrow/', MagicFundEscrowView.as_view(), name='agreement-magic-fund-escrow'),

    # Magic Invoice Access
    path('invoices/magic/<int:pk>/', MagicInvoiceView.as_view(), name='magic-invoice-detail'),
    path('invoices/magic/<int:pk>/approve/', MagicInvoiceApproveView.as_view(), name='magic-invoice-approve'),
    path('invoices/magic/<int:pk>/dispute/', MagicInvoiceDisputeView.as_view(), name='magic-invoice-dispute'),

    # Stripe Onboarding
    path('contractor-onboarding/', ContractorOnboardingView.as_view(), name='contractor-onboarding'),
    path('contractor-onboarding-status/', ContractorOnboardingStatusView.as_view(), name='contractor-onboarding-status'),

    # Routers
    path('', include(router.urls)),
    path('', include(agreement_router.urls)),
    path('', include(milestone_router.urls)),
]
