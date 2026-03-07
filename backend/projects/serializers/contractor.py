# backend/backend/projects/serializers/contractor.py
from rest_framework import serializers
from ..models import Contractor


class ContractorSerializer(serializers.ModelSerializer):
    # Computed helpers exposed to the UI (from @property on model)
    stripe_connected = serializers.BooleanField(read_only=True)
    stripe_action_required = serializers.BooleanField(read_only=True)

    # ✅ Back-compat alias:
    # Frontend commonly uses `license_expiration_date`, while the model/serializer has `license_expiration`.
    # This lets the UI send either key without breaking.
    license_expiration_date = serializers.DateField(
        write_only=True, required=False, allow_null=True
    )

    class Meta:
        model = Contractor
        fields = [
            "id",
            "user",  # pk; remove if you don't want to expose it

            "business_name",
            "phone",

            # ✅ Address pieces (must exist on model)
            "address",
            "city",
            "state",
            "zip",

            # License
            "license_number",
            "license_expiration",       # canonical API read field
            "license_expiration_date",  # alias write field

            # Files
            "logo",
            "license_file",
            "insurance_file",

            # Stripe / Connect
            "stripe_account_id",
            "onboarding_status",
            "charges_enabled",
            "payouts_enabled",
            "details_submitted",
            "requirements_due_count",
            "stripe_status_updated_at",
            "stripe_deauthorized_at",

            # Computed
            "stripe_connected",
            "stripe_action_required",
        ]
        read_only_fields = [
            "user",

            "stripe_account_id",
            "onboarding_status",
            "charges_enabled",
            "payouts_enabled",
            "details_submitted",
            "requirements_due_count",
            "stripe_status_updated_at",
            "stripe_deauthorized_at",

            "stripe_connected",
            "stripe_action_required",
        ]

    def validate_state(self, value):
        """
        Optional: normalize state to uppercase 2-letter code.
        """
        if value is None:
            return value
        s = str(value).strip().upper()
        return s

    def validate_zip(self, value):
        """
        Optional: normalize ZIP (keep as string; allow ZIP+4).
        """
        if value is None:
            return value
        z = str(value).strip()
        return z

    def update(self, instance, validated_data):
        """
        Apply alias write fields without changing the canonical read API.
        """
        # If UI posts license_expiration_date, write it into license_expiration
        led = validated_data.pop("license_expiration_date", None)
        if led is not None:
            instance.license_expiration = led

        return super().update(instance, validated_data)