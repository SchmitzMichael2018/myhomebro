# backend/projects/urls.py
# v2025-10-22 — Router for AgreementViewSet + list endpoints
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from projects.views.agreements import AgreementViewSet
from projects.views.listing import MilestonesList, InvoicesList, ExpensesList

app_name = "projects"

router = DefaultRouter(trailing_slash="/?")
router.register(r"agreements", AgreementViewSet, basename="agreements")

urlpatterns = [
    path("", include(router.urls)),  # Main router for AgreementViewSet
    path("milestones/", MilestonesList.as_view(), name="milestones-list"),
    path("invoices/", InvoicesList.as_view(), name="invoices-list"),
    path("expenses/", ExpensesList.as_view(), name="expenses-list"),
]
