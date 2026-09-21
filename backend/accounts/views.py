# backend/accounts/views.py
from django.contrib.auth import get_user_model, authenticate
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.http import HttpResponse
from django.views import View
from io import BytesIO
import logging

from .serializers import ContractorRegistrationSerializer, CustomerRegistrationSerializer

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
                return Response({"detail": "Email not verified. Please verify your account."},
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
        payload.setdefault("referral_code", request.session.get("referral_code", ""))
        serializer = ContractorRegistrationSerializer(data=payload, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        self._mark_referral_visit_registered(request, user)
        return Response(serializer.to_representation(user), status=status.HTTP_201_CREATED)

    @staticmethod
    def _mark_referral_visit_registered(request, user):
        from django.utils import timezone
        from projects.models_referrals import ReferralVisit

        if request.session.session_key:
            ReferralVisit.objects.filter(
                session_key=request.session.session_key,
                registered_user__isnull=True,
            ).update(registered_user=user, registration_at=timezone.now())


class CustomerRegistrationView(APIView):
    """
    POST to create a homeowner/customer account without requiring a project.
    Email verification is sent by the customer registration serializer.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        payload = request.data.copy()
        payload.setdefault("referral_code", request.session.get("referral_code", ""))
        serializer = CustomerRegistrationSerializer(data=payload, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        ContractorRegistrationView._mark_referral_visit_registered(request, user)
        return Response(serializer.to_representation(user), status=status.HTTP_201_CREATED)
