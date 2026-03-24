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
from .views.invoice_direct_pay_email import invoice_email_direct_pay_link

from .views.milestone import (
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
)
from .views.homeowner import HomeownerViewSet
from .views.project import ProjectViewSet

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

from .views.agreements_merge import MergeAgreementsView
from .views.calendar import MilestoneCalendarView, AgreementCalendarView
from .views.contractors.public import ContractorPublicProfileView
from .views.notifications import NotificationListView
from .views.dispute_workorders import DisputeWorkOrderViewSet

from .views.magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .views.magic_invoice_pdf import MagicInvoicePDFView

from .views.public_intake import PublicIntakeView
from .views.public_intake_start import PublicIntakeStartView

from .views.contractor_me import ContractorMeView
from .views.subaccounts import ContractorSubAccountViewSet, WhoAmIView

from .views.funding import (
    SendFundingLinkView,
    PublicFundingInfoView,
    CreateFundingPaymentIntentView,
    AgreementFundingPreviewView,
    FundingReceiptView,
)

from .views_template import (
    TemplateListCreateView,
    TemplateDetailView,
    ApplyTemplateToAgreementView,
    SaveAgreementAsTemplateView,
    TemplateGenerateMaterialsView,
)

from .views.template_views import (
    TemplateSuggestPricingView,
    TemplateApplyPricingView,
    TemplateImproveDescriptionView,
    TemplateSuggestTypeSubtypeView,
    TemplateCreateFromScopeView,
)

from .views.agreements_amend import create_amendment
from .views.refund import AgreementRefundCompatView

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

from .views.employee_profile import EmployeeMeProfileView

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

from .views.business_dashboard import BusinessDashboardSummaryAPIView
from .views.contractor_operations import ContractorOperationsDashboardView
from .views.expense_requests import ExpenseRequestViewSet
from .views.subcontractor_invitations import (
    AgreementSubcontractorInvitationsView,
    RevokeSubcontractorInvitationView,
    SubcontractorInvitationAcceptView,
)
from .views.subcontractor_work import (
    my_assigned_subcontractor_work,
    subcontractor_milestone_comments,
    subcontractor_milestone_detail,
    subcontractor_milestone_files,
    subcontractor_submit_completion,
    subcontractor_request_review,
)
from .views.subcontractor_payouts import (
    ExecuteMilestonePayoutView,
    ResetMilestonePayoutView,
    RetryMilestonePayoutView,
    SubcontractorPayoutAccountManageView,
    SubcontractorPayoutAccountStartView,
    SubcontractorPayoutAccountStatusView,
)
from .views.payout_history import (
    ContractorPayoutHistoryExportView,
    ContractorPayoutHistoryView,
)
from .views.milestone_workflow import (
    approve_work_submission,
    reviewer_queue,
    send_back_work_submission,
    submit_work_for_review,
)

from .views.agreement_closeout import (
    AgreementClosureStatusView,
    AgreementCloseAndArchiveView,
)

from .views.invoice_direct_pay import invoice_create_direct_pay_link

from projects.api.ai_agreement_views import (
    ai_agreement_description,
    ai_suggest_milestones,
    ai_refresh_pricing_estimate,
    ai_draft_project,
)

from .views_template_recommend import TemplateRecommendView
from .views.project_taxonomy import ProjectTypeViewSet, ProjectSubtypeViewSet
from .views.warranty import AgreementWarrantyViewSet

app_name = "projects_api"

