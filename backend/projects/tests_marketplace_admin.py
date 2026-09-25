from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, ContractorPublicProfile, Homeowner, Notification, Project, ProjectStatus, PublicContractorLead
from projects.models_customer_portal import CustomerRequest, SmartNotification, SmartNotificationEvent
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorDirectoryListing, ContractorDiscoveryInvite, ContractorOpportunity, MarketplaceAutomaticMatchingApproval, MarketplaceLocation
from projects.models_project_intake import ProjectIntake
from projects.services.contractor_discovery import create_discovery_invites
from projects.services.marketplace_readiness import automatic_matching_readiness, create_marketplace_invites_for_intake, eligible_marketplace_listings, location_readiness, marketplace_enabled_for_intake
from projects.services.marketplace_coverage_map import build_marketplace_coverage_map


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

        lightweight = self.client.get(
            "/api/projects/admin/marketplace/",
            {"include_readiness": "false"},
        ).json()
        self.assertEqual(lightweight["coverage"]["automatic_matching_readiness"], [])
        self.assertEqual(lightweight["coverage"]["location_readiness"], [])

    def test_lightweight_overview_query_count_is_not_per_location(self):
        with CaptureQueriesContext(connection) as small:
            self.client.get("/api/projects/admin/marketplace/", {"include_readiness": "false"})
        for index in range(20):
            ContractorDirectoryListing.objects.create(
                source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
                google_place_id=f"overview-query-place-{index}",
                business_name=f"Overview business {index}",
                city=f"Overview City {index}",
                state="TX",
                primary_trade="roofing",
            )
        with CaptureQueriesContext(connection) as large:
            response = self.client.get("/api/projects/admin/marketplace/", {"include_readiness": "false"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["coverage"]["location_readiness"], [])
        self.assertLessEqual(len(large), len(small) + 2)

    def test_legacy_saved_request_without_location_is_not_nearing_ready_or_routable(self):
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            google_place_id="unlocated-legacy-listing",
            business_name="Unlocated directory entry",
            primary_trade="flooring",
        )
        intake = ProjectIntake.objects.create(
            lead_source="landing_page", status="submitted",
            ai_project_title="Legacy project", ai_project_type="Flooring",
        )

        self.assertEqual(location_readiness("", "")["status"], "location_needed")
        response = self.client.get("/api/projects/admin/marketplace/")
        self.assertEqual(response.status_code, 200, response.data)
        saved = response.json()["saved_marketplace_requests"]
        row = next(item for item in saved["results"] if item["id"] == intake.id)
        self.assertEqual(row["marketplace_status"], "location_needed")
        self.assertFalse(row["location_complete"])
        self.assertFalse(row["routable_now"])
        self.assertEqual(row["city"], "")
        self.assertEqual(row["state"], "")
        self.assertEqual(row["customer_email"], "")
        self.assertEqual(saved["summary"]["blocked_location_missing"], 1)
        self.assertEqual(saved["summary"]["blocked_disabled"], 0)
        self.assertNotIn(", ", saved["by_location"])
        intake.project_postal_code = "78701"
        intake.save(update_fields=["project_postal_code"])
        partial = self.client.get("/api/projects/admin/marketplace/").json()["saved_marketplace_requests"]["results"][0]
        self.assertEqual(partial["zip"], "78701")
        self.assertEqual(partial["marketplace_status"], "location_needed")
        route = self.client.post("/api/projects/admin/marketplace/route-intake/", {"intake_id": intake.id}, format="json")
        self.assertEqual(route.status_code, 202)
        self.assertEqual(route.json()["created_count"], 0)

    def test_saved_request_recovers_complete_customer_address_and_linked_contact(self):
        homeowner = Homeowner.objects.create(
            created_by=self.claimed_contractor,
            full_name="Linked Customer", email="linked@example.com",
            phone_number="5550102000",
        )
        intake = ProjectIntake.objects.create(
            lead_source="landing_page", status="submitted", homeowner=homeowner,
            project_city=" Austin ", customer_city="Dallas", customer_state="TX",
            customer_postal_code="75201", ai_project_type="Roofing",
        )
        # A partial project address must not be combined with the customer state.
        response = self.client.get("/api/projects/admin/marketplace/")
        self.assertEqual(response.status_code, 200, response.data)
        row = next(item for item in response.json()["saved_marketplace_requests"]["results"] if item["id"] == intake.id)
        self.assertEqual((row["city"], row["state"], row["zip"]), ("Dallas", "TX", "75201"))
        self.assertTrue(row["location_complete"])
        self.assertEqual(row["customer_name"], homeowner.full_name)
        self.assertEqual(row["customer_email"], homeowner.email)
        self.assertEqual(row["customer_phone"], homeowner.phone_number)
        self.assertNotEqual(row["marketplace_status"], "location_needed")
        self.assertFalse(row["marketplace_enabled"])
        detail = self.client.get(f"/api/projects/admin/requests/{intake.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["customer"]["email"], homeowner.email)

        intake.project_city = ""
        intake.same_as_customer_address = False
        intake.save(update_fields=["project_city", "same_as_customer_address"])
        separate_address = self.client.get("/api/projects/admin/marketplace/").json()["saved_marketplace_requests"]["results"][0]
        self.assertEqual(separate_address["marketplace_status"], "location_needed")

        intake.customer_city = ""
        intake.save(update_fields=["customer_city"])
        route = self.client.post("/api/projects/admin/marketplace/route-intake/", {"intake_id": intake.id}, format="json")
        self.assertEqual(route.status_code, 202)
        self.assertEqual(route.json()["marketplace"]["status"], "location_needed")

    def test_overview_does_not_truncate_automatic_matching_rows(self):
        rows = [
            {"city": "Austin", "state": "TX", "trade": f"trade-{index}"}
            for index in range(101)
        ]
        with patch(
            "adminpanel.views_marketplace.automatic_matching_readiness_rows_for_locations",
            return_value=rows,
        ):
            response = self.client.get("/api/projects/admin/marketplace/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.json()["coverage"]["automatic_matching_readiness"]), 101)

    def test_approval_only_location_is_visible_without_duplicate_case_variant_rows(self):
        MarketplaceAutomaticMatchingApproval.objects.create(
            city_key="San Antonio", state_key="tx", trade="roofing", is_approved=False,
        )
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            business_name="Unclaimed San Antonio Listing",
            city="SAN ANTONIO", state="TX", primary_trade="roofing",
        )
        response = self.client.get("/api/projects/admin/marketplace/")
        self.assertEqual(response.status_code, 200, response.data)
        rows = [
            row for row in response.json()["coverage"]["automatic_matching_readiness"]
            if row["city"].casefold() == "san antonio" and row["trade"] == "roofing"
        ]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["can_auto_route"])

    @override_settings(
        MYHOMEBRO_MARKETPLACE_MIN_CLAIMED_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_VERIFIED_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_STRIPE_READY_CONTRACTORS=1,
        MYHOMEBRO_MARKETPLACE_MIN_TRADE_CATEGORIES=1,
    )
    def test_marketplace_request_statuses_are_backend_authoritative(self):
        intake = ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Austin",
            project_state="TX",
            ai_project_type="Roofing",
        )

        row = self.client.get("/api/projects/admin/marketplace/requests/").json()["results"][0]
        self.assertEqual(row["id"], intake.id)
        self.assertEqual(row["marketplace_status"], "coverage_not_activated")
        self.assertEqual(row["marketplace_status_label"], "Coverage not activated")
        self.assertFalse(row["routable_now"])

        self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": "Austin", "state": "TX", "trade": "roofing", "enabled": True},
            format="json",
        )
        active = self.client.get("/api/projects/admin/marketplace/requests/").json()["results"][0]
        self.assertEqual(active["marketplace_status"], "active")
        self.assertTrue(active["routable_now"])

        self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": "Austin", "state": "TX", "trade": "roofing", "enabled": False},
            format="json",
        )
        paused = self.client.get("/api/projects/admin/marketplace/requests/").json()["results"][0]
        self.assertEqual(paused["marketplace_status"], "routing_paused")
        self.assertFalse(paused["routable_now"])

    def test_marketplace_request_queue_is_server_paginated_and_filterable(self):
        for index in range(27):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city="Austin" if index % 2 == 0 else "Dallas",
                project_state="TX",
                ai_project_type="Roofing" if index % 2 == 0 else "Plumbing",
                customer_name=f"Customer {index}",
            )

        response = self.client.get(
            "/api/projects/admin/marketplace/requests/",
            {"page": 2, "page_size": 10, "city": "Austin", "trade": "Roofing"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["pagination"]["page"], 2)
        self.assertEqual(payload["pagination"]["page_size"], 10)
        self.assertEqual(payload["pagination"]["total"], 14)
        self.assertEqual(len(payload["results"]), 4)
        self.assertTrue(all(row["city"] == "Austin" for row in payload["results"]))
        self.assertEqual(payload["summary"]["total"], 14)
        self.assertEqual(payload["summary"]["saved_not_routed"], 14)
        self.assertEqual(sum(payload["summary"]["operational_statuses"].values()), 14)

    def test_marketplace_status_filter_applies_before_stable_pagination(self):
        matching = [
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                ai_project_title=f"Location needed {index}",
            )
            for index in range(15)
        ]
        nonmatching = [
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city="Dallas",
                project_state="TX",
                ai_project_title=f"Newer located request {index}",
            )
            for index in range(25)
        ]
        newer_timestamp = timezone.now()
        shared_timestamp = newer_timestamp - timedelta(days=1)
        ProjectIntake.objects.filter(id__in=[row.id for row in matching]).update(
            post_submit_flow_selected_at=shared_timestamp,
            created_at=shared_timestamp,
        )
        ProjectIntake.objects.filter(id__in=[row.id for row in nonmatching]).update(
            post_submit_flow_selected_at=newer_timestamp,
            created_at=newer_timestamp,
        )

        first = self.client.get(
            "/api/projects/admin/marketplace/requests/",
            {"marketplace_status": "location_needed", "page": 1, "page_size": 10},
        )
        second = self.client.get(
            "/api/projects/admin/marketplace/requests/",
            {"marketplace_status": "location_needed", "page": 2, "page_size": 10},
        )

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        first_payload = first.json()
        second_payload = second.json()
        self.assertEqual(first_payload["pagination"], {
            "page": 1,
            "page_size": 10,
            "total": 15,
            "total_pages": 2,
            "has_previous": False,
            "has_next": True,
        })
        self.assertEqual(second_payload["pagination"], {
            "page": 2,
            "page_size": 10,
            "total": 15,
            "total_pages": 2,
            "has_previous": True,
            "has_next": False,
        })
        first_ids = [row["id"] for row in first_payload["results"]]
        second_ids = [row["id"] for row in second_payload["results"]]
        expected_ids = sorted((row.id for row in matching), reverse=True)
        self.assertEqual(first_ids + second_ids, expected_ids)
        self.assertEqual(len(set(first_ids + second_ids)), 15)
        self.assertEqual(first_payload["summary"]["total"], 15)
        self.assertEqual(first_payload["summary"]["blocked_location_missing"], 15)
        self.assertEqual(first_payload["summary"]["operational_statuses"], {"location_needed": 15})

    def test_marketplace_overview_aggregates_all_requests_beyond_card_limit(self):
        for index in range(15):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city="Austin",
                project_state="TX",
                ai_project_title=f"Older Austin request {index}",
            )
        for index in range(15):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city="Dallas",
                project_state="TX",
                ai_project_title=f"Newer Dallas request {index}",
            )
        for index in range(4):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                ai_project_title=f"Newest location-needed request {index}",
            )

        response = self.client.get("/api/projects/admin/marketplace/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        requests = payload["saved_marketplace_requests"]
        self.assertEqual(len(requests["results"]), 25)
        self.assertEqual(requests["summary"]["total"], 34)
        self.assertEqual(requests["summary"]["saved_not_routed"], 34)
        self.assertEqual(requests["summary"]["blocked_location_missing"], 4)
        self.assertEqual(sum(requests["summary"]["operational_statuses"].values()), 34)
        self.assertEqual(requests["summary"]["operational_statuses"]["location_needed"], 4)
        self.assertEqual(requests["by_location"]["Austin, TX"]["saved_not_routed"], 15)
        self.assertEqual(requests["by_location"]["Dallas, TX"]["saved_not_routed"], 15)
        self.assertEqual(requests["pagination"]["total"], 34)
        self.assertTrue(requests["pagination"]["has_next"])
        readiness = {
            f"{row['city']}, {row['state']}": row["marketplace_backlog"]
            for row in payload["coverage"]["location_readiness"]
        }
        self.assertEqual(readiness["Austin, TX"]["saved_not_routed"], 15)
        self.assertEqual(readiness["Dallas, TX"]["saved_not_routed"], 15)

    def test_coverage_defaults_to_safe_state_aggregation_and_never_exposes_residential_coordinates(self):
        self.claimed_listing.latitude = 30.2672
        self.claimed_listing.longitude = -97.7431
        self.claimed_listing.zip_code = "78701"
        self.claimed_listing.save(update_fields=["latitude", "longitude", "zip_code", "updated_at"])
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            project_address_line1="Private home address",
            ai_project_type="Roofing",
        )
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            ai_project_type="Plumbing",
        )

        response = self.client.get("/api/projects/admin/marketplace/coverage/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        texas = next(row for row in payload["points"] if row["state"] == "TX")
        self.assertEqual(payload["aggregation_level"], "state")
        self.assertEqual(texas["coordinate_source"], "public_state_center")
        self.assertEqual(texas["counts"]["active_demand"], 1)
        self.assertEqual(texas["counts"]["eligible_claimed_supply"], 1)
        self.assertNotEqual(
            (texas["latitude"], texas["longitude"]),
            (30.2672, -97.7431),
        )
        self.assertNotIn("address", str(payload).lower())
        self.assertNotIn("customer", str(payload).lower())
        self.assertNotIn("private home", str(payload).lower())
        self.assertEqual(payload["unlocated"]["requests"], 1)

    def test_coverage_progresses_from_state_to_city_to_zip_using_business_centroids(self):
        self.claimed_listing.latitude = 30.2672
        self.claimed_listing.longitude = -97.7431
        self.claimed_listing.zip_code = "78701"
        self.claimed_listing.save(update_fields=["latitude", "longitude", "zip_code", "updated_at"])
        for index, point in enumerate(((30.271, -97.741), (30.279, -97.749))):
            ContractorDirectoryListing.objects.create(
                source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
                google_place_id=f"public-austin-{index}",
                business_name=f"Public business {index}",
                city="Austin", state="TX", zip_code="78701",
                latitude=point[0], longitude=point[1],
                primary_trade="roofing",
            )
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            ai_project_type="Roofing",
        )

        national = self.client.get("/api/projects/admin/marketplace/coverage/", {"zoom": 4}).json()
        city = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"zoom": 6, "state": "TX"},
        ).json()
        zip_level = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"zoom": 10, "state": "TX", "city": "Austin"},
        ).json()

        self.assertEqual(national["aggregation_level"], "state")
        self.assertEqual(city["aggregation_level"], "city")
        self.assertEqual(zip_level["aggregation_level"], "zip")
        self.assertEqual(city["points"][0]["city"], "Austin")
        self.assertEqual(zip_level["points"][0]["zip"], "78701")
        self.assertEqual(city["points"][0]["coordinate_source"], "public_directory_business_centroid")
        self.assertEqual(zip_level["points"][0]["coordinate_source"], "public_directory_business_centroid")
        for payload in (national, city, zip_level):
            row = payload["coverage_areas"]["results"][0]
            marker = payload["points"][0]
            self.assertTrue(row["has_marker"])
            self.assertEqual(
                (row["latitude"], row["longitude"], row["coordinate_source"]),
                (marker["latitude"], marker["longitude"], marker["coordinate_source"]),
            )
        self.assertNotEqual((city["points"][0]["latitude"], city["points"][0]["longitude"]), (30.2672, -97.7431))
        self.assertEqual(city["points"][0]["coverage_classification"], "covered")

    def test_coverage_does_not_use_single_or_private_business_coordinate_as_demand_point(self):
        self.claimed_listing.latitude = 30.2672
        self.claimed_listing.longitude = -97.7431
        self.claimed_listing.zip_code = "78701"
        self.claimed_listing.save(update_fields=["latitude", "longitude", "zip_code", "updated_at"])
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
            google_place_id="only-public-place",
            business_name="One public business",
            city="Austin", state="TX", zip_code="78701",
            latitude=30.271, longitude=-97.741,
        )
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor", status="submitted",
            project_city="Austin", project_state="TX", project_postal_code="78701",
            project_address_line1="Private home address", ai_project_type="Roofing",
        )
        payload = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"aggregation_level": "zip", "state": "TX", "city": "Austin"},
        ).json()
        self.assertEqual(payload["points"], [])
        self.assertEqual(payload["summary"]["active_demand"], 1)
        self.assertEqual(payload["location_needed"]["active_demand"], 1)
        self.assertNotIn("Private home address", str(payload))

    def test_coverage_excludes_draft_converted_and_cancelled_demand(self):
        for status in ("draft", "converted"):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor", status=status,
                project_city="Austin", project_state="TX", ai_project_type="Roofing",
            )
        cancelled = ProjectIntake.objects.create(
            post_submit_flow="multi_contractor", status="submitted",
            project_city="Austin", project_state="TX", ai_project_type="Roofing",
        )
        CustomerRequest.objects.create(
            source_intake=cancelled,
            status=CustomerRequest.STATUS_CANCELLED,
            customer_email="cancelled-test@example.com",
            request_type=CustomerRequest.TYPE_REPAIR,
            title="Cancelled test request",
            description="Test-only record",
        )
        payload = self.client.get("/api/projects/admin/marketplace/coverage/").json()
        self.assertEqual(payload["summary"].get("active_demand", 0), 0)

    def test_coverage_query_count_does_not_grow_per_request(self):
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor", status="submitted",
            project_city="Austin", project_state="TX", ai_project_type="Roofing",
        )
        with CaptureQueriesContext(connection) as small:
            build_marketplace_coverage_map({})
        for _ in range(25):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor", status="submitted",
                project_city="Austin", project_state="TX", ai_project_type="Roofing",
            )
        with CaptureQueriesContext(connection) as large:
            result = build_marketplace_coverage_map({})
        self.assertEqual(result["summary"]["active_demand"], 26)
        self.assertLessEqual(len(large), len(small) + 2)

    def test_coverage_summary_counts_a_claimed_contractor_once_across_areas(self):
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            google_place_id="same-claimed-second-location",
            business_name="Claimed Pro second location",
            city="Dallas", state="TX", primary_trade="roofing",
            claimed_profile=True, claimed_contractor=self.claimed_contractor,
            manually_reviewed=True,
        )
        payload = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"aggregation_level": "city"},
        ).json()
        self.assertEqual(payload["summary"]["eligible_claimed_supply"], 1)

    def test_coverage_requires_admin_permission(self):
        user_model = get_user_model()
        regular_user = user_model.objects.create_user(
            email="coverage-non-admin@example.com",
        )
        self.client.force_authenticate(user=regular_user)

        response = self.client.get("/api/projects/admin/marketplace/coverage/")
        readiness_response = self.client.get("/api/projects/admin/marketplace/readiness/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(readiness_response.status_code, 403)

    def test_coverage_excludes_archived_demand_ineligible_supply_and_closed_prospects(self):
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Austin",
            project_state="TX",
            ai_project_type="Roofing",
            marketplace_archived_at=timezone.now(),
        )
        inactive_user = get_user_model().objects.create_user(
            email="inactive-coverage@example.com",
            is_active=False,
        )
        inactive_contractor = Contractor.objects.create(
            user=inactive_user,
            is_active=False,
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
            charges_enabled=True,
            payouts_enabled=True,
        )
        ContractorDirectoryListing.objects.create(
            google_place_id="inactive-claimed",
            business_name="Inactive Claimed",
            city="Austin",
            state="TX",
            claimed_profile=True,
            claimed_contractor=inactive_contractor,
            primary_trade="roofing",
        )
        ContractorDirectoryListing.objects.create(
            google_place_id="closed-prospect",
            business_name="Closed Prospect",
            city="Austin",
            state="TX",
            business_status="CLOSED_PERMANENTLY",
            primary_trade="roofing",
        )
        ContractorDirectoryEntry.objects.create(
            business_name="Archived Prospect",
            normalized_name="archived prospect",
            city="Austin",
            state="TX",
            primary_service="roofing",
            is_archived=True,
        )

        payload = self.client.get("/api/projects/admin/marketplace/coverage/").json()
        texas = next(row for row in payload["points"] if row["state"] == "TX")

        self.assertEqual(texas["counts"]["active_demand"], 0)
        self.assertEqual(texas["counts"]["eligible_claimed_supply"], 1)
        self.assertEqual(texas["counts"]["directory_prospects"], 1)
        self.assertEqual(texas["coverage_classification"], "supply_only")

    def test_coverage_filters_before_aggregation_and_reports_complete_totals(self):
        old = timezone.now() - timedelta(days=120)
        for index in range(125):
            intake = ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city="Austin" if index % 2 == 0 else "Dallas",
                project_state="TX",
                project_postal_code="78701" if index % 2 == 0 else "75201",
                ai_project_type="Roofing" if index % 2 == 0 else "Plumbing",
            )
            if index == 0:
                ProjectIntake.objects.filter(pk=intake.pk).update(
                    submitted_at=old,
                    post_submit_flow_selected_at=old,
                    created_at=old,
                )

        roofing = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"trade": "roofing", "date_range": "30d", "zoom": 4},
        ).json()
        bounded_out = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {
                "date_range": "all",
                "south": 20,
                "west": -90,
                "north": 30,
                "east": -80,
            },
        ).json()

        self.assertEqual(roofing["summary"]["active_demand"], 62)
        self.assertEqual(roofing["summary"]["area_count"], 1)
        self.assertEqual(roofing["points"][0]["counts"]["active_demand"], 62)
        self.assertEqual(bounded_out["summary"]["active_demand"], 125)
        self.assertEqual(bounded_out["points"], [])
        self.assertFalse(roofing["limited"])
        ids = [row["id"] for row in roofing["points"]]
        self.assertEqual(ids, sorted(ids))

    def test_coverage_areas_are_server_paged_sorted_and_independent_of_map_points(self):
        states = [
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
            "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
            "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        ]
        for index, state in enumerate(states, start=1):
            ProjectIntake.objects.create(
                post_submit_flow="multi_contractor",
                status="submitted",
                project_city=f"Coverage City {index}",
                project_state=state,
                project_postal_code=f"{index:05d}",
                ai_project_type="Roofing",
            )

        first = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"aggregation_level": "state", "coverage_sort": "area_name"},
        ).json()
        second = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {
                "aggregation_level": "state",
                "coverage_page": 2,
                "coverage_sort": "area_name",
            },
        ).json()

        self.assertEqual(first["coverage_areas"]["pagination"]["page_size"], 25)
        self.assertEqual(len(first["coverage_areas"]["results"]), 25)
        self.assertGreater(first["coverage_areas"]["pagination"]["total"], 25)
        self.assertEqual(first["summary"]["area_count"], first["coverage_areas"]["pagination"]["total"])
        self.assertGreater(len(first["points"]), len(second["coverage_areas"]["results"]))
        first_ids = {row["id"] for row in first["coverage_areas"]["results"]}
        second_ids = {row["id"] for row in second["coverage_areas"]["results"]}
        self.assertFalse(first_ids & second_ids)
        ordered_ids = [
            row["id"]
            for row in first["coverage_areas"]["results"] + second["coverage_areas"]["results"]
        ]
        self.assertEqual(ordered_ids, sorted(ordered_ids))

        invalid = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"coverage_page": 999, "coverage_page_size": 1000},
        ).json()["coverage_areas"]["pagination"]
        self.assertEqual(invalid["page_size"], 25)
        self.assertEqual(invalid["page"], invalid["total_pages"])

        for page_size in (25, 50, 100):
            pagination = self.client.get(
                "/api/projects/admin/marketplace/coverage/",
                {"coverage_page_size": page_size},
            ).json()["coverage_areas"]["pagination"]
            self.assertEqual(pagination["page_size"], page_size)

    def test_unmapped_coverage_area_remains_in_precise_paginated_results(self):
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Demand Only",
            project_state="TX",
            project_postal_code="79999",
            project_address_line1="Private homeowner location",
            ai_project_type="Roofing",
        )

        payload = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {
                "aggregation_level": "city",
                "state": "TX",
                "city": "Demand Only",
            },
        ).json()

        self.assertEqual(payload["points"], [])
        self.assertEqual(payload["coverage_areas"]["pagination"]["total"], 1)
        area = payload["coverage_areas"]["results"][0]
        self.assertFalse(area["has_marker"])
        self.assertEqual(area["coverage_status"], "location_needed")
        self.assertEqual(area["coverage_status_label"], "Map location unavailable")
        self.assertNotIn("latitude", area)
        self.assertNotIn("longitude", area)
        self.assertNotIn("Private homeowner location", str(payload))

    def test_automatic_matching_readiness_has_independent_server_pagination(self):
        for index in range(30):
            ContractorDirectoryListing.objects.create(
                source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
                google_place_id=f"readiness-place-{index}",
                business_name=f"Readiness Business {index}",
                city=f"Readiness City {index:02d}",
                state="TX",
                primary_trade="roofing",
                trade_categories=["roofing"],
            )

        first = self.client.get(
            "/api/projects/admin/marketplace/readiness/",
            {"readiness_sort": "location"},
        ).json()
        second = self.client.get(
            "/api/projects/admin/marketplace/readiness/",
            {"readiness_page": 2, "readiness_sort": "location"},
        ).json()

        self.assertEqual(first["pagination"]["page_size"], 25)
        self.assertEqual(len(first["results"]), 25)
        self.assertGreater(first["pagination"]["total"], 25)
        first_keys = {(row["state"], row["city"], row["trade"]) for row in first["results"]}
        second_keys = {(row["state"], row["city"], row["trade"]) for row in second["results"]}
        self.assertFalse(first_keys & second_keys)

        filtered = self.client.get(
            "/api/projects/admin/marketplace/readiness/",
            {
                "readiness_city": "Readiness City 07",
                "readiness_trade": "roofing",
                "readiness_page_size": 50,
            },
        ).json()
        self.assertEqual(filtered["pagination"]["total"], 1)
        self.assertEqual(filtered["results"][0]["city"], "Readiness City 07")
        self.assertEqual(filtered["pagination"]["page_size"], 50)

        invalid = self.client.get(
            "/api/projects/admin/marketplace/readiness/",
            {"readiness_page": 999, "readiness_page_size": 101},
        ).json()["pagination"]
        self.assertEqual(invalid["page_size"], 25)
        self.assertEqual(invalid["page"], invalid["total_pages"])

        for page_size in (25, 50, 100):
            pagination = self.client.get(
                "/api/projects/admin/marketplace/readiness/",
                {"readiness_page_size": page_size},
            ).json()["pagination"]
            self.assertEqual(pagination["page_size"], page_size)

    def test_readiness_query_count_does_not_grow_per_location(self):
        with CaptureQueriesContext(connection) as small:
            self.client.get("/api/projects/admin/marketplace/readiness/")
        for index in range(20):
            ContractorDirectoryListing.objects.create(
                source=ContractorDirectoryListing.SOURCE_GOOGLE_PLACES,
                google_place_id=f"query-count-place-{index}",
                business_name=f"Query Count Business {index}",
                city=f"Query Count City {index}",
                state="TX",
                primary_trade="roofing",
                trade_categories=["roofing"],
            )

        with CaptureQueriesContext(connection) as large:
            response = self.client.get("/api/projects/admin/marketplace/readiness/")

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(large), len(small) + 2)

    def test_city_aggregation_without_safe_representative_point_is_location_needed(self):
        ProjectIntake.objects.create(
            post_submit_flow="multi_contractor",
            status="submitted",
            project_city="Demand Only",
            project_state="TX",
            project_postal_code="79999",
            ai_project_type="Roofing",
        )

        payload = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"zoom": 6, "state": "TX", "city": "Demand Only"},
        ).json()

        self.assertEqual(payload["points"], [])
        self.assertEqual(payload["location_needed"]["active_demand"], 1)
        self.assertEqual(payload["summary"]["active_demand"], 1)

        supply_only = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"zoom": 6, "state": "TX", "city": "Demand Only", "layer": "claimed_supply"},
        ).json()
        self.assertEqual(supply_only["summary"]["active_demand"], 0)
        self.assertEqual(supply_only["location_needed"]["active_demand"], 0)

        no_layers = self.client.get(
            "/api/projects/admin/marketplace/coverage/",
            {"zoom": 6, "state": "TX", "city": "Demand Only", "layer": "none"},
        ).json()
        self.assertEqual(no_layers["points"], [])
        self.assertEqual(no_layers["summary"]["active_demand"], 0)

    def test_marketplace_analytics_reports_funnel_city_and_contractor_conversion(self):
        profile = ContractorPublicProfile.objects.create(contractor=self.claimed_contractor)
        homeowner = Homeowner.objects.create(
            created_by=self.claimed_contractor,
            full_name="Austin Customer",
            email="austin-customer@example.com",
        )
        request = ProjectIntake.objects.create(
            initiated_by="homeowner",
            post_submit_flow="multi_contractor",
            status="submitted",
            customer_name="Austin Customer",
            customer_email=homeowner.email,
            project_city="Austin",
            project_state="TX",
            accomplishment_text="Install luxury vinyl plank flooring.",
            ai_project_type="Flooring",
            submitted_at=timezone.now(),
        )
        request.ensure_share_token()
        zero_bid = ProjectIntake.objects.create(
            initiated_by="homeowner",
            post_submit_flow="multi_contractor",
            status="submitted",
            customer_name="Dallas Customer",
            customer_email="dallas@example.com",
            project_city="Dallas",
            project_state="TX",
            accomplishment_text="Repair porch columns.",
            ai_project_type="Carpentry",
            submitted_at=timezone.now(),
        )
        zero_bid.ensure_share_token()
        entry = ContractorDirectoryEntry.objects.create(
            business_name="Claimed Pro LLC",
            city="Austin",
            state="TX",
            primary_service="flooring",
            claimed=True,
            claimed_by_contractor=self.claimed_contractor,
        )
        ContractorDiscoveryInvite.objects.create(
            public_intake=request,
            contractor=self.claimed_contractor,
            directory_listing=self.claimed_listing,
            status=ContractorDiscoveryInvite.STATUS_SENT,
            sent_at=timezone.now(),
        )
        ContractorOpportunity.objects.create(
            directory_entry=entry,
            intake_request=request,
            project_city="Austin",
            project_state="TX",
            project_type="Flooring",
            accepted_by_contractor=self.claimed_contractor,
            status=ContractorOpportunity.STATUS_ACCEPTED,
        )
        project = Project.objects.create(
            contractor=self.claimed_contractor,
            homeowner=homeowner,
            title="Awarded Flooring Project",
            status=ProjectStatus.DRAFT,
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.claimed_contractor,
            homeowner=homeowner,
            description="Awarded marketplace draft",
            project_type="Flooring",
            status=ProjectStatus.DRAFT,
            total_cost=Decimal("5000.00"),
        )
        PublicContractorLead.objects.create(
            contractor=self.claimed_contractor,
            public_profile=profile,
            source=PublicContractorLead.SOURCE_QUOTE_REQUEST,
            full_name=homeowner.full_name,
            email=homeowner.email,
            city="Austin",
            state="TX",
            project_type="Flooring",
            project_description="Install luxury vinyl plank flooring.",
            budget_text="$5,000",
            status=PublicContractorLead.STATUS_ACCEPTED,
            ai_analysis={"source_intake_id": request.id, "suggested_total_price": "5000"},
            converted_homeowner=homeowner,
            converted_agreement=agreement,
            converted_at=timezone.now(),
        )
        MarketplaceLocation.objects.create(city="Austin", state="TX", is_enabled=True)

        response = self.client.get("/api/projects/admin/marketplace/analytics/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["funnel"]["requests_submitted"], 2)
        self.assertEqual(payload["funnel"]["requests_routed"], 1)
        self.assertEqual(payload["funnel"]["bids_submitted"], 1)
        self.assertEqual(payload["funnel"]["requests_with_zero_bids"], 1)
        self.assertEqual(payload["funnel"]["awarded_requests"], 1)
        self.assertEqual(payload["funnel"]["agreement_drafts_created"], 1)
        self.assertEqual(payload["conversion_rates"]["request_to_routed"], 50.0)
        austin = next(row for row in payload["city_analytics"] if row["city"] == "Austin")
        self.assertEqual(austin["requests"], 1)
        self.assertEqual(austin["average_bids_per_request"], 1.0)
        contractor = payload["contractor_analytics"][0]
        self.assertEqual(contractor["business_name"], "Claimed Pro LLC")
        self.assertEqual(contractor["bids_submitted"], 1)
        self.assertEqual(contractor["bids_won"], 1)
        self.assertEqual(contractor["win_rate"], 100.0)
        self.assertEqual(contractor["average_bid_amount"], "5000.00")
        self.assertEqual(payload["attention_queues"]["zero_bid_requests"][0]["id"], zero_bid.id)
        self.assertEqual(payload["location_summary"]["enabled_cities"], 1)

        filtered = self.client.get("/api/projects/admin/marketplace/analytics/", {"city": "Dallas"})
        self.assertEqual(filtered.status_code, 200, filtered.data)
        self.assertEqual(filtered.json()["funnel"]["requests_submitted"], 1)
        self.assertEqual(filtered.json()["funnel"]["bids_submitted"], 0)

    def test_marketplace_analytics_requires_admin(self):
        regular = get_user_model().objects.create_user(email="not-admin@example.com", password="testpass123")
        self.client.force_authenticate(user=regular)

        response = self.client.get("/api/projects/admin/marketplace/analytics/")

        self.assertEqual(response.status_code, 403)

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
        self.assertEqual(payload["results"][0]["label"], "Profile Reviewed")
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
            {"city": "Austin", "state": "TX", "trade": "roofing", "enabled": True, "max_bids_per_request": 9},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["status"], "active")
        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["max_bids_per_request"], 5)
        location = MarketplaceLocation.objects.get(city="Austin", state="TX")
        self.assertFalse(location.is_enabled)
        self.assertTrue(MarketplaceAutomaticMatchingApproval.objects.get(
            city_key="austin", state_key="TX", trade="roofing",
        ).is_approved)
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
    def _approve(self, trade="flooring", city="Austin", state="TX"):
        return MarketplaceAutomaticMatchingApproval.objects.create(
            city_key=city, state_key=state, trade=trade, is_approved=True,
            updated_by=self.admin_user,
        )

    def test_legacy_city_enabled_and_sufficient_supply_still_requires_trade_approval(self):
        MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        intake = self._intake()
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "flooring")["status"], "awaiting_approval")
        self.assertFalse(marketplace_enabled_for_intake(intake)["can_auto_route"])
        self.assertEqual(create_marketplace_invites_for_intake(intake.id)["created_count"], 0)

    def test_approval_normalizes_location_and_rejects_case_variant_duplicate(self):
        self._approve("Flooring", "  AUSTIN  ", "tx")
        self.assertTrue(MarketplaceAutomaticMatchingApproval.objects.filter(
            city_key="austin", state_key="TX", trade="flooring", is_approved=True,
        ).exists())
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._approve("flooring", "Austin", "TX")

    def test_supply_counts_normalized_legacy_directory_location(self):
        MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=False,
            min_claimed_contractors=7, min_verified_contractors=7,
            min_stripe_ready_contractors=7,
        )
        self._approve()
        contractor = Contractor.objects.create(
            user=get_user_model().objects.create_user(email="padded-city@example.com", password="testpass123"),
            business_name="Padded City Pro", city="Austin", state="TX",
            charges_enabled=True, payouts_enabled=True,
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            business_name="Padded City Pro", city="  AUSTIN  ", state=" tx ",
            primary_trade="flooring", trade_categories=["flooring"],
            claimed_profile=True, claimed_contractor=contractor, manually_reviewed=True,
        )
        readiness = automatic_matching_readiness(" austin ", "Tx", "flooring")
        self.assertEqual(readiness["counts"]["claimed_contractors"], 7)
        self.assertEqual(readiness["counts"]["verified_contractors"], 7)
        self.assertEqual(readiness["counts"]["stripe_ready_contractors"], 7)
        self.assertEqual(readiness["status"], "active")

    def test_padded_legacy_thresholds_apply_and_duplicate_locations_fail_closed(self):
        MarketplaceLocation.objects.create(
            city="  AUSTIN  ", state=" tx ", is_enabled=True,
            min_claimed_contractors=7, min_verified_contractors=7,
            min_stripe_ready_contractors=7,
        )
        self._approve()
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "flooring")["status"], "building_coverage")
        MarketplaceLocation.objects.create(city="Austin", state="TX", is_enabled=True)
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "flooring")["status"], "location_review_needed")
        self.assertFalse(marketplace_enabled_for_intake(self._intake())["can_auto_route"])
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": "Austin", "state": "TX", "trade": "flooring", "enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 409, response.data)

    def test_admin_trade_toggle_only_changes_that_trade(self):
        location = MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        original_location_updated_at = location.updated_at
        self._approve("flooring")
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": " AUSTIN ", "state": "tx", "trade": "plumbing", "enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(MarketplaceAutomaticMatchingApproval.objects.get(trade="flooring").is_approved)
        self.assertTrue(MarketplaceAutomaticMatchingApproval.objects.get(trade="plumbing").is_approved)
        response = self.client.post(
            "/api/projects/admin/marketplace/locations/",
            {"city": "Austin", "state": "TX", "trade": "plumbing", "enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(MarketplaceAutomaticMatchingApproval.objects.get(trade="flooring").is_approved)
        self.assertFalse(MarketplaceAutomaticMatchingApproval.objects.get(trade="plumbing").is_approved)
        location.refresh_from_db()
        self.assertTrue(location.is_enabled)
        self.assertEqual(location.updated_at, original_location_updated_at)

    def test_blank_unknown_and_ambiguous_trade_fail_closed(self):
        MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        self._approve()
        for trade in ("", "not-a-trade", "flooring plumbing"):
            self.assertFalse(automatic_matching_readiness("Austin", "TX", trade)["can_auto_route"])
        self.client.force_authenticate(user=self.admin_user)
        for trade in ("", "not-a-trade", "flooring plumbing"):
            response = self.client.post(
                "/api/projects/admin/marketplace/locations/",
                {"city": "Austin", "state": "TX", "trade": trade, "enabled": True},
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)

    def test_narrative_trade_without_authoritative_classification_cannot_route(self):
        MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        self._approve()
        intake = self._intake()
        intake.ai_project_type = "General project"
        intake.ai_project_subtype = ""
        intake.ai_project_title = "Flooring installation"
        intake.save(update_fields=["ai_project_type", "ai_project_subtype", "ai_project_title"])
        self.assertEqual(marketplace_enabled_for_intake(intake)["status"], "service_needed")
        self.assertEqual(create_marketplace_invites_for_intake(intake.id)["created_count"], 0)

        intake.ai_project_type = "Flooring and plumbing"
        intake.save(update_fields=["ai_project_type"])
        self.assertEqual(marketplace_enabled_for_intake(intake)["status"], "service_needed")
        self.assertEqual(create_marketplace_invites_for_intake(intake.id)["created_count"], 0)

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
        marketplace = response.json()["marketplace"]
        self.assertEqual(
            marketplace["capabilities"],
            {
                "can_participate": True,
                "can_search": True,
                "can_direct_invite": True,
                "can_auto_route": False,
            },
        )
        self.assertTrue(marketplace["request_saved"])
        self.assertTrue(marketplace["saved_for_future_matching"])
        self.assertIn("Automatic matching is not yet available", marketplace["message"])
        self.assertIn("direct invitations remain available", marketplace["message"])
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
        self.assertEqual(saved["results"][0]["marketplace_status"], "building_coverage")
        self.assertEqual(
            saved["results"][0]["reason"],
            "Local contractor coverage is progressing. Automatic matching is not yet available.",
        )
        self.assertTrue(saved["results"][0]["can_participate"])
        self.assertTrue(saved["results"][0]["can_search"])
        self.assertTrue(saved["results"][0]["can_direct_invite"])
        self.assertFalse(saved["results"][0]["can_auto_route"])
        self.assertTrue(saved["results"][0]["saved_for_future_matching"])

    def test_incomplete_location_is_saved_with_participation_capabilities(self):
        intake = self._intake(city="", state="")

        response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {"branch_flow": "multi_contractor"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        marketplace = response.json()["marketplace"]
        self.assertEqual(marketplace["status"], "location_needed")
        self.assertTrue(marketplace["request_saved"])
        self.assertTrue(marketplace["can_participate"])
        self.assertTrue(marketplace["can_search"])
        self.assertTrue(marketplace["can_direct_invite"])
        self.assertFalse(marketplace["can_auto_route"])
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 0)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake).count(), 0)
        self.assertEqual(PublicContractorLead.objects.filter(ai_analysis__source_intake_id=intake.id).count(), 0)

    @patch("projects.services.contractor_discovery.send_twilio_sms", return_value=(True, "sent"))
    @patch("projects.services.contractor_discovery.send_postmark_email", return_value=(True, "sent"))
    def test_direct_invitation_ignores_location_readiness_but_blocks_ineligible_contractor(
        self,
        _mock_email,
        _mock_sms,
    ):
        intake = self._intake(city="Dallas", state="TX")
        contractor = self.contractors[0]

        result = create_discovery_invites(
            intake=intake,
            selected_targets=[{"source": "contractor", "id": f"contractor:{contractor.id}", "channel": "in_app"}],
        )

        self.assertEqual(result["invite_count"], 1)
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=intake).count(), 1)
        self.assertEqual(
            ContractorDiscoveryInvite.objects.filter(public_intake=intake, contractor=contractor).count(),
            1,
        )
        self.assertEqual(
            ContractorDiscoveryInvite.objects.filter(public_intake=intake).exclude(contractor=contractor).count(),
            0,
        )

        rejected = self.contractors[1]
        rejected.marketplace_verification_status = Contractor.MARKETPLACE_REJECTED
        rejected.save(update_fields=["marketplace_verification_status", "updated_at"])
        with self.assertRaisesMessage(ValueError, "not currently available"):
            create_discovery_invites(
                intake=intake,
                selected_targets=[{"source": "contractor", "id": f"contractor:{rejected.id}", "channel": "in_app"}],
            )

    def test_trade_approval_and_supply_are_independent_in_one_city(self):
        location = MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        self._approve()
        floor = self._intake()
        self.assertTrue(marketplace_enabled_for_intake(floor)["can_auto_route"])

        plumbing = self._intake()
        plumbing.ai_project_type = "Plumbing"
        plumbing.save(update_fields=["ai_project_type"])
        self.assertFalse(marketplace_enabled_for_intake(plumbing)["can_auto_route"])
        self.assertEqual(create_marketplace_invites_for_intake(plumbing.id)["created_count"], 0)

        plumber = Contractor.objects.create(
            user=get_user_model().objects.create_user(email="plumbing-pro@example.com", password="testpass123"),
            business_name="Plumbing Pro", city="Austin", state="TX",
            charges_enabled=True, payouts_enabled=True,
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_MYHOMEBRO,
            business_name="Plumbing Pro", city="Austin", state="TX",
            primary_trade="plumbing", trade_categories=["plumbing"],
            claimed_profile=True, claimed_contractor=plumber, manually_reviewed=True,
        )
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "plumbing")["status"], "awaiting_approval")
        self.assertEqual(create_marketplace_invites_for_intake(plumbing.id)["created_count"], 0)
        self._approve("plumbing")
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "plumbing")["status"], "active")
        self.assertEqual(create_marketplace_invites_for_intake(plumbing.id)["created_count"], 1)
        self.assertEqual(ContractorDiscoveryInvite.objects.filter(public_intake=plumbing).exclude(contractor=plumber).count(), 0)

    def test_approval_without_eligible_supply_never_routes(self):
        MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=1, min_verified_contractors=1,
            min_stripe_ready_contractors=1,
        )
        self._approve("plumbing")
        intake = self._intake()
        intake.ai_project_type = "Plumbing"
        intake.save(update_fields=["ai_project_type"])
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "plumbing")["status"], "building_coverage")
        self.assertEqual(create_marketplace_invites_for_intake(intake.id)["created_count"], 0)

    def test_unclaimed_or_payment_ineligible_listing_does_not_count_as_supply(self):
        location = MarketplaceLocation.objects.create(
            city="Austin", state="TX", is_enabled=True,
            min_claimed_contractors=6, min_verified_contractors=6,
            min_stripe_ready_contractors=6,
        )
        self._approve()
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "flooring")["counts"]["claimed_contractors"], 6)
        self.contractors[0].payouts_enabled = False
        self.contractors[0].save(update_fields=["payouts_enabled"])
        self.assertEqual(automatic_matching_readiness("Austin", "TX", "flooring")["status"], "building_coverage")
        self.assertEqual(create_marketplace_invites_for_intake(self._intake().id)["created_count"], 0)
        location.min_claimed_contractors = 5
        location.min_verified_contractors = 5
        location.min_stripe_ready_contractors = 5
        location.save(update_fields=["min_claimed_contractors", "min_verified_contractors", "min_stripe_ready_contractors"])
        final_readiness = automatic_matching_readiness("Austin", "TX", "flooring")
        self.assertEqual(final_readiness["status"], "active", final_readiness)
        self.assertNotIn(self.contractors[0].id, [row.claimed_contractor_id for row in eligible_marketplace_listings(self._intake())])

    def test_inactive_disabled_and_deauthorized_supply_is_excluded(self):
        intake = self._intake()
        self.contractors[0].is_active = False
        self.contractors[0].save(update_fields=["is_active"])
        self.contractors[1].user.verification_state = get_user_model().VerificationState.DISABLED
        self.contractors[1].user.save(update_fields=["verification_state"])
        self.contractors[2].stripe_deauthorized_at = timezone.now()
        self.contractors[2].save(update_fields=["stripe_deauthorized_at"])
        eligible_ids = {row.claimed_contractor_id for row in eligible_marketplace_listings(intake)}
        self.assertFalse({self.contractors[index].id for index in (0, 1, 2)} & eligible_ids)
        self.assertEqual(len(eligible_ids), 3)

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
        self._approve()
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
        self._approve()
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

    def test_suspended_contractor_cannot_accept_existing_marketplace_opportunity(self):
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
        self._approve()
        intake = self._intake()
        create_marketplace_invites_for_intake(intake.id)
        opportunity = ContractorOpportunity.objects.get(
            intake_request=intake,
            directory_entry__claimed_by_contractor=self.contractors[0],
        )
        self.contractors[0].marketplace_verification_status = Contractor.MARKETPLACE_SUSPENDED
        self.contractors[0].save(update_fields=["marketplace_verification_status", "updated_at"])
        self.client.force_authenticate(user=self.contractors[0].user)

        response = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/")

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("suspended", response.data["detail"].lower())
        opportunity.refresh_from_db()
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_PENDING)
        self.assertIsNone(opportunity.converted_agreement_id)

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
        self._approve()

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
        self._approve()
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
