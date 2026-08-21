from datetime import datetime, timedelta, timezone as datetime_timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.core import mail, signing
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor
from projects.models_contractor_discovery import EstimateAppointmentDelivery, OpportunityEstimateAppointment
from projects.models_proposals import Proposal
from projects.services.estimate_appointment_notifications import (
    TOKEN_SALT,
    appointment_payload,
    appointment_ics,
    confirmation_token,
    contractor_export_payload,
    dispatch_due_reminders,
    google_calendar_url,
    prepare_confirmed_reminders,
    public_confirmation_url,
    public_customer_action,
    schedule_version,
    send_confirmation_notice,
)
from projects.services.estimate_appointments import hold_expiration, transition_appointment


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SITE_URL="https://example.test",
    ESTIMATE_APPOINTMENT_REMINDER_OFFSETS_MINUTES=[1440, 120],
)
class EstimateAppointmentConfirmationTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.user = users.objects.create_user(email="appointment-owner@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Safe Builder")
        self.other_user = users.objects.create_user(email="other-owner@example.com", password="test-pass")
        self.other = Contractor.objects.create(user=self.other_user, business_name="Other Builder")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.start = timezone.now().replace(second=0, microsecond=0) + timedelta(days=3)
        self.start += timedelta(minutes=(-self.start.minute) % 15)

    def appointment(self, *, contractor=None, status="proposed", start=None, email="casey@example.com", phone="+15125550199"):
        owner = contractor or self.contractor
        proposal = Proposal.objects.create(
            contractor=owner, created_by=owner.user, source_type=Proposal.SOURCE_DASHBOARD,
            source_id=80000 + Proposal.objects.count(), project_title="Kitchen Estimate",
            customer_name="Casey Customer", customer_email=email, customer_phone=phone,
            service_location="12 Main St; Suite 2",
        )
        appointment = OpportunityEstimateAppointment.objects.create(
            contractor=owner, source_type=OpportunityEstimateAppointment.SOURCE_PROPOSAL,
            direct_proposal=proposal, opportunity_title="Kitchen Estimate", customer_name="Casey Customer",
            customer_email=email, customer_phone=phone, service_location="12 Main St; Suite 2",
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=start or self.start, duration_minutes=60, status=status,
            requested_by=OpportunityEstimateAppointment.REQUESTED_BY_CONTRACTOR,
            timezone="America/Chicago", hold_expires_at=hold_expiration() if status in {"proposed", "requested"} else None,
        )
        proposal.estimate_appointment = appointment
        proposal.save(update_fields=["estimate_appointment"])
        return appointment

    @patch("projects.services.estimate_appointment_notifications.send_compliant_sms")
    def test_contractor_time_is_proposed_and_email_fallback_obeys_sms_consent(self, sms):
        appointment = self.appointment()
        sms.return_value = {"ok": False, "blocked": True, "reason_code": "no_consent", "detail": "No consent"}
        results = send_confirmation_notice(appointment)
        self.assertEqual(results, ["sent", "suppressed"])
        self.assertEqual(appointment.status, "proposed")
        self.assertEqual(appointment.deliveries.get(channel="email").status, "sent")
        self.assertEqual(appointment.deliveries.get(channel="sms").error_code, "no_consent")
        sms.assert_called_once()
        with self.assertRaisesRegex(ValueError, "sent recently"):
            send_confirmation_notice(appointment)

    @override_settings(SITE_URL="https://www.myhomebro.com/")
    @patch("projects.services.estimate_appointment_notifications.send_compliant_sms")
    def test_confirmation_email_sms_and_resend_use_production_origin(self, sms):
        sms.return_value = {"ok": True, "twilio_sid": "SM-test"}
        appointment = self.appointment()
        send_confirmation_notice(appointment)
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", mail.outbox[-1].body)
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", sms.call_args.args[1])
        self.assertNotIn("localhost", mail.outbox[-1].body + sms.call_args.args[1])
        send_confirmation_notice(appointment, force=True)
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", mail.outbox[-1].body)
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", sms.call_args.args[1])

    @override_settings(SITE_URL="http://localhost:5173/")
    def test_development_origin_may_be_explicitly_overridden(self):
        appointment = self.appointment(phone="")
        self.assertTrue(public_confirmation_url(appointment).startswith(
            "http://localhost:5173/appointment-confirmation/"
        ))

    @override_settings(SITE_URL="https://www.myhomebro.com")
    @patch("projects.services.estimate_appointment_notifications.send_compliant_sms")
    def test_due_reminder_uses_production_origin(self, sms):
        sms.return_value = {"ok": True, "twilio_sid": "SM-reminder"}
        appointment = self.appointment(status="confirmed", start=self.start)
        prepare_confirmed_reminders(appointment, now=self.start - timedelta(hours=25))
        dispatch_due_reminders(now=self.start - timedelta(hours=24), batch_size=10)
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", sms.call_args.args[1])
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", mail.outbox[-1].body)

    @override_settings(SITE_URL="https://www.myhomebro.com", ALLOWED_HOSTS=["attacker.example"])
    @patch("projects.services.estimate_appointment_notifications.send_compliant_sms")
    def test_request_host_cannot_influence_delivered_url(self, sms):
        sms.return_value = {"ok": True, "twilio_sid": "SM-host"}
        appointment = self.appointment(email="")
        response = self.client.post(
            f"/api/projects/estimate-appointments/{appointment.id}/send-confirmation/",
            {}, format="json", HTTP_HOST="attacker.example", secure=True,
        )
        self.assertIn(response.status_code, {200, 201})
        self.assertIn("https://www.myhomebro.com/appointment-confirmation/", sms.call_args.args[1])
        self.assertNotIn("attacker.example", sms.call_args.args[1])

    def test_customer_confirmation_is_idempotent_and_creates_versioned_reminders(self):
        appointment = self.appointment(phone="")
        token = confirmation_token(appointment)
        confirmed = public_customer_action(token, "confirm")
        replayed = public_customer_action(token, "confirm")
        self.assertEqual(confirmed.id, replayed.id)
        self.assertEqual(confirmed.status, "confirmed")
        self.assertEqual(confirmed.events.filter(event_type="confirm", actor_kind="customer").count(), 1)
        self.assertEqual(confirmed.deliveries.filter(kind="reminder").count(), 2)

    def test_contractor_confirms_customer_requested_exact_time_and_sends_notice(self):
        appointment = self.appointment(status="requested", phone="")
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/projects/contractor-opportunities/estimate-appointments/{appointment.id}/transition/",
                {"action": "confirm"}, format="json", secure=True,
            )
        self.assertEqual(response.status_code, 200)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, "confirmed")
        self.assertEqual(appointment.events.filter(event_type="confirm", actor_kind="contractor").count(), 1)
        self.assertEqual(appointment.deliveries.filter(kind="confirmation", status="sent").count(), 1)
        self.assertEqual(appointment.deliveries.filter(kind="reminder").count(), 2)

    def test_request_another_time_is_audit_only_and_decline_is_terminal(self):
        appointment = self.appointment(phone="")
        token = confirmation_token(appointment)
        first = public_customer_action(token, "request_another_time", reason="Afternoons work better")
        public_customer_action(token, "request_another_time", reason="Afternoons work better")
        self.assertEqual(first.status, "proposed")
        self.assertEqual(first.events.filter(event_type="request_another_time").count(), 1)
        declined = public_customer_action(token, "decline", reason="No longer needed")
        self.assertEqual(declined.status, "declined")
        with self.assertRaises(ValueError):
            public_customer_action(token, "confirm")

    def test_tampered_cross_object_expired_and_stale_tokens_fail(self):
        appointment = self.appointment(phone="")
        token = confirmation_token(appointment)
        with self.assertRaises(ValueError):
            public_customer_action(token + "x", "confirm")
        other = self.appointment(contractor=self.other, start=self.start + timedelta(hours=2), phone="")
        payload = signing.loads(token, salt=TOKEN_SALT)
        payload["appointment_id"] = other.id
        cross_token = signing.dumps(payload, salt=TOKEN_SALT)
        with self.assertRaises(ValueError):
            public_customer_action(cross_token, "confirm")
        with patch("django.core.signing.time.time", return_value=1):
            expired_token = confirmation_token(appointment)
        with override_settings(ESTIMATE_APPOINTMENT_CONFIRMATION_MAX_AGE=1):
            with self.assertRaises(ValueError):
                public_customer_action(expired_token, "confirm")
        transition_appointment(
            contractor=self.contractor, appointment_id=appointment.id, action="reschedule", actor=self.user,
            scheduled_start=self.start + timedelta(hours=4), duration_minutes=60,
        )
        with self.assertRaises(ValueError):
            public_customer_action(token, "confirm")

    def test_reschedule_invalidates_old_deliveries_and_requires_reconfirmation(self):
        appointment = self.appointment(status="confirmed", phone="")
        prepare_confirmed_reminders(appointment)
        old_version = schedule_version(appointment)
        updated = transition_appointment(
            contractor=self.contractor, appointment_id=appointment.id, action="reschedule", actor=self.user,
            scheduled_start=self.start + timedelta(hours=3), duration_minutes=60,
        )
        self.assertEqual(updated.status, "proposed")
        self.assertNotEqual(schedule_version(updated), old_version)
        self.assertFalse(updated.confirmed_at)
        self.assertEqual(set(updated.deliveries.filter(schedule_version=old_version).values_list("status", flat=True)), {"suppressed"})

    def test_reminder_boundaries_retry_and_terminal_suppression(self):
        appointment = self.appointment(status="confirmed", phone="", start=self.start)
        rows = prepare_confirmed_reminders(appointment, now=self.start - timedelta(hours=25))
        self.assertEqual({row.offset_minutes for row in rows}, {1440, 120})
        with patch("projects.services.estimate_appointment_notifications.EmailMessage.send", side_effect=RuntimeError("temporary")):
            counts = dispatch_due_reminders(now=self.start - timedelta(hours=24), batch_size=10)
        self.assertEqual(counts.failed, 1)
        with patch("projects.services.estimate_appointment_notifications.EmailMessage.send", return_value=1):
            counts = dispatch_due_reminders(now=self.start - timedelta(hours=24), batch_size=10)
        self.assertEqual(counts.sent, 1)
        appointment.status = appointment.STATUS_CANCELLED
        appointment.save(update_fields=["status", "updated_at"])
        counts = dispatch_due_reminders(now=self.start - timedelta(hours=2), batch_size=10)
        self.assertEqual(counts.suppressed, 1)

    def test_google_and_ics_use_utc_escape_values_and_stable_uid(self):
        appointment = self.appointment(status="confirmed", phone="", start=datetime(2026, 8, 21, 19, 0, tzinfo=datetime_timezone.utc))
        query = parse_qs(urlparse(google_calendar_url(appointment)).query)
        self.assertEqual(query["dates"], ["20260821T190000Z/20260821T200000Z"])
        self.assertEqual(query["ctz"], ["America/Chicago"])
        first = appointment_ics(appointment)
        second = appointment_ics(appointment)
        self.assertIn(f"UID:estimate-appointment-{appointment.id}@myhomebro.com", first)
        self.assertIn("DTSTART:20260821T190000Z", first)
        self.assertIn("LOCATION:12 Main St\\; Suite 2", first)
        self.assertNotIn("localhost", google_calendar_url(appointment) + first)
        public_export = appointment_payload(appointment, include_token=True)
        contractor_export = contractor_export_payload(appointment)
        self.assertTrue(public_export["ics_url"].startswith("https://example.test/api/"))
        self.assertTrue(contractor_export["ics_url"].startswith("https://example.test/api/"))
        self.assertNotIn("localhost", public_export["ics_url"] + contractor_export["ics_url"])
        self.assertEqual(first.split("UID:", 1)[1].split("\r\n", 1)[0], second.split("UID:", 1)[1].split("\r\n", 1)[0])

    def test_ics_endpoints_enforce_confirmed_status_and_contractor_ownership(self):
        appointment = self.appointment(status="confirmed", phone="")
        response = self.client.get(f"/api/projects/estimate-appointments/{appointment.id}/calendar.ics", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/calendar; charset=utf-8")
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(f"/api/projects/estimate-appointments/{appointment.id}/calendar.ics", secure=True).status_code, 404)
        public = APIClient().get(f"/api/projects/public/estimate-appointments/{confirmation_token(appointment)}/calendar.ics", secure=True)
        self.assertEqual(public.status_code, 200)

    def test_management_command_dry_run_does_not_send(self):
        appointment = self.appointment(status="confirmed", phone="", start=timezone.now() + timedelta(hours=25))
        prepare_confirmed_reminders(appointment)
        with patch("projects.services.estimate_appointment_notifications.EmailMessage.send") as sender:
            call_command("send_estimate_appointment_reminders", "--dry-run", "--batch-size", "10")
        sender.assert_not_called()
