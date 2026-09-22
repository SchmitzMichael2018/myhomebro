# backend/accounts/views.py
from django.contrib.auth import get_user_model, authenticate
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from django.http import HttpResponse
from django.views import View
from io import BytesIO
import logging

from .serializers import ContractorRegistrationSerializer, CustomerRegistrationSerializer
from .services.verification import apply_registration_risk_flags, log_event, safe_continuation, send_verification_email, verification_token, verify_turnstile

logger = logging.getLogger(__name__)
User = get_user_model()

PUBLIC_REGISTRATION_URL = "https://www.myhomebro.com/register"


class PublicRegistrationQrView(View):
    """Return the fixed public registration QR; callers cannot choose its target."""

    def get(self, request, *args, **kwargs):
        import qrcode
        import qrcode.image.svg

        image = qrcode.make(
            PUBLIC_REGISTRATION_URL,
            image_factory=qrcode.image.svg.SvgPathImage,
            box_size=8,
            border=4,
        )
        output = BytesIO()
        image.save(output)
        response = HttpResponse(output.getvalue(), content_type="image/svg+xml")
        response["Cache-Control"] = "public, max-age=86400"
        response["Content-Disposition"] = 'inline; filename="myhomebro-registration-qr.svg"'
        return response


class EmailLoginView(APIView):
    """
    POST { "email": "...", "password": "..." }
    -> 200 { access, refresh, user:{id,email,first_name,last_name,is_active} }
    -> 400 missing fields
    -> 401 invalid credentials
    -> 403 inactive / not verified
    Never raises 500 to the client; logs server-side details instead.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        try:
            email = (request.data.get("email") or "").strip().lower()
            password = request.data.get("password") or ""
            if not email or not password:
                return Response({"detail": "Invalid email or password."},
                                status=status.HTTP_400_BAD_REQUEST)

            # Try configured auth backends (works if EmailBackend or USERNAME_FIELD='email')
            user = authenticate(request, email=email, password=password)

            # Fallback: manual lookup + password check
            if user is None:
                try:
                    u = User.objects.get(email__iexact=email)
                    if not u.check_password(password):
                        raise User.DoesNotExist
                    user = u
                except User.DoesNotExist:
                    return Response({"detail": "Invalid email or password."},
                                    status=status.HTTP_401_UNAUTHORIZED)

            if not user.is_active:
                if user.verification_state == User.VerificationState.DISABLED or user.trust_classification == User.TrustClassification.SPAM_FRAUD:
                    return Response({"detail": "This account is unavailable."}, status=status.HTTP_403_FORBIDDEN)
                return Response({
                    "detail": "Finish setting up your account.",
                    "verification_state": user.verification_state,
                    "email_verified": bool(user.email_verified_at),
                    "phone_verified": bool(user.phone_verified_at),
                    "verification_session": verification_token(user),
                    "continuation": user.verification_continuation,
                },
                                status=status.HTTP_403_FORBIDDEN)

            refresh = RefreshToken.for_user(user)
            return Response({
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "first_name": getattr(user, "first_name", "") or "",
                    "last_name": getattr(user, "last_name", "") or "",
                    "is_active": user.is_active,
                },
            }, status=status.HTTP_200_OK)

        except Exception as exc:
            # Log server-side detail; return safe message to client
            logger.exception("Login error for email=%s", request.data.get("email"))
            return Response(
                {"detail": "Server error while processing login."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ContractorRegistrationView(APIView):
    """
    POST to create User + Contractor. Only includes tokens if user is active.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        payload = request.data.copy()
        if payload.get("company_website"):
            return Response({"message": "Registration received. Please check your email to continue."}, status=201)
        if not verify_turnstile(payload.get("turnstile_token", ""), request):
            return Response({"detail": "We could not verify this registration. Please try again."}, status=400)
        payload.setdefault("referral_code", request.session.get("referral_code", ""))
        serializer = ContractorRegistrationSerializer(data=payload, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        user.verification_role = "contractor"
        user.verification_continuation = safe_continuation(payload.get("continuation"))
        user.save(update_fields=["verification_role", "verification_continuation"])
        apply_registration_risk_flags(user, request=request)
        email_sent = True
        try:
            send_verification_email(user, request=request)
        except Exception:
            email_sent = False
            logger.exception("Verification email delivery failed for user_id=%s", user.pk)
            log_event("verification_email_delivery_failed", user=user, request=request)
        self._mark_referral_visit_registered(request, user, role="contractor")
        response = serializer.to_representation(user)
        response.update({"next_step": "verify_email", "verification_session": verification_token(user)})
        if not email_sent:
            response["message"] = "Account created, but the verification email could not be sent. Use Resend verification email to try again."
        return Response(response, status=status.HTTP_201_CREATED)

    @staticmethod
    def _mark_referral_visit_registered(request, user, *, role):
        from projects.services.attribution import associate_account
        associate_account(request, user, role=role)


class CustomerRegistrationView(APIView):
    """
    POST to create a homeowner/customer account without requiring a project.
    Email verification is sent by the customer registration serializer.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_registration"
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_registration"

    def post(self, request, *args, **kwargs):
        payload = request.data.copy()
        if payload.get("company_website"):
            return Response({"ok": True, "message": "Account created. Please check your email to continue.", "next_step": "verify_email"}, status=201)
        if not verify_turnstile(payload.get("turnstile_token", ""), request):
            return Response({"detail": "We could not verify this registration. Please try again."}, status=400)
        payload.setdefault("referral_code", request.session.get("referral_code", ""))
        serializer = CustomerRegistrationSerializer(data=payload, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        account_type = str(payload.get("account_type") or "individual")
        role = "property_manager" if account_type == "property_management_company" else "homeowner"
        user.verification_role = role
        user.verification_continuation = safe_continuation(payload.get("continuation"))
        user.save(update_fields=["verification_role", "verification_continuation"])
        apply_registration_risk_flags(user, request=request)
        email_sent = True
        try:
            send_verification_email(user, request=request)
        except Exception:
            email_sent = False
            logger.exception("Verification email delivery failed for user_id=%s", user.pk)
            log_event("verification_email_delivery_failed", user=user, request=request)
        ContractorRegistrationView._mark_referral_visit_registered(request, user, role=role)
        response = serializer.to_representation(user)
        response["verification_session"] = verification_token(user)
        if not email_sent:
            response["message"] = "Account created, but the verification email could not be sent. Use Resend verification email to try again."
        return Response(response, status=status.HTTP_201_CREATED)
