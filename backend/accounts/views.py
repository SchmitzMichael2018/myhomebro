from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.tokens import RefreshToken
from projects.models import Contractor
from projects.serializers import ContractorSerializer

User = get_user_model()

class ContractorRegistrationView(APIView):
    permission_classes = []

    def post(self, request):
        email = request.data.get("email")
        password = request.data.get("password")
        name = request.data.get("name")
        business_name = request.data.get("business_name", "")
        phone = request.data.get("phone", "")
        skills = request.data.get("skills", "")

        if User.objects.filter(email=email).exists():
            return Response(
                {"error": "A user with this email already exists. Please log in or use another email."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(password)
        except ValidationError as e:
            return Response({"error": list(e)}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(email=email, password=password, first_name=name)
        user.save()
        contractor = Contractor.objects.create(
            user=user,
            name=name,
            email=email,
            business_name=business_name,
            phone=phone,
            skills=skills,
        )
        refresh = RefreshToken.for_user(user)

        return Response(
            {
                "message": "Registration successful.",
                "user": {
                    "id": user.id,
                    "email": user.email,
                },
                "contractor": ContractorSerializer(contractor).data,
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            },
            status=status.HTTP_201_CREATED,
        )



