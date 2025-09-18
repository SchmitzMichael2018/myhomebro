# backend/projects/serializers/expense.py
from rest_framework import serializers
from projects.models import Expense

class ExpenseSerializer(serializers.ModelSerializer):
    agreement_title = serializers.SerializerMethodField()
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "agreement",
            "agreement_title",
            "description",
            "amount",
            "incurred_date",
            "status",
            "category",
            "created_by",
            "created_by_email",
            "created_at",
        ]
        read_only_fields = ["created_by", "created_by_email", "created_at", "agreement_title"]

    def get_agreement_title(self, obj):
        proj = getattr(obj.agreement, "project", None)
        return getattr(proj, "title", "") if proj else ""

    def create(self, validated_data):
        req = self.context.get("request")
        if req and getattr(req.user, "is_authenticated", False) and not validated_data.get("created_by"):
            validated_data["created_by"] = req.user
        return super().create(validated_data)
