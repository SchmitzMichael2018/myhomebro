from django.urls import path
from .views import (
    AdminOverview,
    AdminContractors,
    AdminSubcontractors,
    AdminHomeowners,
    AdminAgreements,
    AdminAgreementAIContext,
    AdminAgreementRefreshPricing,
    AdminAgreementResendSignature,
    AdminDisputes,
    AdminDownloadAgreementPDF,
    AdminTriggerPasswordReset,
    AdminFeeLedger,
    AdminGeo,
)
from .views_goals import AdminGoals
from .views_marketplace import (
    AdminMarketplaceContractors,
    AdminMarketplaceImport,
    AdminMarketplaceListingDetail,
    AdminMarketplaceListingInvite,
    AdminMarketplaceLocationStatus,
    AdminMarketplaceOverview,
    AdminMarketplaceRouteIntake,
    AdminMarketplaceVerification,
)
from .views_reimbursements import (
    AdminReimbursementClearHold,
    AdminReimbursementDetail,
    AdminReimbursementHold,
    AdminReimbursementRecordRelease,
    AdminReimbursementRetryRelease,
    AdminReimbursements,
)

urlpatterns = [
    path("overview/", AdminOverview.as_view(), name="admin-overview"),
    path("goals/", AdminGoals.as_view(), name="admin-goals"),

    path("contractors/", AdminContractors.as_view(), name="admin-contractors"),
    path("subcontractors/", AdminSubcontractors.as_view(), name="admin-subcontractors"),
    path("homeowners/", AdminHomeowners.as_view(), name="admin-homeowners"),
    path("agreements/", AdminAgreements.as_view(), name="admin-agreements"),
    path("agreements/<int:agreement_id>/ai-context/", AdminAgreementAIContext.as_view(), name="admin-agreement-ai-context"),
    path("agreements/<int:agreement_id>/refresh-pricing/", AdminAgreementRefreshPricing.as_view(), name="admin-agreement-refresh-pricing"),
    path("agreements/<int:agreement_id>/resend-signature/", AdminAgreementResendSignature.as_view(), name="admin-agreement-resend-signature"),
    path("disputes/", AdminDisputes.as_view(), name="admin-disputes"),

    # ✅ NEW
    path("geo/", AdminGeo.as_view(), name="admin-geo"),

    path("agreements/<int:agreement_id>/pdf/", AdminDownloadAgreementPDF.as_view(), name="admin-agreement-pdf"),
    path("users/password-reset/", AdminTriggerPasswordReset.as_view(), name="admin-trigger-password-reset"),
    path("fees/ledger/", AdminFeeLedger.as_view(), name="admin-fee-ledger"),
    path("reimbursements/", AdminReimbursements.as_view(), name="admin-reimbursements"),
    path("reimbursements/<int:reimbursement_id>/", AdminReimbursementDetail.as_view(), name="admin-reimbursement-detail"),
    path("reimbursements/<int:reimbursement_id>/record-release/", AdminReimbursementRecordRelease.as_view(), name="admin-reimbursement-record-release"),
    path("reimbursements/<int:reimbursement_id>/hold/", AdminReimbursementHold.as_view(), name="admin-reimbursement-hold"),
    path("reimbursements/<int:reimbursement_id>/clear-hold/", AdminReimbursementClearHold.as_view(), name="admin-reimbursement-clear-hold"),
    path("reimbursements/<int:reimbursement_id>/retry-release/", AdminReimbursementRetryRelease.as_view(), name="admin-reimbursement-retry-release"),
    path("marketplace/", AdminMarketplaceOverview.as_view(), name="admin-marketplace-overview"),
    path("marketplace/locations/", AdminMarketplaceLocationStatus.as_view(), name="admin-marketplace-location-status"),
    path("marketplace/route-intake/", AdminMarketplaceRouteIntake.as_view(), name="admin-marketplace-route-intake"),
    path("marketplace/verification/", AdminMarketplaceVerification.as_view(), name="admin-marketplace-verification"),
    path("marketplace/contractors/", AdminMarketplaceContractors.as_view(), name="admin-marketplace-contractors"),
    path("marketplace/import/", AdminMarketplaceImport.as_view(), name="admin-marketplace-import"),
    path("marketplace/listings/<int:listing_id>/", AdminMarketplaceListingDetail.as_view(), name="admin-marketplace-listing-detail"),
    path("marketplace/listings/<int:listing_id>/invite/", AdminMarketplaceListingInvite.as_view(), name="admin-marketplace-listing-invite"),
]
