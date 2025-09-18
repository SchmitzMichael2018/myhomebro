# backend/projects/serializers/expense_request.py
from __future__ import annotations
from rest_framework import serializers
from projects.models import ExpenseRequest

class ExpenseRequestSerializer(serializers.ModelSerializer):
    receipt_url = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseRequest
        fields = [
            "id",
            "agreement",
            "description",
            "amount",
            "incurred_date",
            "receipt",        # for upload via multipart/form-data
            "receipt_url",    # convenience for frontend display
            "status",
            "notes_to_homeowner",
            "contractor_signed_at",
            "homeowner_acted_at",
            "paid_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "status",
            "contractor_signed_at", "homeowner_acted_at", "paid_at",
            "created_at", "updated_at",
        ]

    def get_receipt_url(self, obj):
        request = self.context.get("request")
        if obj.receipt and hasattr(obj.receipt, "url"):
            if request is not None:
                return request.build_absolute_uri(obj.receipt.url)
            return obj.receipt.url
        return None
