from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from projects.models import Agreement
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.services.subcontractor_invitations import normalize_email


class SubcontractorInvitationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubcontractorInvitation
        fields = ["invite_email", "invite_name", "invited_message"]

    def validate_invite_email(self, value):
        email = normalize_email(value)
        if not email:
            raise serializers.ValidationError("Invite email is required.")
        return email

    def validate(self, attrs):
        agreement: Agreement = self.context["agreement"]
        contractor = self.context["contractor"]
        email = attrs["invite_email"]

        attrs["invite_name"] = (attrs.get("invite_name") or "").strip()
        attrs["invited_message"] = (attrs.get("invited_message") or "").strip()

        if normalize_email(getattr(contractor, "email", None)) == email:
            raise serializers.ValidationError({"invite_email": "Use a different email for the subcontractor."})

        existing_accepted = SubcontractorInvitation.objects.filter(
            agreement=agreement,
            invite_email__iexact=email,
            status=SubcontractorInvitationStatus.ACCEPTED,
        ).exists()
        if existing_accepted:
            raise serializers.ValidationError({"invite_email": "This subcontractor is already attached to the agreement."})

        duplicate_pending = SubcontractorInvitation.objects.filter(
            agreement=agreement,
            invite_email__iexact=email,
            status=SubcontractorInvitationStatus.PENDING,
            expires_at__gt=timezone.now(),
        ).exists()
        if duplicate_pending:
            raise serializers.ValidationError({"invite_email": "A pending invitation already exists for this email."})

        return attrs
