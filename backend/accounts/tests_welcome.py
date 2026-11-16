from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.db import transaction
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from accounts.models import ContractorWelcomeEmail, User
from accounts.services.verification import request_phone_code, verify_phone_code
from accounts.services.welcome import deliver_welcome, queue_contractor_welcome


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                   SITE_URL="https://www.myhomebro.com", SUPPORT_EMAIL="support@myhomebro.com",
                   CELERY_NOTIFICATIONS_ENABLED=False, DEBUG=True,
                   ACCOUNT_VERIFICATION_SMS_BACKEND="test")
class ContractorWelcomeTests(TestCase):
    def make_user(self, **overrides):
        values = dict(email="contractor@example.com", first_name="Alex",
                      verification_role="contractor", is_active=True,
                      verification_state=User.VerificationState.VERIFIED,
                      email_verified_at=timezone.now(), phone_verified_at=timezone.now())
        values.update(overrides)
        return User.objects.create_user(**values)

    def test_welcome_after_commit_has_helpful_content_and_only_one_recipient(self):
        user = self.make_user(first_name="<script>bad</script>")
        with self.captureOnCommitCallbacks(execute=True):
            queue_contractor_welcome(user)
            self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, [user.email])
        self.assertEqual(message.reply_to, ["support@myhomebro.com"])
        self.assertIn("https://www.myhomebro.com/app/dashboard", message.body)
        self.assertIn("Stripe", message.body)
        self.assertIn("Agreement Wizard", message.body)
        self.assertNotIn("<script>", message.alternatives[0].content)
        self.assertIn('alt="MyHomeBro"', message.alternatives[0].content)
        self.assertEqual(ContractorWelcomeEmail.objects.get(user=user).status, "sent")

    def test_repeated_queue_and_task_do_not_duplicate_sent_message(self):
        user = self.make_user()
        with self.captureOnCommitCallbacks(execute=True):
            queue_contractor_welcome(user)
            queue_contractor_welcome(user)
        self.assertFalse(deliver_welcome(user.contractor_welcome_email.pk))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(ContractorWelcomeEmail.objects.count(), 1)

    def test_ineligible_accounts_are_not_enrolled(self):
        for index, fields in enumerate([
            {"verification_role": "homeowner"}, {"is_staff": True},
            {"email_verified_at": None}, {"phone_verified_at": None},
            {"is_active": False}, {"trust_classification": "spam_fraud"},
            {"trust_classification": "test"}, {"verification_state": "suspicious"},
        ]):
            user = self.make_user(email=f"account{index}@example.com", **fields)
            queue_contractor_welcome(user)
        self.assertFalse(ContractorWelcomeEmail.objects.exists())

    def test_disabled_after_enqueue_does_not_send(self):
        user = self.make_user()
        queue_contractor_welcome(user)
        user.is_active = False
        user.save(update_fields=["is_active"])
        self.assertFalse(deliver_welcome(user.contractor_welcome_email.pk))
        self.assertEqual(len(mail.outbox), 0)

    def test_failure_is_recorded_and_can_be_retried(self):
        user = self.make_user()
        queue_contractor_welcome(user)
        delivery = user.contractor_welcome_email
        with patch("accounts.services.welcome.EmailMultiAlternatives.send", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                deliver_welcome(delivery.pk)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "failed")
        self.assertIsNone(delivery.sent_at)
        call_command("send_pending_contractor_welcomes", retry_failed=True, verbosity=0)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "sent")
        self.assertEqual(delivery.attempts, 2)

    @override_settings(CELERY_NOTIFICATIONS_ENABLED=True)
    @patch("accounts.tasks.send_contractor_welcome.delay", side_effect=OSError("broker down"))
    def test_broker_failure_preserves_pending_delivery(self, delay):
        user = self.make_user()
        with self.captureOnCommitCallbacks(execute=True):
            queue_contractor_welcome(user)
        self.assertEqual(user.contractor_welcome_email.status, "pending")
        self.assertEqual(len(mail.outbox), 0)

    def test_rollback_does_not_queue_or_leave_delivery(self):
        user = self.make_user()
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    queue_contractor_welcome(user)
                    raise ValueError("rollback")
            except ValueError:
                pass
        self.assertFalse(ContractorWelcomeEmail.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_successful_phone_verification_triggers_welcome(self):
        user = self.make_user(phone_verified_at=None, is_active=False,
                              verification_state="pending_phone", phone_number="+12105550144")
        request = RequestFactory().post("/")
        request.session = {}
        challenge, code = request_phone_code(user, request)
        with self.captureOnCommitCallbacks(execute=True):
            verify_phone_code(user, code, request)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(ContractorWelcomeEmail.objects.filter(user=user, status="sent").exists())

    def test_sending_record_is_not_automatically_replayed(self):
        user = self.make_user()
        delivery = ContractorWelcomeEmail.objects.create(user=user, status="sending")
        self.assertFalse(deliver_welcome(delivery.pk))
        self.assertEqual(len(mail.outbox), 0)
