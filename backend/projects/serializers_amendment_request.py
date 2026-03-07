from rest_framework import serializers
from .models_amendment_request import AmendmentRequest


class AmendmentRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = AmendmentRequest
        fields = [
            "id",
            "created_at",
            "updated_at",
            "agreement",
            "milestone",
            "requested_by",
            "change_type",
            "requested_changes",
            "justification",
            "status",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "requested_by", "status"]