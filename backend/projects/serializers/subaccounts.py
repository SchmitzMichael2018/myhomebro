# backend/projects/serializers/subaccounts.py
# v2025-11-16 — Serializers for ContractorSubAccount

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from projects.models import ContractorSubAccount

User = get_user_model()


class ContractorSubAccountSerializer(serializers.ModelSerializer):
    """
    Read-only serializer for listing / retrieving sub-accounts.
    """

    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = ContractorSubAccount
        fields = [
            "id",
            "display_name",
            "email",
            "role",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ContractorSubAccountCreateSerializer(serializers.ModelSerializer):
    """
    Used for creating/updating employee sub-accounts from the Contractor UI.
    """

    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True, min_length=8, allow_blank=False)

    class Meta:
        model = ContractorSubAccount
        fields = [
            "id",
            "display_name",
            "role",
            "is_active",
            "notes",
            "email",
            "password",
        ]
        read_only_fields = ["id"]

    def validate_email(self, value: str) -> str:
        value = (value or "").strip().lower()
        if not value:
            raise serializers.ValidationError("Email is required.")
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def create(self, validated_data):
        email = validated_data.pop("email")
        password = validated_data.pop("password")

        # Parent contractor will be provided via serializer.save(parent_contractor=...)
        parent_contractor = validated_data.get("parent_contractor")
        if parent_contractor is None:
            raise serializers.ValidationError("parent_contractor is required.")

        user = User.objects.create_user(
            username=email,  # simple: username == email
            email=email,
            password=password,
            is_active=True,
        )

        sub = ContractorSubAccount.objects.create(
            parent_contractor=parent_contractor,
            user=user,
            **validated_data,
        )
        return sub

    def update(self, instance: ContractorSubAccount, validated_data):
        """
        Allow updating display_name, role, is_active, notes.
        Email/password are intentionally not updated via this serializer for now.
        """
        for field in ["display_name", "role", "is_active", "notes"]:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        instance.save(update_fields=["display_name", "role", "is_active", "notes", "updated_at"])
        return instance
