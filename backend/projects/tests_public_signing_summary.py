from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from projects.views.agreements.public import agreement_public_sign, agreement_public_pdf


class PublicSigningSummaryTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @patch("projects.views.agreements.public._agreement_visible_attachments", return_value=[])
    @patch("projects.views.agreements.public._active_public_funding_link", return_value=None)
    @patch("projects.views.agreements.public.Milestone.objects.filter")
    @patch("projects.views.agreements.public.AgreementDetailPublicSerializer")
    @patch("projects.views.agreements.public.unsign_public_token")
    def test_public_payload_exposes_payment_and_contingency_summary(
        self, unsign, serializer, milestones, _funding, _attachments
    ):
        agreement = SimpleNamespace(
            id=35,
            project_title="Master Bath Renovation",
            title="Master Bath Renovation",
            scope_summary="Bathroom scope",
            description="",
            homeowner=SimpleNamespace(email="customer@example.com", full_name="QA Homeowner"),
            contractor=SimpleNamespace(
                business_name="QA Contractor",
                full_name="",
                user=SimpleNamespace(email="contractor@example.com"),
                review_count=0,
            ),
            project=SimpleNamespace(id=1052, title="Master Bath Renovation"),
            status="draft",
            payment_mode="escrow",
            total_cost=Decimal("5000.00"),
            incidentals_reserve_amount=Decimal("500.00"),
            signed_by_contractor=True,
            signed_by_homeowner=False,
        )
        unsign.return_value = agreement
        serializer.return_value.data = {}
        milestones.return_value.order_by.return_value = []

        response = agreement_public_sign(self.factory.get("/", {"token": "safe-token"}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["payment_mode"], "escrow")
        self.assertEqual(response.data["contract_amount"], "5000.00")
        self.assertEqual(response.data["contingency_reserve"], "500.00")
        self.assertEqual(response.data["total_escrow_required"], "5500.00")
        self.assertEqual(response.data["status_label"], "Awaiting your signature")

    def test_public_pdf_can_render_in_same_origin_frame(self):
        response = agreement_public_pdf(self.factory.get("/"))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response["X-Frame-Options"], "SAMEORIGIN")
