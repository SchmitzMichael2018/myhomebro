from datetime import timedelta
from unittest.mock import patch

from django.contrib.admin.sites import AdminSite
from django.contrib.auth.tokens import default_token_generator
from django.core import mail, signing
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from accounts.admin import CustomUserAdmin
from accounts.models import AccountSecurityEvent, PhoneVerificationChallenge, User
from accounts.services.verification import request_phone_code, verification_token, verify_phone_code
from projects.models_attribution import AccountAcquisition, AttributionEvent
from projects.services.attribution import acquisition_report


@override_settings(
    DEBUG=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    TURNSTILE_REQUIRED=False,
    TURNSTILE_TEST_BYPASS=True,
    ACCOUNT_VERIFICATION_SMS_BACKEND="test",
    ACCOUNT_OTP_RESEND_COOLDOWN_SECONDS=0,
)
class AccountVerificationTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def register(self, **overrides):
        payload = {
            "email": "new.contractor@example.com",
            "password": "Strong-Test-Password-982!",
            "first_name": "New",
            "last_name": "Contractor",
            "phone_number": "210-555-0144",
            "continuation": "/improvements/bathroom/replace-toilet/diy",
        }
        payload.update(overrides)
        return self.client.post(reverse("accounts_api:contractor-register"), payload, format="json")

    def _pending_user(self, **kwargs):
        defaults = dict(
            email="pending@example.com",
            password="Strong-Test-Password-982!",
            phone_number="+12105550144",
            phone_number_normalized="+12105550144",
            verification_state=User.VerificationState.PENDING_EMAIL,
            is_active=False,
        )
        defaults.update(kwargs)
        return User.objects.create_user(**defaults)

    def _request(self, path="/"):
        request = RequestFactory().post(path)
        request.session = self.client.session
        request.META["REMOTE_ADDR"] = "203.0.113.10"
        return request

    def test_registration_is_pending_sends_email_and_preserves_continuation(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("access", response.data)
        user = User.objects.get(email="new.contractor@example.com")
        self.assertFalse(user.is_active)
        self.assertEqual(user.verification_state, User.VerificationState.PENDING_EMAIL)
        self.assertEqual(user.phone_number_normalized, "+12105550144")
        self.assertEqual(user.verification_continuation, "/improvements/bathroom/replace-toilet/diy")
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn("Strong-Test-Password", mail.outbox[0].body)

    def test_honeypot_returns_plausible_success_without_account(self):
        response = self.register(company_website="https://bot.invalid")
        self.assertEqual(response.status_code, 201)
        self.assertFalse(User.objects.filter(email="new.contractor@example.com").exists())

    @override_settings(TURNSTILE_REQUIRED=True, TURNSTILE_TEST_BYPASS=False, TURNSTILE_SECRET_KEY="")
    def test_turnstile_fails_closed_when_required_and_unconfigured(self):
        response = self.register()
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email="new.contractor@example.com").exists())

    def test_pending_login_routes_to_setup_without_tokens(self):
        user = self._pending_user()
        response = self.client.post("/api/accounts/auth/login/", {"email": user.email, "password": "Strong-Test-Password-982!"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Finish setting up your account.")
        self.assertIn("verification_session", response.data)
        self.assertNotIn("access", response.data)

    def test_legacy_user_retains_access_without_false_verification(self):
        user = User.objects.create_user(email="legacy@example.com", password="Strong-Test-Password-982!")
        response = self.client.post("/api/accounts/auth/login/", {"email": user.email, "password": "Strong-Test-Password-982!"}, format="json")
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.verification_state, User.VerificationState.LEGACY_UNVERIFIED)
        self.assertIsNone(user.email_verified_at)
        self.assertIsNone(user.phone_verified_at)

    def test_valid_email_link_is_idempotent_and_only_advances_to_phone(self):
        user = self._pending_user()
        url = reverse("accounts_api:verify-account-email", kwargs={"token": verification_token(user)})
        self.assertEqual(self.client.get(url).status_code, 302)
        first_timestamp = User.objects.get(pk=user.pk).email_verified_at
        self.assertEqual(self.client.get(url).status_code, 302)
        user.refresh_from_db()
        self.assertEqual(user.email_verified_at, first_timestamp)
        self.assertEqual(user.verification_state, User.VerificationState.PENDING_PHONE)
        self.assertFalse(user.is_active)

    def test_tampered_and_expired_email_links_are_rejected(self):
        user = self._pending_user()
        token = verification_token(user)
        tampered = token[:-1] + ("x" if token[-1] != "x" else "y")
        response = self.client.get(reverse("accounts_api:verify-account-email", kwargs={"token": tampered}))
        self.assertIn("status=expired", response.url)
        with patch("accounts.verification_views.user_from_token", side_effect=signing.SignatureExpired):
            response = self.client.get(reverse("accounts_api:verify-account-email", kwargs={"token": token}))
        self.assertIn("status=expired", response.url)

    def test_otp_is_hashed_wrong_code_limited_and_success_activates(self):
        user = self._pending_user(email_verified_at=timezone.now(), verification_state=User.VerificationState.PENDING_PHONE)
        challenge, code = request_phone_code(user, self._request())
        self.assertNotEqual(challenge.code_hash, code)
        self.assertNotIn(code, challenge.code_hash)
        with override_settings(ACCOUNT_OTP_MAX_ATTEMPTS=2):
            with self.assertRaises(ValueError):
                verify_phone_code(user, "000000" if code != "000000" else "111111", self._request())
            with self.assertRaises(ValueError):
                verify_phone_code(user, "000000" if code != "000000" else "111111", self._request())
        challenge.refresh_from_db()
        self.assertIsNotNone(challenge.locked_until)
        challenge.locked_until = None
        challenge.failed_attempts = 0
        challenge.save(update_fields=["locked_until", "failed_attempts"])
        verify_phone_code(user, code, self._request())
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.has_full_verification)
        self.assertEqual(user.verification_state, User.VerificationState.VERIFIED)
        self.assertIsNotNone(challenge.__class__.objects.get(pk=challenge.pk).consumed_at)

    def test_expired_otp_and_resend_cooldown(self):
        user = self._pending_user(email_verified_at=timezone.now(), verification_state=User.VerificationState.PENDING_PHONE)
        challenge, code = request_phone_code(user, self._request())
        challenge.expires_at = timezone.now() - timedelta(seconds=1)
        challenge.save(update_fields=["expires_at"])
        with self.assertRaisesRegex(ValueError, "expired"):
            verify_phone_code(user, code, self._request())
        with override_settings(ACCOUNT_OTP_RESEND_COOLDOWN_SECONDS=60):
            with self.assertRaises(PermissionError):
                request_phone_code(user, self._request())

    def test_duplicate_verified_phone_is_risk_flag_not_ban(self):
        existing = User.objects.create_user(email="existing@example.com", phone_number_normalized="+12105550144", phone_verified_at=timezone.now())
        user = self._pending_user(email_verified_at=timezone.now(), verification_state=User.VerificationState.PENDING_PHONE)
        _, code = request_phone_code(user, self._request())
        verify_phone_code(user, code, self._request())
        existing.refresh_from_db(); user.refresh_from_db()
        self.assertTrue(existing.duplicate_phone_risk)
        self.assertTrue(user.duplicate_phone_risk)
        self.assertTrue(user.is_active)

    def test_email_and_phone_changes_invalidate_only_corresponding_evidence(self):
        user = User.objects.create_user(
            email="verified@example.com", password="Strong-Test-Password-982!", is_active=True,
            verification_state=User.VerificationState.VERIFIED, email_verified_at=timezone.now(),
            phone_verified_at=timezone.now(), phone_number="+12105550144", phone_number_normalized="+12105550144",
        )
        self.client.force_authenticate(user)
        response = self.client.post(reverse("accounts_api:change-phone"), {"current_password": "Strong-Test-Password-982!", "new_phone_number": "2105550199"}, format="json")
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertIsNone(user.phone_verified_at)
        self.assertIsNotNone(user.email_verified_at)
        self.assertFalse(user.is_active)

    def test_password_reset_does_not_activate_pending_account(self):
        user = self._pending_user()
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        response = self.client.post(reverse("accounts_api:password_reset_confirm"), {"uid": uid, "token": token, "new_password": "Another-Strong-Password-432!"}, format="json")
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.verification_state, User.VerificationState.PENDING_EMAIL)

    def test_admin_suspicious_action_is_visible_and_audited(self):
        staff = User.objects.create_superuser(email="admin@example.com", password="Admin-Test-Password-321!")
        user = User.objects.create_user(email="review@example.com")
        request = RequestFactory().post("/admin/"); request.user = staff
        CustomUserAdmin(User, AdminSite()).mark_suspicious(request, User.objects.filter(pk=user.pk))
        user.refresh_from_db()
        self.assertEqual(user.trust_classification, User.TrustClassification.SUSPICIOUS)
        self.assertTrue(AccountSecurityEvent.objects.filter(user=user, event_type="account_classified_suspicious").exists())

    def test_security_events_do_not_store_otp(self):
        user = self._pending_user(email_verified_at=timezone.now(), verification_state=User.VerificationState.PENDING_PHONE)
        _, code = request_phone_code(user, self._request())
        self.assertNotIn(code, str(list(AccountSecurityEvent.objects.values_list("metadata", flat=True))))

    def test_test_and_spam_accounts_are_excluded_from_normal_attribution(self):
        normal = User.objects.create_user(email="normal@example.com")
        test_user = User.objects.create_user(email="test@example.com", trust_classification=User.TrustClassification.TEST)
        spam = User.objects.create_user(email="spam@example.com", trust_classification=User.TrustClassification.SPAM_FRAUD)
        for user in (normal, test_user, spam):
            AccountAcquisition.objects.create(user=user, first_touch={"source": "campaign"}, roles=["homeowner"])
            AttributionEvent.objects.create(event_type="account_created", user=user)
        report = acquisition_report()
        self.assertEqual(report["source_funnel"]["campaign"]["signups"], 1)
        self.assertEqual(report["funnel_events"]["account_created"], 1)
