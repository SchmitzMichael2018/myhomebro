# backend/accounts/views.py
from django.contrib.auth import get_user_model, authenticate
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
import logging

from .serializers import ContractorRegistrationSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


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
        serializer = ContractorRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        return Response(serializer.to_representation(user), status=status.HTTP_201_CREATED)
