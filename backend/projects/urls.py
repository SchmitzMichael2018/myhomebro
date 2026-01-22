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
    send_final_agreement_link_view,
)
from .views.invoice import InvoiceViewSet, InvoicePDFView
from .views.milestone import (
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
)
from .views.homeowner import HomeownerViewSet
from .views.project import ProjectViewSet

# ✅ Disputes (authenticated ViewSet + public token endpoints)
from .views.dispute import (
    DisputeViewSet,
    public_dispute_detail,
    public_dispute_accept,
    public_dispute_reject,
)

from .views.attachments import (
    AgreementAttachmentViewSet,
    AgreementAttachmentNestedView,
)
from .views.expenses import ExpenseViewSet

from .views.agreements_merge import MergeAgreementsView
from .views.calendar import MilestoneCalendarView, AgreementCalendarView
from .views.contractors.public import ContractorPublicProfileView
from .views.notifications import NotificationListView
from .views.dispute_workorders import DisputeWorkOrderViewSet

# ✅ Magic invoice endpoints (public)
from .views.magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .views.magic_invoice_pdf import MagicInvoicePDFView

from .views.contractor_me import ContractorMeView
from .views.subaccounts import ContractorSubAccountViewSet, WhoAmIView

from .views.funding import (
    SendFundingLinkView,
    PublicFundingInfoView,
    CreateFundingPaymentIntentView,
    AgreementFundingPreviewView,
    FundingReceiptView,
)

from .views.agreements_amend import create_amendment
from .views.refund import AgreementRefundCompatView

# ✅ Employee assignment + employee dashboard views
from .views.employee_assignments import (
    assign_agreement,
    unassign_agreement,
    assign_milestone,
    unassign_milestone,
)
from .views.employee_milestones import (
    my_milestones,
    milestone_detail,
    add_comment,
    upload_file,
    mark_milestone_complete,
)

# ✅ Employee profile
from .views.employee_profile import EmployeeMeProfileView

# ✅ Employee agreements
from .views.employee_agreements import (
    my_agreements,
    agreement_detail as employee_agreement_detail,
)

from .views.assignments_conflicts import check_assignment_conflicts
from .views.assignment_status import (
    agreement_assignment_status,
    milestone_assignment_status,
)
from .views.assignment_calendar import AssignmentCalendarView
from .views.subaccount_schedule import (
    subaccount_schedule,
    add_schedule_exception,
    delete_schedule_exception,
)

# ✅ Contractor Business Dashboard
from .views.business_dashboard import BusinessDashboardSummaryAPIView

# ✅ NEW: Agreement close-out / archive views
from .views.agreement_closeout import (
    AgreementClosureStatusView,
    AgreementCloseAndArchiveView,
)

# ✅ NEW: Feature flags endpoint (Django settings → frontend gating)
from .views.feature_flags import FeatureFlagsView

app_name = "projects_api"

router = DefaultRouter(trailing_slash="/?")
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
router.register(r"dispute-workorders", DisputeWorkOrderViewSet, basename="dispute-workorders")


milestone_router = NestedDefaultRouter(
    router, r"milestones", lookup="milestone", trailing_slash="/?"
)
milestone_router.register(
    r"comments", MilestoneCommentViewSet, basename="milestone-comments"
)

agreements_router = NestedDefaultRouter(
    router, r"agreements", lookup="agreement", trailing_slash="/?"
)
agreements_router.register(
    r"attachments",
    AgreementAttachmentNestedView,
    basename="agreement-attachments",
)

