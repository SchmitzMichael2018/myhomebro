from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import AdminSignupSMS, User
from accounts.services.signup_alerts import deliver_signup_alert, queue_signup_alert
from projects.models_sms import SMSConsent


@override_settings(ADMIN_SIGNUP_SMS_ENABLED=True, ADMIN_SIGNUP_SMS_TO="+12105550199",
                   CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "signup-alert-tests"}},
                   SITE_URL="https://www.myhomebro.com", CELERY_NOTIFICATIONS_ENABLED=False,
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                   TURNSTILE_REQUIRED=False, TURNSTILE_TEST_BYPASS=True, DEBUG=True,
                   TWILIO_ACCOUNT_SID="test-account", TWILIO_AUTH_TOKEN="test-token",
                   TWILIO_MESSAGING_SERVICE_SID="test-service")
class SignupAlertTests(TestCase):
    def setUp(self):
        cache.clear()

    def make_user(self, **overrides):
        values = dict(email="signup@example.com", verification_role="contractor",
                      is_active=False, verification_state="pending_email")
        values.update(overrides)
        return User.objects.create_user(**values)

    @patch("accounts.services.signup_alerts.send_compliant_sms")
    def test_sends_after_commit_only_once_to_configured_owner(self, send):
        send.return_value = {"ok": True, "twilio_sid": "SMtest"}
        user = self.make_user()
        with self.captureOnCommitCallbacks(execute=True):
            queue_signup_alert(user)
            queue_signup_alert(user)
            send.assert_not_called()
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0], "+12105550199")
        self.assertIn("New contractor signup", send.call_args.args[1])
        self.assertIn("verification pending", send.call_args.args[1])
        self.assertNotIn(user.email, send.call_args.args[1])
        delivery = AdminSignupSMS.objects.get(user=user)
        self.assertEqual(delivery.status, "sent")
        self.assertEqual(delivery.provider_sid, "SMtest")
        self.assertEqual(deliver_signup_alert(delivery.pk), "skipped")
        send.assert_called_once()

    def test_disabled_and_invalid_recipient_do_not_enroll_accounts(self):
        user = self.make_user()
        with override_settings(ADMIN_SIGNUP_SMS_ENABLED=False):
            queue_signup_alert(user)
        with override_settings(ADMIN_SIGNUP_SMS_TO="not-a-phone"):
            queue_signup_alert(user)
        self.assertFalse(AdminSignupSMS.objects.exists())

    def test_staff_test_and_suspicious_accounts_are_excluded(self):
        for index, fields in enumerate([
            {"is_staff": True}, {"is_superuser": True}, {"verification_role": ""},
            {"trust_classification": "test"}, {"trust_classification": "spam_fraud"},
            {"trust_classification": "suspicious"}, {"verification_state": "disabled"},
        ]):
            queue_signup_alert(self.make_user(email=f"excluded{index}@example.com", **fields))
        self.assertFalse(AdminSignupSMS.objects.exists())

    @patch("accounts.services.signup_alerts.send_compliant_sms")
    def test_rollback_never_sends(self, send):
        user = self.make_user()
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    queue_signup_alert(user)
                    raise ValueError("rollback")
            except ValueError:
                pass
        self.assertFalse(AdminSignupSMS.objects.exists())
        send.assert_not_called()

    @patch("accounts.services.signup_alerts.send_compliant_sms", side_effect=OSError("offline"))
    def test_dispatch_failure_does_not_interrupt_registration(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            queue_signup_alert(self.make_user())
        delivery = AdminSignupSMS.objects.get()
        self.assertEqual(delivery.status, "failed")
        self.assertEqual(delivery.reason_code, "sms_unavailable")

    @patch("accounts.services.signup_alerts.send_compliant_sms")
    def test_recovery_retries_failed_records_without_historical_backfill(self, send):
        user = self.make_user()
        self.make_user(email="historical@example.com")
        queue_signup_alert(user)
        delivery = AdminSignupSMS.objects.get()
        send.return_value = {"ok": False, "blocked": False, "reason_code": "twilio_error"}
        self.assertEqual(deliver_signup_alert(delivery.pk), "failed")
        send.return_value = {"ok": True, "twilio_sid": "SMretry"}
        call_command("send_pending_signup_alerts", retry_failed=True)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "sent")
        self.assertEqual(delivery.attempts, 2)
        self.assertEqual(AdminSignupSMS.objects.count(), 1)

    @patch("accounts.services.signup_alerts.send_compliant_sms")
    def test_paused_or_changed_destination_does_not_send(self, send):
        queue_signup_alert(self.make_user())
        delivery = AdminSignupSMS.objects.get()
        with override_settings(ADMIN_SIGNUP_SMS_ENABLED=False):
            self.assertEqual(deliver_signup_alert(delivery.pk), "skipped")
        with override_settings(ADMIN_SIGNUP_SMS_TO="+12105550188"):
            self.assertEqual(deliver_signup_alert(delivery.pk), "skipped")
        send.assert_not_called()

    @patch("projects.services.sms_service._twilio_client")
    def test_owner_opt_out_is_respected(self, client):
        SMSConsent.objects.create(phone_number_e164="+12105550199", opted_out=True, can_send_sms=False)
        queue_signup_alert(self.make_user())
        delivery = AdminSignupSMS.objects.get()
        self.assertEqual(deliver_signup_alert(delivery.pk), "blocked")
        client.assert_not_called()

    @patch("projects.services.sms_service._twilio_client")
    def test_consented_owner_uses_existing_twilio_service(self, client):
        SMSConsent.objects.create(phone_number_e164="+12105550199", can_send_sms=True)
        client.return_value.messages.create.return_value = SimpleNamespace(sid="SMaccepted", status="queued")
        queue_signup_alert(self.make_user())
        delivery = AdminSignupSMS.objects.get()
        self.assertEqual(deliver_signup_alert(delivery.pk), "sent")
        payload = client.return_value.messages.create.call_args.kwargs
        self.assertEqual(payload["to"], "+12105550199")
        self.assertEqual(payload["messaging_service_sid"], "test-service")

    @patch("accounts.services.signup_alerts.dispatch_signup_alert")
    def test_all_public_registration_roles_queue_an_alert(self, dispatch):
        client = APIClient()
        for index, (endpoint, extra, role) in enumerate([
            ("contractor-register", {}, "contractor"),
            ("customer-register", {}, "homeowner"),
            ("customer-register", {"account_type": "property_management_company", "company_name": "Test Rentals"}, "property_manager"),
        ]):
            payload = {"email": f"new{index}@example.com", "password": "Strong-Test-Password-982!",
                       "first_name": "New", "last_name": "User", "full_name": "New User",
                       "phone_number": f"210555014{index}", **extra}
            with self.captureOnCommitCallbacks(execute=True):
                response = client.post(f"/api/accounts/auth/{endpoint}/", payload, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            user = User.objects.get(email=payload["email"])
            self.assertEqual(user.verification_role, role)
            self.assertTrue(AdminSignupSMS.objects.filter(user=user).exists())
        self.assertEqual(dispatch.call_count, 3)

    @patch("accounts.services.signup_alerts.dispatch_signup_alert")
    def test_honeypot_invalid_and_duplicate_signups_do_not_alert(self, dispatch):
        client = APIClient()
        endpoint = "/api/accounts/auth/contractor-register/"
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(client.post(endpoint, {"company_website": "spam.invalid"}).status_code, 201)
            self.assertEqual(client.post(endpoint, {}).status_code, 400)
        self.assertFalse(AdminSignupSMS.objects.exists())
        dispatch.assert_not_called()

    @override_settings(CELERY_NOTIFICATIONS_ENABLED=True)
    @patch("accounts.tasks.send_admin_signup_sms.delay", side_effect=OSError("broker down"))
    def test_queue_failure_leaves_recoverable_record(self, delay):
        with self.captureOnCommitCallbacks(execute=True):
            queue_signup_alert(self.make_user())
        self.assertEqual(AdminSignupSMS.objects.get().status, "pending")

