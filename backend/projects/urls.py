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
from .views.project_intake import ProjectIntakeViewSet

from .views.contractor_me import ContractorMeView
from .views.activity_feed import ContractorActivityFeedView
from .views.compliance import ContractorCompliancePreviewView
from .views.onboarding import (
    ContractorOnboardingDismissStripePromptView,
    ContractorOnboardingEventView,
    ContractorOnboardingView,
)
from .views.sms_compliance import (
    SMSAutomationPreviewView,
    SMSOptInView,
    SMSOptOutView,
    SMSStatusView,
    twilio_inbound_sms,
    twilio_sms_status,
)
from .views.subaccounts import ContractorSubAccountViewSet, WhoAmIView

from .views.funding import (
    SendFundingLinkView,
    PublicFundingInfoView,
    CreateFundingPaymentIntentView,
    AgreementFundingPreviewView,
    FundingReceiptView,
)

from .views_template import (
    TemplateGenerateMaterialsView,
)

from .views.template_views import (
    ApplyTemplateToAgreementView,
    ResetAgreementStep1View,
    SaveAgreementAsTemplateView,
    TemplateDetailView,
    TemplateDiscoverView,
    TemplateSuggestPricingView,
    TemplateApplyPricingView,
    TemplateImproveDescriptionView,
    TemplateListCreateView,
    TemplateSuggestTypeSubtypeView,
    TemplateCreateFromScopeView,
    TemplateVisibilityUpdateView,
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

from .views.business_dashboard import (
    BusinessDashboardDrilldownAPIView,
    BusinessDashboardCompletedJobsExportView,
    BusinessDashboardFeesExportView,
    BusinessDashboardPayoutsExportView,
    BusinessDashboardRevenueExportView,
    BusinessDashboardSummaryAPIView,
)
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
from .views.subcontractor_hub import (
    AgreementSubcontractorAssignmentsView,
    ContractorSubcontractorAssignmentsView,
    ContractorSubcontractorDirectoryView,
    ContractorSubcontractorInvitationRevokeView,
    ContractorSubcontractorInvitationsView,
    ContractorSubcontractorInviteView,
    ContractorSubcontractorWorkReviewView,
    ContractorSubcontractorWorkSubmissionListView,
)
from .views.public_presence import (
    ContractorGalleryDetailView,
    ContractorGalleryListCreateView,
    ContractorPublicLeadAcceptView,
    ContractorPublicLeadAnalyzeView,
    ContractorPublicLeadCreateAgreementView,
    ContractorPublicLeadConvertHomeownerView,
    ContractorPublicLeadDetailView,
    ContractorPublicLeadListView,
    ContractorPublicLeadRejectView,
    ContractorPublicLeadSendIntakeView,
    ContractorPublicProfileManageView,
    ContractorPublicProfileQrView,
    ContractorReviewDetailView,
    ContractorReviewListCreateView,
    PublicContractorGalleryView,
    PublicContractorIntakeView,
    PublicContractorProfileView as PublicContractorProfileBySlugView,
    PublicContractorQrView,
    PublicContractorReviewsView,
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
    ContractorPayoutDetailView,
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
from .views.draw_requests import (
    AgreementDrawListCreateView,
    AgreementExternalPaymentListView,
    DrawApproveView,
    DrawRecordExternalPaymentView,
    DrawRejectView,
    DrawRequestChangesView,
    DrawSubmitView,
)
from .views.magic_draw_request import (
    MagicDrawRequestApproveView,
    MagicDrawRequestChangesView,
    MagicDrawRequestView,
)

from .views.invoice_direct_pay import invoice_create_direct_pay_link

from projects.api.ai_agreement_views import (
    ai_agreement_description,
    ai_orchestrate_assistant,
    ai_suggest_milestones,
    ai_refresh_pricing_estimate,
    ai_draft_project,
    agreement_estimate_preview,
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
router.register(r"intakes", ProjectIntakeViewSet, basename="project-intakes")

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
    path("activity-feed/", ContractorActivityFeedView.as_view(), name="activity-feed"),
    path("twilio/inbound-sms/", twilio_inbound_sms, name="twilio-inbound-sms"),
    path("twilio/status/", twilio_sms_status, name="twilio-sms-status"),
    path("sms/automation/preview/", SMSAutomationPreviewView.as_view(), name="sms-automation-preview"),
    path("sms/opt-in/", SMSOptInView.as_view(), name="sms-opt-in"),
    path("sms/opt-out/", SMSOptOutView.as_view(), name="sms-opt-out"),
    path("sms/status/", SMSStatusView.as_view(), name="sms-status"),
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
    path("templates/discover/", TemplateDiscoverView.as_view(), name="template-discover"),
    path("templates/recommend/", TemplateRecommendView.as_view(), name="template-recommend"),
    path("templates/<int:pk>/", TemplateDetailView.as_view(), name="template-detail"),
    path(
        "templates/<int:pk>/visibility/",
        TemplateVisibilityUpdateView.as_view(),
        name="template-visibility-update",
    ),
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
    path(
        "agreements/<int:agreement_id>/reset-step1/",
        ResetAgreementStep1View.as_view(),
        name="agreement-reset-step1",
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
    path("assistant/orchestrate/", ai_orchestrate_assistant),
    path("agreements/ai/description/", ai_agreement_description),
    path("agreements/ai/draft/", ai_draft_project),
    path("agreements/<int:agreement_id>/ai/suggest-milestones/", ai_suggest_milestones),
    path("agreements/<int:agreement_id>/ai/refresh-pricing-estimate/", ai_refresh_pricing_estimate),
    path("agreements/<int:agreement_id>/estimate-preview/", agreement_estimate_preview),
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
        "agreements/<int:agreement_id>/subcontractor-assignments/",
        AgreementSubcontractorAssignmentsView.as_view(),
        name="agreement-subcontractor-assignments",
    ),
    path(
        "agreements/<int:agreement_id>/draws/",
        AgreementDrawListCreateView.as_view(),
        name="agreement-draws",
    ),
    path(
        "agreements/<int:agreement_id>/external-payments/",
        AgreementExternalPaymentListView.as_view(),
        name="agreement-external-payments",
    ),
    path("draws/<int:draw_id>/submit/", DrawSubmitView.as_view(), name="draw-submit"),
    path("draws/<int:draw_id>/approve/", DrawApproveView.as_view(), name="draw-approve"),
    path("draws/<int:draw_id>/reject/", DrawRejectView.as_view(), name="draw-reject"),
    path(
        "draws/<int:draw_id>/request_changes/",
        DrawRequestChangesView.as_view(),
        name="draw-request-changes",
    ),
    path(
        "draws/<int:draw_id>/record_external_payment/",
        DrawRecordExternalPaymentView.as_view(),
        name="draw-record-external-payment",
    ),
    path("draws/magic/<uuid:token>/", MagicDrawRequestView.as_view(), name="draw-magic-view"),
    path("draws/magic/<uuid:token>/approve/", MagicDrawRequestApproveView.as_view(), name="draw-magic-approve"),
    path(
        "draws/magic/<uuid:token>/request_changes/",
        MagicDrawRequestChangesView.as_view(),
        name="draw-magic-request-changes",
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
    path(
        "subcontractors/",
        ContractorSubcontractorDirectoryView.as_view(),
        name="contractor-subcontractor-directory",
    ),
    path(
        "subcontractors/invite/",
        ContractorSubcontractorInviteView.as_view(),
        name="contractor-subcontractor-invite",
    ),
    path(
        "subcontractor-invitations/",
        ContractorSubcontractorInvitationsView.as_view(),
        name="contractor-subcontractor-invitations",
    ),
    path(
        "subcontractor-invitations/<int:invitation_id>/revoke/",
        ContractorSubcontractorInvitationRevokeView.as_view(),
        name="contractor-subcontractor-invitation-revoke",
    ),
    path(
        "subcontractor-assignments/",
        ContractorSubcontractorAssignmentsView.as_view(),
        name="contractor-subcontractor-assignments",
    ),
    path(
        "subcontractor-work-submissions/",
        ContractorSubcontractorWorkSubmissionListView.as_view(),
        name="contractor-subcontractor-work-submissions",
    ),
    path(
        "subcontractor-work-submissions/<int:submission_id>/review/",
        ContractorSubcontractorWorkReviewView.as_view(),
        name="contractor-subcontractor-work-review",
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
        "business/contractor/drilldown/",
        BusinessDashboardDrilldownAPIView.as_view(),
        name="contractor_business_drilldown",
    ),
    path(
        "business-dashboard/export/revenue/",
        BusinessDashboardRevenueExportView.as_view(),
        name="business_dashboard_export_revenue",
    ),
    path(
        "business-dashboard/export/fees/",
        BusinessDashboardFeesExportView.as_view(),
        name="business_dashboard_export_fees",
    ),
    path(
        "business-dashboard/export/payouts/",
        BusinessDashboardPayoutsExportView.as_view(),
        name="business_dashboard_export_payouts",
    ),
    path(
        "business-dashboard/export/jobs/",
        BusinessDashboardCompletedJobsExportView.as_view(),
        name="business_dashboard_export_jobs",
    ),
    path(
        "dashboard/operations/",
        ContractorOperationsDashboardView.as_view(),
        name="contractor_operations_dashboard",
    ),
    path("payouts/history/", ContractorPayoutHistoryView.as_view()),
    path("payouts/history/<int:payout_id>/", ContractorPayoutDetailView.as_view()),
    path("payouts/history/export/", ContractorPayoutHistoryExportView.as_view()),

    # -------------------------------------------------
    # Public dispute decision
    # -------------------------------------------------
    path("disputes/public/<int:dispute_id>/", public_dispute_detail),
    path("disputes/public/<int:dispute_id>/accept/", public_dispute_accept),
    path("disputes/public/<int:dispute_id>/reject/", public_dispute_reject),

    # -------------------------------------------------
    # Contractor public presence
    # -------------------------------------------------
    path("contractor/public-profile/", ContractorPublicProfileManageView.as_view()),
    path("contractor/public-profile/qr/", ContractorPublicProfileQrView.as_view()),
    path("contractor/gallery/", ContractorGalleryListCreateView.as_view()),
    path("contractor/gallery/<int:item_id>/", ContractorGalleryDetailView.as_view()),
    path("contractor/reviews/", ContractorReviewListCreateView.as_view()),
    path("contractor/reviews/<int:review_id>/", ContractorReviewDetailView.as_view()),
    path("contractor/public-leads/", ContractorPublicLeadListView.as_view()),
    path("contractor/public-leads/<int:lead_id>/", ContractorPublicLeadDetailView.as_view()),
    path("contractor/public-leads/<int:lead_id>/accept/", ContractorPublicLeadAcceptView.as_view()),
    path("contractor/public-leads/<int:lead_id>/reject/", ContractorPublicLeadRejectView.as_view()),
    path("contractor/public-leads/<int:lead_id>/analyze/", ContractorPublicLeadAnalyzeView.as_view()),
    path("contractor/public-leads/<int:lead_id>/send-intake/", ContractorPublicLeadSendIntakeView.as_view()),
    path("contractor/public-leads/<int:lead_id>/create-agreement/", ContractorPublicLeadCreateAgreementView.as_view()),
    path("contractor/public-leads/<int:lead_id>/convert-homeowner/", ContractorPublicLeadConvertHomeownerView.as_view()),
    path("public/contractors/<slug:slug>/", PublicContractorProfileBySlugView.as_view()),
    path("public/contractors/<slug:slug>/gallery/", PublicContractorGalleryView.as_view()),
    path("public/contractors/<slug:slug>/reviews/", PublicContractorReviewsView.as_view()),
    path("public/contractors/<slug:slug>/intake/", PublicContractorIntakeView.as_view()),
    path("public/contractors/<slug:slug>/qr/", PublicContractorQrView.as_view()),

    # -------------------------------------------------
    # Misc
    # -------------------------------------------------
    path("notifications/", NotificationListView.as_view()),
    path("contractors/me/", ContractorMeView.as_view()),
    path("contractors/onboarding/", ContractorOnboardingView.as_view()),
    path("contractors/onboarding/events/", ContractorOnboardingEventView.as_view()),
    path(
        "contractors/onboarding/dismiss-stripe-prompt/",
        ContractorOnboardingDismissStripePromptView.as_view(),
    ),
    path("compliance/profile-preview/", ContractorCompliancePreviewView.as_view()),

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