router = DefaultRouter(trailing_slash="/?")
router.register(r"homeowners", HomeownerViewSet, basename="homeowners")
router.register(r"projects", ProjectViewSet, basename="projects")
router.register(r"agreements", AgreementViewSet, basename="agreements")
router.register(r"invoices", InvoiceViewSet, basename="invoices")
router.register(r"milestones", MilestoneViewSet, basename="milestones")
router.register(r"milestone-files", MilestoneFileViewSet, basename="milestone-files")
router.register(r"disputes", DisputeViewSet, basename="disputes")
router.register(r"expense-requests", ExpenseRequestViewSet, basename="expense-requests")
router.register(r"attachments", AgreementAttachmentViewSet, basename="attachments")
router.register(r"subaccounts", ContractorSubAccountViewSet, basename="subaccounts")
router.register(r"dispute-workorders", DisputeWorkOrderViewSet, basename="dispute-workorders")
router.register(r"project-types", ProjectTypeViewSet, basename="project-types")
router.register(r"project-subtypes", ProjectSubtypeViewSet, basename="project-subtypes")
router.register(r"warranties", AgreementWarrantyViewSet, basename="warranties")

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
    # Admin Panel
    # -------------------------------------------------
    path("admin/", include("adminpanel.urls")),

    # -------------------------------------------------
    # AI Disputes
    # -------------------------------------------------
    path("", include("projects.api.disputes_ai_urls")),

    # -------------------------------------------------
    # Project Templates
    # -------------------------------------------------
    path("templates/", TemplateListCreateView.as_view(), name="template-list-create"),
    path("templates/recommend/", TemplateRecommendView.as_view(), name="template-recommend"),
    path("templates/<int:pk>/", TemplateDetailView.as_view(), name="template-detail"),
    path(
        "templates/<int:pk>/suggest_pricing/",
        TemplateSuggestPricingView.as_view(),
        name="template-suggest-pricing",
    ),
    path(
        "templates/<int:pk>/apply_pricing/",
        TemplateApplyPricingView.as_view(),
        name="template-apply-pricing",
    ),
    path(
        "templates/ai/improve-description/",
        TemplateImproveDescriptionView.as_view(),
        name="template-ai-improve-description",
    ),
    path(
        "templates/ai/suggest-type-subtype/",
        TemplateSuggestTypeSubtypeView.as_view(),
        name="template-ai-suggest-type-subtype",
    ),
    path(
        "templates/ai/create-from-scope/",
        TemplateCreateFromScopeView.as_view(),
        name="template-ai-create-from-scope",
    ),
    path(
        "templates/ai/generate-materials/",
        TemplateGenerateMaterialsView.as_view(),
        name="template-ai-generate-materials",
    ),
    path(
        "agreements/<int:agreement_id>/apply-template/",
        ApplyTemplateToAgreementView.as_view(),
        name="agreement-apply-template",
    ),
    path(
        "agreements/<int:agreement_id>/save-as-template/",
        SaveAgreementAsTemplateView.as_view(),
        name="agreement-save-as-template",
    ),

    # -------------------------------------------------
    # Direct Pay
    # -------------------------------------------------
    path("invoices/<int:pk>/direct_pay_link/", invoice_create_direct_pay_link),
    path("invoices/<int:pk>/direct_pay_email/", invoice_email_direct_pay_link),

    # -------------------------------------------------
    # Agreement utilities
    # -------------------------------------------------
    path("agreements/<int:agreement_id>/pdf/", agreement_pdf),
    path("agreements/<int:pk>/milestones/", agreement_milestones),
    path("agreements/public_sign/", agreement_public_sign),
    path("agreements/public_pdf/", agreement_public_pdf),

    # -------------------------------------------------
    # Agreement AI
    # -------------------------------------------------
    path("agreements/ai/description/", ai_agreement_description),
    path("agreements/ai/draft/", ai_draft_project),
    path("agreements/<int:agreement_id>/ai/suggest-milestones/", ai_suggest_milestones),
    path("agreements/<int:agreement_id>/ai/refresh-pricing-estimate/", ai_refresh_pricing_estimate),
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
    # Agreement close-out / archive
    # -------------------------------------------------
    path(
        "agreements/<int:agreement_id>/closure_status/",
        AgreementClosureStatusView.as_view(),
    ),
    path(
        "agreements/<int:agreement_id>/close_and_archive/",
        AgreementCloseAndArchiveView.as_view(),
    ),
    path(
        "agreements/<int:agreement_id>/subcontractor-invitations/",
        AgreementSubcontractorInvitationsView.as_view(),
        name="agreement-subcontractor-invitations",
    ),
    path(
        "agreements/<int:agreement_id>/subcontractor-invitations/<int:invitation_id>/revoke/",
        RevokeSubcontractorInvitationView.as_view(),
        name="revoke-subcontractor-invitation",
    ),
    path(
        "subcontractor-invitations/accept/<str:token>/",
        SubcontractorInvitationAcceptView.as_view(),
        name="subcontractor-invitation-accept",
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
    # Public Intake
    # -------------------------------------------------
    path("public-intake/", PublicIntakeView.as_view()),
    path("public-intake/start/", PublicIntakeStartView.as_view()),

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
    path("subcontractor/milestones/my-assigned/", my_assigned_subcontractor_work),
    path("subcontractor/payout-account/status/", SubcontractorPayoutAccountStatusView.as_view()),
    path("subcontractor/payout-account/start/", SubcontractorPayoutAccountStartView.as_view()),
    path("subcontractor/payout-account/manage/", SubcontractorPayoutAccountManageView.as_view()),
    path(
        "subcontractor/milestones/<int:milestone_id>/",
        subcontractor_milestone_detail,
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/comments/",
        subcontractor_milestone_comments,
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/files/",
        subcontractor_milestone_files,
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/request-review/",
        subcontractor_request_review,
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/submit-completion/",
        subcontractor_submit_completion,
    ),
    path("milestones/reviewer-queue/", reviewer_queue),
    path("milestones/<int:milestone_id>/submit-work/", submit_work_for_review),
    path("milestones/<int:milestone_id>/approve-work/", approve_work_submission),
    path("milestones/<int:milestone_id>/send-back-work/", send_back_work_submission),
    path("milestones/<int:milestone_id>/execute-subcontractor-payout/", ExecuteMilestonePayoutView.as_view()),
    path("milestones/<int:milestone_id>/retry-subcontractor-payout/", RetryMilestonePayoutView.as_view()),
    path("milestones/<int:milestone_id>/reset-subcontractor-payout/", ResetMilestonePayoutView.as_view()),
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
    path(
        "dashboard/operations/",
        ContractorOperationsDashboardView.as_view(),
        name="contractor_operations_dashboard",
    ),
    path("payouts/history/", ContractorPayoutHistoryView.as_view()),
    path("payouts/history/export/", ContractorPayoutHistoryExportView.as_view()),

    # -------------------------------------------------
    # Public dispute decision
    # -------------------------------------------------
    path("disputes/public/<int:dispute_id>/", public_dispute_detail),
    path("disputes/public/<int:dispute_id>/accept/", public_dispute_accept),
    path("disputes/public/<int:dispute_id>/reject/", public_dispute_reject),

    # -------------------------------------------------
    # Misc
    # -------------------------------------------------
    path("notifications/", NotificationListView.as_view()),
    path("contractors/me/", ContractorMeView.as_view()),

    path("milestones/calendar/", MilestoneCalendarView.as_view()),
    path("agreements/calendar/", AgreementCalendarView.as_view()),

    path("invoices/<int:pk>/pdf/", InvoicePDFView.as_view()),
    path("contractors/<int:pk>/public/", ContractorPublicProfileView.as_view()),

    path("agreements/merge/", MergeAgreementsView.as_view()),

    # -------------------------------------------------
    # Magic invoice
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

    path("", include("projects.urls_invites")),
]

urlpatterns += [
    re_path(
        r"^agreements/(?P<pk>\d+)/preview_pdf/?$",
        AgreementViewSet.as_view({"get": "preview_pdf"}),
    ),
    re_path(
        r"^agreements/(?P<pk>\d+)/preview_link/?$",
        AgreementViewSet.as_view({"get": "preview_link"}),
    ),
    re_path(
        r"^agreements/(?P<pk>\d+)/acknowledge/?$",
        AgreementViewSet.as_view({"post": "acknowledge"}),
    ),
]
