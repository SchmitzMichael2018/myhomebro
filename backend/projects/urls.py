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
    public_dispute_message,
    public_dispute_accept,
    public_dispute_reject,
)

from .views.attachments import (
    AgreementAttachmentViewSet,
    AgreementAttachmentNestedView,
)

from .views.agreements_bulk_delete import BulkDeleteAgreementsView
from .views.agreements_merge import MergeAgreementsView
from .views.calendar import MilestoneCalendarView, AgreementCalendarView
from .views.contractors.public import ContractorPublicProfileView
from .views.notifications import (
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationMarkReadView,
    NotificationUnreadCountView,
)
from .views.recommendations import RecommendationMeView
from .views.dispute_workorders import DisputeWorkOrderViewSet
from .views.support_tickets import SupportTicketViewSet

from .views.magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .views.magic_invoice_pdf import MagicInvoicePDFView

from .views.public_intake import (
    PublicIntakeClarificationPhotoUploadView,
    PublicIntakeDescriptionImproveView,
    PublicIntakeView,
)
from .views.contractor_discovery import (
    AdminContractorDirectoryView,
    AdminContractorDirectoryClaimLinkView,
    AdminContractorDirectoryJoinInviteView,
    AdminContractorDirectoryArchiveView,
    AdminContractorDirectoryImportApplyView,
    AdminContractorDirectoryImportPreviewView,
    AdminContractorDirectoryManualClaimView,
    AdminContractorDirectoryOutreachLogView,
    AdminContractorDirectoryRestoreView,
    AdminContractorSearchCaptureView,
    AdminContractorSearchView,
    AdminContractorOpportunityListView,
    ContractorDirectoryClaimView,
    ContractorOpportunityDeclineView,
    ContractorOpportunityListView,
    ContractorOpportunityAcceptView,
    ContractorDiscoveryClaimView,
    PublicIntakeSelectContractorView,
    PublicIntakeContractorSearchView,
    PublicIntakeSendContractorInvitesView,
)
from .views.contractor_activation import (
    ContractorActivationSummaryDismissView,
    ContractorActivationSummaryView,
)
from .views.public_intake_start import PublicIntakeStartView
from .views.project_intake import ProjectIntakeViewSet

from .views.contractor_me import ContractorMeView
from .views.activity_feed import ContractorActivityFeedView
from .views.contractor_bids import ContractorBidsView
from .views.compliance import ContractorCompliancePreviewView
from .views.contractor_onboarding_setup import ContractorOnboardingSetupView
from .views.workspace_context import WorkspaceContextView
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
    ApplyTemplateToNewAgreementView,
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
    UpdateSourceTemplateFromAgreementView,
)

