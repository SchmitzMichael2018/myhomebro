from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import ContractorDirectoryClaimToken, ContractorDirectoryEntry
from projects.services.contractor_directory import normalize_business_name
from projects.services.geographic_contractor_matching import (
    contractor_serves_location,
    distance_miles,
    match_contractors_for_project,
)


class ContractorDirectoryClaimFoundationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            email="directory-claim-admin@example.com",
            password="test-pass",
            is_staff=True,
            is_superuser=True,
        )
        self.contractor_user = User.objects.create_user(email="claim-contractor@example.com", password="test-pass")
        self.other_user = User.objects.create_user(email="other-claim@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Claim Co")
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Claimable Concrete Co",
            normalized_name=normalize_business_name("Claimable Concrete Co"),
            website="https://claimable.example",
            phone="210-555-0101",
            public_email="hello@claimable.example",
            address_line1="16654 San Pedro Ave",
            city="San Antonio",
            state="TX",
            zip_code="78232",
            latitude=29.595,
            longitude=-98.475,
            service_radius_miles=25,
            primary_service="concrete contractor",
            normalized_services=["concrete contractor", "patio contractor"],
            services=["concrete_contractor"],
        )

    def test_admin_generates_claim_token_and_contractor_claim_prefills_profile(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        response = admin_client.post(f"/api/projects/admin/contractor-directory/{self.entry.id}/claim-link/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["claim_url"].endswith(response.data["claim_token"]))
        token = ContractorDirectoryClaimToken.objects.get(directory_entry=self.entry)
        self.assertEqual(token.status, ContractorDirectoryClaimToken.STATUS_PENDING)

        public = APIClient()
        get_response = public.get(f"/api/projects/contractors/directory-claim/{token.token}/")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.data["prefill"]["business_name"], "Claimable Concrete Co")
        self.assertEqual(get_response.data["prefill"]["service_radius_miles"], 25)

        claim_client = APIClient()
        claim_client.force_authenticate(self.contractor_user)
        post_response = claim_client.post(
            f"/api/projects/contractors/directory-claim/{token.token}/",
            {"service_radius_miles": 50},
            format="json",
        )

        self.assertEqual(post_response.status_code, 200)
        self.entry.refresh_from_db()
        contractor = Contractor.objects.get(user=self.contractor_user)
        self.assertTrue(self.entry.claimed)
        self.assertEqual(self.entry.claimed_by_contractor, contractor)
        self.assertEqual(contractor.business_name, "Claimable Concrete Co")
        self.assertEqual(contractor.phone, "210-555-0101")
        self.assertEqual(contractor.address, "16654 San Pedro Ave")
        self.assertEqual(contractor.city, "San Antonio")
        self.assertEqual(contractor.state, "TX")
        self.assertEqual(contractor.zip, "78232")
        self.assertEqual(contractor.service_radius_miles, 50)
        self.assertEqual(contractor.public_profile.website_url, "https://claimable.example")
        self.assertEqual(contractor.public_profile.email_public, "hello@claimable.example")
        token.refresh_from_db()
        self.assertEqual(token.status, ContractorDirectoryClaimToken.STATUS_CLAIMED)

    def test_unrelated_contractor_cannot_claim_already_claimed_entry(self):
        owner = Contractor.objects.create(user=self.contractor_user, business_name="Owner Claim Co")
        self.entry.claimed = True
        self.entry.claimed_by_contractor = owner
        self.entry.save(update_fields=["claimed", "claimed_by_contractor"])
        token = ContractorDirectoryClaimToken.objects.create(directory_entry=self.entry)

        client = APIClient()
        client.force_authenticate(self.other_user)
        response = client.post(f"/api/projects/contractors/directory-claim/{token.token}/", {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.claimed_by_contractor, owner)

    def test_admin_can_mark_entry_claimed_manually(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        response = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/mark-claimed/",
            {"contractor_id": self.other_contractor.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.entry.refresh_from_db()
        self.assertTrue(self.entry.claimed)
        self.assertEqual(self.entry.claimed_by_contractor, self.other_contractor)

    def test_service_radius_and_geographic_matching(self):
        self.assertEqual(distance_miles(29.595, -98.475, 29.6, -98.48), 0.5)
        self.assertTrue(contractor_serves_location(self.entry, 29.6, -98.48))
        self.assertFalse(contractor_serves_location(self.entry, 30.2672, -97.7431))

        inside = match_contractors_for_project({"latitude": 29.6, "longitude": -98.48}, "concrete contractor")
        self.assertEqual([row["business_name"] for row in inside], ["Claimable Concrete Co"])
        outside = match_contractors_for_project({"latitude": 30.2672, "longitude": -97.7431}, "concrete contractor")
        self.assertEqual(outside, [])

    def test_invalid_claim_token_returns_not_found(self):
        client = APIClient()
        client.force_authenticate(self.contractor_user)
        response = client.post("/api/projects/contractors/directory-claim/00000000-0000-0000-0000-000000000000/", {}, format="json")
        self.assertEqual(response.status_code, 404)
