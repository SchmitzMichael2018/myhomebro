# backend/projects/serializers/subaccounts.py
# v2026-01-04-FIX — View owns User creation; serializer creates ONLY ContractorSubAccount
# Compatible with custom User model (NO username field)
# PATCH-safe: do NOT require password/email on update

from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from projects.models import ContractorSubAccount
from projects.services.team_attention import build_subaccount_work_summary
from projects.serializers.workforce import EmployeeCapabilitySerializer

User = get_user_model()


class ContractorSubAccountSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    last_login = serializers.SerializerMethodField()
    last_activity_at = serializers.SerializerMethodField()
    assignment_count = serializers.SerializerMethodField()
    active_assignment_count = serializers.SerializerMethodField()
    pending_review_count = serializers.SerializerMethodField()
    overdue_milestone_count = serializers.SerializerMethodField()
    capabilities = EmployeeCapabilitySerializer(many=True, read_only=True)
    calculated_effective_hourly_cost = serializers.SerializerMethodField()

    LABOR_COST_FIELDS = {
        "cost_basis",
        "hourly_cost",
        "annual_salary",
        "standard_hours_per_week",
        "overtime_multiplier",
        "labor_cost_notes",
        "calculated_effective_hourly_cost",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.context.get("can_view_labor_cost"):
            for field in self.LABOR_COST_FIELDS:
                self.fields.pop(field, None)

    class Meta:
        model = ContractorSubAccount
        fields = [
            "id",
            "display_name",
            "email",
            "role",
            "role_label",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
            "last_login",
            "last_activity_at",
            "assignment_count",
            "active_assignment_count",
            "pending_review_count",
            "overdue_milestone_count",
            "capabilities",
            "cost_basis",
            "hourly_cost",
            "annual_salary",
            "standard_hours_per_week",
            "overtime_multiplier",
            "labor_cost_notes",
            "calculated_effective_hourly_cost",
        ]
        read_only_fields = fields

    def _summary(self, obj: ContractorSubAccount) -> dict:
        cached = getattr(obj, "_team_summary_cache", None)
        if cached is None:
            cached = build_subaccount_work_summary(obj)
            setattr(obj, "_team_summary_cache", cached)
        return cached

    def get_last_login(self, obj: ContractorSubAccount):
        return getattr(getattr(obj, "user", None), "last_login", None)

    def get_last_activity_at(self, obj: ContractorSubAccount):
        return self._summary(obj).get("last_activity_at")

    def get_assignment_count(self, obj: ContractorSubAccount) -> int:
        return int(self._summary(obj).get("assignment_count", 0) or 0)

    def get_active_assignment_count(self, obj: ContractorSubAccount) -> int:
        return int(self._summary(obj).get("active_assignment_count", 0) or 0)

    def get_pending_review_count(self, obj: ContractorSubAccount) -> int:
        return int(self._summary(obj).get("pending_review_count", 0) or 0)

    def get_overdue_milestone_count(self, obj: ContractorSubAccount) -> int:
        return int(self._summary(obj).get("overdue_milestone_count", 0) or 0)

    def get_calculated_effective_hourly_cost(self, obj: ContractorSubAccount):
        value = obj.calculated_effective_hourly_cost
        if value is None:
            return None
        return f"{value.quantize(Decimal('0.01'))}"


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

    LABOR_COST_FIELDS = [
        "cost_basis",
        "hourly_cost",
        "annual_salary",
        "standard_hours_per_week",
        "overtime_multiplier",
        "labor_cost_notes",
    ]

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
            "cost_basis",
            "hourly_cost",
            "annual_salary",
            "standard_hours_per_week",
            "overtime_multiplier",
            "labor_cost_notes",
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
            self._validate_labor_cost(attrs)
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
        self._validate_labor_cost(attrs)
        return attrs

    def _validate_labor_cost(self, attrs):
        cost_basis = attrs.get(
            "cost_basis",
            getattr(self.instance, "cost_basis", ContractorSubAccount.COST_BASIS_HOURLY),
        )
        if cost_basis not in dict(ContractorSubAccount.COST_BASIS_CHOICES):
            raise serializers.ValidationError({"cost_basis": "Choose a valid cost basis."})

        for field in ["hourly_cost", "annual_salary", "standard_hours_per_week", "overtime_multiplier"]:
            value = attrs.get(field)
            if value is not None and value <= 0:
                raise serializers.ValidationError({field: "Enter a positive value."})

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
        for field in ["display_name", "role", "is_active", "notes", *self.LABOR_COST_FIELDS]:
            if field in validated_data:
                setattr(instance, field, validated_data[field])

        # Be explicit and safe about update_fields
        update_fields = ["updated_at"]
        for f in ["display_name", "role", "is_active", "notes", *self.LABOR_COST_FIELDS]:
            if f in validated_data:
                update_fields.append(f)

        instance.save(update_fields=update_fields)
        return instance
