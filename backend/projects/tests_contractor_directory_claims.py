from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from unittest.mock import patch
from datetime import timedelta
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import (
    ContractorDirectoryClaimToken,
    ContractorDirectoryEntry,
    ContractorMarketplaceJoinInvite,
)
from projects.models_sms import SMSConsentStatus
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

    @patch("projects.services.contractor_marketplace_join_invites.send_postmark_email", return_value=(True, "sent"))
    def test_admin_can_send_marketplace_join_email_invite(self, mock_email):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        response = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        invite = ContractorMarketplaceJoinInvite.objects.get(directory_entry=self.entry)
        self.assertEqual(invite.status, ContractorMarketplaceJoinInvite.STATUS_SENT)
        self.assertEqual(invite.email_status, "sent")
        self.assertEqual(invite.email, "hello@claimable.example")
        self.assertIsNotNone(invite.claim_token)
        self.assertIsNotNone(invite.sent_at)
        self.assertEqual(invite.sent_by, self.admin)
        self.assertIn("/contractors/directory-claim/", response.data["invite"]["claim_url"])
        mock_email.assert_called_once()

    @patch("projects.services.contractor_marketplace_join_invites.send_postmark_email", return_value=(True, "sent"))
    def test_join_invite_duplicate_is_idempotent_until_resend(self, mock_email):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        first = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "email"},
            format="json",
        )
        second = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "email"},
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ContractorMarketplaceJoinInvite.objects.filter(directory_entry=self.entry).count(), 1)
        self.assertEqual(mock_email.call_count, 1)

        resend = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "email", "resend": True},
            format="json",
        )
        self.assertEqual(resend.status_code, 200)
        self.assertEqual(ContractorMarketplaceJoinInvite.objects.filter(directory_entry=self.entry).count(), 1)
        self.assertEqual(mock_email.call_count, 2)

    @override_settings(MARKETPLACE_JOIN_INVITE_SMS_ENABLED=True, TWILIO_INVITES_ENABLED=True)
    @patch("projects.services.contractor_marketplace_join_invites.send_twilio_sms", return_value=(True, "sent"))
    def test_admin_can_send_sms_join_invite_when_enabled(self, mock_sms):
        self.entry.public_email = ""
        self.entry.save(update_fields=["public_email"])
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        response = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "sms"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        invite = ContractorMarketplaceJoinInvite.objects.get(directory_entry=self.entry)
        self.assertEqual(invite.status, ContractorMarketplaceJoinInvite.STATUS_SENT)
        self.assertEqual(invite.sms_status, "sent")
        self.assertEqual(invite.phone, "+12105550101")
        mock_sms.assert_called_once()

    @override_settings(MARKETPLACE_JOIN_INVITE_SMS_ENABLED=True, TWILIO_INVITES_ENABLED=True)
    @patch("projects.services.contractor_marketplace_join_invites.send_twilio_sms", return_value=(True, "sent"))
    def test_join_invite_sms_respects_opt_out(self, mock_sms):
        self.entry.public_email = ""
        self.entry.save(update_fields=["public_email"])
        SMSConsentStatus.objects.create(
            phone_number="+12105550101",
            is_subscribed=False,
            last_inbound_body="STOP",
            last_keyword_type=SMSConsentStatus.KEYWORD_OPT_OUT,
        )
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)

        response = admin_client.post(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
            {"preferred_channel": "sms"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        invite = ContractorMarketplaceJoinInvite.objects.get(directory_entry=self.entry)
        self.assertEqual(invite.status, ContractorMarketplaceJoinInvite.STATUS_SUPPRESSED)
        self.assertEqual(invite.sms_status, "suppressed")
        self.assertTrue(invite.sms_opted_out)
        mock_sms.assert_not_called()

    def test_expired_join_invite_token_is_rejected(self):
        token = ContractorDirectoryClaimToken.objects.create(directory_entry=self.entry)
        ContractorMarketplaceJoinInvite.objects.create(
            directory_entry=self.entry,
            claim_token=token,
            invited_business_name=self.entry.business_name,
            email=self.entry.public_email,
            expires_at=timezone.now() - timedelta(days=1),
            status=ContractorMarketplaceJoinInvite.STATUS_SENT,
        )

        response = APIClient().get(f"/api/projects/contractors/directory-claim/{token.token}/")

        self.assertEqual(response.status_code, 410)
        invite = ContractorMarketplaceJoinInvite.objects.get(claim_token=token)
        self.assertEqual(invite.status, ContractorMarketplaceJoinInvite.STATUS_EXPIRED)

    def test_claiming_join_invite_marks_invite_claimed(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        with patch("projects.services.contractor_marketplace_join_invites.send_postmark_email", return_value=(True, "sent")):
            response = admin_client.post(
                f"/api/projects/admin/contractor-directory/{self.entry.id}/join-invite/",
                {"preferred_channel": "email"},
                format="json",
            )
        invite = ContractorMarketplaceJoinInvite.objects.get(pk=response.data["invite"]["id"])

        claim_client = APIClient()
        claim_client.force_authenticate(self.contractor_user)
        claim_response = claim_client.post(
            f"/api/projects/contractors/directory-claim/{invite.claim_token.token}/",
            {},
            format="json",
        )

        self.assertEqual(claim_response.status_code, 200, claim_response.data)
        invite.refresh_from_db()
        self.assertEqual(invite.status, ContractorMarketplaceJoinInvite.STATUS_CLAIMED)
        self.assertIsNotNone(invite.claimed_at)
