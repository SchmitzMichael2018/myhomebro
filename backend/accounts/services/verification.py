from __future__ import annotations

import json
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from accounts.models import AccountSecurityEvent, PhoneVerificationChallenge, User
from projects.services.sms_service import normalize_phone_to_e164

logger = logging.getLogger(__name__)
TOKEN_SALT = "accounts.verification.v1"
EMAIL_TOKEN_SALT = "accounts.email_verification.v2"
TURNSTILE_SAFE_ERROR_CODES = frozenset({
    "missing-input-secret", "invalid-input-secret", "missing-input-response",
    "invalid-input-response", "bad-request", "timeout-or-duplicate",
    "internal-error",
})


def client_ip(request):
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return forwarded or request.META.get("REMOTE_ADDR") or None


def safe_continuation(value):
    value = str(value or "").strip()
    return value if value.startswith("/") and not value.startswith("//") else ""


def normalize_account_email(value):
    return str(value or "").strip().lower()


def apply_registration_risk_flags(user, *, request=None):
    configured = getattr(settings, "ACCOUNT_DISPOSABLE_EMAIL_DOMAINS", ())
    domains = {str(item).strip().lower() for item in configured if str(item).strip()}
    domain = user.email.rsplit("@", 1)[-1].lower() if "@" in user.email else ""
    if domain and domain in domains:
        user.trust_classification = User.TrustClassification.SUSPICIOUS
        user.save(update_fields=["trust_classification"])
        log_event("disposable_email_flag", user=user, request=request, metadata={"domain": domain})
        return True
    return False


def verification_token(user):
    return signing.dumps({"user": user.pk, "purpose": "account_verification"}, salt=TOKEN_SALT, compress=True)


def user_from_token(token):
    payload = signing.loads(token, salt=TOKEN_SALT, max_age=getattr(settings, "ACCOUNT_VERIFICATION_TOKEN_MAX_AGE", 86400))
    if payload.get("purpose") != "account_verification":
        raise signing.BadSignature("Wrong token purpose")
    return User.objects.get(pk=payload["user"])


def email_verification_token(user, version):
    return signing.dumps(
        {
            "user": user.pk,
            "purpose": "email_verification",
            "version": version,
        },
        salt=EMAIL_TOKEN_SALT,
        compress=True,
    )


def user_from_email_token(token):
    max_age = getattr(settings, "ACCOUNT_VERIFICATION_TOKEN_MAX_AGE", 86400)
    try:
        payload = signing.loads(token, salt=EMAIL_TOKEN_SALT, max_age=max_age)
        if payload.get("purpose") != "email_verification":
            raise signing.BadSignature("Wrong token purpose")
        user = User.objects.get(pk=payload["user"])
        if payload.get("version") != user.email_verification_token_version:
            raise signing.BadSignature("Superseded email verification token")
        return user
    except (signing.BadSignature, User.DoesNotExist):
        user = user_from_token(token)
        if user.email_verification_token_version != 0:
            raise signing.BadSignature("Superseded legacy email verification token")
        return user


def is_email_verification_eligible(user):
    return bool(
        not user.is_active
        and not user.email_verified_at
        and user.verification_state == User.VerificationState.PENDING_EMAIL
        and user.trust_classification
        not in {
            User.TrustClassification.SUSPICIOUS,
            User.TrustClassification.SPAM_FRAUD,
        }
    )


def log_event(event_type, *, user=None, request=None, metadata=None):
    return AccountSecurityEvent.objects.create(
        user=user,
        event_type=event_type,
        request_ip=client_ip(request) if request else None,
        metadata=metadata or {},
    )


def send_verification_email(user, *, request=None):
    with transaction.atomic():
        locked_user = User.objects.select_for_update().get(pk=user.pk)
        next_version = locked_user.email_verification_token_version + 1
        token = email_verification_token(locked_user, next_version)
        url = f"{str(settings.SITE_URL).rstrip('/')}/api/accounts/auth/verify-account-email/{token}/"
        locked_user.email_verification_token_version = next_version
        locked_user.save(update_fields=["email_verification_token_version"])
        send_mail(
            "Verify your MyHomeBro email",
            "Thanks for creating your MyHomeBro account.\n\nVerify your email address to continue setting up your account:\n"
            f"{url}\n\nIf you didn't create this account, you can ignore this message.",
            settings.DEFAULT_FROM_EMAIL,
            [locked_user.email],
            fail_silently=False,
        )
    user.email_verification_token_version = next_version
    log_event("verification_email_sent", user=user, request=request)
    return token


def verify_turnstile(token, request):
    required = bool(getattr(settings, "TURNSTILE_REQUIRED", False))
    if getattr(settings, "TURNSTILE_TEST_BYPASS", False) and settings.DEBUG:
        return True
    secret = str(getattr(settings, "TURNSTILE_SECRET_KEY", "")).strip()
    if not required and not secret:
        return True
    if not secret:
        logger.warning("Turnstile verification rejected: secret_not_configured")
        return False
    if not token:
        logger.info("Turnstile verification rejected: token_missing")
        return False
    body = urlencode({"secret": secret, "response": token, "remoteip": client_ip(request) or ""}).encode()
    try:
        with urlopen(Request("https://challenges.cloudflare.com/turnstile/v0/siteverify", data=body), timeout=5) as response:
            result = json.loads(response.read().decode())
            if result.get("success"):
                return True
            codes = result.get("error-codes") or []
            safe_codes = sorted({code for code in codes if isinstance(code, str) and code in TURNSTILE_SAFE_ERROR_CODES})
            logger.info("Turnstile verification rejected: %s", ",".join(safe_codes) or "provider_rejected")
            return False
    except Exception as exc:
        logger.warning("Turnstile verification unavailable: %s", type(exc).__name__)
        return False


