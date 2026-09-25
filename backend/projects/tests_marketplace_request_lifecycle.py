from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorDirectoryListing, ContractorDiscoveryInvite, ContractorOpportunity, OpportunityEstimateAppointment
from projects.models_customer_portal import CustomerRequest
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.models_proposals import Proposal
from projects.models import Contractor, ContractorInvite
from projects.services.marketplace_request_lifecycle import (
    ARCHIVE_REASON_UNANSWERED,
    LIFECYCLE_ARCHIVE_DUE,
    LIFECYCLE_ARCHIVED,
    LIFECYCLE_OPEN,
    LIFECYCLE_PURGE_DUE,
    LIFECYCLE_REMINDER_DUE,
    LIFECYCLE_RESPONDED,
    LIFECYCLE_RETENTION_PROTECTED,
    lifecycle_state,
    process_marketplace_request_lifecycle,
)
from projects.services.marketplace_readiness import create_marketplace_invites_for_intake


@override_settings(
    MARKETPLACE_FIRST_REMINDER_DAYS=2,
    MARKETPLACE_FINAL_REMINDER_DAYS=5,
    MARKETPLACE_AUTO_ARCHIVE_DAYS=14,
    MARKETPLACE_ARCHIVE_RETENTION_DAYS=90,
)
class MarketplaceRequestLifecycleTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(
            email="lifecycle-admin@example.com",
            password="local-test-password",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def make_intake(self, *, age_days=0, **kwargs):
        intake = ProjectIntake.objects.create(
            customer_name="Lifecycle Customer",
            customer_email="lifecycle@example.com",
            status="submitted",
            post_submit_flow="multi_contractor",
            **kwargs,
        )
        started = timezone.now() - timedelta(days=age_days)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            created_at=started,
            submitted_at=started,
            post_submit_flow_selected_at=started,
        )
        intake.refresh_from_db()
        return intake

    def test_threshold_states_are_deterministic(self):
        self.assertEqual(lifecycle_state(self.make_intake(age_days=1))["code"], LIFECYCLE_OPEN)
        self.assertEqual(lifecycle_state(self.make_intake(age_days=2))["code"], LIFECYCLE_REMINDER_DUE)
        self.assertEqual(lifecycle_state(self.make_intake(age_days=14))["code"], LIFECYCLE_ARCHIVE_DUE)

    def test_meaningful_response_prevents_reminders_and_archive(self):
        intake = self.make_intake(age_days=30)
        ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            status=ContractorDiscoveryInvite.STATUS_RESPONDED,
            response_at=timezone.now(),
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RESPONDED)
        counts = process_marketplace_request_lifecycle(limit=10)
        intake.refresh_from_db()
        self.assertEqual(counts.archived, 0)
        self.assertIsNone(intake.marketplace_archived_at)

    def test_decline_does_not_protect_unanswered_request(self):
        intake = self.make_intake(age_days=14)
        ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            status=ContractorDiscoveryInvite.STATUS_DECLINED,
            response_at=timezone.now(),
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_ARCHIVE_DUE)

    def test_accepted_direct_invitation_protects_request(self):
        intake = self.make_intake(age_days=30)
        invite = ContractorInvite.objects.create(
            homeowner_name="Lifecycle Customer",
            homeowner_email=intake.customer_email,
            contractor_email="invitee@example.test",
            source_intake=intake,
            accepted_at=timezone.now(),
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RESPONDED)
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.archived, 0)
        self.assertTrue(ContractorInvite.objects.filter(pk=invite.pk).exists())

    def test_archive_is_idempotent_and_records_machine_reason(self):
        intake = self.make_intake(age_days=14)
        first = process_marketplace_request_lifecycle(limit=10)
        second = process_marketplace_request_lifecycle(limit=10)
        intake.refresh_from_db()
        self.assertEqual(first.archived, 1)
        self.assertEqual(second.archived, 0)
        self.assertEqual(intake.marketplace_archive_reason, ARCHIVE_REASON_UNANSWERED)
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_ARCHIVED)

    def test_restored_request_does_not_duplicate_customer_archive_notice(self):
        intake = self.make_intake(age_days=14)
        first = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(first.archived, 1)
        self.assertEqual(first.customer_notices, 1)
        url = f"/api/projects/admin/marketplace/requests/{intake.id}/lifecycle/"
        restored = self.client.post(url, {"action": "restore", "confirmed": True}, format="json")
        self.assertEqual(restored.status_code, 200)
        ProjectIntake.objects.filter(pk=intake.pk).update(customer_email="updated@example.test")
        second = process_marketplace_request_lifecycle(now=timezone.now() + timedelta(days=15), limit=10)
        self.assertEqual(second.archived, 1)
        self.assertEqual(second.customer_notices, 0)

    def test_dry_run_writes_nothing(self):
        intake = self.make_intake(age_days=14)
        counts = process_marketplace_request_lifecycle(limit=10, dry_run=True)
        intake.refresh_from_db()
        self.assertEqual(counts.archived, 1)
        self.assertIsNone(intake.marketplace_archived_at)
        self.assertIsNone(intake.first_marketplace_reminder_sent_at)
        self.assertIsNone(intake.final_marketplace_reminder_sent_at)

    def test_purge_waits_full_retention_period(self):
        intake = self.make_intake(age_days=120)
        archived_at = timezone.now() - timedelta(days=89, hours=23)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=archived_at,
            marketplace_archive_reason=ARCHIVE_REASON_UNANSWERED,
        )
        intake.refresh_from_db()
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_ARCHIVED)
        process_marketplace_request_lifecycle(limit=10)
        self.assertTrue(ProjectIntake.objects.filter(pk=intake.pk).exists())

        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=90),
        )
        intake.refresh_from_db()
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_PURGE_DUE)
        process_marketplace_request_lifecycle(limit=10)
        self.assertFalse(ProjectIntake.objects.filter(pk=intake.pk).exists())

    def test_customer_history_is_retention_protected(self):
        intake = self.make_intake(age_days=120)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=100),
            marketplace_archive_reason=ARCHIVE_REASON_UNANSWERED,
        )
        CustomerRequest.objects.create(
            customer_email=intake.customer_email,
            request_type=CustomerRequest.TYPE_REPAIR,
            title="Protected request",
            description="Retained customer history",
            source_intake=intake,
        )
        intake.refresh_from_db()
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RETENTION_PROTECTED)
        counts = process_marketplace_request_lifecycle(limit=10)
        intake.refresh_from_db()
        self.assertEqual(counts.retention_protected, 1)
        self.assertEqual(intake.marketplace_retention_protection_reason, "Customer request history")

    def test_clarification_photo_cannot_be_cascade_deleted_by_purge(self):
        intake = self.make_intake(age_days=120)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=100),
        )
        photo = ProjectIntakeClarificationPhoto.objects.create(
            project_intake=intake,
            image="test-only/clarification.jpg",
        )
        counts = process_marketplace_request_lifecycle(limit=10)
        intake.refresh_from_db()
        self.assertEqual(counts.purged, 0)
        self.assertEqual(counts.retention_protected, 1)
        self.assertTrue(ProjectIntakeClarificationPhoto.objects.filter(pk=photo.pk).exists())
        self.assertEqual(intake.marketplace_retention_protection_reason, "Customer-provided request attachment")

    def test_estimate_appointment_counts_as_response_and_prevents_cascade(self):
        intake = self.make_intake(age_days=120)
        contractor_user = get_user_model().objects.create_user(
            email="lifecycle-contractor@example.com", password="local-test-password"
        )
        contractor = Contractor.objects.create(user=contractor_user, business_name="Test Contractor")
        appointment = OpportunityEstimateAppointment.objects.create(
            contractor=contractor,
            source_type=OpportunityEstimateAppointment.SOURCE_INTAKE,
            project_intake=intake,
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=timezone.now() + timedelta(days=1),
        )
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=100),
        )
        intake.refresh_from_db()
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RETENTION_PROTECTED)
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.purged, 0)
        self.assertTrue(OpportunityEstimateAppointment.objects.filter(pk=appointment.pk).exists())

    def test_direct_estimate_source_id_counts_as_response_and_protects_history(self):
        intake = self.make_intake(age_days=120)
        contractor_user = get_user_model().objects.create_user(
            email="proposal-contractor@example.com", password="local-test-password"
        )
        contractor = Contractor.objects.create(user=contractor_user, business_name="Proposal Contractor")
        proposal = Proposal.objects.create(
            contractor=contractor,
            source_type=Proposal.SOURCE_INTAKE,
            source_id=intake.pk,
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RESPONDED)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=100),
        )
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.purged, 0)
        self.assertTrue(Proposal.objects.filter(pk=proposal.pk).exists())

    def test_opportunity_review_notes_are_retained_without_counting_as_response(self):
        intake = self.make_intake(age_days=120)
        entry = ContractorDirectoryEntry.objects.create(
            business_name="Review Notes Contractor", normalized_name="review notes contractor"
        )
        opportunity = ContractorOpportunity.objects.create(
            directory_entry=entry,
            intake_request=intake,
            conversion_notes="Administrative review only",
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_ARCHIVE_DUE)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=100),
        )
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.purged, 0)
        self.assertTrue(ContractorOpportunity.objects.filter(pk=opportunity.pk).exists())

    def test_restore_starts_new_review_window_without_erasing_reminders(self):
        intake = self.make_intake(age_days=120)
        old_reminder = timezone.now() - timedelta(days=118)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now() - timedelta(days=10),
            first_marketplace_reminder_sent_at=old_reminder,
            final_marketplace_reminder_sent_at=old_reminder,
        )
        url = f"/api/projects/admin/marketplace/requests/{intake.id}/lifecycle/"
        response = self.client.post(url, {"action": "restore", "confirmed": True}, format="json")
        self.assertEqual(response.status_code, 200)
        intake.refresh_from_db()
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_OPEN)
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.archived, 0)
        self.assertEqual(counts.first_reminders, 0)
        self.assertEqual(counts.final_reminders, 0)
        intake.refresh_from_db()
        self.assertEqual(intake.first_marketplace_reminder_sent_at, old_reminder)
        self.assertEqual(intake.final_marketplace_reminder_sent_at, old_reminder)

    def test_cancelled_customer_request_suppresses_reminders(self):
        intake = self.make_intake(age_days=5)
        CustomerRequest.objects.create(
            customer_email=intake.customer_email,
            request_type=CustomerRequest.TYPE_REPAIR,
            title="Cancelled request",
            description="No longer needed",
            source_intake=intake,
            status=CustomerRequest.STATUS_CANCELLED,
        )
        self.assertEqual(lifecycle_state(intake)["code"], LIFECYCLE_RETENTION_PROTECTED)
        counts = process_marketplace_request_lifecycle(limit=10)
        self.assertEqual(counts.first_reminders + counts.final_reminders + counts.archived, 0)

    def test_archived_request_cannot_be_routed(self):
        intake = self.make_intake(age_days=20)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            marketplace_archived_at=timezone.now(),
            marketplace_archive_reason=ARCHIVE_REASON_UNANSWERED,
        )
        result = create_marketplace_invites_for_intake(intake.id)
        self.assertTrue(result["archived"])
        self.assertFalse(result["marketplace"]["can_auto_route"])
        self.assertEqual(result["created_count"], 0)

    def test_reminder_progresses_without_delivery_channel_and_does_not_repeat(self):
        intake = self.make_intake(age_days=2)
        listing = ContractorDirectoryListing.objects.create(
            business_name="No Delivery Channel",
            source=ContractorDirectoryListing.SOURCE_MANUAL,
        )
        ContractorDiscoveryInvite.objects.create(
            public_intake=intake,
            directory_listing=listing,
            status=ContractorDiscoveryInvite.STATUS_PENDING,
        )
        first = process_marketplace_request_lifecycle(limit=10)
        second = process_marketplace_request_lifecycle(limit=10)
        intake.refresh_from_db()
        self.assertEqual(first.first_reminders, 1)
        self.assertEqual(second.first_reminders, 0)
        self.assertIsNotNone(intake.first_marketplace_reminder_sent_at)

    def test_command_reports_bounded_counts(self):
        self.make_intake(age_days=2)
        output = StringIO()
        call_command(
            "process_marketplace_request_lifecycle",
            "--dry-run",
            "--limit",
            "1",
            stdout=output,
        )
        self.assertIn("examined=1", output.getvalue())
        self.assertIn("dry_run=True", output.getvalue())

    def test_admin_archive_and_restore_require_confirmation(self):
        intake = self.make_intake(age_days=1)
        url = f"/api/projects/admin/marketplace/requests/{intake.id}/lifecycle/"
        unconfirmed = self.client.post(url, {"action": "archive", "confirmed": False}, format="json")
        self.assertEqual(unconfirmed.status_code, 400, unconfirmed.content)
        archived = self.client.post(url, {"action": "archive", "confirmed": True}, format="json")
        self.assertEqual(archived.status_code, 200)
        intake.refresh_from_db()
        self.assertIsNotNone(intake.marketplace_archived_at)

        restored = self.client.post(url, {"action": "restore", "confirmed": True}, format="json")
        self.assertEqual(restored.status_code, 200)
        intake.refresh_from_db()
        self.assertIsNone(intake.marketplace_archived_at)
        self.assertIsNotNone(intake.marketplace_restored_at)
        self.assertIsNotNone(intake.marketplace_last_archived_at)
        self.assertEqual(intake.marketplace_last_archive_reason, "admin_archived")

    def test_non_admin_cannot_change_lifecycle(self):
        intake = self.make_intake(age_days=1)
        ordinary_user = get_user_model().objects.create_user(
            email="ordinary@example.test", password="local-test-password"
        )
        self.client.force_authenticate(ordinary_user)
        response = self.client.post(
            f"/api/projects/admin/marketplace/requests/{intake.id}/lifecycle/",
            {"action": "archive", "confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        intake.refresh_from_db()
        self.assertIsNone(intake.marketplace_archived_at)

    def test_lifecycle_filtering_precedes_pagination_and_counts_full_population(self):
        for _index in range(26):
            self.make_intake(age_days=1)
        archived = self.make_intake(age_days=20)
        ProjectIntake.objects.filter(pk=archived.pk).update(
            marketplace_archived_at=timezone.now(),
            marketplace_archive_reason=ARCHIVE_REASON_UNANSWERED,
        )
        operational = self.client.get(
            "/api/projects/admin/marketplace/requests/",
            {"page_size": 25, "lifecycle_status": "operational"},
        )
        self.assertEqual(operational.status_code, 200, operational.content)
        self.assertEqual(operational.data["pagination"]["total"], 26)
        self.assertEqual(len(operational.data["results"]), 25)
        self.assertEqual(operational.data["summary"]["lifecycle_statuses"]["archived"], 1)

        archived_response = self.client.get(
            "/api/projects/admin/marketplace/requests/",
            {"page_size": 25, "lifecycle_status": "archived"},
        )
        self.assertEqual(archived_response.status_code, 200)
        self.assertEqual(archived_response.data["pagination"]["total"], 1)
        self.assertEqual(archived_response.data["results"][0]["id"], archived.id)
