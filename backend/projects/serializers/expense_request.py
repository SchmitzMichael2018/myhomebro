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

    class Meta:
        model = ExpenseRequest
        fields = [
            "id",
            "agreement",
            "description",
            "amount",
            "incurred_date",
            "receipt",
            "receipt_url",
            "attachments",
            "status",
            "notes_to_homeowner",
            "contractor_signed_at",
            "homeowner_acted_at",
            "paid_at",
            # ✅ NEW: archive fields
            "is_archived",
            "archived_at",
            "archived_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "contractor_signed_at",
            "homeowner_acted_at",
            "paid_at",
            "created_at",
            "updated_at",
            "attachments",
            # ✅ archive fields should be controlled by backend actions
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