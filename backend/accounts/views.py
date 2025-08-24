# backend/accounts/views.py

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    ContractorRegistrationSerializer,
    EmailTokenObtainPairSerializer,
)


class EmailLoginView(TokenObtainPairView):
    """
    POST { "email": "...", "password": "..." } -> { "access", "refresh" }
    Returns clear messages for inactive or invalid credentials.
    """
    permission_classes = [permissions.AllowAny]
    serializer_class = EmailTokenObtainPairSerializer


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