from .views.agreements_amend import create_amendment
from .views.amendment_requests import ContractorAgreementAmendmentRequestView, AmendmentRequestResponseView, AmendmentRequestViewedView
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
from .views.subcontractor_milestone_agreements import (
    MilestoneSubcontractorAgreementView,
    SubcontractorMilestoneAgreementAcceptView,
    SubcontractorMilestoneAgreementDeclineView,
    SubcontractorMilestoneAgreementView,
)
from .views.subcontractor_quotes import SubcontractorQuoteRequestViewSet
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
    ContractorPublicProfileGenerateView,
    ContractorPublicProfileManageView,
    ContractorPublicProfileQrView,
    ContractorReviewDetailView,
    ContractorReviewListCreateView,
    PublicContractorQuoteDescriptionImproveView,
    PublicContractorQuoteRequestView,
    PublicContractorGalleryView,
    PublicContractorIntakeView,
    PublicContractorProfileView as PublicContractorProfileBySlugView,
    PublicContractorQrView,
    PublicContractorReviewsView,
    PublicContractorRatingView,
)
from .views.subcontractor_payouts import (
    ExecuteMilestonePayoutView,
    ResetMilestonePayoutView,
    RetryMilestonePayoutView,
    ReleaseSubcontractorPaymentView,
    SubcontractorPayoutAccountManageView,
    SubcontractorPayoutAccountStartView,
    SubcontractorPayoutAccountStatusView,
)
from .views.payout_history import (
    ContractorPayoutDetailView,
    ContractorPayoutHistoryExportView,
    ContractorPayoutHistoryView,
)
from .views.contractor_payout_history import ContractorPayoutHistoryView as ContractorCompletedPayoutHistoryView
from .views.customer_portal import (
    AgreementMagicAccessView,
    AgreementMagicPdfView,
    CustomerPortalBidAcceptView,
    CustomerPortalAccountView,
    CustomerPortalAgreementAmendmentImproveView,
    CustomerPortalAgreementAmendmentRequestView,
    CustomerPortalAgreementDisputeView,
    CustomerPortalAgreementRefundRequestView,
    CustomerPortalCreatePasswordView,
    CustomerPortalDrawDisputeView,
    CustomerPortalNotificationArchiveView,
    CustomerPortalNotificationMarkAllReadView,
    CustomerPortalNotificationMarkReadView,
    CustomerPortalProfileView,
    CustomerPortalHomeSystemView,
    CustomerPortalHomeSystemServiceRequestView,
    CustomerPortalHomeSystemServiceView,
    CustomerPortalPropertyProfileView,
    CustomerPortalPropertyUploadView,
    CustomerPortalReimbursementApproveView,
    CustomerPortalReimbursementDenyView,
    CustomerPortalReviewSubmitView,
    CustomerPortalRequestCreateView,
    CustomerPortalRequestCancelView,
    CustomerPortalRequestContractorSelectView,
    CustomerPortalRequestDetailView,
    CustomerPortalRequestImproveView,
    CustomerPortalRequestMatchingView,
    CustomerProjectDashboardView,
    CustomerPortalRequestLinkView,
    CustomerPortalView,
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
    ContractorDrawRequestListView,
    DrawReleaseView,
    DrawRecordExternalPaymentView,
    DrawRejectView,
    DrawResendReviewEmailView,
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
    ai_classify_project,
    ai_suggest_milestones,
    ai_refresh_pricing_estimate,
    ai_draft_project,
    agreement_estimate_preview,
)

