# backend/projects/serializers/dispute.py
from rest_framework import serializers

from ..models import Agreement, Milestone
from ..models_dispute import Dispute, DisputeAttachment, DisputeWorkOrder


class DisputeAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = DisputeAttachment
        fields = [
            "id",
            "kind",
            "file",
            "file_url",
            "uploaded_by",
            "uploaded_at",
        ]
        read_only_fields = [
            "id",
            "file_url",
            "uploaded_by",
            "uploaded_at",
            "file",
        ]

    def get_file_url(self, obj):
        request = self.context.get("request")
        try:
            url = obj.file.url
        except Exception:
            url = ""
        return request.build_absolute_uri(url) if (request and url) else url


class DisputeWorkOrderSerializer(serializers.ModelSerializer):
    # ✅ NEW: link to created rework milestone
    rework_milestone_id = serializers.IntegerField(read_only=True)

    # ✅ NEW: link back to the original disputed milestone (the milestone on the Dispute)
    original_milestone_id = serializers.SerializerMethodField()
    original_milestone_title = serializers.SerializerMethodField()

    class Meta:
        model = DisputeWorkOrder
        fields = [
            "id",
            "dispute",
            "agreement",
            "title",
            "notes",
            "due_date",
            "status",
            "created_at",
            "completed_at",

            # ✅ NEW
            "rework_milestone_id",
            "original_milestone_id",
            "original_milestone_title",
        ]
        read_only_fields = fields

    def get_original_milestone_id(self, obj):
        d = getattr(obj, "dispute", None)
        if not d:
            return None
        return getattr(d, "milestone_id", None)

    def get_original_milestone_title(self, obj):
        d = getattr(obj, "dispute", None)
        m = getattr(d, "milestone", None) if d else None
        return getattr(m, "title", "") if m else ""


class DisputeSerializer(serializers.ModelSerializer):
    agreement_number = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    attachments = DisputeAttachmentSerializer(many=True, read_only=True)

    # ✅ Work orders (now includes rework_milestone_id + original milestone info)
    work_orders = DisputeWorkOrderSerializer(many=True, read_only=True)

    class Meta:
        model = Dispute
        fields = [
            "id",
            "agreement",
            "agreement_number",
            "milestone",
            "milestone_title",
            "initiator",
            "reason",
            "description",
            "status",
            "fee_amount",
            "fee_paid",
            "fee_paid_at",
            "escrow_frozen",
            "homeowner_response",
            "contractor_response",
            "responded_at",
            "admin_notes",
            "resolved_at",
            "attachments",
            "created_by",
            "created_at",
            "updated_at",

            "proposal",
            "proposal_sent_at",
            "public_token",

            "response_due_at",
            "proposal_due_at",
            "deadline_hours",
            "deadline_tier",
            "last_activity_at",
            "deadline_missed_by",

            "work_orders",
        ]
        read_only_fields = [
            "id",
            "agreement_number",
            "milestone_title",
            "status",
            "fee_paid",
            "fee_paid_at",
            "escrow_frozen",
            "responded_at",
            "admin_notes",
            "resolved_at",
            "attachments",
            "created_by",
            "created_at",
            "updated_at",

            "proposal",
            "proposal_sent_at",
            "public_token",

            "response_due_at",
            "proposal_due_at",
            "deadline_hours",
            "deadline_tier",
            "last_activity_at",
            "deadline_missed_by",

            "work_orders",
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
        fields = [
            "agreement",
            "milestone",
            "initiator",
            "reason",
            "description",
            "fee_amount",
        ]

    def validate(self, attrs):
        ag = attrs.get("agreement")
        ms = attrs.get("milestone")
        if ms and ms.agreement_id != ag.id:
            raise serializers.ValidationError(
                "Milestone does not belong to the selected agreement."
            )
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        return Dispute.objects.create(
            created_by=user,
            status="initiated",
            fee_paid=False,
            escrow_frozen=False,
            **validated_data,
        )


class DisputeRespondSerializer(serializers.Serializer):
    response = serializers.CharField(max_length=20000)


class DisputeResolveSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(
        choices=["contractor", "homeowner", "canceled"]
    )
    admin_notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=20000,
    )


class DisputePublicSerializer(serializers.ModelSerializer):
    agreement_number = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    attachments = DisputeAttachmentSerializer(many=True, read_only=True)

    # ✅ Work orders (public decision page can also show the rework milestone id if needed)
    work_orders = DisputeWorkOrderSerializer(many=True, read_only=True)

    class Meta:
        model = Dispute
        fields = [
            "id",
            "agreement_number",
            "milestone_title",
            "initiator",
            "reason",
            "description",
            "status",
            "fee_paid",
            "escrow_frozen",
            "proposal",
            "proposal_sent_at",
            "homeowner_response",
            "contractor_response",
            "created_at",
            "attachments",

            "work_orders",
        ]
        read_only_fields = fields

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
