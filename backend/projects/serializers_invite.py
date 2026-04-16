# backend/projects/serializers_invite.py
from rest_framework import serializers
from .models_invite import ContractorInvite


class ContractorInviteCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContractorInvite
        fields = [
            "homeowner_name",
            "homeowner_email",
            "homeowner_phone",
            "contractor_email",
            "contractor_phone",
            "message",
            "source_intake",
        ]
        read_only_fields = ["source_intake"]

    def validate(self, attrs):
        contractor_email = (attrs.get("contractor_email") or "").strip()
        contractor_phone = (attrs.get("contractor_phone") or "").strip()

        if not contractor_email and not contractor_phone:
            raise serializers.ValidationError(
                "Provide at least one: contractor_email or contractor_phone."
            )

        # Normalize basic strings
        attrs["homeowner_name"] = (attrs.get("homeowner_name") or "").strip()
        attrs["homeowner_email"] = (attrs.get("homeowner_email") or "").strip().lower()
        attrs["homeowner_phone"] = (attrs.get("homeowner_phone") or "").strip()
        attrs["contractor_email"] = contractor_email.lower()
        attrs["contractor_phone"] = contractor_phone
        attrs["message"] = (attrs.get("message") or "").strip()

        if len(attrs["homeowner_name"]) < 2:
            raise serializers.ValidationError("homeowner_name is required.")

        if "@" not in attrs["homeowner_email"]:
            raise serializers.ValidationError("homeowner_email must be a valid email.")

        return attrs


class ContractorInviteReadSerializer(serializers.ModelSerializer):
    is_accepted = serializers.SerializerMethodField()
    source_intake_id = serializers.SerializerMethodField()

    class Meta:
        model = ContractorInvite
        fields = [
            "token",
            "homeowner_name",
            "homeowner_email",
            "homeowner_phone",
            "contractor_email",
            "contractor_phone",
            "message",
            "source_intake",
            "source_intake_id",
            "is_accepted",
            "accepted_at",
            "created_at",
        ]
    def get_is_accepted(self, obj):
        return obj.is_accepted

    def get_source_intake_id(self, obj):
        return getattr(obj, "source_intake_id", None)