from .views_template_recommend import TemplateRecommendView
from .views.project_taxonomy import ProjectTypeViewSet, ProjectSubtypeViewSet
from .views.warranty import AgreementWarrantyViewSet
from .views.maintenance_work_orders import MaintenanceWorkOrderViewSet

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
router.register(r"support-tickets", SupportTicketViewSet, basename="support-tickets")
router.register(r"subcontractor-quotes", SubcontractorQuoteRequestViewSet, basename="subcontractor-quotes")
router.register(r"maintenance-work-orders", MaintenanceWorkOrderViewSet, basename="maintenance-work-orders")

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
    path("recommendations/me/", RecommendationMeView.as_view(), name="recommendations-me"),
    path("twilio/inbound-sms/", twilio_inbound_sms, name="twilio-inbound-sms"),
    path("twilio/status/", twilio_sms_status, name="twilio-sms-status"),
    path("customer-portal/request-link/", CustomerPortalRequestLinkView.as_view(), name="customer-portal-request-link"),
    path("customer-portal/account/", CustomerPortalAccountView.as_view(), name="customer-portal-account"),
    path("customer-portal/<str:token>/create-password/", CustomerPortalCreatePasswordView.as_view(), name="customer-portal-create-password"),
    path("customer-portal/<str:token>/", CustomerPortalView.as_view(), name="customer-portal-detail"),
    path("customer-portal/<str:token>/profile/", CustomerPortalProfileView.as_view(), name="customer-portal-profile"),
    path("customer-portal/<str:token>/requests/", CustomerPortalRequestCreateView.as_view(), name="customer-portal-request-create"),
    path("customer-portal/<str:token>/requests/<int:request_id>/", CustomerPortalRequestDetailView.as_view(), name="customer-portal-request-detail"),
    path("customer-portal/<str:token>/requests/<int:request_id>/cancel/", CustomerPortalRequestCancelView.as_view(), name="customer-portal-request-cancel"),
    path("customer-portal/<str:token>/requests/<int:request_id>/contractor-search/", CustomerPortalRequestMatchingView.as_view(), name="customer-portal-request-contractor-search"),
    path("customer-portal/<str:token>/requests/<int:request_id>/contractors/select/", CustomerPortalRequestContractorSelectView.as_view(), name="customer-portal-request-contractor-select"),
    path("customer-portal/<str:token>/requests/improve/", CustomerPortalRequestImproveView.as_view(), name="customer-portal-request-improve"),
    path("customer-portal/<str:token>/property/", CustomerPortalPropertyProfileView.as_view(), name="customer-portal-property"),
    path("customer-portal/<str:token>/property/systems/", CustomerPortalHomeSystemView.as_view(), name="customer-portal-home-system-create"),
    path("customer-portal/<str:token>/property/systems/<int:system_id>/", CustomerPortalHomeSystemView.as_view(), name="customer-portal-home-system-detail"),
    path("customer-portal/<str:token>/property/systems/<int:system_id>/mark-serviced/", CustomerPortalHomeSystemServiceView.as_view(), name="customer-portal-home-system-mark-serviced"),
    path("customer-portal/<str:token>/property/systems/<int:system_id>/service-request/", CustomerPortalHomeSystemServiceRequestView.as_view(), name="customer-portal-home-system-service-request"),
    path(
        "customer-portal/<str:token>/property/<str:upload_kind>/",
        CustomerPortalPropertyUploadView.as_view(),
        name="customer-portal-property-upload",
    ),
    path(
        "customer-portal/<str:token>/notifications/<int:notification_id>/read/",
        CustomerPortalNotificationMarkReadView.as_view(),
        name="customer-portal-notification-read",
    ),
    path(
        "customer-portal/<str:token>/notifications/mark-all-read/",
        CustomerPortalNotificationMarkAllReadView.as_view(),
        name="customer-portal-notification-mark-all-read",
    ),
    path(
        "customer-portal/<str:token>/notifications/<int:notification_id>/archive/",
        CustomerPortalNotificationArchiveView.as_view(),
        name="customer-portal-notification-archive",
    ),
    path("customer-portal/<str:token>/bids/<str:bid_key>/accept/", CustomerPortalBidAcceptView.as_view(), name="customer-portal-bid-accept"),
    path("customer-portal/<str:token>/draws/<int:draw_id>/dispute/", CustomerPortalDrawDisputeView.as_view(), name="customer-portal-draw-dispute"),
    path("customer-portal/<str:token>/agreements/<int:agreement_id>/amendments/improve/", CustomerPortalAgreementAmendmentImproveView.as_view(), name="customer-portal-agreement-amendment-improve"),
    path("customer-portal/<str:token>/agreements/<int:agreement_id>/amendments/", CustomerPortalAgreementAmendmentRequestView.as_view(), name="customer-portal-agreement-amendment-request"),
    path("customer-portal/<str:token>/agreements/<int:agreement_id>/refunds/", CustomerPortalAgreementRefundRequestView.as_view(), name="customer-portal-agreement-refund-request"),
    path("customer-portal/<str:token>/agreements/<int:agreement_id>/disputes/", CustomerPortalAgreementDisputeView.as_view(), name="customer-portal-agreement-dispute"),
    path("customer-portal/<str:token>/agreements/<int:agreement_id>/review/", CustomerPortalReviewSubmitView.as_view(), name="customer-portal-review-submit"),
    path("agreements/<int:agreement_id>/amendment-requests/", ContractorAgreementAmendmentRequestView.as_view(), name="contractor-agreement-amendment-request"),
    path("amendment-requests/<int:request_id>/respond/", AmendmentRequestResponseView.as_view(), name="amendment-request-respond"),
    path("amendment-requests/<int:request_id>/viewed/", AmendmentRequestViewedView.as_view(), name="amendment-request-viewed"),
    path("customer-portal/<str:token>/reimbursements/<int:reimbursement_id>/approve/", CustomerPortalReimbursementApproveView.as_view(), name="customer-portal-reimbursement-approve"),
    path("customer-portal/<str:token>/reimbursements/<int:reimbursement_id>/deny/", CustomerPortalReimbursementDenyView.as_view(), name="customer-portal-reimbursement-deny"),
    path("customer-portal/project/<int:project_id>/", CustomerProjectDashboardView.as_view(), name="customer-project-dashboard"),
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
        "agreements/new/apply-template/",
        ApplyTemplateToNewAgreementView.as_view(),
        name="agreement-apply-template-new",
    ),
    path(
        "agreements/<int:agreement_id>/save-as-template/",
        SaveAgreementAsTemplateView.as_view(),
        name="agreement-save-as-template",
    ),
    path(
        "agreements/<int:agreement_id>/update-source-template/",
        UpdateSourceTemplateFromAgreementView.as_view(),
        name="agreement-update-source-template",
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
    path("agreements/access/<uuid:token>/", AgreementMagicAccessView.as_view(), name="agreement-magic-access"),
    path("agreements/access/<uuid:token>/pdf/", AgreementMagicPdfView.as_view(), name="agreement-magic-access-pdf"),
    path("agreements/<int:pk>/milestones/", agreement_milestones),
    path("agreements/public_sign/", agreement_public_sign),
    path("agreements/public_pdf/", agreement_public_pdf),

    # -------------------------------------------------
    # Agreement AI
    # -------------------------------------------------
    path("assistant/orchestrate/", ai_orchestrate_assistant),
    path("agreements/ai/description/", ai_agreement_description),
    path("agreements/ai/draft/", ai_draft_project),
    path("agreements/ai/classify/", ai_classify_project),
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
    path("draws/", ContractorDrawRequestListView.as_view(), name="draw-list"),
    path("draws/<int:draw_id>/submit/", DrawSubmitView.as_view(), name="draw-submit"),
    path("draws/<int:draw_id>/approve/", DrawApproveView.as_view(), name="draw-approve"),
    path("draws/<int:draw_id>/release/", DrawReleaseView.as_view(), name="draw-release"),
    path("draws/<int:draw_id>/reject/", DrawRejectView.as_view(), name="draw-reject"),
    path("draws/<int:draw_id>/resend_review/", DrawResendReviewEmailView.as_view(), name="draw-resend-review"),
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
    path("public-intake/improve-description/", PublicIntakeDescriptionImproveView.as_view()),
    path("public-intake/photos/", PublicIntakeClarificationPhotoUploadView.as_view()),
    path("public-intake/start/", PublicIntakeStartView.as_view()),
    path("public-intake/contractor-search/", PublicIntakeContractorSearchView.as_view()),
    path("public-intake/select-contractor/", PublicIntakeSelectContractorView.as_view()),
    path("public-intake/send-contractor-invites/", PublicIntakeSendContractorInvitesView.as_view()),
    path("admin/contractor-search/", AdminContractorSearchView.as_view()),
    path("admin/contractor-search/capture/", AdminContractorSearchCaptureView.as_view()),
    path("admin/contractor-directory/", AdminContractorDirectoryView.as_view()),
    path("admin/contractor-directory/import-preview/", AdminContractorDirectoryImportPreviewView.as_view()),
    path("admin/contractor-directory/import-apply/", AdminContractorDirectoryImportApplyView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/archive/", AdminContractorDirectoryArchiveView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/restore/", AdminContractorDirectoryRestoreView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/outreach-log/", AdminContractorDirectoryOutreachLogView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/claim-link/", AdminContractorDirectoryClaimLinkView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/join-invite/", AdminContractorDirectoryJoinInviteView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/mark-claimed/", AdminContractorDirectoryManualClaimView.as_view()),
    path("admin/contractor-directory/<int:entry_id>/", AdminContractorDirectoryView.as_view()),
    path("admin/contractor-opportunities/", AdminContractorOpportunityListView.as_view()),
    path("contractor-opportunities/", ContractorOpportunityListView.as_view()),
    path("contractor-opportunities/<int:opportunity_id>/accept/", ContractorOpportunityAcceptView.as_view()),
    path("contractor-opportunities/<int:opportunity_id>/decline/", ContractorOpportunityDeclineView.as_view()),
    path("contractor-activation-summary/", ContractorActivationSummaryView.as_view()),
    path("contractor-activation-summary/dismiss/", ContractorActivationSummaryDismissView.as_view()),
    path("contractors/directory-claim/<uuid:token>/", ContractorDirectoryClaimView.as_view()),

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
    path(
        "milestones/<int:milestone_id>/subcontractor-agreement/",
        MilestoneSubcontractorAgreementView.as_view(),
        name="milestone-subcontractor-agreement",
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/agreement/",
        SubcontractorMilestoneAgreementView.as_view(),
        name="subcontractor-milestone-agreement",
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/agreement/accept/",
        SubcontractorMilestoneAgreementAcceptView.as_view(),
        name="subcontractor-milestone-agreement-accept",
    ),
    path(
        "subcontractor/milestones/<int:milestone_id>/agreement/decline/",
        SubcontractorMilestoneAgreementDeclineView.as_view(),
        name="subcontractor-milestone-agreement-decline",
    ),
    path("milestones/reviewer-queue/", reviewer_queue),
    path("milestones/<int:milestone_id>/submit-work/", submit_work_for_review),
    path("milestones/<int:milestone_id>/approve-work/", approve_work_submission),
    path("milestones/<int:milestone_id>/send-back-work/", send_back_work_submission),
    path("milestones/<int:milestone_id>/execute-subcontractor-payout/", ExecuteMilestonePayoutView.as_view()),
    path("milestones/<int:milestone_id>/retry-subcontractor-payout/", RetryMilestonePayoutView.as_view()),
    path("milestones/<int:milestone_id>/reset-subcontractor-payout/", ResetMilestonePayoutView.as_view()),
    path("subcontractor-agreements/<int:agreement_id>/release-payment/", ReleaseSubcontractorPaymentView.as_view()),
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
    path("contractor/payout-history/", ContractorCompletedPayoutHistoryView.as_view()),

    # -------------------------------------------------
    # Public dispute decision
    # -------------------------------------------------
    path("disputes/public/<int:dispute_id>/", public_dispute_detail),
    path("disputes/public/<int:dispute_id>/messages/", public_dispute_message),
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
    path("contractor/bids/", ContractorBidsView.as_view()),
    path("public/contractors/<slug:slug>/", PublicContractorProfileBySlugView.as_view()),
    path("public/contractors/<slug:slug>/gallery/", PublicContractorGalleryView.as_view()),
    path("public/contractors/<slug:slug>/rating/", PublicContractorRatingView.as_view()),
    path("public/contractors/<slug:slug>/reviews/", PublicContractorReviewsView.as_view()),
    path("public/contractors/<slug:slug>/request-quote/", PublicContractorQuoteRequestView.as_view()),
    path("public/contractors/<slug:slug>/request-quote/improve-description/", PublicContractorQuoteDescriptionImproveView.as_view()),
    path("public/contractors/<slug:slug>/intake/", PublicContractorIntakeView.as_view()),
    path("public/contractors/<slug:slug>/qr/", PublicContractorQrView.as_view()),

    # -------------------------------------------------
    # Misc
    # -------------------------------------------------
    path("notifications/", NotificationListView.as_view()),
    path("notifications/unread-count/", NotificationUnreadCountView.as_view()),
    path("notifications/<int:pk>/read/", NotificationMarkReadView.as_view()),
    path("notifications/mark-all-read/", NotificationMarkAllReadView.as_view()),
    path("contractors/me/", ContractorMeView.as_view()),
    path("contractors/generate-profile/", ContractorPublicProfileGenerateView.as_view()),
    path("contractors/onboarding/setup/", ContractorOnboardingSetupView.as_view()),
    path("projects/workspace-context/", WorkspaceContextView.as_view()),
    path("contractors/onboarding/", ContractorOnboardingView.as_view()),
    path("contractors/onboarding/events/", ContractorOnboardingEventView.as_view()),
    path("contractors/claim/<uuid:token>/", ContractorDiscoveryClaimView.as_view()),
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
    path("agreements/bulk-delete/", BulkDeleteAgreementsView.as_view()),

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
