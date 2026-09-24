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
from projects.models_contractor_discovery import ContractorDiscoveryInvite, ContractorOpportunity
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

    def test_stable_contact_identifiers_take_precedence_over_mutable_channels(self):
        identifier_cases = [
            ("contractor_id", "42"),
            ("directory_entry_id", "77"),
            ("google_place_id", "ChIJ-ABC"),
            ("contact_id", "crm-9"),
        ]
        for index, (field, value) in enumerate(identifier_cases):
            first = self._patch([{field: value, "email": f"old-{index}@example.com"}])
            retry = self._patch([{field: value, "email": f"new-{index}@example.com"}])
            self.assertEqual(
                first.json()["branch_invites"][0]["token"],
                retry.json()["branch_invites"][0]["token"],
            )
        self.assertEqual(ContractorInvite.objects.filter(source_intake=self.intake).count(), 4)

    def test_two_contacts_reordered_remain_two_and_preserve_tokens(self):
        alpha = {"contact_id": "alpha", "email": "alpha@example.com"}
        beta = {"contact_id": "beta", "phone": "512-555-0122"}
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
        first = self._patch([{"contact_id": "shared", "email": "shared@example.com"}])
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
                "contractors": [{"contact_id": "shared", "email": "shared@example.com"}],
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

    def test_website_normalization_and_opaque_stable_ids(self):
        self.assertEqual(
            canonical_invite_contact({"website_url": "HTTPS://www.Example.com/services/?utm=1#top"})[
                "identity"
            ],
            "website:example.com/services",
        )
        self.assertEqual(
            canonical_invite_contact({"id": "listing:77", "email": "listing@example.com"})[
                "identity"
            ],
            "listing:77",
        )
        self.assertEqual(
            canonical_invite_contact(
                {"google_place_id": "ChIJ-CaseSensitive", "email": "place@example.com"}
            )["identity"],
            "place:ChIJ-CaseSensitive",
        )
        self.assertEqual(
            canonical_invite_contact(
                {"email": "valid@example.com", "website_url": "example.com:invalid-port"}
            )["identity"],
            "email:valid@example.com",
        )
        long_identity = canonical_invite_contact({"email": f"{'a' * 245}@example.com"})["identity"]
        self.assertLessEqual(len(long_identity), 255)
        self.assertTrue(long_identity.startswith("email:sha256:"))


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

    def _create(self, barrier):
        close_old_connections()
        try:
            intake = ProjectIntake.objects.get(pk=self.intake.pk)
            barrier.wait(timeout=5)
            invite, created = get_or_create_public_intake_invite(
                intake=intake,
                row={"contact_id": "same-contact", "email": "same@example.com"},
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
