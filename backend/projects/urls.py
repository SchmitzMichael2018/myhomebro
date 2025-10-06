# backend/projects/urls.py
from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter

from .views.agreements import (
    AgreementViewSet,
    agreement_pdf,
    signing_preview,
    agreement_milestones,
)
from .views.invoice import InvoiceViewSet, InvoicePDFView
from .views.milestone import (
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
)
from .views.contractor import ContractorViewSet, ContractorLicenseUploadView
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
from .views.public_sign import (
    MagicAccessView,
    AgreementSignView,
    AgreementSignSuccessView,
    AgreementMagicPdfView,
    MagicFundEscrowView,
)
from .views.magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .views.stripe_onboarding import (
    ContractorOnboardingView,
    ContractorOnboardingStatusView,
)
from .views.account import ChangePasswordView
from .views.contractor_me import ContractorMeView

# Optional debug (guarded)
try:
    from .views.debug import env_debug
    HAS_DEBUG = True
except Exception:
    HAS_DEBUG = False

app_name = "projects_api"

# -----------------------------------------------------------------------------------
# Routers with OPTIONAL trailing slash to prevent 404 on `/attachments` (no slash)
# -----------------------------------------------------------------------------------
router = DefaultRouter(trailing_slash='/?')
router.register(r"contractors", ContractorViewSet, basename="contractors")
router.register(r"homeowners", HomeownerViewSet, basename="homeowners")
router.register(r"projects", ProjectViewSet, basename="projects")
router.register(r"agreements", AgreementViewSet, basename="agreements")
router.register(r"invoices", InvoiceViewSet, basename="invoices")
router.register(r"milestones", MilestoneViewSet, basename="milestones")
router.register(r"milestone-files", MilestoneFileViewSet, basename="milestone-files")
router.register(r"disputes", DisputeViewSet, basename="disputes")
router.register(r"expenses", ExpenseViewSet, basename="expenses")

# ✅ Flat attachments route (GET/POST works with or without trailing slash)
router.register(r"attachments", AgreementAttachmentViewSet, basename="attachments")

# Nested routers (also optional trailing slash)
milestone_router = NestedDefaultRouter(router, r"milestones", lookup="milestone", trailing_slash='/?')
milestone_router.register(r"comments", MilestoneCommentViewSet, basename="milestone-comments")

agreements_router = NestedDefaultRouter(router, r"agreements", lookup="agreement", trailing_slash='/?')
agreements_router.register(
    r"attachments",
    AgreementAttachmentNestedView,
    basename="agreement-attachments",
)

urlpatterns = [
    # ── Function-view endpoints ─────────────────────────────────────────────
    path("agreements/<int:pk>/milestones/", agreement_milestones, name="agreement-milestones"),

    # ── Core REST routers ──────────────────────────────────────────────────
    path("", include(router.urls)),
    path("", include(milestone_router.urls)),
    path("", include(agreements_router.urls)),

    # ── Optional debug ─────────────────────────────────────────────────────
    *([path("debug/env/", env_debug, name="projects-env-debug")] if HAS_DEBUG else []),

    # ── Notifications / profile / calendars ────────────────────────────────
    path("notifications/", NotificationListView.as_view(), name="notifications"),
    path("contractors/me/", ContractorMeView.as_view(), name="contractor-me"),
    path(
        "contractors/license-upload/",
        ContractorLicenseUploadView.as_view({"post": "create"}),
        name="contractor-license-upload",
    ),
    path("milestones/calendar/", MilestoneCalendarView.as_view(), name="milestones-calendar"),
    path("agreements/calendar/", AgreementCalendarView.as_view(), name="agreements-calendar"),

    # ── PDFs ────────────────────────────────────────────────────────────────
    path("agreements/<int:agreement_id>/pdf/", agreement_pdf, name="agreement-pdf"),
    path("invoices/<int:pk>/pdf/", InvoicePDFView.as_view(), name="invoice-pdf"),

    # ── Public signing preview ─────────────────────────────────────────────
    path("signing/agreements/<int:pk>/preview/", signing_preview, name="agreement-signing-preview"),

    # ── Public contractor profile ──────────────────────────────────────────
    path("contractors/<int:pk>/public/", ContractorPublicProfileView.as_view(), name="contractor-public-profile"),

    # ── Magic links + tools ────────────────────────────────────────────────
    path("agreements/merge/", MergeAgreementsView.as_view(), name="agreements-merge"),
    path("agreements/access/<uuid:token>/",       MagicAccessView.as_view(),       name="agreement-magic-access"),
    path("agreements/access/<uuid:token>/pdf/",   AgreementMagicPdfView.as_view(), name="agreement-magic-pdf"),
    path("agreements/access/<uuid:token>/sign/",  AgreementSignView.as_view(),     name="agreement-sign-page"),
    path("agreements/access/<uuid:token>/signed-success/", AgreementSignSuccessView.as_view(), name="agreement-sign-success"),
    path("agreements/access/<uuid:token>/fund-escrow/",    MagicFundEscrowView.as_view(),      name="agreement-magic-fund-escrow"),

    path("invoices/magic/<int:pk>/",          MagicInvoiceView.as_view(),        name="magic-invoice-detail"),
    path("invoices/magic/<int:pk>/approve/",  MagicInvoiceApproveView.as_view(), name="magic-invoice-approve"),
    path("invoices/magic/<int:pk>/dispute/",  MagicInvoiceDisputeView.as_view(), name="magic-invoice-dispute"),

    path("contractor-onboarding/",        ContractorOnboardingView.as_view(),       name="contractor-onboarding"),
    path("contractor-onboarding-status/", ContractorOnboardingStatusView.as_view(), name="contractor-onboarding-status"),
]

# ── Preview PDF explicit route ─────────────────────────────────────────────
# Map GET to the viewset action so the front end's GET /preview_pdf/ works.
urlpatterns += [
    re_path(
        r"^agreements/(?P<pk>\d+)/preview_pdf/?$",
        AgreementViewSet.as_view({"get": "preview_pdf"}),  # ← changed from {"post": "preview_pdf"}
        name="agreement-preview-pdf",
    ),
]
