# backend/projects/serializers/subaccounts.py
# v2026-01-04-FIX — View owns User creation; serializer creates ONLY ContractorSubAccount
# Compatible with custom User model (NO username field)
# PATCH-safe: do NOT require password/email on update

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from projects.models import ContractorSubAccount

User = get_user_model()


class ContractorSubAccountSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = ContractorSubAccount
        fields = [
            "id",
            "display_name",
            "email",
            "role",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ContractorSubAccountCreateSerializer(serializers.ModelSerializer):
    """
    CREATE (POST):
      - requires: email + (password OR temporary_password)
      - DOES NOT create the auth User (the View does)
      - View will inject: user + parent_contractor

    UPDATE (PUT/PATCH):
      - does NOT require email/password
      - updates only: display_name, role, is_active, notes
      - does NOT change auth user email/password here
    """

    email = serializers.EmailField(write_only=True, required=False)
    password = serializers.CharField(
        write_only=True, min_length=8, required=False, allow_blank=False
    )
    temporary_password = serializers.CharField(
        write_only=True, min_length=8, required=False, allow_blank=False
    )

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
            "temporary_password",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """
        On CREATE: require email + password (or temporary_password)
        On UPDATE/PATCH: allow partial updates without password/email
        """
        is_create = self.instance is None

        if not is_create:
            # Update/PATCH path — do not require password/email
            # Also, if frontend accidentally sends these on PATCH, ignore them
            attrs.pop("password", None)
            attrs.pop("temporary_password", None)
            attrs.pop("email", None)
            return attrs

        # CREATE path
        email = (attrs.get("email") or "").strip().lower()
        if not email:
            raise serializers.ValidationError({"email": "Email is required."})

        pwd = attrs.get("password")
        tmp = attrs.get("temporary_password")

        if not pwd and not tmp:
            raise serializers.ValidationError(
                {"password": "Password or temporary_password is required."}
            )

        # Normalize alias: temporary_password -> password
        if not pwd and tmp:
            attrs["password"] = tmp
            attrs.pop("temporary_password", None)

        # If both provided, prefer password
        if pwd and tmp:
            attrs.pop("temporary_password", None)

        attrs["email"] = email
        return attrs

    def create(self, validated_data):
        """
        IMPORTANT: View injects user + parent_contractor.
        This serializer must NOT create User objects.
        """
        # Remove request-only fields; these are handled by the View
        validated_data.pop("email", None)
        validated_data.pop("password", None)
        validated_data.pop("temporary_password", None)

        user = validated_data.pop("user")
        parent_contractor = validated_data.pop("parent_contractor")

        sub = ContractorSubAccount.objects.create(
            parent_contractor=parent_contractor,
            user=user,
            **validated_data,
        )
        return sub

    def update(self, instance, validated_data):
        # Do not update email/password via this serializer
        for field in ["display_name", "role", "is_active", "notes"]:
            if field in validated_data:
                setattr(instance, field, validated_data[field])

        # Be explicit and safe about update_fields
        update_fields = ["updated_at"]
        for f in ["display_name", "role", "is_active", "notes"]:
            if f in validated_data:
                update_fields.append(f)

        instance.save(update_fields=update_fields)
        return instance
