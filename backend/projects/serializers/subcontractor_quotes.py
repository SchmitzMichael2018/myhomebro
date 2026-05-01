from __future__ import annotations

from rest_framework import serializers

from projects.models_subcontractor import SubcontractorPaymentReleaseMode
from projects.services.subcontractor_quotes import serialize_subcontractor_quote_request


class SubcontractorQuoteRequestSerializer(serializers.Serializer):
    agreement_id = serializers.IntegerField(required=False)
    milestone_id = serializers.IntegerField(required=False)
    subcontractor_invitation_id = serializers.IntegerField(required=False)
    contractor_message = serializers.CharField(required=False, allow_blank=True, default="")
    scope_snapshot = serializers.JSONField(required=False, default=dict)
    quoted_amount = serializers.DecimalField(required=False, max_digits=12, decimal_places=2, allow_null=True)
    subcontractor_message = serializers.CharField(required=False, allow_blank=True, default="")
    estimated_start_date = serializers.DateField(required=False, allow_null=True)
    estimated_completion_date = serializers.DateField(required=False, allow_null=True)
    payment_release_mode = serializers.ChoiceField(
        required=False,
        choices=SubcontractorPaymentReleaseMode.choices,
        default=SubcontractorPaymentReleaseMode.MANUAL_RELEASE,
    )
    revision_note = serializers.CharField(required=False, allow_blank=True, default="")
    override_reason = serializers.CharField(required=False, allow_blank=True, default="")

    def to_representation(self, instance):
        contractor_view = bool(self.context.get("contractor_view"))
        subcontractor_view = bool(self.context.get("subcontractor_view"))
        return serialize_subcontractor_quote_request(
            instance,
            contractor_view=contractor_view,
            subcontractor_view=subcontractor_view,
        ) or {}
