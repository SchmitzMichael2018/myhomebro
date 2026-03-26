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

        existing_accepted = (
            SubcontractorInvitation.objects.filter(
            contractor=contractor,
            invite_email__iexact=email,
            status=SubcontractorInvitationStatus.ACCEPTED,
        )
            .select_related("agreement__project")
            .order_by("-accepted_at", "-id")
            .first()
        )
        if existing_accepted:
            agreement_label = (
                getattr(getattr(existing_accepted.agreement, "project", None), "title", "")
                or getattr(existing_accepted.agreement, "title", "")
                or f"Agreement #{existing_accepted.agreement_id}"
            )
            raise serializers.ValidationError(
                {
                    "invite_email": (
                        "This subcontractor is already active for your business"
                        f" on {agreement_label}."
                    )
                }
            )

        duplicate_pending = (
            SubcontractorInvitation.objects.filter(
                contractor=contractor,
                invite_email__iexact=email,
                status=SubcontractorInvitationStatus.PENDING,
                expires_at__gt=timezone.now(),
            )
            .select_related("agreement__project")
            .order_by("-invited_at", "-id")
            .first()
        )
        if duplicate_pending:
            agreement_label = (
                getattr(getattr(duplicate_pending.agreement, "project", None), "title", "")
                or getattr(duplicate_pending.agreement, "title", "")
                or f"Agreement #{duplicate_pending.agreement_id}"
            )
            raise serializers.ValidationError(
                {
                    "invite_email": (
                        "A pending invitation already exists for this subcontractor"
                        f" on {agreement_label}."
                    )
                }
            )

        return attrs
