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
            "is_archived",
            "fee_amount",
            "fee_paid",
            "fee_paid_at",
            "escrow_frozen",
            "homeowner_response",
            "contractor_response",
            "responded_at",
            "admin_notes",
            "resolved_at",
            "resolution_type",
            "resolution_notes",
            "resolved_by",
            "financial_disposition",
            "approved_amount",
            "disputed_remainder",
            "linked_rework_milestone_id",
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
            "is_archived",
            "fee_paid",
            "fee_paid_at",
            "escrow_frozen",
            "responded_at",
            "admin_notes",
            "resolved_at",
            "resolution_type",
            "resolution_notes",
            "resolved_by",
            "financial_disposition",
            "approved_amount",
            "disputed_remainder",
            "linked_rework_milestone_id",
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
        choices=["contractor", "homeowner", "canceled"],
        required=False,
    )
    resolution_type = serializers.ChoiceField(
        choices=[
            Dispute.RESOLUTION_CONTRACTOR_PREVAILS,
            Dispute.RESOLUTION_CUSTOMER_PREVAILS,
            Dispute.RESOLUTION_PARTIAL,
            Dispute.RESOLUTION_REWORK_REQUIRED,
            Dispute.RESOLUTION_ADMIN_CLOSURE,
        ],
        required=False,
    )
    financial_disposition = serializers.ChoiceField(
        choices=[
            Dispute.FINANCIAL_ELIGIBLE_RELEASE,
            Dispute.FINANCIAL_ELIGIBLE_REFUND,
            Dispute.FINANCIAL_PARTIAL_MANUAL,
            Dispute.FINANCIAL_MANUAL_REVIEW,
            Dispute.FINANCIAL_NO_ACTION,
        ],
        required=False,
    )
    admin_notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=20000,
    )
    resolution_notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=20000,
    )
    approved_amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    disputed_remainder = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    linked_rework_milestone_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        if not attrs.get("resolution_type") and not attrs.get("outcome"):
            raise serializers.ValidationError("Resolution type is required.")
        resolution_type = attrs.get("resolution_type")
        if resolution_type == Dispute.RESOLUTION_PARTIAL and "approved_amount" not in attrs:
            raise serializers.ValidationError("Approved amount is required for partial resolution.")
        return attrs


class DisputePublicSerializer(serializers.ModelSerializer):
    agreement_number = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    attachments = DisputeAttachmentSerializer(many=True, read_only=True)
    messages = serializers.SerializerMethodField()

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
            "resolution_type",
            "financial_disposition",
            "approved_amount",
            "disputed_remainder",
            "linked_rework_milestone_id",
            "proposal",
            "proposal_sent_at",
            "homeowner_response",
            "contractor_response",
            "messages",
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

    def get_messages(self, obj):
        rows = []

        def add_response(role: str, text: str):
            text = str(text or "").strip()
            if not text:
                return
            parts = [part.strip() for part in text.split("\n\n") if part.strip()]
            for idx, part in enumerate(parts or [text]):
                rows.append(
                    {
                        "id": f"{role}-{idx + 1}",
                        "author_role": role,
                        "message_type": "comment",
                        "body": part,
                        "created_at": obj.updated_at or obj.created_at,
                    }
                )

        add_response("homeowner", getattr(obj, "homeowner_response", ""))
        add_response("contractor", getattr(obj, "contractor_response", ""))
        return rows
