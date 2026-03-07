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


def _boolish(v, default=True) -> bool:
    if v is True:
        return True
    if v is False:
        return False
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    if v in (0, "0", "false", "False", "no", "No"):
        return False
    return default


class AgreementReviewSerializer(serializers.ModelSerializer):
    contractor_business = serializers.SerializerMethodField()
    milestones = MilestoneLiteSerializer(source="milestone_set", many=True, read_only=True)
    invoices = InvoiceLiteSerializer(source="invoice_set", many=True, read_only=True)

    # extra flags (if present on model)
    reviewed_at = serializers.SerializerMethodField()
    warranty_text = serializers.SerializerMethodField()

    # ✅ include for Step4 stability
    payment_mode = serializers.SerializerMethodField()

    require_contractor_signature = serializers.SerializerMethodField()
    require_customer_signature = serializers.SerializerMethodField()

    contractor_signature_name = serializers.SerializerMethodField()
    homeowner_signature_name = serializers.SerializerMethodField()

    contractor_signed_at = serializers.SerializerMethodField()
    homeowner_signed_at = serializers.SerializerMethodField()

    contractor_signed_ip = serializers.SerializerMethodField()
    homeowner_signed_ip = serializers.SerializerMethodField()

    contractor_signed = serializers.SerializerMethodField()
    homeowner_signed = serializers.SerializerMethodField()
    fully_signed = serializers.SerializerMethodField()

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

            # ✅ keep fee/workflow consistent after signing response
            "payment_mode",

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

            # ✅ signature requirements + status
            "require_contractor_signature",
            "require_customer_signature",
            "contractor_signature_name",
            "homeowner_signature_name",
            "contractor_signed_at",
            "homeowner_signed_at",
            "contractor_signed_ip",
            "homeowner_signed_ip",
            "contractor_signed",
            "homeowner_signed",
            "fully_signed",

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

    def get_payment_mode(self, obj):
        return getattr(obj, "payment_mode", None)

    def get_require_contractor_signature(self, obj):
        v = getattr(obj, "require_contractor_signature", None)
        return _boolish(v, True)

    def get_require_customer_signature(self, obj):
        v = getattr(obj, "require_customer_signature", None)
        return _boolish(v, True)

    def get_contractor_signature_name(self, obj):
        return getattr(obj, "contractor_signature_name", None)

    def get_homeowner_signature_name(self, obj):
        return getattr(obj, "homeowner_signature_name", None)

    def get_contractor_signed_at(self, obj):
        return getattr(obj, "contractor_signed_at", None) or getattr(obj, "signed_at_contractor", None)

    def get_homeowner_signed_at(self, obj):
        return getattr(obj, "homeowner_signed_at", None) or getattr(obj, "signed_at_homeowner", None)

    def get_contractor_signed_ip(self, obj):
        return getattr(obj, "contractor_signed_ip", None)

    def get_homeowner_signed_ip(self, obj):
        return getattr(obj, "homeowner_signed_ip", None)

    def get_contractor_signed(self, obj):
        if bool(getattr(obj, "signed_by_contractor", False)):
            return True
        if bool(getattr(obj, "contractor_signed", False)):
            return True
        if getattr(obj, "contractor_signature_name", None):
            return True
        if getattr(obj, "contractor_signed_at", None) or getattr(obj, "signed_at_contractor", None):
            return True
        return False

    def get_homeowner_signed(self, obj):
        if bool(getattr(obj, "signed_by_homeowner", False)):
            return True
        if bool(getattr(obj, "homeowner_signed", False)):
            return True
        if getattr(obj, "homeowner_signature_name", None):
            return True
        if getattr(obj, "homeowner_signed_at", None) or getattr(obj, "signed_at_homeowner", None):
            return True
        return False

    def get_fully_signed(self, obj):
        req_contr = self.get_require_contractor_signature(obj)
        req_cust = self.get_require_customer_signature(obj)
        contr_ok = (not req_contr) or self.get_contractor_signed(obj)
        cust_ok = (not req_cust) or self.get_homeowner_signed(obj)
        return bool(contr_ok and cust_ok)


class AgreementSignSerializer(serializers.Serializer):
    signer_name = serializers.CharField(max_length=200)
    signer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])

    # ✅ accept both names (frontend has varied over time)
    agree_tos = serializers.BooleanField(required=False)
    agree_privacy = serializers.BooleanField(required=False)
    consent_tos = serializers.BooleanField(required=False)
    consent_privacy = serializers.BooleanField(required=False)

    signature_text = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        # Normalize old -> new
        if "agree_tos" not in attrs and "consent_tos" in attrs:
            attrs["agree_tos"] = attrs.get("consent_tos")
        if "agree_privacy" not in attrs and "consent_privacy" in attrs:
            attrs["agree_privacy"] = attrs.get("consent_privacy")

        if not attrs.get("agree_tos") or not attrs.get("agree_privacy"):
            raise serializers.ValidationError(
                "You must accept Terms of Service and Privacy Policy to sign."
            )
        return attrs


class AgreementPreviewSerializer(serializers.Serializer):
    warranty_type = serializers.ChoiceField(choices=["default", "custom"], default="default")
    warranty_text = serializers.CharField(required=False, allow_blank=True, default="")


class AgreementReviewedSerializer(serializers.Serializer):
    reviewer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])