from concurrent.futures import ThreadPoolExecutor
import threading
from unittest.mock import patch

from django.db import close_old_connections
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_invite import ContractorInvite
from projects.models import Contractor, PublicContractorLead
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
    ContractorDiscoveryInvite,
    ContractorOpportunity,
)
from projects.models_project_intake import ProjectIntake
from projects.services.public_intake_invites import (
    canonical_invite_contact,
    get_or_create_public_intake_invite,
)


class PublicIntakeInviteIdempotencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            lead_source="landing_page",
            customer_name="Retry Customer",
            customer_email="retry@example.com",
            customer_phone="512-555-0100",
            accomplishment_text="Need a contractor.",
        )
        self.url = f"/api/projects/public-intake/?token={self.intake.share_token}"
        self.contractor_user = get_user_model().objects.create_user(
            email="stable-contractor@example.com"
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Stable Contractor",
            phone="512-555-0140",
        )
        self.directory_entry = ContractorDirectoryEntry.objects.create(
            business_name="Stable Directory",
            normalized_name="stable directory",
            public_email="directory@example.com",
            google_place_id="ChIJ-StableDirectory",
            claimed_by_contractor=self.contractor,
        )
        self.listing = ContractorDirectoryListing.objects.create(
            business_name="Stable Listing",
            email="listing@example.com",
            google_place_id="ChIJ-StableListing",
            claimed_contractor=self.contractor,
        )

    def _patch(self, contractors):
        return self.client.patch(
            self.url,
            {
                "branch_flow": "multi_contractor",
                "contractors": contractors,
            },
            format="json",
        )

    @patch("projects.views.public_intake.create_marketplace_invites_for_intake")
    @patch("projects.services.invites_delivery.deliver_invite_notifications")
    def test_identical_retry_reuses_row_token_and_does_not_deliver_or_route(
        self, delivery, automatic_routing
    ):
        payload = [{"name": "Alpha", "email": "Alpha@Example.com", "phone": "(512) 555-0111"}]

        first = self._patch(payload)
        second = self._patch(payload)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_invite = first.json()["branch_invites"][0]
        second_invite = second.json()["branch_invites"][0]
        self.assertTrue(first_invite["created"])
        self.assertFalse(first_invite["reused"])
        self.assertFalse(second_invite["created"])
        self.assertTrue(second_invite["reused"])
        self.assertEqual(first_invite["token"], second_invite["token"])
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 1)
        invite = ContractorInvite.objects.get(source_intake=self.intake)
        self.assertEqual(invite.contractor_email, "alpha@example.com")
        self.assertEqual(invite.contractor_phone, "+15125550111")
        self.assertEqual(invite.send_count, 0)
        delivery.assert_not_called()
        automatic_routing.assert_not_called()
        self.assertEqual(ContractorDiscoveryInvite.objects.count(), 0)
        self.assertEqual(ContractorOpportunity.objects.count(), 0)
        self.assertEqual(PublicContractorLead.objects.count(), 0)

    def test_email_case_and_phone_formatting_are_canonical_identities(self):
        email_first = self._patch([{"email": "Case@Test.Example"}])
        email_retry = self._patch([{"email": " case@test.example "}])
        self.assertEqual(
            email_first.json()["branch_invites"][0]["token"],
            email_retry.json()["branch_invites"][0]["token"],
        )

        phone_first = self._patch([{"phone": "(512) 555-0199"}])
        phone_retry = self._patch([{"phone": "+1 512 555 0199"}])
        self.assertEqual(
            phone_first.json()["branch_invites"][0]["token"],
            phone_retry.json()["branch_invites"][0]["token"],
        )
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 2)

    def test_valid_domestic_and_international_phone_formats_are_canonical(self):
        domestic_first = self._patch([{"phone": "512.555.0198"}])
        domestic_retry = self._patch([{"phone": "+1 (512) 555-0198"}])
        international_first = self._patch([{"phone": "+44 20 7946 0958"}])
        international_retry = self._patch([{"phone": "+44-20-7946-0958"}])

        self.assertEqual(domestic_first.status_code, 200)
        self.assertEqual(international_first.status_code, 200)
        self.assertEqual(
            domestic_first.json()["branch_invites"][0]["token"],
            domestic_retry.json()["branch_invites"][0]["token"],
        )
        self.assertEqual(
            international_first.json()["branch_invites"][0]["token"],
            international_retry.json()["branch_invites"][0]["token"],
        )
        self.assertEqual(
            set(
                ContractorInvite.objects.filter(source_intake=self.intake).values_list(
                    "contractor_phone", flat=True
                )
            ),
            {"+15125550198", "+442079460958"},
        )

    def test_stable_contact_identifiers_take_precedence_over_mutable_channels(self):
        identifier_cases = [
            (
                {"contractor_id": str(self.contractor.id)},
                {"email": "stable-contractor@example.com"},
                {"email": " STABLE-CONTRACTOR@example.com "},
            ),
            (
                {"directory_entry_id": str(self.directory_entry.id)},
                {"email": "directory@example.com"},
                {"email": " DIRECTORY@example.com "},
            ),
            (
                {"google_place_id": self.listing.google_place_id},
                {"email": "listing@example.com"},
                {"email": " LISTING@example.com "},
            ),
        ]
        for stable_id, first_contact, retry_contact in identifier_cases:
            first = self._patch([{**stable_id, **first_contact}])
            retry = self._patch([{**stable_id, **retry_contact}])
            self.assertEqual(
                first.json()["branch_invites"][0]["token"],
                retry.json()["branch_invites"][0]["token"],
            )
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 3)

    def test_two_contacts_reordered_remain_two_and_preserve_tokens(self):
        alpha = {"email": "alpha@example.com"}
        beta = {"phone": "512-555-0122"}
        first = self._patch([alpha, beta])
        retry = self._patch([beta, alpha])

        self.assertEqual(first.status_code, 200)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(
            {row["token"] for row in first.json()["branch_invites"]},
            {row["token"] for row in retry.json()["branch_invites"]},
        )
        self.assertTrue(all(row["reused"] for row in retry.json()["branch_invites"]))
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 2)

    def test_same_contact_on_different_intake_gets_distinct_invitation(self):
        first = self._patch([{"email": "shared@example.com"}])
        other = ProjectIntake.objects.create(
            initiated_by="homeowner",
            lead_source="landing_page",
            customer_name="Other Customer",
            customer_email="other@example.com",
        )
        other_response = self.client.patch(
            f"/api/projects/public-intake/?token={other.share_token}",
            {
                "branch_flow": "multi_contractor",
                "contractors": [{"email": "shared@example.com"}],
            },
            format="json",
        )

        self.assertNotEqual(
            first.json()["branch_invites"][0]["token"],
            other_response.json()["branch_invites"][0]["token"],
        )

    def test_missing_contact_is_rejected_without_rows(self):
        response = self._patch([{"name": "No Contact"}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)

    def test_existing_lifecycle_state_is_returned_without_reactivation(self):
        first = self._patch([{"email": "accepted@example.com"}])
        invite = ContractorInvite.objects.get(token=first.json()["branch_invites"][0]["token"])
        user = get_user_model().objects.create_user(email="accepted@example.com")
        contractor = Contractor.objects.create(user=user, business_name="Accepted Builder")
        accepted_at = timezone.now()
        invite.accepted_at = accepted_at
        invite.accepted_by_contractor = contractor
        invite.save(update_fields=["accepted_at", "accepted_by_contractor"])

        retry = self._patch([{"email": "ACCEPTED@example.com"}])

        invite.refresh_from_db()
        self.assertEqual(invite.accepted_at, accepted_at)
        self.assertEqual(invite.accepted_by_contractor, contractor)
        self.assertEqual(invite.send_count, 0)
        self.assertTrue(retry.json()["branch_invites"][0]["reused"])
        self.assertEqual(retry.json()["branch_invites"][0]["status"], "accepted")

    def test_website_normalization_and_validated_stable_ids(self):
        self.assertEqual(
            canonical_invite_contact(
                {
                    "email": "website@example.com",
                    "website_url": "HTTPS://www.Example.com/services/?utm=1#top",
                }
            )["website"],
            "example.com/services",
        )
        self.assertEqual(
            canonical_invite_contact(
                {
                    "id": f"listing:{self.listing.id}",
                    "email": "listing@example.com",
                }
            )["identity"],
            f"listing:{self.listing.id}",
        )
        self.assertEqual(
            canonical_invite_contact(
                {
                    "google_place_id": self.listing.google_place_id,
                    "email": "listing@example.com",
                }
            )["identity"],
            f"place:{self.listing.google_place_id}",
        )

    @patch("projects.services.invites_delivery.deliver_invite_notifications")
    def test_malformed_nonempty_contact_fields_create_nothing_and_do_not_deliver(self, delivery):
        cases = [
            {"email": "not-an-email"},
            {"phone": "abc"},
            {"email": "not-an-email", "phone": "512-555-0188"},
            {"email": "valid@example.com", "phone": "abc"},
            {"email": "valid@example.com", "phone": "abc5125550188"},
            {"email": "valid@example.com", "phone": "5125550188abc"},
            {"email": "valid@example.com", "phone": "+00000000"},
            {"email": "valid@example.com", "phone": "00000000"},
            {"email": "valid@example.com", "phone": "0000000000"},
            {"email": "valid@example.com", "phone": "++15125550188"},
            {"email": "valid@example.com", "phone": "+1abc5125550188"},
            {"email": "valid@example.com", "phone": "1-800-FLOWERS"},
            {"email": "valid@example.com", "phone": "5551212"},
            {"email": "valid@example.com", "phone": "+1234567890123456"},
            {"email": "valid@example.com", "phone": "+1 512 555 0188 ext 2"},
            {"email": "valid@example.com", "phone": "１２３４５６７８９０"},
            {"email": "valid@example.com", "phone": "(512 555-0188"},
            {"email": "valid@example.com", "website_url": "https://[malformed"},
            {"email": "valid@example.com", "contractor_id": "not-an-id"},
            {"email": "valid@example.com", "contact_id": "untrusted-free-text"},
            {
                "email": "unrelated@example.com",
                "contractor_id": self.contractor.id,
            },
        ]
        for row in cases:
            with self.subTest(row=row):
                response = self._patch([row])
                self.assertEqual(response.status_code, 400)
                self.assertIn("detail", response.json())
                self.assertNotIn("token", response.json())
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)
        delivery.assert_not_called()

    def test_unrelated_malformed_values_never_share_invitation(self):
        invalid_rows = [
            [{"name": "One", "phone": "abc"}],
            [{"name": "Two", "phone": "abc"}],
            [{"name": "Three", "email": "invalid"}],
            [{"name": "Four", "email": "invalid"}],
        ]
        for rows in invalid_rows:
            response = self._patch(rows)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)

    def test_mismatched_stable_ids_are_rejected(self):
        other_user = get_user_model().objects.create_user(email="other-stable@example.com")
        other_contractor = Contractor.objects.create(
            user=other_user,
            business_name="Other Stable Contractor",
        )

        response = self._patch(
            [
                {
                    "contractor_id": other_contractor.id,
                    "directory_entry_id": self.directory_entry.id,
                    "email": "valid@example.com",
                }
            ]
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)

    @patch("projects.services.invites_delivery.deliver_invite_notifications")
    def test_mixed_valid_and_invalid_batch_is_atomic(self, delivery):
        response = self._patch(
            [
                {"email": "valid@example.com"},
                {"phone": "abc"},
            ]
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)
        self.assertNotIn("branch_invites", response.json())
        self.assertNotIn("token", response.json())
        delivery.assert_not_called()
        self.assertEqual(ContractorDiscoveryInvite.objects.count(), 0)
        self.assertEqual(ContractorOpportunity.objects.count(), 0)
        self.assertEqual(PublicContractorLead.objects.count(), 0)

    def test_invalid_contact_after_five_row_cap_still_rejects_whole_batch(self):
        rows = [{"email": f"valid-{index}@example.com"} for index in range(5)]
        rows.append({"phone": "abc"})

        response = self._patch(rows)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)

    def test_malformed_contact_json_cannot_fall_through_to_automatic_routing(self):
        with patch(
            "projects.views.public_intake.create_marketplace_invites_for_intake"
        ) as automatic_routing:
            response = self.client.patch(
                self.url,
                {
                    "branch_flow": "multi_contractor",
                    "contractors": "{malformed",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 0)
        automatic_routing.assert_not_called()

    def test_names_are_descriptive_and_never_dedupe(self):
        first = self._patch([{"name": "Same Name", "email": "one@example.com"}])
        second = self._patch([{"name": "Same Name", "email": "two@example.com"}])

        self.assertNotEqual(
            first.json()["branch_invites"][0]["token"],
            second.json()["branch_invites"][0]["token"],
        )
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 2)


