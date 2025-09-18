from rest_framework import serializers

from ..models import Agreement, Milestone
from ..models_dispute import Dispute, DisputeAttachment


class DisputeAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = DisputeAttachment
        fields = ["id", "kind", "file", "file_url", "uploaded_by", "uploaded_at"]
        read_only_fields = ["id", "file_url", "uploaded_by", "uploaded_at", "file"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        try:
            url = obj.file.url
        except Exception:
            url = ""
        return request.build_absolute_uri(url) if (request and url) else url


class DisputeSerializer(serializers.ModelSerializer):
    agreement_number = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    attachments = DisputeAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Dispute
        fields = [
            "id", "agreement", "agreement_number", "milestone", "milestone_title",
            "initiator", "reason", "description",
            "status",
            "fee_amount", "fee_paid", "fee_paid_at",
            "escrow_frozen",
            "attachments",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "agreement_number", "milestone_title",
            "status", "fee_paid", "fee_paid_at",
            "escrow_frozen", "attachments",
            "created_by", "created_at", "updated_at",
        ]

    def get_agreement_number(self, obj):
        a: Agreement = obj.agreement
        for key in ("project_number", "number", "agreement_number"):
            v = getattr(a, key, None)
            if v:
                return str(v)
        return str(getattr(a, "id", ""))

    def get_milestone_title(self, obj):
        m: Milestone | None = obj.milestone
        return getattr(m, "title", "") if m else ""


class DisputeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dispute
        fields = ["agreement", "milestone", "initiator", "reason", "description", "fee_amount"]

    def validate(self, attrs):
        ag = attrs.get("agreement")
        ms = attrs.get("milestone")
        if ms and ms.agreement_id != ag.id:
            raise serializers.ValidationError("Milestone does not belong to the selected agreement.")
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        return Dispute.objects.create(created_by=user, **validated_data)