def _send_sms(phone, code):
    backend = getattr(settings, "ACCOUNT_VERIFICATION_SMS_BACKEND", "disabled")
    body = f"MyHomeBro verification code: {code}\n\nThis code expires in 10 minutes. Do not share this code."
    if backend == "test" and settings.DEBUG:
        return
    if backend != "twilio":
        raise RuntimeError("Mobile verification is not configured.")
    from twilio.rest import Client
    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    payload = {"to": phone, "body": body}
    if getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", ""):
        payload["messaging_service_sid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    else:
        payload["from_"] = settings.TWILIO_PHONE_NUMBER or settings.TWILIO_FROM_NUMBER
    client.messages.create(**payload)


def request_phone_code(user, request):
    now = timezone.now()
    if user.verification_state == User.VerificationState.DISABLED or user.trust_classification == User.TrustClassification.SPAM_FRAUD:
        raise PermissionError("This account is unavailable.")
    phone = normalize_phone_to_e164(user.phone_number_normalized or user.phone_number)
    if not phone or not phone.startswith("+") or not phone[1:].isdigit():
        raise ValueError("Enter a valid mobile number before requesting a code.")
    cooldown = getattr(settings, "ACCOUNT_OTP_RESEND_COOLDOWN_SECONDS", 60)
    recent = PhoneVerificationChallenge.objects.filter(user=user, sent_at__gte=now - timedelta(seconds=cooldown)).exists()
    if recent:
        log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "otp_cooldown"})
        raise PermissionError("Please wait before requesting another code.")
    window = now - timedelta(hours=1)
    if PhoneVerificationChallenge.objects.filter(user=user, sent_at__gte=window).count() >= getattr(settings, "ACCOUNT_OTP_MAX_SENDS_PER_HOUR", 5):
        log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "account"})
        raise PermissionError("Too many codes requested. Try again later.")
    if PhoneVerificationChallenge.objects.filter(phone_number_e164=phone, sent_at__gte=window).count() >= getattr(settings, "ACCOUNT_OTP_MAX_SENDS_PER_PHONE_HOUR", 5):
        log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "phone"})
        raise PermissionError("Too many codes requested. Try again later.")
    ip = client_ip(request)
    if ip and PhoneVerificationChallenge.objects.filter(request_ip=ip, sent_at__gte=window).count() >= getattr(settings, "ACCOUNT_OTP_MAX_SENDS_PER_IP_HOUR", 10):
        log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "ip"})
        raise PermissionError("Too many codes requested. Try again later.")
    session_key = getattr(request.session, "session_key", "") or ""
    if session_key and PhoneVerificationChallenge.objects.filter(session_key=session_key, sent_at__gte=window).count() >= getattr(settings, "ACCOUNT_OTP_MAX_SENDS_PER_SESSION_HOUR", 5):
        log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "session"})
        raise PermissionError("Too many codes requested. Try again later.")
    code = f"{secrets.randbelow(1000000):06d}"
    _send_sms(phone, code)
    challenge = PhoneVerificationChallenge.objects.create(
        user=user,
        phone_number_e164=phone,
        code_hash=make_password(code),
        expires_at=now + timedelta(seconds=getattr(settings, "ACCOUNT_OTP_TTL_SECONDS", 600)),
        request_ip=ip,
        session_key=session_key,
    )
    log_event("sms_otp_requested", user=user, request=request)
    return challenge, code if getattr(settings, "ACCOUNT_VERIFICATION_SMS_BACKEND", "") == "test" and settings.DEBUG else None


def verify_phone_code(user, code, request):
    now = timezone.now()
    if user.verification_state == User.VerificationState.DISABLED or user.trust_classification == User.TrustClassification.SPAM_FRAUD:
        raise PermissionError("This account is unavailable.")
    error = None
    failed_attempts = None
    with transaction.atomic():
        challenge = PhoneVerificationChallenge.objects.select_for_update().filter(user=user, consumed_at__isnull=True).order_by("-sent_at").first()
        if not challenge or challenge.expires_at <= now:
            error = ValueError("This code has expired. Request a new code.")
        elif challenge.locked_until and challenge.locked_until > now:
            error = PermissionError("Too many attempts. Try again later.")
        elif not check_password(str(code or ""), challenge.code_hash):
            challenge.failed_attempts += 1
            if challenge.failed_attempts >= getattr(settings, "ACCOUNT_OTP_MAX_ATTEMPTS", 5):
                challenge.locked_until = now + timedelta(minutes=15)
            challenge.save(update_fields=["failed_attempts", "locked_until"])
            failed_attempts = challenge.failed_attempts
            error = ValueError("The verification code is incorrect.")
        else:
            challenge.consumed_at = now
            challenge.save(update_fields=["consumed_at"])
            user.phone_number_normalized = challenge.phone_number_e164
            user.phone_verified_at = now
            user.verification_state = User.VerificationState.VERIFIED
            user.is_verified = True
            user.is_active = True
            duplicate = User.objects.filter(phone_number_normalized=challenge.phone_number_e164, phone_verified_at__isnull=False).exclude(pk=user.pk)
            user.duplicate_phone_risk = duplicate.exists()
            user.save(update_fields=["phone_number_normalized", "phone_verified_at", "verification_state", "is_verified", "is_active", "duplicate_phone_risk"])
            if user.duplicate_phone_risk:
                duplicate.update(duplicate_phone_risk=True)
    if error:
        if failed_attempts is not None:
            log_event("sms_verification_failed", user=user, request=request, metadata={"attempts": failed_attempts})
        raise error
    if user.duplicate_phone_risk:
        log_event("duplicate_phone_flag", user=user, request=request)
    log_event("sms_verification_succeeded", user=user, request=request)
    return user
