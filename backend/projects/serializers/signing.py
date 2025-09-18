# backend/projects/serializers/signing.py
from rest_framework import serializers
from projects.models import Agreement, Milestone, Invoice

class MilestoneLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Milestone
        fields = ("id", "title", "description", "due_date", "amount", "status", "invoiced")

class InvoiceLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ("id", "title", "amount", "status", "approved_at")

class AgreementReviewSerializer(serializers.ModelSerializer):
    contractor_business = serializers.SerializerMethodField()
    milestones = MilestoneLiteSerializer(source="milestone_set", many=True, read_only=True)
    invoices = InvoiceLiteSerializer(source="invoice_set", many=True, read_only=True)

    # extra flags (if present on model)
    reviewed_at = serializers.SerializerMethodField()
    warranty_text = serializers.SerializerMethodField()

    class Meta:
        model = Agreement
        fields = (
            "id",
            "title",
            "project_id",
            "status",
            "is_archived",
            "amendment_number",
            "pdf_version",
            "contractor_business",
            "homeowner_name",
            "homeowner_email",
            "homeowner_phone",
            "scope_summary",
            "terms_of_service_snapshot",
            "privacy_policy_snapshot",
            "escrow_total",
            "escrow_funded",
            "escrow_frozen",
            "milestones",
            "invoices",
            "created_at",
            "updated_at",
            "reviewed_at",
            "warranty_text",
        )

    def get_contractor_business(self, obj):
        c = getattr(obj, "contractor", None)
        if not c:
            return None
        return {
            "id": c.id,
            "business_name": getattr(c, "business_name", ""),
            "full_name": getattr(c, "full_name", ""),
            "email": getattr(c, "email", ""),
            "phone": getattr(c, "phone", ""),
            "stripe_account_id": getattr(c, "stripe_account_id", ""),
        }

    def get_reviewed_at(self, obj):
        return getattr(obj, "reviewed_at", None)

    def get_warranty_text(self, obj):
        return getattr(obj, "warranty_text_snapshot", None)

class AgreementSignSerializer(serializers.Serializer):
    signer_name = serializers.CharField(max_length=200)
    signer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])
    agree_tos = serializers.BooleanField()
    agree_privacy = serializers.BooleanField()
    signature_text = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs.get("agree_tos") or not attrs.get("agree_privacy"):
            raise serializers.ValidationError("You must accept Terms of Service and Privacy Policy to sign.")
        return attrs

class AgreementPreviewSerializer(serializers.Serializer):
    warranty_type = serializers.ChoiceField(choices=["default", "custom"], default="default")
    warranty_text = serializers.CharField(required=False, allow_blank=True, default="")

class AgreementReviewedSerializer(serializers.Serializer):
    reviewer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])
