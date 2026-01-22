from django.urls import path
from .views import (
    AdminOverview,
    AdminContractors,
    AdminHomeowners,
    AdminAgreements,
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
    path("disputes/", AdminDisputes.as_view(), name="admin-disputes"),

    # ✅ NEW
    path("geo/", AdminGeo.as_view(), name="admin-geo"),

    path("agreements/<int:agreement_id>/pdf/", AdminDownloadAgreementPDF.as_view(), name="admin-agreement-pdf"),
    path("users/password-reset/", AdminTriggerPasswordReset.as_view(), name="admin-trigger-password-reset"),
    path("fees/ledger/", AdminFeeLedger.as_view(), name="admin-fee-ledger"),
]
