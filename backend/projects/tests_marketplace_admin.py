from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite


class AdminMarketplaceTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_superuser(
            email="admin-marketplace@example.com",
            password="testpass123",
        )
        contractor_user = user_model.objects.create_user(
            email="claimed-contractor@example.com",
            password="testpass123",
        )
        self.claimed_contractor = Contractor.objects.create(
            user=contractor_user,
            business_name="Claimed Pro LLC",
            city="Austin",
            state="TX",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin_user)

        self.claimed_listing = ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            google_place_id="place-claimed-1",
            business_name="Claimed Pro LLC",
            city="Austin",
            state="TX",
            primary_trade="roofing",
            trade_categories=["roofing"],
            google_rating=4.8,
            google_review_count=42,
            claimed_profile=True,
            claimed_contractor=self.claimed_contractor,
            assisted_diy_friendly=True,
            escrow_friendly=True,
            inspection_capable=True,
            rescue_project_friendly=True,
            compatibility_tags=["verified", "collaborative"],
            manually_reviewed=True,
        )
        self.unclaimed_listing = ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
            google_place_id="place-unclaimed-1",
            business_name="Local Plumbing Co",
            city="Dallas",
            state="TX",
            primary_trade="plumbing",
            trade_categories=["plumbing"],
            phone_number="(555) 444-5555",
            google_rating=4.2,
            google_review_count=19,
            assisted_diy_friendly=False,
            escrow_friendly=True,
            inspection_capable=False,
            rescue_project_friendly=False,
        )

    def test_marketplace_overview_reports_listing_counts_and_gaps(self):
        ContractorDiscoveryInvite.objects.create(directory_listing=self.unclaimed_listing, channel="sms")

        response = self.client.get("/api/projects/admin/marketplace/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["summary"]["total_listings"], 2)
        self.assertEqual(payload["summary"]["claimed_listings"], 1)
        self.assertEqual(payload["summary"]["unclaimed_listings"], 1)
        self.assertEqual(payload["summary"]["total_invites"], 1)
        self.assertGreaterEqual(len(payload["coverage"]["gaps"]), 1)

    def test_marketplace_contractor_filters_support_claimed_and_compatibility(self):
        ContractorDiscoveryInvite.objects.create(
            directory_listing=self.claimed_listing,
            status=ContractorDiscoveryInvite.STATUS_SENT,
            sent_at=timezone.now(),
        )

        response = self.client.get(
            "/api/projects/admin/marketplace/contractors/",
            {"claimed": "1", "invited": "1", "assisted_diy": "1", "has_phone": "0"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["results"][0]["id"], self.claimed_listing.id)
        self.assertEqual(payload["results"][0]["label"], "MyHomeBro Verified")
        self.assertIn("DIY Assistance Available", payload["results"][0]["compatibility_profile"]["badges"])

    @patch("adminpanel.views_marketplace.build_contractor_recommendations")
    def test_marketplace_import_search_uses_recommendation_service(self, mock_recommendations):
        mock_recommendations.return_value = {
            "results": [
                {
                    "id": "listing:77",
                    "source": "google_places",
                    "business_name": "Seeded Roofing Co",
                    "claimed": False,
                    "label": "Local Business Listing",
                    "rating": 4.6,
                    "review_count": 33,
                    "website_url": "",
                    "city": "Austin",
                    "state": "TX",
                    "distance_miles": 2.4,
                    "phone_available": True,
                    "email_available": False,
                    "invite_available": True,
                    "recommendation_tier": "Strong Match",
                    "compatibility_score": 87,
                    "recommendation_reasons": ["Supports Assisted DIY"],
                    "supported_project_modes": ["full_service", "assisted_diy"],
                    "escrow_friendly": True,
                    "assisted_diy_friendly": True,
                    "inspection_capable": True,
                    "rescue_project_friendly": False,
                }
            ]
        }

        response = self.client.get(
            "/api/projects/admin/marketplace/import/",
            {"query": "roofing contractor", "project_type": "roofing", "city": "Austin", "radius_miles": "15"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(mock_recommendations.call_count, 1)
        self.assertEqual(payload["results"][0]["business_name"], "Seeded Roofing Co")
        self.assertTrue(payload["results"][0]["assisted_diy_friendly"])

    @patch("projects.services.invites_delivery.send_twilio_sms", return_value=(True, "sent"))
    def test_marketplace_listing_detail_and_invite_flow(self, _mock_sms):
        response = self.client.patch(
            f"/api/projects/admin/marketplace/listings/{self.unclaimed_listing.id}/",
            {
                "admin_notes": "Reviewed by admin.",
                "compatibility_tags": "local, responsive",
                "assisted_diy_friendly": True,
                "inspection_capable": True,
                "manually_reviewed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.unclaimed_listing.refresh_from_db()
        self.assertTrue(self.unclaimed_listing.manually_reviewed)
        self.assertTrue(self.unclaimed_listing.assisted_diy_friendly)
        self.assertTrue(self.unclaimed_listing.inspection_capable)
        self.assertIn("local", self.unclaimed_listing.compatibility_tags)

        invite_response = self.client.post(
            f"/api/projects/admin/marketplace/listings/{self.unclaimed_listing.id}/invite/",
            {"preferred_channel": "sms"},
            format="json",
        )

        self.assertEqual(invite_response.status_code, 200, invite_response.data)
        payload = invite_response.json()
        self.assertIn("claim_link", payload)
        invite = ContractorDiscoveryInvite.objects.get(directory_listing=self.unclaimed_listing)
        self.assertEqual(invite.status, ContractorDiscoveryInvite.STATUS_SENT)
        self.assertIsNotNone(invite.sent_at)
