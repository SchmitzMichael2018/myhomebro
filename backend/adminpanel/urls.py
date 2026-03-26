from django.urls import path
from .views import (
    AdminOverview,
    AdminContractors,
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

urlpatterns = [
    path("overview/", AdminOverview.as_view(), name="admin-overview"),
    path("goals/", AdminGoals.as_view(), name="admin-goals"),

    path("contractors/", AdminContractors.as_view(), name="admin-contractors"),
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
]
