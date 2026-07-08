# backend/projects/serializers/dispute.py
from rest_framework import serializers

from ..models import Agreement, Milestone
from ..models_dispute import (
    Dispute,
    DisputeAttachment,
    DisputeWorkOrder,
    ResolutionAgreement,
    ResolutionAgreementSignature,
    ResolutionCaseAuditEvent,
    ResolutionCaseTimelineEvent,
    ResolutionDocument,
    ResolutionEvidenceIndex,
    ResolutionPartyStatement,
    ResolutionProposal,
)


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


class ResolutionCaseTimelineEventSerializer(serializers.ModelSerializer):
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionCaseTimelineEvent
        fields = [
            "id",
            "event_type",
            "title",
            "description",
            "actor",
            "actor_email",
            "occurred_at",
            "related_object_type",
            "related_object_id",
            "visibility",
            "metadata",
        ]
        read_only_fields = ["id", "actor", "actor_email", "occurred_at"]

    def get_actor_email(self, obj):
        return getattr(getattr(obj, "actor", None), "email", "") or ""


class ResolutionCaseAuditEventSerializer(serializers.ModelSerializer):
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionCaseAuditEvent
        fields = [
            "id",
            "action",
            "actor",
            "actor_email",
            "occurred_at",
            "summary",
            "before",
            "after",
            "metadata",
        ]
        read_only_fields = fields

    def get_actor_email(self, obj):
        return getattr(getattr(obj, "actor", None), "email", "") or ""


class ResolutionPartyStatementSerializer(serializers.ModelSerializer):
    author_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionPartyStatement
        fields = [
            "id",
            "statement_type",
            "party_role",
            "author",
            "author_email",
            "text",
            "version",
            "supersedes",
            "is_current",
            "visibility",
            "created_at",
            "metadata",
        ]
        read_only_fields = ["id", "author", "author_email", "version", "supersedes", "is_current", "created_at"]

    def get_author_email(self, obj):
        return getattr(getattr(obj, "author", None), "email", "") or ""


class ResolutionEvidenceIndexSerializer(serializers.ModelSerializer):
    uploaded_by_email = serializers.SerializerMethodField()
    attachment_file_url = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionEvidenceIndex
        fields = [
            "id",
            "attachment",
            "attachment_file_url",
            "category",
            "description",
            "uploaded_by",
            "uploaded_by_email",
            "uploaded_at",
            "related_party",
            "related_source_type",
            "related_source_object_id",
            "ai_summary",
            "visibility",
            "metadata",
        ]
        read_only_fields = ["id", "attachment_file_url", "uploaded_by", "uploaded_by_email", "uploaded_at"]

    def get_uploaded_by_email(self, obj):
        return getattr(getattr(obj, "uploaded_by", None), "email", "") or ""

    def get_attachment_file_url(self, obj):
        attachment = getattr(obj, "attachment", None)
        if not attachment:
            return ""
        return DisputeAttachmentSerializer(context=self.context).get_file_url(attachment)


class ResolutionProposalSerializer(serializers.ModelSerializer):
    proposed_by_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionProposal
        fields = [
            "id",
            "proposed_by",
            "proposed_by_email",
            "problem_statement",
            "proposed_solution",
            "required_actions",
            "deadlines",
            "payment_impact",
            "warranty_impact",
            "evidence_relied_upon",
            "status",
            "created_at",
            "updated_at",
            "metadata",
        ]
        read_only_fields = ["id", "proposed_by", "proposed_by_email", "created_at", "updated_at"]

    def get_proposed_by_email(self, obj):
        return getattr(getattr(obj, "proposed_by", None), "email", "") or ""


class ResolutionAgreementSignatureSerializer(serializers.ModelSerializer):
    signer_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionAgreementSignature
        fields = [
            "id",
            "signer",
            "signer_email",
            "signer_role",
            "signer_name",
            "signed_at",
            "ip_address",
            "user_agent",
            "signature_text",
            "metadata",
        ]
        read_only_fields = ["id", "signer", "signer_email", "signed_at", "ip_address", "user_agent"]

    def get_signer_email(self, obj):
        return getattr(getattr(obj, "signer", None), "email", "") or ""


