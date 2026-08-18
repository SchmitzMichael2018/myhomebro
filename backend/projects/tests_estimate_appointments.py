from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import EstimateAppointmentReservation, OpportunityEstimateAppointment
from projects.models_proposals import Proposal
from projects.services.estimate_appointments import (
    EstimateAppointmentError, hold_expiration, is_hold_expired, reserve_appointment, transition_appointment,
)


class EstimateAppointmentLifecycleTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="appointments@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Appointment Builder")
        self.other_user = user_model.objects.create_user(email="other-appointments@example.com", password="test-pass")
        self.other = Contractor.objects.create(user=self.other_user, business_name="Other Builder")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        raw_start = timezone.now().replace(second=0, microsecond=0) + timedelta(days=2)
        self.start = raw_start + timedelta(minutes=(-raw_start.minute) % 15)

    def appointment(self, *, status=OpportunityEstimateAppointment.STATUS_REQUESTED, start=None, contractor=None):
        owner = contractor or self.contractor
        proposal = Proposal.objects.create(
            contractor=owner, created_by=owner.user, source_type=Proposal.SOURCE_DASHBOARD,
            source_id=10000 + Proposal.objects.count(), project_title="Appointment owner",
        )
        return OpportunityEstimateAppointment.objects.create(
            contractor=owner,
            source_type=OpportunityEstimateAppointment.SOURCE_PROPOSAL,
            direct_proposal=proposal,
            opportunity_title="Kitchen Estimate",
            customer_name="Casey Customer",
            customer_email="casey@example.com",
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=start or self.start,
            duration_minutes=60,
            status=status,
            requested_by=OpportunityEstimateAppointment.REQUESTED_BY_CUSTOMER,
            timezone="America/Chicago",
            hold_expires_at=hold_expiration() if status in {OpportunityEstimateAppointment.STATUS_REQUESTED, OpportunityEstimateAppointment.STATUS_PROPOSED} else None,
        )

    def test_legal_transitions_record_append_only_history_and_terminal_is_terminal(self):
        appointment = self.appointment()
        confirmed = transition_appointment(
            contractor=self.contractor, appointment_id=appointment.id, action="confirm", actor=self.user
        )
        self.assertEqual(confirmed.status, OpportunityEstimateAppointment.STATUS_CONFIRMED)
        completed = transition_appointment(
            contractor=self.contractor, appointment_id=appointment.id, action="complete", actor=self.user
        )
        self.assertEqual(completed.status, OpportunityEstimateAppointment.STATUS_COMPLETED)
        self.assertEqual(list(appointment.events.values_list("event_type", flat=True)), ["confirm", "complete"])
        with self.assertRaises(EstimateAppointmentError):
            transition_appointment(
                contractor=self.contractor, appointment_id=appointment.id, action="confirm", actor=self.user
            )

    def test_proposal_and_reschedule_preserve_original_time_and_reject_overlap(self):
        appointment = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED)
        next_start = self.start + timedelta(hours=2)
        updated = transition_appointment(
            contractor=self.contractor,
            appointment_id=appointment.id,
            action="reschedule",
            actor=self.user,
            scheduled_start=next_start,
        )
        self.assertEqual(updated.original_scheduled_start, self.start)
        self.appointment(status=OpportunityEstimateAppointment.STATUS_SCHEDULED, start=next_start + timedelta(minutes=30))
        with self.assertRaises(EstimateAppointmentError):
            transition_appointment(
                contractor=self.contractor,
                appointment_id=appointment.id,
                action="reschedule",
                actor=self.user,
                scheduled_start=next_start + timedelta(minutes=45),
            )

    def test_boundary_touching_is_allowed_and_terminal_records_do_not_block(self):
        self.appointment(status=OpportunityEstimateAppointment.STATUS_CANCELLED)
        active = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED, start=self.start + timedelta(hours=1))
        moved = transition_appointment(
            contractor=self.contractor,
            appointment_id=active.id,
            action="reschedule",
            actor=self.user,
            scheduled_start=self.start,
        )
        self.assertEqual(moved.scheduled_start, self.start)

    def test_direct_estimate_can_schedule_and_choose_no_visit(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            created_by=self.user,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=1001,
            project_title="Direct Estimate",
            customer_name="Casey Customer",
            customer_email="casey@example.com",
            service_location="123 Main St",
        )
        disposition = self.client.post(
            f"/api/projects/proposals/{proposal.id}/appointment/", {"action": "no_visit_needed"}, format="json", secure=True
        )
        self.assertEqual(disposition.status_code, 200)
        self.assertEqual(disposition.data["proposal"]["appointment_disposition"], Proposal.APPOINTMENT_NOT_NEEDED)
        scheduled = self.client.post(
            f"/api/projects/proposals/{proposal.id}/appointment/",
            {
                "action": "schedule",
                "scheduled_start": self.start.isoformat(),
                "appointment_type": "in_person",
                "duration_minutes": 60,
                "timezone": "America/Chicago",
            },
            format="json",
            secure=True,
        )
        self.assertEqual(scheduled.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.estimate_appointment.direct_proposal_id, proposal.id)
        self.assertEqual(proposal.appointment_disposition, Proposal.APPOINTMENT_PLANNED)

    def test_transition_hides_cross_contractor_appointment(self):
        appointment = self.appointment(contractor=self.other)
        response = self.client.post(
            f"/api/projects/contractor-opportunities/estimate-appointments/{appointment.id}/transition/",
            {"action": "confirm"},
            format="json",
            secure=True,
        )
        self.assertEqual(response.status_code, 404)

    def test_database_segments_reject_competing_overlap_and_allow_boundary(self):
        first = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED)
        reserve_appointment(first)
        overlap = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED, start=self.start + timedelta(minutes=15))
        with self.assertRaises(EstimateAppointmentError):
            reserve_appointment(overlap)
        overlap.delete()
        boundary = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED, start=self.start + timedelta(minutes=60))
        reserve_appointment(boundary)
        self.assertEqual(EstimateAppointmentReservation.objects.filter(appointment=boundary).count(), 4)

    @override_settings(ESTIMATE_APPOINTMENT_HOLD_HOURS=3)
    def test_hold_expiration_is_configurable_and_releases_reservations(self):
        requested = self.appointment()
        requested.hold_expires_at = hold_expiration()
        requested.save(update_fields=["hold_expires_at"])
        self.assertAlmostEqual((requested.hold_expires_at - timezone.now()).total_seconds(), 10800, delta=5)
        reserve_appointment(requested)
        requested.hold_expires_at = timezone.now() - timedelta(seconds=1)
        requested.save(update_fields=["hold_expires_at"])
        self.assertTrue(is_hold_expired(requested))
        replacement = self.appointment(status=OpportunityEstimateAppointment.STATUS_CONFIRMED)
        reserve_appointment(replacement)
        self.assertFalse(EstimateAppointmentReservation.objects.filter(appointment=requested).exists())
        with self.assertRaises(EstimateAppointmentError):
            transition_appointment(contractor=self.contractor, appointment_id=requested.id, action="confirm", actor=self.user)

    def test_direct_relationship_validation_rejects_mismatch(self):
        first = Proposal.objects.create(contractor=self.contractor, created_by=self.user, source_type=Proposal.SOURCE_DASHBOARD, source_id=20001)
        second = Proposal.objects.create(contractor=self.contractor, created_by=self.user, source_type=Proposal.SOURCE_DASHBOARD, source_id=20002)
        appointment = OpportunityEstimateAppointment(
            contractor=self.contractor, source_type=OpportunityEstimateAppointment.SOURCE_PROPOSAL,
            direct_proposal=first, appointment_type="phone_call", scheduled_start=self.start,
        )
        appointment.full_clean()
        appointment.save()
        second.estimate_appointment = appointment
        with self.assertRaises(ValidationError):
            second.full_clean()
