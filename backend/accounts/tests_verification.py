from datetime import timedelta
import re
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import AdminSite
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core import mail, signing
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts.admin import CustomUserAdmin
from accounts.models import AccountSecurityEvent, PhoneVerificationChallenge, User
from accounts.services.verification import (
    request_phone_code,
    send_verification_email,
    user_from_email_token,
    verification_token,
    verify_phone_code,
)
from accounts.verification_views import VerificationEmailAddressThrottle
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

    @override_settings(TURNSTILE_REQUIRED=True, TURNSTILE_TEST_BYPASS=False, TURNSTILE_SECRET_KEY="configured-secret")
    def test_turnstile_rejects_missing_token_before_account_creation(self):
        response = self.register(turnstile_token="")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email="new.contractor@example.com").exists())

    @override_settings(TURNSTILE_REQUIRED=True, TURNSTILE_TEST_BYPASS=False, TURNSTILE_SECRET_KEY="configured-secret")
    @patch("accounts.services.verification.urlopen")
    def test_turnstile_verifies_valid_token_before_account_creation(self, urlopen):
        response_body = urlopen.return_value.__enter__.return_value
        response_body.read.return_value = b'{"success": true}'
        response = self.register(turnstile_token="valid-provider-token")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email="new.contractor@example.com").exists())
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://challenges.cloudflare.com/turnstile/v0/siteverify")
        self.assertIn(b"response=valid-provider-token", request.data)

    @override_settings(TURNSTILE_REQUIRED=True, TURNSTILE_TEST_BYPASS=False, TURNSTILE_SECRET_KEY="configured-secret")
    @patch("accounts.services.verification.urlopen")
    def test_turnstile_rejection_logs_only_safe_category(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = (
            b'{"success": false, "error-codes": ["timeout-or-duplicate", "untrusted-provider-text"]}'
        )
        with self.assertLogs("accounts.services.verification", level="INFO") as captured:
            response = self.register(turnstile_token="sensitive-test-response")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email="new.contractor@example.com").exists())
        self.assertIn("timeout-or-duplicate", captured.output[0])
        self.assertNotIn("sensitive-test-response", str(captured.output))
        self.assertNotIn("configured-secret", str(captured.output))
        self.assertNotIn("untrusted-provider-text", str(captured.output))

    def test_pending_login_routes_to_setup_without_tokens(self):
        user = self._pending_user()
        response = self.client.post("/api/accounts/auth/login/", {"email": f"  {user.email.upper()}  ", "password": "Strong-Test-Password-982!"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Finish setting up your account.")
        self.assertEqual(response.data["code"], "email_verification_required")
        self.assertIn("verification_session", response.data)
        self.assertNotIn("access", response.data)

    def test_incorrect_credentials_do_not_reveal_pending_or_unknown_status(self):
        user = self._pending_user()
        pending_response = self.client.post(
            "/api/accounts/auth/login/",
            {"email": user.email, "password": "wrong-password"},
            format="json",
        )
        unknown_response = self.client.post(
            "/api/accounts/auth/login/",
            {"email": "unknown@example.com", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(pending_response.status_code, 401)
        self.assertEqual(unknown_response.status_code, 401)
        self.assertEqual(pending_response.data, unknown_response.data)
        self.assertNotIn("code", pending_response.data)
        self.assertNotIn("verification_session", pending_response.data)

    def test_customer_and_contractor_pending_logins_share_verification_recovery(self):
        for role in ("homeowner", "contractor"):
            with self.subTest(role=role):
                user = self._pending_user(
                    email=f"{role}@example.com",
                    verification_role=role,
                )
                response = self.client.post(
                    "/api/accounts/auth/login/",
                    {
                        "email": user.email,
                        "password": "Strong-Test-Password-982!",
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(
                    response.data["code"], "email_verification_required"
                )

    @override_settings(ACCOUNT_EMAIL_RESEND_COOLDOWN_SECONDS=0)
    def test_resend_issues_one_replacement_and_invalidates_previous_token(self):
        user = self._pending_user()
        previous_token = send_verification_email(user, request=self._request())
        mail.outbox.clear()

        response = self.client.post(
            reverse("accounts_api:verification-resend-email"),
            {
                "email": f" {user.email.upper()} ",
                "verification_session": verification_token(user),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["detail"],
            "If this account is eligible, a new verification email has been sent.",
        )
        self.assertEqual(len(mail.outbox), 1)
        replacement_token = re.search(
            r"/verify-account-email/([^/]+)/", mail.outbox[0].body
        ).group(1)
        self.assertNotEqual(previous_token, replacement_token)

        previous = self.client.get(
            reverse(
                "accounts_api:verify-account-email",
                kwargs={"token": previous_token},
            )
        )
        self.assertIn("status=expired", previous.url)
        replacement = self.client.get(
            reverse(
                "accounts_api:verify-account-email",
                kwargs={"token": replacement_token},
            )
        )
        self.assertIn("status=email_verified", replacement.url)

    @override_settings(ACCOUNT_EMAIL_RESEND_COOLDOWN_SECONDS=60)
    def test_resend_cooldown_prevents_immediate_repeat(self):
        user = self._pending_user()
        send_verification_email(user, request=self._request())
        mail.outbox.clear()

        response = self.client.post(
            reverse("accounts_api:verification-resend-email"),
            {
                "email": user.email,
                "verification_session": verification_token(user),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertGreater(response.data["cooldown_seconds"], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_public_resend_does_not_leak_ineligible_or_unknown_status(self):
        eligible = self._pending_user(email="eligible@example.com")
        cooldown_eligible = self._pending_user(email="cooldown@example.com")
        send_verification_email(cooldown_eligible, request=self._request())
        AccountSecurityEvent.objects.filter(
            user=cooldown_eligible,
            event_type="verification_email_sent",
        ).update(created_at=timezone.now() - timedelta(seconds=17))
        mail.outbox.clear()
        verified = User.objects.create_user(
            "verified-resend@example.com",
            "Strong-Test-Password-982!",
            is_active=True,
            email_verified_at=timezone.now(),
            verification_state=User.VerificationState.VERIFIED,
        )
        disabled = self._pending_user(
            email="disabled@example.com",
            verification_state=User.VerificationState.DISABLED,
        )
        suspended = self._pending_user(
            email="suspended@example.com",
            verification_state=User.VerificationState.SUSPICIOUS,
            trust_classification=User.TrustClassification.SUSPICIOUS,
        )
        spam = self._pending_user(
            email="spam@example.com",
            trust_classification=User.TrustClassification.SPAM_FRAUD,
        )
        expected = None
        for email in (
            eligible.email,
            cooldown_eligible.email,
            verified.email,
            disabled.email,
            suspended.email,
            spam.email,
            "unknown@example.com",
        ):
            with self.subTest(email=email):
                response = self.client.post(
                    reverse("accounts_api:verification-resend-email"),
                    {"email": email},
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                expected = expected or response.data
                self.assertEqual(response.data, expected)
                self.assertEqual(
                    response.data["cooldown_seconds"],
                    settings.ACCOUNT_EMAIL_RESEND_COOLDOWN_SECONDS,
                )
        self.assertEqual(len(mail.outbox), 1)

    def test_failed_replacement_delivery_preserves_previous_token(self):
        user = self._pending_user()
        previous_token = send_verification_email(user, request=self._request())
        previous_version = user.email_verification_token_version

        with patch(
            "accounts.services.verification.send_mail",
            side_effect=RuntimeError("delivery unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                send_verification_email(user, request=self._request())

        user.refresh_from_db()
        self.assertEqual(user.email_verification_token_version, previous_version)
        self.assertEqual(user_from_email_token(previous_token), user)

    def test_repeated_successful_issuance_only_accepts_latest_token(self):
        user = self._pending_user()
        first_token = send_verification_email(user, request=self._request())
        second_token = send_verification_email(user, request=self._request())
        third_token = send_verification_email(user, request=self._request())

        for superseded_token in (first_token, second_token):
            with self.assertRaises(signing.BadSignature):
                user_from_email_token(superseded_token)
        self.assertEqual(user_from_email_token(third_token), user)
        user.refresh_from_db()
        self.assertEqual(user.email_verification_token_version, 3)

    def test_resend_is_throttled_by_normalized_email_and_client_ip(self):
        endpoint = reverse("accounts_api:verification-resend-email")
        cache.clear()
        with patch.dict(
            VerificationEmailAddressThrottle.THROTTLE_RATES,
            {"verification_email_address": "1/hour"},
            clear=False,
        ):
            first = self.client.post(
                endpoint,
                {"email": " Unknown@Example.com "},
                format="json",
                REMOTE_ADDR="203.0.113.1",
            )
            second = self.client.post(
                endpoint,
                {"email": "unknown@example.com"},
                format="json",
                REMOTE_ADDR="203.0.113.2",
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

        cache.clear()
        with (
            patch.dict(
                ScopedRateThrottle.THROTTLE_RATES,
                {"verification_email": "1/hour"},
                clear=False,
            ),
            patch.dict(
                VerificationEmailAddressThrottle.THROTTLE_RATES,
                {"verification_email_address": "10/hour"},
                clear=False,
            ),
        ):
            first = self.client.post(
                endpoint,
                {"email": "first-unknown@example.com"},
                format="json",
                REMOTE_ADDR="203.0.113.3",
            )
            second = self.client.post(
                endpoint,
                {"email": "second-unknown@example.com"},
                format="json",
                REMOTE_ADDR="203.0.113.3",
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

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
        payload, timestamp, signature = token.rsplit(":", 2)
        tampered_signature = ("x" if signature[0] != "x" else "y") + signature[1:]
        tampered = ":".join((payload, timestamp, tampered_signature))
        response = self.client.get(reverse("accounts_api:verify-account-email", kwargs={"token": tampered}))
        self.assertIn("status=expired", response.url)
        with patch("accounts.verification_views.user_from_email_token", side_effect=signing.SignatureExpired):
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