class ResolutionAgreementSerializer(serializers.ModelSerializer):
    signatures = ResolutionAgreementSignatureSerializer(many=True, read_only=True)
    is_locked = serializers.BooleanField(read_only=True)

    class Meta:
        model = ResolutionAgreement
        fields = [
            "id",
            "proposal",
            "project",
            "agreement",
            "source_type",
            "source_object_id",
            "problem_statement",
            "disputed_facts",
            "undisputed_facts",
            "agreed_solution",
            "required_actions",
            "deadlines",
            "payment_changes",
            "warranty_impact",
            "future_obligations",
            "evidence_reviewed",
            "human_decision_summary",
            "audit_summary",
            "status",
            "locked_at",
            "is_locked",
            "created_by",
            "created_at",
            "updated_at",
            "signatures",
        ]
        read_only_fields = [
            "id",
            "project",
            "agreement",
            "source_type",
            "source_object_id",
            "status",
            "locked_at",
            "is_locked",
            "created_by",
            "created_at",
            "updated_at",
            "signatures",
        ]


class ResolutionDocumentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    generated_by_email = serializers.SerializerMethodField()

    class Meta:
        model = ResolutionDocument
        fields = [
            "id",
            "resolution_agreement",
            "document_type",
            "title",
            "file",
            "file_url",
            "generated_by",
            "generated_by_email",
            "generated_at",
            "sha256",
            "metadata",
        ]
        read_only_fields = fields

    def get_file_url(self, obj):
        request = self.context.get("request")
        try:
            url = obj.file.url
        except Exception:
            url = ""
        return request.build_absolute_uri(url) if (request and url) else url

    def get_generated_by_email(self, obj):
        return getattr(getattr(obj, "generated_by", None), "email", "") or ""


class DisputeSerializer(serializers.ModelSerializer):
    agreement_number = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    attachments = DisputeAttachmentSerializer(many=True, read_only=True)
    timeline_events = ResolutionCaseTimelineEventSerializer(many=True, read_only=True)
    audit_events = ResolutionCaseAuditEventSerializer(many=True, read_only=True)
    party_statements = ResolutionPartyStatementSerializer(many=True, read_only=True)
    evidence_index = ResolutionEvidenceIndexSerializer(many=True, read_only=True)
    resolution_proposals = ResolutionProposalSerializer(many=True, read_only=True)
    resolution_agreements = ResolutionAgreementSerializer(many=True, read_only=True)
    resolution_documents = ResolutionDocumentSerializer(many=True, read_only=True)

    # ✅ Work orders (now includes rework_milestone_id + original milestone info)
    work_orders = DisputeWorkOrderSerializer(many=True, read_only=True)

    class Meta:
        model = Dispute
        fields = [
            "id",
            "agreement",
            "agreement_number",
            "project",
            "milestone",
            "milestone_title",
            "source_type",
            "source_object_id",
            "source_locked",
            "payment_request",
            "draw_request",
            "expense",
            "amendment",
            "warranty_request",
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
            "timeline_events",
            "audit_events",
            "party_statements",
            "evidence_index",
            "resolution_proposals",
            "resolution_agreements",
            "resolution_documents",
        ]
        read_only_fields = [
            "id",
            "agreement_number",
            "project",
            "milestone_title",
            "source_object_id",
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
            "timeline_events",
            "audit_events",
            "party_statements",
            "evidence_index",
            "resolution_proposals",
            "resolution_agreements",
            "resolution_documents",
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
            "source_type",
            "source_object_id",
            "source_locked",
            "payment_request",
            "draw_request",
            "expense",
            "amendment",
            "warranty_request",
            "initiator",
            "reason",
            "description",
            "fee_amount",
        ]

    def validate(self, attrs):
        ag = attrs.get("agreement")
        ms = attrs.get("milestone")
        source_type = attrs.get("source_type") or (Dispute.SOURCE_MILESTONE if ms else Dispute.SOURCE_AGREEMENT)
        if source_type != Dispute.SOURCE_GENERAL_PROJECT_ISSUE and not ag:
            raise serializers.ValidationError("Agreement is required unless this is a general project issue.")
        if ms and ag and ms.agreement_id != ag.id:
            raise serializers.ValidationError(
                "Milestone does not belong to the selected agreement."
            )
        payment_request = attrs.get("payment_request")
        draw_request = attrs.get("draw_request")
        expense = attrs.get("expense")
        amendment = attrs.get("amendment")
        warranty_request = attrs.get("warranty_request")
        for obj in [payment_request, draw_request, expense, amendment, warranty_request]:
            if obj is not None and ag is not None and getattr(obj, "agreement_id", ag.id) != ag.id:
                raise serializers.ValidationError("Source object does not belong to the selected agreement.")
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
