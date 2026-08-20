from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import OpportunityEstimateAppointment
from projects.models_proposals import Proposal


class EstimateAppointmentCalendarIntegrationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="calendar-appointments@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Calendar Builder")
        self.other_user = user_model.objects.create_user(email="calendar-other@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Builder")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.start = datetime(2026, 8, 21, 19, 0, tzinfo=dt_timezone.utc)  # 2 PM America/Chicago

    def appointment(self, *, contractor=None, status="scheduled", start=None, hold_expires_at=None, proposal_status="draft"):
        owner = contractor or self.contractor
        proposal = Proposal.objects.create(
            contractor=owner,
            created_by=owner.user,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=50000 + Proposal.objects.count(),
            project_title="Kitchen Estimate",
            customer_name="Casey Customer",
            service_location="123 Main St",
            status=proposal_status,
        )
        appointment = OpportunityEstimateAppointment.objects.create(
            contractor=owner,
            source_type=OpportunityEstimateAppointment.SOURCE_PROPOSAL,
            direct_proposal=proposal,
            opportunity_title="Kitchen Estimate",
            customer_name="Casey Customer",
            service_location="123 Main St",
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=start or self.start,
            duration_minutes=60,
            status=status,
            timezone="America/Chicago",
            hold_expires_at=hold_expires_at,
        )
        proposal.estimate_appointment = appointment
        proposal.save(update_fields=["estimate_appointment"])
        return appointment

    def calendar(self, start="2026-08-01T00:00:00-05:00", end="2026-09-01T00:00:00-05:00"):
        return self.client.get("/api/projects/appointments/calendar/", {"start": start, "end": end}, secure=True)

    def test_direct_estimate_appointment_is_one_first_class_event_with_timezone_and_navigation(self):
        appointment = self.appointment()
        response = self.calendar()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["events"]), 1)
        event = response.data["events"][0]
        self.assertEqual(event["id"], f"estimate-appointment-{appointment.id}")
        self.assertEqual(event["start"], "2026-08-21T19:00:00+00:00")
        self.assertEqual(event["end"], "2026-08-21T20:00:00+00:00")
        self.assertEqual(event["extendedProps"]["appointment_timezone"], "America/Chicago")
        self.assertEqual(event["extendedProps"]["status"], "scheduled")
        self.assertFalse(event["extendedProps"]["tentative"])
        self.assertEqual(event["extendedProps"]["navigation_target"], f"/app/estimates/{appointment.direct_proposal_id}#appointment")

    def test_overlap_range_is_end_exclusive_and_cross_contractor_isolated(self):
        self.appointment(start=datetime(2026, 8, 31, 23, 30, tzinfo=dt_timezone.utc))
        self.appointment(contractor=self.other_contractor)
        response = self.calendar(start="2026-09-01T00:00:00Z", end="2026-09-01T00:15:00Z")
        self.assertEqual(len(response.data["events"]), 1)
        self.assertEqual(response.data["events"][0]["start"], "2026-08-31T23:30:00+00:00")

    def test_tentative_policy_and_terminal_or_expired_exclusions(self):
        future_hold = timezone.now() + timedelta(days=1)
        requested = self.appointment(status="requested", hold_expires_at=future_hold)
        proposed = self.appointment(status="proposed", start=self.start + timedelta(hours=2), hold_expires_at=future_hold)
        self.appointment(status="requested", start=self.start + timedelta(hours=4), hold_expires_at=timezone.now() - timedelta(minutes=1))
        for offset, status in enumerate(("cancelled", "declined", "completed", "no_show"), start=6):
            self.appointment(status=status, start=self.start + timedelta(hours=offset))
        self.appointment(start=self.start + timedelta(hours=11), proposal_status=Proposal.STATUS_CANCELLED)
        events = self.calendar().data["events"]
        self.assertEqual({row["id"] for row in events}, {f"estimate-appointment-{requested.id}", f"estimate-appointment-{proposed.id}"})
        self.assertEqual({row["extendedProps"]["display_status"] for row in events}, {"Customer requested — awaiting contractor confirmation", "Awaiting customer confirmation"})
        self.assertTrue(all(row["extendedProps"]["tentative"] for row in events))

    def test_invalid_range_fails_safely(self):
        response = self.calendar(start="2026-09-01T00:00:00Z", end="2026-08-01T00:00:00Z")
        self.assertEqual(response.status_code, 400)