urlpatterns = [
    # -------------------------------------------------
    # ✅ Admin Panel (API)
    # -------------------------------------------------
    # Mounts: /api/admin/...
    path("admin/", include("adminpanel.urls")),

    # -------------------------------------------------
    # ✅ AI Disputes (advisory endpoints)
    # -------------------------------------------------
    # Mounts (under /api/projects/...):
    #   POST /api/projects/disputes/<id>/ai/recommendation/
    path("", include("projects.api.disputes_ai_urls")),

    # -------------------------------------------------
    # Agreement utilities
    # -------------------------------------------------
    path("agreements/<int:agreement_id>/pdf/", agreement_pdf),
    path("agreements/<int:pk>/milestones/", agreement_milestones),
    path("agreements/public_sign/", agreement_public_sign),
    path("agreements/public_pdf/", agreement_public_pdf),

    path(
        "agreements/<int:agreement_id>/refund/",
        AgreementRefundCompatView.as_view(),
    ),

    path(
        "agreements/<int:agreement_id>/send_final_agreement_link/",
        send_final_agreement_link_view,
    ),

    path(
        "agreements/<int:pk>/create_amendment/",
        create_amendment,
    ),

    # -------------------------------------------------
    # ✅ NEW: Agreement close-out / archive
    # -------------------------------------------------
    path(
        "agreements/<int:agreement_id>/closure_status/",
        AgreementClosureStatusView.as_view(),
    ),
    path(
        "agreements/<int:agreement_id>/close_and_archive/",
        AgreementCloseAndArchiveView.as_view(),
    ),

    # -------------------------------------------------
    # Funding
    # -------------------------------------------------
    path("agreements/<int:pk>/send_funding_link/", SendFundingLinkView.as_view()),
    path("agreements/<int:pk>/funding_preview/", AgreementFundingPreviewView.as_view()),
    path("funding/public_fund/", PublicFundingInfoView.as_view()),
    path("funding/create_payment_intent/", CreateFundingPaymentIntentView.as_view()),
    path("funding/receipt/", FundingReceiptView.as_view()),

    # -------------------------------------------------
    # Owner → employee assignment
    # -------------------------------------------------
    path("assignments/agreements/<int:agreement_id>/assign/", assign_agreement),
    path("assignments/agreements/<int:agreement_id>/unassign/", unassign_agreement),
    path("assignments/milestones/<int:milestone_id>/assign/", assign_milestone),
    path("assignments/milestones/<int:milestone_id>/unassign/", unassign_milestone),
    path("assignments/check-conflicts/", check_assignment_conflicts),

    path("assignments/agreements/<int:agreement_id>/status/", agreement_assignment_status),
    path("assignments/milestones/<int:milestone_id>/status/", milestone_assignment_status),
    path("assignments/calendar/", AssignmentCalendarView.as_view()),

    # -------------------------------------------------
    # Subaccount schedules
    # -------------------------------------------------
    path("subaccounts/<int:subaccount_id>/schedule/", subaccount_schedule),
    path("subaccounts/<int:subaccount_id>/schedule/exceptions/", add_schedule_exception),
    path(
        "subaccounts/<int:subaccount_id>/schedule/exceptions/<int:exception_id>/",
        delete_schedule_exception,
    ),

    # -------------------------------------------------
    # Employee dashboard
    # -------------------------------------------------
    path("employee/profile/", EmployeeMeProfileView.as_view()),
    path("employee/milestones/", my_milestones),
    path("employee/milestones/<int:milestone_id>/", milestone_detail),
    path("employee/milestones/<int:milestone_id>/comments/", add_comment),
    path("employee/milestones/<int:milestone_id>/files/", upload_file),
    path("employee/milestones/<int:milestone_id>/complete/", mark_milestone_complete),

    path("employee/agreements/", my_agreements),
    path("employee/agreements/<int:agreement_id>/", employee_agreement_detail),

    # -------------------------------------------------
    # Contractor dashboards
    # -------------------------------------------------
    path(
        "business/contractor/summary/",
        BusinessDashboardSummaryAPIView.as_view(),
        name="contractor_business_summary",
    ),

    # -------------------------------------------------
    # ✅ Feature Flags (Django settings → frontend gating)
    # -------------------------------------------------
    path("feature-flags/", FeatureFlagsView.as_view()),

    # -------------------------------------------------
    # ✅ Public dispute decision (token-based, no auth)
    # -------------------------------------------------
    path("disputes/public/<int:dispute_id>/", public_dispute_detail),
    path("disputes/public/<int:dispute_id>/accept/", public_dispute_accept),
    path("disputes/public/<int:dispute_id>/reject/", public_dispute_reject),

    # -------------------------------------------------
    # Misc (order matters)
    # -------------------------------------------------
    path("notifications/", NotificationListView.as_view()),
    path("contractors/me/", ContractorMeView.as_view()),

    path("milestones/calendar/", MilestoneCalendarView.as_view()),
    path("agreements/calendar/", AgreementCalendarView.as_view()),

    path("invoices/<int:pk>/pdf/", InvoicePDFView.as_view()),
    path("contractors/<int:pk>/public/", ContractorPublicProfileView.as_view()),

    path("agreements/merge/", MergeAgreementsView.as_view()),

    # -------------------------------------------------
    # Magic invoice (public)
    # -------------------------------------------------
    path("invoices/magic/<uuid:token>/", MagicInvoiceView.as_view()),
    path("invoices/magic/<uuid:token>/approve/", MagicInvoiceApproveView.as_view()),
    path("invoices/magic/<uuid:token>/dispute/", MagicInvoiceDisputeView.as_view()),
    path("invoices/magic/<uuid:token>/pdf/", MagicInvoicePDFView.as_view()),

    path("whoami/", WhoAmIView.as_view()),

    # -------------------------------------------------
    # Routers
    # -------------------------------------------------
    path("", include(router.urls)),
    path("", include(milestone_router.urls)),
    path("", include(agreements_router.urls)),
]

urlpatterns += [
    re_path(
        r"^agreements/(?P<pk>\d+)/preview_pdf/?$",
        AgreementViewSet.as_view({"get": "preview_pdf"}),
    ),
]
