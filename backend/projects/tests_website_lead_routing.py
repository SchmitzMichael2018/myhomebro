from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor, ContractorPublicProfile, Notification, PublicContractorLead
from projects.services.public_lead_pipeline import create_public_lead_sales_notification


class WebsiteLeadRoutingTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="contractor@example.com",
            password="test-pass",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Evergreen Remodel Co",
            phone="512-555-0100",
            city="Austin",
            state="TX",
        )
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Evergreen Remodel Co",
            tagline="Kitchens, baths, and thoughtful repairs.",
            city="Austin",
            state="TX",
            allow_public_intake=True,
            is_public=True,
        )
        self.client = APIClient()

    def _make_lead(self, **overrides):
        defaults = {
            "contractor": self.contractor,
            "public_profile": self.profile,
            "source": PublicContractorLead.SOURCE_QUOTE_REQUEST,
            "full_name": "Jamie Homeowner",
            "email": "jamie@example.com",
            "phone": "512-555-0199",
            "project_type": "Kitchen Remodel",
            "project_description": "Refresh cabinets and counters.",
            "status": PublicContractorLead.STATUS_NEW,
        }
        defaults.update(overrides)
        return PublicContractorLead.objects.create(**defaults)

    def test_website_lead_appears_in_opportunities_with_source_summary(self):
        lead = self._make_lead()
        self.client.force_authenticate(self.user)

        response = self.client.get("/api/projects/contractor-opportunities/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["website_leads"], 1)
        self.assertEqual(response.data["summary"]["new_website_leads"], 1)
        self.assertEqual(response.data["summary"]["website_leads_needing_follow_up"], 1)
        row = response.data["results"][0]
        self.assertEqual(row["bid_id"], f"lead-{lead.id}")
        self.assertEqual(row["source_kind_label"], "Website")
        self.assertEqual(row["lead_source_label"], "Website")
        self.assertEqual(row["lead_source_filter"], "website")
        self.assertTrue(row["is_website_lead"])
        self.assertEqual(row["customer_name"], "Jamie Homeowner")

    def test_source_labels_include_public_profile_qr_marketplace_and_manual(self):
        self._make_lead(source=PublicContractorLead.SOURCE_PUBLIC_PROFILE, full_name="Profile Lead")
        self._make_lead(source=PublicContractorLead.SOURCE_QR, full_name="QR Lead")
        self._make_lead(source=PublicContractorLead.SOURCE_MANUAL, full_name="Manual Lead")
        self.client.force_authenticate(self.user)

        response = self.client.get("/api/projects/contractor-opportunities/", secure=True)

        self.assertEqual(response.status_code, 200)
        labels = {row["customer_name"]: row["lead_source_label"] for row in response.data["results"]}
        self.assertEqual(labels["Profile Lead"], "Public Profile")
        self.assertEqual(labels["QR Lead"], "QR Code")
        self.assertEqual(labels["Manual Lead"], "Manual")

    def test_website_lead_notification_is_created_and_deduped(self):
        lead = self._make_lead()

        first, first_created = create_public_lead_sales_notification(lead)
        second, second_created = create_public_lead_sales_notification(lead)

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(Notification.objects.filter(public_lead=lead).count(), 1)
        notification = Notification.objects.get(public_lead=lead)
        self.assertEqual(notification.category, Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED)
        self.assertIn("Hey, you got a new lead from your website.", notification.message)
        self.assertIn("Jamie Homeowner", notification.message)
        self.assertIn("Kitchen Remodel", notification.message)
        self.assertEqual(notification.link, "/app/opportunities?source=website")

    def test_public_profile_intake_creates_sales_notification(self):
        response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/intake/",
            {
                "source": "public_profile",
                "full_name": "Priya Customer",
                "email": "priya@example.com",
                "project_type": "Bathroom Remodel",
                "project_description": "Replace tile and fixtures.",
            },
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, 201)
        lead = PublicContractorLead.objects.get(full_name="Priya Customer")
        notification = Notification.objects.get(public_lead=lead)
        self.assertEqual(notification.link, "/app/opportunities?source=public_profile")
        self.assertIn("Hey, you got a new lead from your website.", notification.message)
        self.assertIn("Bathroom Remodel", notification.message)
