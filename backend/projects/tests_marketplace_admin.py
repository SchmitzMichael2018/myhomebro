from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor, Notification, PublicContractorLead
from projects.models_customer_portal import SmartNotification, SmartNotificationEvent
from projects.models_contractor_discovery import ContractorDirectoryListing, ContractorDiscoveryInvite, ContractorOpportunity, MarketplaceLocation
from projects.models_project_intake import ProjectIntake
from projects.services.marketplace_readiness import create_marketplace_invites_for_intake, eligible_marketplace_listings


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
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
            charges_enabled=True,
            payouts_enabled=True,
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
        self.assertGreaterEqual(len(payload["coverage"]["location_readiness"]), 1)
        austin = next(row for row in payload["coverage"]["location_readiness"] if row["city"] == "Austin")
        self.assertEqual(austin["counts"]["total_discovered"], 1)
        self.assertEqual(austin["counts"]["claimed_contractors"], 1)
        self.assertFalse(austin["enabled"])

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

    @override_settings(
        MYHOMEBRO_MARKETPLACE_MIN_CLAIMED_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_VERIFIED_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_STRIPE_READY_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_TRADE_CATEGORIES=1,
    )
    def test_admin_can_enable_ready_marketplace_location(self):
        self.claimed_contractor.charges_enabled = True
        self.claimed_contractor.payouts_enabled = True
        self.claimed_contractor.save(update_fields=["charges_enabled", "payouts_enabled", "updated_at"])

        response = self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": "Austin", "state": "TX", "enabled": True, "max_bids_per_request": 9},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["status"], "enabled")
        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["max_bids_per_request"], 5)
        location = MarketplaceLocation.objects.get(city="Austin", state="TX")
        self.assertTrue(location.is_enabled)
        self.assertEqual(location.max_bids_per_request, 5)

    def test_admin_verification_actions_update_contractor_trust_state(self):
        self.claimed_contractor.marketplace_verification_status = Contractor.MARKETPLACE_PENDING_REVIEW
        self.claimed_contractor.marketplace_preferred = False
        self.claimed_contractor.save(update_fields=["marketplace_verification_status", "marketplace_preferred", "updated_at"])

        response = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "verify", "notes": "Profile reviewed."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.claimed_contractor.refresh_from_db()
        self.assertEqual(self.claimed_contractor.marketplace_verification_status, Contractor.MARKETPLACE_VERIFIED)
        self.assertEqual(self.claimed_contractor.marketplace_verified_by, self.admin_user)
        self.assertIsNotNone(self.claimed_contractor.marketplace_verified_at)

        preferred = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "mark_preferred", "reason": "High quality work."},
            format="json",
        )
        self.assertEqual(preferred.status_code, 200, preferred.data)
        self.claimed_contractor.refresh_from_db()
        self.assertTrue(self.claimed_contractor.marketplace_preferred)
        self.assertEqual(self.claimed_contractor.marketplace_preferred_by, self.admin_user)

        suspended = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "suspend", "reason": "Insurance issue."},
            format="json",
        )
        self.assertEqual(suspended.status_code, 200, suspended.data)
        self.claimed_contractor.refresh_from_db()
        self.assertEqual(self.claimed_contractor.marketplace_verification_status, Contractor.MARKETPLACE_SUSPENDED)
        self.assertFalse(self.claimed_contractor.marketplace_preferred)

        unsuspended = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "unsuspend"},
            format="json",
        )
        self.assertEqual(unsuspended.status_code, 200, unsuspended.data)
        self.claimed_contractor.refresh_from_db()
        self.assertEqual(self.claimed_contractor.marketplace_verification_status, Contractor.MARKETPLACE_UNVERIFIED)

    def test_admin_cannot_mark_unverified_or_suspended_contractor_preferred(self):
        self.claimed_contractor.marketplace_verification_status = Contractor.MARKETPLACE_UNVERIFIED
        self.claimed_contractor.save(update_fields=["marketplace_verification_status", "updated_at"])

        response = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "mark_preferred"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Only verified contractors", response.json()["detail"])

    def test_non_admin_cannot_change_marketplace_verification(self):
        user_model = get_user_model()
        non_admin = user_model.objects.create_user(email="not-admin@example.com", password="testpass123")
        self.client.force_authenticate(user=non_admin)

        response = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": self.claimed_contractor.id, "action": "suspend"},
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})


class MarketplaceGatingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_superuser(
            email="marketplace-gating-admin@example.com",
            password="testpass123",
        )
        self.contractors = []
        for index in range(6):
            user = user_model.objects.create_user(
                email=f"flooring-pro-{index}@example.com",
                password="testpass123",
            )
            contractor = Contractor.objects.create(
                user=user,
                business_name=f"Flooring Pro {index}",
                city="Austin",
                state="TX",
                charges_enabled=True,
                payouts_enabled=True,
                marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
            )
            self.contractors.append(contractor)
            ContractorDirectoryListing.objects.create(
                source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
                business_name=f"Flooring Pro {index}",
                city="Austin",
                state="TX",
                primary_trade="flooring",
                trade_categories=["flooring"],
                claimed_profile=True,
                claimed_contractor=contractor,
                manually_reviewed=True,
                google_review_count=50 - index,
            )
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
            business_name="Unclaimed Flooring Listing",
            city="Austin",
            state="TX",
            primary_trade="flooring",
            trade_categories=["flooring"],
            claimed_profile=False,
            manually_reviewed=True,
            google_review_count=99,
        )

    def _intake(self, *, city="Austin", state="TX"):
        intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            lead_source=ProjectIntake.SOURCE_LANDING_PAGE if hasattr(ProjectIntake, "SOURCE_LANDING_PAGE") else "landing_page",
            customer_name="Homeowner",
            customer_email="homeowner@example.com",
            project_city=city,
            project_state=state,
            project_postal_code="78701",
            accomplishment_text="Install luxury vinyl plank flooring in kitchen and hallway.",
            ai_project_type="Flooring",
            ai_project_subtype="Luxury Vinyl Plank",
        )
        intake.ensure_share_token()
        return intake

    def test_gated_city_saves_request_without_broadcasting(self):
        intake = self._intake(city="Dallas", state="TX")

        response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        intake.refresh_from_db()
        self.assertEqual(intake.post_submit_flow, "multi_contractor")
        self.assertFalse(response.json()["marketplace_available"])
        self.assertIn("not yet enabled", response.json()["marketplace"]["message"])
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 0)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake).count(), 0)
        self.assertEqual(PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(), 0)

        self.client.force_authenticate(user=self.admin_user)
        overview = self.client.get("/api/projects/admin/marketplace/")
        self.assertEqual(overview.status_code, 200, overview.data)
        saved = overview.json()["saved_marketplace_requests"]
        self.assertEqual(saved["summary"]["saved_not_routed"], 1)
        self.assertEqual(saved["summary"]["blocked_disabled"], 1)
        self.assertEqual(saved["results"][0]["id"], intake.id)
        self.assertFalse(saved["results"][0]["routable_now"])
        self.assertEqual(saved["results"][0]["reason"], "Marketplace is not enabled for this location yet.")

    def test_enabled_city_invites_max_five_claimed_verified_contractors(self):
        MarketplaceLocation.objects.create(
            city="Austin",
            state="TX",
            is_enabled=True,
            min_claimed_contractors=1,
            min_verified_contractors=1,
            min_stripe_ready_contractors=1,
            min_trade_categories=1,
            max_bids_per_request=5,
        )
        intake = self._intake()

        response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertTrue(payload["marketplace_available"])
        self.assertEqual(payload["marketplace"]["created_count"], 5)
        invites = ContractorDiscoveryInvite.objects.filter(public_intake=intake)
        self.assertEqual(invites.count(), 5)
        self.assertEqual(invites.filter(contractor__isnull=True).count(), 0)
        self.assertFalse(invites.filter(directory_listing__business_name="Unclaimed Flooring Listing").exists())
        opportunities = ContractorOpportunity.objects.filter(intake_request=intake)
        self.assertEqual(opportunities.count(), 5)
        self.assertEqual(opportunities.filter(directory_entry__claimed_by_contractor__isnull=True).count(), 0)
        leads = PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id)
        self.assertEqual(leads.count(), 5)
        self.assertEqual(leads.filter(status=PublicContractorLead.STATUS_READY_FOR_REVIEW).count(), 5)
        self.assertEqual(
            set(leads.values_list("contractor_id", flat=True)),
            set(invites.values_list("contractor_id", flat=True)),
        )
        self.assertTrue(all(row.ai_analysis.get("marketplace_request") for row in leads))

        repeat = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )
        self.assertEqual(repeat.status_code, 200, repeat.data)
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 5)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake).count(), 5)
        self.assertEqual(PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(), 5)
        self.assertTrue(repeat.json()["marketplace"]["cap_reached"])

    def test_suspended_and_rejected_contractors_are_excluded_from_marketplace_routing(self):
        self.contractors[0].marketplace_verification_status = Contractor.MARKETPLACE_SUSPENDED
        self.contractors[0].save(update_fields=["marketplace_verification_status", "updated_at"])
        self.contractors[1].marketplace_verification_status = Contractor.MARKETPLACE_REJECTED
        self.contractors[1].save(update_fields=["marketplace_verification_status", "updated_at"])
        MarketplaceLocation.objects.create(
            city="Austin",
            state="TX",
            is_enabled=True,
            min_claimed_contractors=1,
            min_verified_contractors=1,
            min_stripe_ready_contractors=1,
            min_trade_categories=1,
            max_bids_per_request=5,
        )
        intake = self._intake()

        response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        invited_contractors = set(
            ContractorDiscoveryInvite.objects.filter(public_intake=intake).values_list("contractor_id", flat=True)
        )
        self.assertNotIn(self.contractors[0].id, invited_contractors)
        self.assertNotIn(self.contractors[1].id, invited_contractors)
        self.assertEqual(len(invited_contractors), 4)

    def test_preferred_verified_contractors_rank_before_non_preferred_eligible_contractors(self):
        self.contractors[4].marketplace_preferred = True
        self.contractors[4].save(update_fields=["marketplace_preferred", "updated_at"])
        intake = self._intake()

        ordered = eligible_marketplace_listings(intake)

        self.assertGreaterEqual(len(ordered), 5)
        self.assertEqual(ordered[0].claimed_contractor_id, self.contractors[4].id)

    def test_admin_can_route_saved_request_after_location_enabled_without_duplicates(self):
        intake = self._intake()

        disabled_response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )
        self.assertEqual(disabled_response.status_code, 200, disabled_response.data)
        self.assertFalse(disabled_response.json()["marketplace_available"])

        MarketplaceLocation.objects.create(
            city="Austin",
            state="TX",
            is_enabled=True,
            min_claimed_contractors=1,
            min_verified_contractors=1,
            min_stripe_ready_contractors=1,
            min_trade_categories=1,
            max_bids_per_request=5,
        )

        self.client.force_authenticate(user=self.admin_user)
        route_response = self.client.post(
            "/api/projects/admin/marketplace/route-intake/",
            {"intake_id": intake.id},
            format="json",
        )

        self.assertEqual(route_response.status_code, 200, route_response.data)
        self.assertEqual(route_response.json()["created_count"], 5)
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 5)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake).count(), 5)
        self.assertEqual(PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(), 5)

        retry_response = self.client.post(
            "/api/projects/admin/marketplace/route-intake/",
            {"intake_id": intake.id},
            format="json",
        )
        self.assertEqual(retry_response.status_code, 200, retry_response.data)
        self.assertTrue(retry_response.json()["cap_reached"])
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 5)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake).count(), 5)
        self.assertEqual(PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(), 5)

    def test_marketplace_routing_creates_customer_and_contractor_notifications_once(self):
        MarketplaceLocation.objects.create(
            city="Austin",
            state="TX",
            is_enabled=True,
            min_claimed_contractors=1,
            min_verified_contractors=1,
            min_stripe_ready_contractors=1,
            min_trade_categories=1,
            max_bids_per_request=5,
        )
        intake = self._intake()

        result = create_marketplace_invites_for_intake(intake.id)

        self.assertEqual(result["created_count"], 5)
        lead = PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).first()
        self.assertIsNotNone(lead)
        self.assertTrue(
            Notification.objects.filter(
                contractor_id=lead.contractor_id,
                public_lead=lead,
                event_type=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
            ).exists()
        )
        self.assertEqual(
            SmartNotification.objects.filter(
                recipient_email="homeowner@example.com",
                event_type=SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED,
            ).count(),
            1,
        )
        self.assertEqual(
            SmartNotification.objects.filter(
                recipient_email="homeowner@example.com",
                event_type=SmartNotificationEvent.CUSTOMER_BID_RECEIVED,
            ).count(),
            5,
        )

        create_marketplace_invites_for_intake(intake.id)

        self.assertEqual(
            Notification.objects.filter(event_type=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED).count(),
            5,
        )
        self.assertEqual(
            SmartNotification.objects.filter(event_type=SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED).count(),
            1,
        )

    def test_verification_action_notifies_only_target_contractor(self):
        target = self.contractors[0]
        other = self.contractors[1]
        target.marketplace_verification_status = Contractor.MARKETPLACE_PENDING_REVIEW
        target.save(update_fields=["marketplace_verification_status", "updated_at"])
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post(
            "/api/projects/admin/marketplace/verification/",
            {"contractor_id": target.id, "action": "verify", "notes": "Looks good."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            Notification.objects.filter(
                contractor=target,
                event_type=Notification.EVENT_MARKETPLACE_VERIFICATION_APPROVED,
            ).exists()
        )
        self.assertFalse(
            Notification.objects.filter(
                contractor=other,
                event_type=Notification.EVENT_MARKETPLACE_VERIFICATION_APPROVED,
            ).exists()
        )
