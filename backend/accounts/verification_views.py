from urllib.parse import urlencode
from datetime import timedelta
import hashlib
import math

from django.conf import settings
from django.core import signing
from django.http import HttpResponseRedirect
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import AccountSecurityEvent, User
from accounts.services.verification import (
    log_event,
    is_email_verification_eligible,
    normalize_account_email,
    request_phone_code,
    send_verification_email,
    user_from_email_token,
    user_from_token,
    verification_token,
    verify_phone_code,
)


def masked_phone(value):
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return f"(***) ***-{digits[-4:]}" if len(digits) >= 4 else "Mobile number on file"


def state_payload(user):
    return {
        "verification_state": user.verification_state,
        "email_verified": bool(user.email_verified_at),
        "phone_verified": bool(user.phone_verified_at),
        "masked_phone": masked_phone(user.phone_number_normalized or user.phone_number),
        "continuation": user.verification_continuation,
        "role": user.verification_role,
        "verification_session": verification_token(user),
    }


class VerifyAccountEmailView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        try:
            user = user_from_email_token(token)
            if not user.email_verified_at:
                user.email_verified_at = timezone.now()
                user.is_verified = True
            if user.verification_state == User.VerificationState.PENDING_EMAIL:
                user.verification_state = User.VerificationState.PENDING_PHONE
            user.save(update_fields=["email_verified_at", "is_verified", "verification_state"])
            log_event("email_verified", user=user, request=request)
            query = urlencode({"status": "email_verified", "verification_session": verification_token(user)})
        except (signing.BadSignature, signing.SignatureExpired, User.DoesNotExist):
            query = urlencode({"status": "expired"})
        return HttpResponseRedirect(f"{settings.FRONTEND_URL.rstrip('/')}/verify-account?{query}")


class VerificationStatusView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        try:
            return Response(state_payload(user_from_token(request.data.get("verification_session", ""))))
        except Exception:
            return Response({"detail": "Verification session expired."}, status=400)


class VerificationEmailAddressThrottle(SimpleRateThrottle):
    scope = "verification_email_address"

    def get_cache_key(self, request, view):
        email = normalize_account_email(request.data.get("email"))
        if not email:
            try:
                email = normalize_account_email(
                    user_from_token(request.data.get("verification_session", "")).email
                )
            except Exception:
                return None
        ident = hashlib.sha256(email.encode("utf-8")).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class ResendVerificationEmailView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle, VerificationEmailAddressThrottle]
    throttle_scope = "verification_email"

    def post(self, request):
        cooldown = getattr(settings, "ACCOUNT_EMAIL_RESEND_COOLDOWN_SECONDS", 60)
        generic = {
            "detail": "If this account is eligible, a new verification email has been sent.",
            "cooldown_seconds": cooldown,
        }
        session_is_valid = False
        user = None
        try:
            user = user_from_token(request.data.get("verification_session", ""))
            session_is_valid = True
        except Exception:
            email = normalize_account_email(request.data.get("email"))
            if email:
                user = User.objects.filter(email__iexact=email).first()
        supplied_email = normalize_account_email(request.data.get("email"))
        if user and supplied_email and normalize_account_email(user.email) != supplied_email:
            return Response(generic)
        if not user or not is_email_verification_eligible(user):
            return Response(generic)
        last = AccountSecurityEvent.objects.filter(user=user, event_type="verification_email_sent").order_by("-created_at").first()
        if last and last.created_at > timezone.now() - timedelta(seconds=cooldown):
            log_event("verification_rate_limited", user=user, request=request, metadata={"scope": "email"})
            if session_is_valid:
                remaining = cooldown - (timezone.now() - last.created_at).total_seconds()
                return Response({**generic, "cooldown_seconds": max(1, math.ceil(remaining))})
            return Response(generic)
        try:
            send_verification_email(user, request=request)
        except Exception:
            log_event("verification_email_delivery_failed", user=user, request=request)
            if session_is_valid:
                return Response(
                    {"detail": "We could not send the email right now. Please try again later."},
                    status=503,
                )
        return Response(generic)


class RequestPhoneVerificationView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "verification_sms"

    def post(self, request):
        try:
            user = user_from_token(request.data.get("verification_session", ""))
            if not user.email_verified_at:
                return Response({"detail": "Verify your email before requesting a mobile code."}, status=409)
            challenge, test_code = request_phone_code(user, request)
            payload = {"detail": "Verification code sent.", "masked_phone": masked_phone(challenge.phone_number_e164)}
            if test_code:
                payload["test_code"] = test_code
            return Response(payload, status=201)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=429)
        except (ValueError, RuntimeError) as exc:
            return Response({"detail": str(exc)}, status=503 if isinstance(exc, RuntimeError) else 400)
        except Exception:
            return Response({"detail": "Verification session expired."}, status=400)


class ConfirmPhoneVerificationView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "verification_sms"

    def post(self, request):
        try:
            user = user_from_token(request.data.get("verification_session", ""))
            verify_phone_code(user, request.data.get("code"), request)
            refresh = RefreshToken.for_user(user)
            payload = state_payload(user)
            payload.update({"access": str(refresh.access_token), "refresh": str(refresh)})
            return Response(payload)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=429)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            return Response({"detail": "Verification session expired."}, status=400)
