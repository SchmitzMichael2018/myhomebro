# backend/accounts/serializers.py

from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth import authenticate
from django.db import transaction
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from projects.models import Contractor
from projects.serializers import ContractorSerializer as ProjectContractorSerializer

User = get_user_model()

class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    # tell Simple JWT to look up users by email, not username
    username_field = "email"

    def validate(self, attrs):
        # attrs now contains {"email": ..., "password": ...}
        email    = attrs.get("email")
        password = attrs.get("password")

        if not email or not password:
            raise serializers.ValidationError("Email and password are required")

        # use Django's authenticate under the hood (it will use username_field)
        user = authenticate(
            request=self.context.get("request"),
            username=email,
            password=password
        )
        if user is None:
            raise serializers.ValidationError("Invalid credentials")

        # delegate token creation back to the parent
        data = super().validate({"username": user.username, "password": password})

        # your extra check:
        if not user.is_verified:
            raise serializers.ValidationError(
                "Account not verified. Please check your email for a verification link."
            )

        # add any extra user info you want in the response:
        data['user_id'] = user.id
        data['email']   = user.email
        return data



class ContractorRegistrationSerializer(serializers.ModelSerializer):
    """
    Serializer for contractor registration. Creates both the User (inactive until
    email verification) and the linked Contractor profile, then returns tokens.
    """
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={"input_type": "password"}
    )
    phone_number = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = (
            "email",
            "password",
            "first_name",
            "last_name",
            "phone_number",
        )
        extra_kwargs = {
            "email": {"required": True},
        }

    def create(self, validated_data):
        """
        Creates User and Contractor inside an atomic transaction,
        then returns the User instance.
        """
        phone = validated_data.pop("phone_number", "")

        with transaction.atomic():
            # 1) Create the user
            user = User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                first_name=validated_data.get("first_name", ""),
                last_name=validated_data.get("last_name", ""),
            )

            # 2) Save phone_number on user model (if your User has that field)
            if hasattr(user, "phone_number"):
                user.phone_number = phone
                user.save()

            # 3) Mark inactive until email verification
            user.is_active = False
            user.save()

            # 4) Create the Contractor profile
            contractor = Contractor.objects.create(
                user=user,
                phone=phone  # assumes Contractor model has a `phone` field
            )

        return user

    def to_representation(self, user):
        """
        After create/save, output a dict with message, user, contractor data,
        and JWT tokens.
        """
        # Fetch the linked contractor
        contractor = Contractor.objects.get(user=user)

        # Generate JWTs
        refresh = RefreshToken.for_user(user)
        access  = refresh.access_token

        return {
            "message": "Registration successful. Please check your email to verify your account.",
            "user": {
                "id": user.id,
                "email": user.email,
            },
            "contractor": ProjectContractorSerializer(contractor).data,
            "refresh": str(refresh),
            "access": str(access),
        }
