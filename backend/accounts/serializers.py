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
REQUIRE_EMAIL_VERIFICATION = getattr(
    settings, "ACCOUNTS_REQUIRE_EMAIL_VERIFICATION", True
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _safe_get(obj, attr, default=None):
    """
    Return obj.attr if present; if it's a File/Image, return its .url when available.
    Otherwise return default.
    """
    if not hasattr(obj, attr):
        return default
    val = getattr(obj, attr)
    if val is None:
        return default
    url = getattr(val, "url", None)
    return url if url else val


# ──────────────────────────────────────────────────────────────────────────────
# Public serializers
# ──────────────────────────────────────────────────────────────────────────────

class PublicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "is_active", "date_joined"]


class SafeContractorSerializer(serializers.Serializer):
    """
    Read-only, resilient serializer for Contractor.
    Uses method fields so missing model attributes (e.g., city/state) do NOT crash.
    """
    id = serializers.SerializerMethodField()
    user = PublicUserSerializer(read_only=True)

    business_name = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()

    # Optional / legacy location fields — returned only if present on the model
    city = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()
    postal_code = serializers.SerializerMethodField()

    # Optional business/license fields
    license_number = serializers.SerializerMethodField()
    license_expiration = serializers.SerializerMethodField()

    # Onboarding / status fields
    onboarding_status = serializers.SerializerMethodField()

    # If you later add branding/stripe fields, just add more SerializerMethodFields

    def get_id(self, obj):
        return getattr(obj, "id", None)

    def get_business_name(self, obj):
        return _safe_get(obj, "business_name")

    def get_phone(self, obj):
        return _safe_get(obj, "phone")

    def get_address(self, obj):
        return _safe_get(obj, "address")

    def get_city(self, obj):
        return _safe_get(obj, "city")

    def get_state(self, obj):
        return _safe_get(obj, "state")

    def get_postal_code(self, obj):
        # Support historical names if your model used a different field earlier
        for candidate in ("postal_code", "zip_code", "zip"):
            val = _safe_get(obj, candidate)
            if val is not None:
                return val
        return None

    def get_license_number(self, obj):
        return _safe_get(obj, "license_number")

    def get_license_expiration(self, obj):
        return _safe_get(obj, "license_expiration")

    def get_onboarding_status(self, obj):
        return _safe_get(obj, "onboarding_status")


# ──────────────────────────────────────────────────────────────────────────────
# Auth / Token serializers
# ──────────────────────────────────────────────────────────────────────────────

class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = "email"

    def validate(self, attrs):
        raw_email = (attrs.get("email") or attrs.get("username") or "").strip().lower()
        password = attrs.get("password") or ""
        if not raw_email or not password:
            raise AuthenticationFailed("Invalid email or password.", code="invalid_credentials")

        attrs["email"] = raw_email
        attrs["username"] = raw_email

        try:
            user = User.objects.get(email__iexact=raw_email)
            if not user.is_active:
                raise AuthenticationFailed(
                    "Email not verified. Please verify your account.",
                    code="user_inactive",
                )
        except User.DoesNotExist:
            # Fall through to super().validate to raise uniform invalid creds
            pass

        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            raise AuthenticationFailed("Invalid email or password.", code="invalid_credentials")

        user = self.user
        data.update({
            "user": {
                "id": user.id,
                "email": user.email,
                "first_name": getattr(user, "first_name", ""),
                "last_name": getattr(user, "last_name", ""),
                "is_active": user.is_active,
            }
        })
        return data


# ──────────────────────────────────────────────────────────────────────────────
# Registration
# ──────────────────────────────────────────────────────────────────────────────

class ContractorRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={"input_type": "password"},
        trim_whitespace=False,
    )
    phone_number = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default=""
    )

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

                # Optional phone_number support on custom User model
                if hasattr(user, "phone_number"):
                    user.phone_number = phone
                    user.save(update_fields=["phone_number"])

                # Email verification gating
                user.is_active = not REQUIRE_EMAIL_VERIFICATION
                user.save(update_fields=["is_active"])

                # Create Contractor; only pass fields that certainly exist
                # (Assumes Contractor has at least user + phone)
                create_kwargs = {"user": user}
                if hasattr(Contractor, "phone"):
                    create_kwargs["phone"] = phone
                Contractor.objects.create(**create_kwargs)

        except IntegrityError:
            raise serializers.ValidationError(
                {"email": ["An account with this email already exists."]}
            )

        return user

    def to_representation(self, user):
        contractor = Contractor.objects.filter(user=user).first()

        payload = {
            "message": (
                "Registration successful. Please check your email to verify your account."
                if REQUIRE_EMAIL_VERIFICATION
                else "Registration successful."
            ),
            "user": PublicUserSerializer(user).data,
            "contractor": SafeContractorSerializer(contractor).data if contractor else None,
        }

        if user.is_active:
            refresh = RefreshToken.for_user(user)
            payload["refresh"] = str(refresh)
            payload["access"] = str(refresh.access_token)

        return payload


# ──────────────────────────────────────────────────────────────────────────────
# Account Settings (Change Email / Password)
# ──────────────────────────────────────────────────────────────────────────────

class ChangeEmailSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_email = serializers.EmailField()

    def validate(self, attrs):
        request = self.context["request"]
        user = request.user

        # Verify password
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError(
                {"current_password": "Incorrect password."}
            )

        new_email = attrs["new_email"].strip().lower()

        # Must be unique
        if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
            raise serializers.ValidationError(
                {"new_email": "This email is already in use."}
            )

        attrs["new_email"] = new_email
        return attrs

    def save(self, **kwargs):
        user = self.context["request"].user
        new_email = self.validated_data["new_email"]

        user.email = new_email

        # If you use email-as-username, keep username in sync
        if hasattr(user, "username"):
            user.username = new_email

        user.save(update_fields=["email", "username"])
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Incorrect current password.")
        return value

    def validate(self, attrs):
        new = attrs["new_password"]
        confirm = attrs["new_password_confirm"]

        if new != confirm:
            raise serializers.ValidationError(
                {"new_password_confirm": "New passwords do not match."}
            )

        # Apply Django’s password checks (same validator you use on signup)
        validate_password(new, self.context["request"].user)

        return attrs

    def save(self, **kwargs):
        user = self.context["request"].user
        new = self.validated_data["new_password"]

        user.set_password(new)
        user.save(update_fields=["password"])
        return user


# ──────────────────────────────────────────────────────────────────────────────
# Password Reset (Request / Confirm)
# ──────────────────────────────────────────────────────────────────────────────

from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator

class PasswordResetRequestSerializer(serializers.Serializer):
    """
    Step 1: request password reset.
    Frontend: POST /accounts/auth/password-reset/request/
    """
    email = serializers.EmailField()

    def validate_email(self, value):
        # Normalize and always accept — we don't reveal whether it exists.
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """
    Step 2: confirm password reset.
    Frontend: POST /accounts/auth/password-reset/confirm/
    Payload: { "uid": "...", "token": "...", "new_password": "..." }
    """
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        uidb64 = attrs.get("uid")
        token = attrs.get("token")
        new_password = attrs.get("new_password")

        # Decode the user id
        try:
            user_id = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=user_id, is_active=True)
        except Exception:
            raise serializers.ValidationError(
                {"uid": ["Invalid or expired reset link."]}
            )

        # Check token validity
        if not default_token_generator.check_token(user, token):
            raise serializers.ValidationError(
                {"token": ["This password reset link is invalid or has expired."]}
            )

        # Validate password strength
        validate_password(new_password, user=user)

        self.user = user
        return attrs

    def save(self, **kwargs):
        user = self.user
        new_password = self.validated_data["new_password"]
        user.set_password(new_password)
        user.save(update_fields=["password"])
        return user
