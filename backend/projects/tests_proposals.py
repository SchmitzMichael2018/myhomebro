from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorOpportunity,
    OpportunityEstimateAppointment,
)
from projects.models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement
from projects.services.contractor_directory import normalize_business_name


def _use_secure_requests(client):
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    for method_name in ("get", "post", "put", "patch", "delete"):
        original = getattr(client, method_name)

        def secure_method(*args, _original=original, **kwargs):
            kwargs.setdefault("secure", True)
            return _original(*args, **kwargs)

        setattr(client, method_name, secure_method)


class ProposalWorkspaceFoundationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(email="contractor@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Proposal Builder LLC")
        self.other_user = User.objects.create_user(email="other@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Pro")
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Proposal Builder LLC",
            normalized_name=normalize_business_name("Proposal Builder LLC"),
            claimed=True,
            claimed_by_contractor=self.contractor,
        )
        self.opportunity = ContractorOpportunity.objects.create(
            directory_entry=self.entry,
            homeowner_name="Casey Homeowner",
            homeowner_email="casey@example.com",
            homeowner_phone="512-555-2222",
            project_address="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_zip="78701",
            project_title="Kitchen Refresh",
            project_type="Remodel",
            project_subtype="Kitchen",
            project_description="Refresh cabinets and counters.",
        )
        self.appointment = OpportunityEstimateAppointment.objects.create(
            contractor=self.contractor,
            source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
            contractor_opportunity=self.opportunity,
            opportunity_title="Kitchen Refresh",
            opportunity_reference=f"Opportunity #{self.opportunity.id}",
            customer_name="Casey Homeowner",
            customer_email="casey@example.com",
            customer_phone="512-555-2222",
            service_location="123 Main St, Austin, TX 78701",
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=timezone.now() + timedelta(days=1),
            duration_minutes=60,
            notes="Bring tape measure.",
        )
        self.client = APIClient()
        _use_secure_requests(self.client)
        self.client.force_authenticate(self.user)

    def _create_proposal(self):
        return self.client.post(
            "/api/projects/proposals/",
            {
                "source_type": "opportunity",
                "source_id": self.opportunity.id,
                "estimate_appointment_id": self.appointment.id,
            },
            format="json",
        )

    def test_create_proposal_links_opportunity_and_appointment_with_snapshots(self):
        response = self._create_proposal()

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["created"])
        proposal = Proposal.objects.get()
        self.assertEqual(proposal.contractor, self.contractor)
        self.assertEqual(proposal.contractor_opportunity, self.opportunity)
        self.assertEqual(proposal.estimate_appointment, self.appointment)
        self.assertEqual(proposal.project_title, "Kitchen Refresh")
        self.assertEqual(proposal.customer_email, "casey@example.com")
        self.assertEqual(ProposalActivity.objects.filter(proposal=proposal).count(), 2)

    def test_create_proposal_is_idempotent_for_source(self):
        first = self._create_proposal()
        second = self._create_proposal()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data["created"])
        self.assertEqual(Proposal.objects.count(), 1)

    def test_status_transition_validates_supported_statuses(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            contractor_opportunity=self.opportunity,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        invalid = self.client.patch(f"/api/projects/proposals/{proposal.id}/", {"status": "pricing"}, format="json")
        self.assertEqual(invalid.status_code, 400)

        valid = self.client.patch(f"/api/projects/proposals/{proposal.id}/", {"status": Proposal.STATUS_SITE_VISIT}, format="json")
        self.assertEqual(valid.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_SITE_VISIT)
        self.assertTrue(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_STATUS_UPDATED).exists())

    def test_measurement_crud(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        created = self.client.post(
            f"/api/projects/proposals/{proposal.id}/measurements/",
            {"label": "Kitchen width", "location": "Kitchen", "quantity": "12.5", "unit": "ft", "notes": "Wall to wall"},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        measurement_id = created.data["id"]
        self.assertEqual(ProposalMeasurement.objects.count(), 1)

        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/measurements/{measurement_id}/",
            {"quantity": "13.0", "notes": "Verified"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["quantity"], "13.00")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/measurements/{measurement_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(ProposalMeasurement.objects.count(), 0)

    def test_attachment_crud(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )
        upload = SimpleUploadedFile("before.jpg", b"fake-image", content_type="image/jpeg")

        created = self.client.post(
            f"/api/projects/proposals/{proposal.id}/attachments/",
            {"file": upload, "attachment_type": "photo", "category": "before", "caption": "Before photo"},
            format="multipart",
        )
        self.assertEqual(created.status_code, 201)
        attachment_id = created.data["id"]
        self.assertEqual(ProposalAttachment.objects.count(), 1)

        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/attachments/{attachment_id}/",
            {"caption": "Front wall", "category": "reference"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["caption"], "Front wall")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/attachments/{attachment_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(ProposalAttachment.objects.count(), 0)

    def test_line_item_crud_and_totals(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        labor = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_LABOR,
                "description": "Crew labor",
                "quantity": "10",
                "unit": "hours",
                "unit_price": "75",
                "notes": "Two-person crew",
            },
            format="json",
        )
        self.assertEqual(labor.status_code, 201)
        self.assertEqual(labor.data["line_item"]["total"], "750.00")
        self.assertEqual(labor.data["totals"]["subtotal"], "750.00")

        tax = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_TAX,
                "description": "Sales tax",
                "quantity": "1",
                "unit_price": "50",
            },
            format="json",
        )
        self.assertEqual(tax.status_code, 201)

        discount = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_DISCOUNT,
                "description": "Preferred customer discount",
                "quantity": "1",
                "unit_price": "25",
            },
            format="json",
        )
        self.assertEqual(discount.status_code, 201)
        self.assertEqual(discount.data["totals"]["total"], "775.00")

        line_item_id = labor.data["line_item"]["id"]
        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/line-items/{line_item_id}/",
            {"quantity": "12", "unit_price": "80"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["line_item"]["total"], "960.00")
        self.assertEqual(updated.data["totals"]["total"], "985.00")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/line-items/{line_item_id}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.data["totals"]["subtotal"], "0.00")
        self.assertTrue(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_LINE_ITEM_REMOVED).exists())

    def test_incidentals_reserve_line_affects_proposal_total(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        base = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_MATERIALS,
                "description": "Cabinet hardware",
                "quantity": "1",
                "unit_price": "500",
            },
            format="json",
        )
        self.assertEqual(base.status_code, 201)
        reserve = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE,
                "description": "Incidentals reserve",
                "quantity": "1",
                "unit_price": "200",
            },
            format="json",
        )

        self.assertEqual(reserve.status_code, 201)
        self.assertEqual(reserve.data["totals"]["subtotal"], "500.00")
        self.assertEqual(reserve.data["totals"]["incidentals_reserve"], "200.00")
        self.assertEqual(reserve.data["totals"]["total"], "700.00")

    def test_other_contractor_cannot_access_proposal(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )
        self.client.force_authenticate(self.other_user)

        response = self.client.get(f"/api/projects/proposals/{proposal.id}/")

        self.assertEqual(response.status_code, 404)
