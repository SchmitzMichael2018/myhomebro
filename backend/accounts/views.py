# accounts/views.py
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from django.db import transaction
from .serializers import ContractorRegistrationSerializer # We will create this serializer

class ContractorRegistrationView(APIView):
    """
    Handles the registration of a new contractor.
    Uses a serializer to validate data and create the user and contractor profile
    within a single database transaction.
    """
    permission_classes = [AllowAny] # Explicitly allow any user to register

    def post(self, request):
        serializer = ContractorRegistrationSerializer(data=request.data)
        if serializer.is_valid():
            # The .save() method on our new serializer will handle everything.
            data = serializer.save()
            return Response(data, status=status.HTTP_201_CREATED)
        
        # If the data is not valid, the serializer will contain the errors.
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)