# backend/accounts/serializers.py

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction, IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from projects.models import Contractor

User = get_user_model()

# Toggle via settings: set to False in dev to allow immediate login after register.
REQUIRE_EMAIL_VERIFICATION = getattr(settings, "ACCOUNTS_REQUIRE_EMAIL_VERIFICATION", True)


class PublicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "is_active", "date_joined"]


class SafeContractorSerializer(serializers.ModelSerializer):
    user = PublicUserSerializer(read_only=True)

    class Meta:
        model = Contractor
        fields = [
            "id",
            "user",
            "business_name",
            "phone",
            "address",
            "city",
            "state",
            "postal_code",
            "license_number",
            "license_expiration",
            "onboarding_status",
        ]


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Accept { "email": "...", "password": "..." }.
    - Normalizes email to lowercase
    - Gives clear message if user is inactive (unverified)
    - Unifies invalid credentials message
    """
    username_field = "email"

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip().lower()
        password = attrs.get("password") or ""
        attrs["email"] = email

        try:
            user = User.objects.get(email__iexact=email)
            if not user.is_active:
                # Explicit message for unverified accounts
                raise AuthenticationFailed("Email not verified. Please verify your account.", code="user_inactive")
        except User.DoesNotExist:
            # Fall through to generic invalid creds
            pass

        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            # Standardize message for bad creds
            raise AuthenticationFailed("Invalid email or password.", code="invalid_credentials")
        return data


class ContractorRegistrationSerializer(serializers.ModelSerializer):
    """
    Create a User and linked Contractor.
    - Email normalized + unique
    - is_active depends on REQUIRE_EMAIL_VERIFICATION
    - JSON-safe response
    - Only includes tokens if user is active
    """
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={"input_type": "password"},
        trim_whitespace=False,
    )
    phone_number = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")

    class Meta:
        model = User
        fields = ("email", "password", "first_name", "last_name", "phone_number")
        extra_kwargs = {"email": {"required": True}}

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip().lower()
        if not email:
            raise serializers.ValidationError({"email": ["This field is required."]})
        attrs["email"] = email
        return attrs

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def create(self, validated_data):
        phone = validated_data.pop("phone_number", "").strip()
        email = validated_data.get("email")

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    email=email,
                    password=validated_data["password"],
                    first_name=validated_data.get("first_name", ""),
                    last_name=validated_data.get("last_name", ""),
                )

                if hasattr(user, "phone_number"):
                    user.phone_number = phone
                    user.save(update_fields=["phone_number"])

                # Activate immediately if verification is not required
                user.is_active = not REQUIRE_EMAIL_VERIFICATION
                user.save(update_fields=["is_active"])

                Contractor.objects.create(
                    user=user,
                    phone=phone  # assumes Contractor.phone exists
                )
        except IntegrityError:
            raise serializers.ValidationError({"email": ["An account with this email already exists."]})

        return user

    def to_representation(self, user):
        contractor = Contractor.objects.get(user=user)
        payload = {
            "message": (
                "Registration successful. Please check your email to verify your account."
                if REQUIRE_EMAIL_VERIFICATION else
                "Registration successful."
            ),
            "user": PublicUserSerializer(user).data,
            "contractor": SafeContractorSerializer(contractor).data,
        }

        # Only issue tokens if the account is active (i.e., usable for login)
        if user.is_active:
            refresh = RefreshToken.for_user(user)
            payload["refresh"] = str(refresh)
            payload["access"] = str(refresh.access_token)

        return payload
