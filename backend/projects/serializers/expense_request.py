# backend/projects/serializers/expense_request.py
from __future__ import annotations

from rest_framework import serializers

from projects.models import ExpenseRequest, ExpenseRequestAttachment


class ExpenseRequestAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseRequestAttachment
        fields = ["id", "original_name", "uploaded_at", "url"]

    def get_url(self, obj):
        request = self.context.get("request")
        if obj.file and hasattr(obj.file, "url"):
            if request is not None:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


class ExpenseRequestSerializer(serializers.ModelSerializer):
    receipt_url = serializers.SerializerMethodField()
    attachments = ExpenseRequestAttachmentSerializer(many=True, read_only=True)
    escrow_ledger = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseRequest
        fields = [
            "id",
            "agreement",
            "milestone",
            "description",
            "amount",
            "incurred_date",
            "request_kind",
            "category",
            "receipt",
            "receipt_url",
            "attachments",
            "stripe_checkout_session_id",
            "stripe_checkout_url",
            "stripe_payment_intent_id",
            "platform_fee_cents",
            "payout_cents",
            "status",
            "status_label",
            "notes_to_homeowner",
            "submitted_at",
            "contractor_signed_at",
            "homeowner_acted_at",
            "approved_at",
            "denied_at",
            "paid_at",
            "released_at",
            "reviewed_by",
            "denial_reason",
            "held_at",
            "hold_cleared_at",
            "hold_reason",
            "held_by",
            "hold_cleared_by",
            "available_escrow_at_approval",
            "stripe_transfer_id",
            "escrow_source_payment_intent_id",
            "release_error",
            "escrow_ledger",
            "is_archived",
            "archived_at",
            "archived_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "status_label",
            "submitted_at",
            "contractor_signed_at",
            "homeowner_acted_at",
            "approved_at",
            "denied_at",
            "paid_at",
            "released_at",
            "reviewed_by",
            "held_at",
            "hold_cleared_at",
            "held_by",
            "hold_cleared_by",
            "available_escrow_at_approval",
            "stripe_transfer_id",
            "escrow_source_payment_intent_id",
            "release_error",
            "escrow_ledger",
            "stripe_checkout_session_id",
            "stripe_checkout_url",
            "stripe_payment_intent_id",
            "platform_fee_cents",
            "payout_cents",
            "created_at",
            "updated_at",
            "attachments",
            "is_archived",
            "archived_at",
            "archived_reason",
        ]

    def get_receipt_url(self, obj):
        request = self.context.get("request")
        if obj.receipt and hasattr(obj.receipt, "url"):
            if request is not None:
                return request.build_absolute_uri(obj.receipt.url)
            return obj.receipt.url
        return None

    def get_status_label(self, obj):
        try:
            return obj.get_status_display()
        except Exception:
            return str(getattr(obj, "status", "") or "").replace("_", " ").title()

    def get_escrow_ledger(self, obj):
        if getattr(obj, "request_kind", "") != ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT or not getattr(obj, "agreement_id", None):
            return None
        try:
            from projects.services.escrow_reimbursements import escrow_ledger, serialize_ledger

            return serialize_ledger(escrow_ledger(obj.agreement, exclude_reimbursement_id=obj.id))
        except Exception:
            return None
