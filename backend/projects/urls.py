# backend/projects/urls.py
from __future__ import annotations

from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter

from .views.agreements import (
    AgreementViewSet,
    agreement_pdf,
    agreement_milestones,
    agreement_public_sign,
    agreement_public_pdf,
)
from .views.invoice import InvoiceViewSet, InvoicePDFView
from .views.milestone import (
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
)
from .views.homeowner import HomeownerViewSet
from .views.project import ProjectViewSet
from .views.dispute import DisputeViewSet
from .views.attachments import (
    AgreementAttachmentViewSet,
    AgreementAttachmentNestedView,
)
from .views.expenses import ExpenseViewSet

from .views.agreements_merge import MergeAgreementsView
from .views.calendar import MilestoneCalendarView, AgreementCalendarView
from .views.contractors.public import ContractorPublicProfileView
from .views.notifications import NotificationListView
from .views.magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .views.account import ChangePasswordView
from .views.contractor_me import ContractorMeView

from .views_pdf import preview_signed

from .views.subaccounts import ContractorSubAccountViewSet, WhoAmIView

from .views.funding import (
    SendFundingLinkView,
    PublicFundingInfoView,
    CreateFundingPaymentIntentView,
    AgreementFundingPreviewView,
)

# NEW – manual amendment endpoint
from .views.agreements_amend import create_amendment

try:
    from .views.debug import env_debug
    HAS_DEBUG = True
except Exception:
    HAS_DEBUG = False

app_name = "projects_api"

router = DefaultRouter(trailing_slash='/?')
router.register(r"homeowners", HomeownerViewSet, basename="homeowners")
router.register(r"projects", ProjectViewSet, basename="projects")
router.register(r"agreements", AgreementViewSet, basename="agreements")
router.register(r"invoices", InvoiceViewSet, basename="invoices")
router.register(r"milestones", MilestoneViewSet, basename="milestones")
router.register(r"milestone-files", MilestoneFileViewSet, basename="milestone-files")
router.register(r"disputes", DisputeViewSet, basename="disputes")
router.register(r"expenses", ExpenseViewSet, basename="expenses")
router.register(r"attachments", AgreementAttachmentViewSet, basename="attachments")
router.register(r"subaccounts", ContractorSubAccountViewSet, basename="subaccounts")

milestone_router = NestedDefaultRouter(
    router, r"milestones", lookup="milestone", trailing_slash='/?'
)
milestone_router.register(
    r"comments", MilestoneCommentViewSet, basename="milestone-comments"
)

agreements_router = NestedDefaultRouter(
    router, r"agreements", lookup="agreement", trailing_slash='/?'
)
agreements_router.register(
    r"attachments",
    AgreementAttachmentNestedView,
    basename="agreement-attachments",
)

urlpatterns = [
    # Function-view endpoints
    path(
        "agreements/<int:agreement_id>/pdf/",
        agreement_pdf,
        name="agreement-pdf",
    ),
    path(
        "agreements/<int:pk>/milestones/",
        agreement_milestones,
        name="agreement-milestones",
    ),
    path("agreements/public_sign/", agreement_public_sign),
    path("agreements/public_pdf/", agreement_public_pdf),

    # NEW – Manual amendment endpoint
    path(
        "agreements/<int:pk>/create_amendment/",
        create_amendment,
        name="agreement-create-amendment",
    ),

    # Funding endpoints
    path(
        "agreements/<int:pk>/send_funding_link/",
        SendFundingLinkView.as_view(),
        name="agreement-send-funding-link",
    ),
    path(
        "agreements/<int:pk>/funding_preview/",
        AgreementFundingPreviewView.as_view(),
        name="agreement-funding-preview",
    ),
    path(
        "funding/public_fund/",
        PublicFundingInfoView.as_view(),
        name="public-funding-info",
    ),
    path(
        "funding/create_payment_intent/",
        CreateFundingPaymentIntentView.as_view(),
        name="funding-create-payment-intent",
    ),

    # Routers
    path("", include(router.urls)),
    path("", include(milestone_router.urls)),
    path("", include(agreements_router.urls)),

    # Debug
    *(
        [path("debug/env/", env_debug, name="projects-env-debug")]
        if HAS_DEBUG
        else []
    ),

    # Notifications / profile / calendars
    path("notifications/", NotificationListView.as_view(), name="notifications"),
    path("contractors/me/", ContractorMeView.as_view(), name="contractor-me"),
    path(
        "milestones/calendar/",
        MilestoneCalendarView.as_view(),
        name="milestones-calendar",
    ),
    path(
        "agreements/calendar/",
        AgreementCalendarView.as_view(),
        name="agreements-calendar",
    ),

    # Invoice PDF
    path("invoices/<int:pk>/pdf/", InvoicePDFView.as_view(), name="invoice-pdf"),

    # Public contractor profile
    path(
        "contractors/<int:pk>/public/",
        ContractorPublicProfileView.as_view(),
        name="contractor-public-profile",
    ),

    # Magic invoice links
    path(
        "agreements/merge/",
        MergeAgreementsView.as_view(),
        name="agreements-merge",
    ),
    path(
        "invoices/magic/<int:pk>/",
        MagicInvoiceView.as_view(),
        name="magic-invoice-detail",
    ),
    path(
        "invoices/magic/<int:pk>/approve/",
        MagicInvoiceApproveView.as_view(),
        name="magic-invoice-approve",
    ),
    path(
        "invoices/magic/<int:pk>/dispute/",
        MagicInvoiceDisputeView.as_view(),
        name="magic-invoice-dispute",
    ),

    # whoami
    path("whoami/", WhoAmIView.as_view(), name="projects-whoami"),
]

urlpatterns += [
    re_path(
        r"^agreements/(?P<pk>\d+)/preview_pdf/?$",
        AgreementViewSet.as_view({"get": "preview_pdf"}),
        name="agreement-preview-pdf",
    ),
]
