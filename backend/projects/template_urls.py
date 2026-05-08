from django.urls import path

from projects.views.template_views import (
    ApplyTemplateToAgreementView,
    ApplyTemplateToNewAgreementView,
    ResetAgreementStep1View,
    SaveAgreementAsTemplateView,
    TemplateDetailView,
    TemplateListCreateView,
)

urlpatterns = [
    path("templates/", TemplateListCreateView.as_view(), name="template-list-create"),
    path("templates/<int:pk>/", TemplateDetailView.as_view(), name="template-detail"),
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
        "agreements/<int:agreement_id>/reset-step1/",
        ResetAgreementStep1View.as_view(),
        name="agreement-reset-step1",
    ),
]
