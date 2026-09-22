from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction, IntegrityError
from django.urls import NoReverseMatch, reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from projects.models import Contractor, Homeowner
from projects.services.customer_accounts import (
    get_or_create_customer_account_identity,
    split_customer_name,
)

User = get_user_model()
REQUIRE_EMAIL_VERIFICATION = getattr(
    settings, "ACCOUNTS_REQUIRE_EMAIL_VERIFICATION", True
)


def customer_accounts_require_email_verification() -> bool:
    return getattr(settings, "CUSTOMER_ACCOUNTS_REQUIRE_EMAIL_VERIFICATION", True)


def send_customer_account_verification_email(user) -> None:
    from accounts.services.verification import send_verification_email
    send_verification_email(user)


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
        write_only=True, required=True, allow_blank=False
    )
    referral_code = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default="", max_length=20
    )

    class Meta:
        model = User
        fields = ("email", "password", "first_name", "last_name", "phone_number", "referral_code")
        extra_kwargs = {"email": {"required": True}}

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip().lower()
        if not email:
            raise serializers.ValidationError({"email": ["This field is required."]})
        attrs["email"] = email
        if not attrs.get("first_name", "").strip() or not attrs.get("last_name", "").strip():
            raise serializers.ValidationError({"first_name": ["First and last name are required."]})
        from projects.services.sms_service import normalize_phone_to_e164
        phone = normalize_phone_to_e164(attrs.get("phone_number"))
        if not phone.startswith("+") or not phone[1:].isdigit() or not 8 <= len(phone[1:]) <= 15:
            raise serializers.ValidationError({"phone_number": ["Enter a valid mobile number."]})
        attrs["phone_number"] = phone
        return attrs

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def create(self, validated_data):
        phone = validated_data.pop("phone_number", "").strip()
        referral_code = validated_data.pop("referral_code", "").strip()
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
                user.is_active = False
                user.verification_state = User.VerificationState.PENDING_EMAIL
                user.phone_number_normalized = phone
                user.save(update_fields=["is_active", "verification_state", "phone_number_normalized"])

                # Create Contractor; only pass fields that certainly exist
                # (Assumes Contractor has at least user + phone)
                create_kwargs = {"user": user}
                if hasattr(Contractor, "phone"):
                    create_kwargs["phone"] = phone
                contractor = Contractor.objects.create(**create_kwargs)
                if referral_code:
                    from projects.services.referrals import attribute_contractor_registration
                    try:
                        request = self.context.get("request")
                        session = getattr(request, "session", {}) if request else {}
                        first_touch = session.get("referral_first_touch_at")
                        from django.utils.dateparse import parse_datetime
                        attribute_contractor_registration(
                            contractor=contractor,
                            referral_code=referral_code,
                            medium=session.get("referral_medium", "link"),
                            landing_page=getattr(request, "path", "") if request else "",
                            first_touch_at=parse_datetime(first_touch) if first_touch else None,
                        )
                    except ValueError as exc:
                        raise serializers.ValidationError({"referral_code": [str(exc)]}) from exc

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

        return payload


# ──────────────────────────────────────────────────────────────────────────────
# Account Settings (Change Email / Password)
# ──────────────────────────────────────────────────────────────────────────────

class CustomerRegistrationSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    phone_number = serializers.CharField(required=True, allow_blank=False)
    account_type = serializers.ChoiceField(
        choices=Homeowner.ACCOUNT_TYPE_CHOICES,
        default=Homeowner.ACCOUNT_TYPE_INDIVIDUAL,
    )
    referral_code = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default="", max_length=20
    )
    password = serializers.CharField(
        write_only=True,
        validators=[validate_password],
        style={"input_type": "password"},
        trim_whitespace=False,
    )

    def validate_email(self, value):
        email = (value or "").strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("A MyHomeBro account with this email already exists.")
        return email

    def validate_full_name(self, value):
        cleaned = (value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Enter your full name.")
        return cleaned

    def validate_phone_number(self, value):
        from projects.services.sms_service import normalize_phone_to_e164
        phone = normalize_phone_to_e164(value)
        if not phone.startswith("+") or not phone[1:].isdigit() or not 8 <= len(phone[1:]) <= 15:
            raise serializers.ValidationError("Enter a valid mobile number.")
        return phone

    def create(self, validated_data):
        full_name = validated_data["full_name"].strip()
        email = validated_data["email"].strip().lower()
        phone = (validated_data.get("phone_number") or "").strip()
        referral_code = (validated_data.get("referral_code") or "").strip()
        first_name, last_name = split_customer_name(full_name)

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    email=email,
                    password=validated_data["password"],
                    first_name=first_name,
                    last_name=last_name,
                )
                user.is_active = False
                user.is_verified = False
                user.verification_state = User.VerificationState.PENDING_EMAIL
                user.phone_number_normalized = phone
                update_fields = ["is_active", "is_verified", "verification_state", "phone_number_normalized"]
                if hasattr(user, "phone_number"):
                    user.phone_number = phone
                    update_fields.append("phone_number")
                user.save(update_fields=update_fields)

                homeowner, created = get_or_create_customer_account_identity(
                    full_name=full_name,
                    email=email,
                    phone=phone,
                    account_type=validated_data["account_type"],
                )
                from projects.services.referrals import (
                    attribute_customer_registration,
                    participant_for_user,
                    reserve_founding_slot_for_user,
                    role_for_user,
                )

                role = role_for_user(user, homeowner=homeowner)
                participant_for_user(user, role=role)
                reserve_founding_slot_for_user(user, role=role)
                if referral_code:
                    try:
                        request = self.context.get("request")
                        session = getattr(request, "session", {}) if request else {}
                        first_touch = session.get("referral_first_touch_at")
                        from django.utils.dateparse import parse_datetime
                        attribute_customer_registration(
                            user=user,
                            homeowner=homeowner,
                            referral_code=referral_code,
                            medium=session.get("referral_medium", "link"),
                            landing_page=getattr(request, "path", "") if request else "",
                            first_touch_at=parse_datetime(first_touch) if first_touch else None,
                        )
                    except ValueError as exc:
                        raise serializers.ValidationError({"referral_code": [str(exc)]}) from exc
        except IntegrityError:
            raise serializers.ValidationError(
                {"email": ["A MyHomeBro account with this email already exists."]}
            )

        self.homeowner = homeowner
        self.homeowner_created = created
        return user

    def to_representation(self, user):
        homeowner = getattr(self, "homeowner", None)
        payload = {
            "ok": True,
            "message": (
                "Account created. Please check your email to verify your account."
                if customer_accounts_require_email_verification()
                else "Account created."
            ),
            "next_step": "verify_email" if customer_accounts_require_email_verification() else "add_property",
            "user": PublicUserSerializer(user).data,
            "customer": {
                "id": getattr(homeowner, "id", None),
                "full_name": getattr(homeowner, "full_name", ""),
                "email": getattr(homeowner, "email", getattr(user, "email", "")),
                "phone_number": getattr(homeowner, "phone_number", ""),
                "account_type": getattr(
                    homeowner,
                    "account_type",
                    Homeowner.ACCOUNT_TYPE_INDIVIDUAL,
                ),
                "created": bool(getattr(self, "homeowner_created", False)),
            },
        }
        return payload


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
        user.email_verified_at = None
        user.is_verified = False
        if user.verification_state != User.VerificationState.LEGACY_UNVERIFIED:
            user.verification_state = User.VerificationState.PENDING_EMAIL
            user.is_active = False

        # If you use email-as-username, keep username in sync
        if hasattr(user, "username"):
            user.username = new_email

        update_fields = ["email", "email_verified_at", "is_verified", "verification_state", "is_active"]
        if hasattr(user, "username"):
            update_fields.append("username")
        user.save(update_fields=update_fields)
        send_customer_account_verification_email(user)
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


class ChangePhoneSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_phone_number = serializers.CharField()

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "Incorrect password."})
        from projects.services.sms_service import normalize_phone_to_e164
        phone = normalize_phone_to_e164(attrs["new_phone_number"])
        if not phone.startswith("+") or not phone[1:].isdigit() or not 8 <= len(phone[1:]) <= 15:
            raise serializers.ValidationError({"new_phone_number": "Enter a valid mobile number."})
        attrs["new_phone_number"] = phone
        return attrs

    def save(self, **kwargs):
        user = self.context["request"].user
        phone = self.validated_data["new_phone_number"]
        user.phone_number = phone
        user.phone_number_normalized = phone
        user.phone_verified_at = None
        user.duplicate_phone_risk = False
        if user.verification_state != User.VerificationState.LEGACY_UNVERIFIED:
            user.verification_state = User.VerificationState.PENDING_PHONE
            user.is_active = False
        user.save(update_fields=["phone_number", "phone_number_normalized", "phone_verified_at", "duplicate_phone_risk", "verification_state", "is_active"])
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
            user = User.objects.get(pk=user_id)
            if user.verification_state == User.VerificationState.DISABLED:
                raise User.DoesNotExist
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
