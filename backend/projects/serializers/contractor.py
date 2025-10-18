# backend/backend/projects/serializers/contractor.py
from rest_framework import serializers
from ..models import Contractor


class ContractorSerializer(serializers.ModelSerializer):
    # Computed helpers exposed to the UI (from @property on model)
    stripe_connected = serializers.BooleanField(read_only=True)
    stripe_action_required = serializers.BooleanField(read_only=True)

    class Meta:
        model = Contractor
        fields = [
            "id",
            "user",  # pk; remove if you don't want to expose it
            "business_name",
            "phone",
            "address",
            "license_number",
            "license_expiration",
            "logo",
            "license_file",

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