class ContractorInviteCompatibilityTests(TestCase):
    @patch("projects.views.views_invite.deliver_homeowner_confirmation")
    @patch("projects.views.views_invite.deliver_invite_notifications")
    def test_generic_create_delivers_and_tracks_success_without_source_identity(
        self, contractor_delivery, homeowner_delivery
    ):
        contractor_delivery.return_value = {
            "invite_url": "http://testserver/invite",
            "email": {"ok": True},
            "sms": {"ok": False},
        }
        homeowner_delivery.return_value = {"email": {"ok": True}}

        response = APIClient().post(
            "/api/projects/invites/",
            {
                "homeowner_name": "Compatibility Customer",
                "homeowner_email": "customer@example.com",
                "contractor_email": "contractor@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        invite = ContractorInvite.objects.get()
        self.assertEqual(invite.contact_identity, "")
        self.assertEqual(invite.send_count, 1)
        contractor_delivery.assert_called_once()
        homeowner_delivery.assert_called_once()

    @patch("projects.views.views_invite.deliver_invite_notifications")
    def test_resend_tracks_once_then_preserves_rate_limit(self, delivery):
        delivery.return_value = {
            "invite_url": "http://testserver/invite",
            "email": {"ok": True},
            "sms": {"ok": False},
        }
        invite = ContractorInvite.objects.create(
            homeowner_name="Resend Customer",
            homeowner_email="resend@example.com",
            contractor_email="builder@example.com",
        )
        url = f"/api/projects/invites/{invite.token}/resend/{invite.resend_token}/"

        first = APIClient().get(url)
        second = APIClient().get(url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        invite.refresh_from_db()
        self.assertEqual(invite.send_count, 1)
        delivery.assert_called_once()

    def test_accept_is_idempotent_for_same_contractor(self):
        user = get_user_model().objects.create_user(email="acceptor@example.com")
        contractor = Contractor.objects.create(user=user, business_name="Acceptor")
        intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            customer_name="Acceptance Customer",
            customer_email="acceptance@example.com",
        )
        invite = ContractorInvite.objects.create(
            homeowner_name="Acceptance Customer",
            homeowner_email="acceptance@example.com",
            contractor_email="acceptor@example.com",
            source_intake=intake,
            contact_identity="email:acceptor@example.com",
        )
        client = APIClient()
        client.force_authenticate(user=user)

        first = client.post(f"/api/projects/invites/{invite.token}/accept/", {}, format="json")
        second = client.post(f"/api/projects/invites/{invite.token}/accept/", {}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["message"], "Invite already accepted.")
        invite.refresh_from_db()
        self.assertEqual(invite.accepted_by_contractor, contractor)
        intake.refresh_from_db()
        self.assertEqual(intake.contractor, contractor)


class ConcurrentPublicIntakeInviteIdempotencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            lead_source="landing_page",
            customer_name="Concurrent Customer",
            customer_email="concurrent@example.com",
        )

    def _create(self, barrier, row=None):
        close_old_connections()
        try:
            intake = ProjectIntake.objects.get(pk=self.intake.pk)
            barrier.wait(timeout=5)
            invite, created = get_or_create_public_intake_invite(
                intake=intake,
                row=row or {"email": "same@example.com"},
                homeowner_name=intake.customer_name,
                homeowner_email=intake.customer_email,
                homeowner_phone="",
                invite_message="",
            )
            return invite.pk, str(invite.token), created
        finally:
            close_old_connections()

    def test_concurrent_identical_attempts_share_one_row_and_token(self):
        barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self._create(barrier), range(2)))

        self.assertEqual({row[0] for row in results}, {ContractorInvite.objects.get().pk})
        self.assertEqual(len({row[1] for row in results}), 1)
        self.assertEqual(sorted(row[2] for row in results), [False, True])
        self.assertEqual(ContractorInvite.objects.count(), 1)

    def test_concurrent_equivalent_phone_attempts_share_one_row_and_token(self):
        barrier = threading.Barrier(2)
        rows = [{"phone": "(512) 555-0188"}, {"phone": "+1 512 555 0188"}]
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(
                    lambda row: self._create(barrier, row),
                    rows,
                )
            )

        invite = ContractorInvite.objects.get()
        self.assertEqual({row[0] for row in results}, {invite.pk})
        self.assertEqual(len({row[1] for row in results}), 1)
        self.assertEqual(sorted(row[2] for row in results), [False, True])
        self.assertEqual(invite.contractor_phone, "+15125550188")
