# backend/projects/serializers/signing.py
from __future__ import annotations

from rest_framework import serializers

from projects.models import Agreement

# These may live in projects.models or elsewhere in your app. We guard imports
# so admin/tests don’t explode if a model moves or is temporarily unavailable.
try:
    from projects.models import Milestone, Invoice  # type: ignore
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore
    Invoice = None    # type: ignore


class MilestoneLiteSerializer(serializers.ModelSerializer):
    """
    A compact milestone shape for signing/review screens.
    Fields are optional if your model differs—missing attrs are tolerated.
    """
    class Meta:
        model = Milestone  # type: ignore
        fields = ("id", "title", "description", "due_date", "amount", "status", "invoiced") if Milestone else ()


class InvoiceLiteSerializer(serializers.ModelSerializer):
    """
    A compact invoice shape for signing/review screens.
    """
    class Meta:
        model = Invoice  # type: ignore
        fields = ("id", "title", "amount", "status", "approved_at") if Invoice else ()


class AgreementReviewSerializer(serializers.ModelSerializer):
    """
    Read-only serializer for the “review” step of signing.
    Includes contractor summary, homeowner contact, milestone & invoice lists,
    and snapshots of legal text if present.
    """
    contractor_business = serializers.SerializerMethodField()
    milestones = serializers.SerializerMethodField()
    invoices = serializers.SerializerMethodField()

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

    # ---------- related lists with guarded fallbacks ----------
    def _milestone_qs(self, obj):
        if not Milestone:
            return []
        # Prefer explicit related_name if your model defines it
        if hasattr(obj, "milestones"):
            return obj.milestones.all()
        # Default Django related_name is <model>_set
        if hasattr(obj, "milestone_set"):
            return obj.milestone_set.all()
        # Fallback: filter by agreement FK
        try:
            return Milestone.objects.filter(agreement=obj)
        except Exception:
            return []

    def _invoice_qs(self, obj):
        if not Invoice:
            return []
        if hasattr(obj, "invoices"):
            return obj.invoices.all()
        if hasattr(obj, "invoice_set"):
            return obj.invoice_set.all()
        try:
            return Invoice.objects.filter(agreement=obj)
        except Exception:
            return []

    def get_milestones(self, obj):
        qs = self._milestone_qs(obj)
        if not qs:
            return []
        return MilestoneLiteSerializer(qs, many=True).data  # type: ignore

    def get_invoices(self, obj):
        qs = self._invoice_qs(obj)
        if not qs:
            return []
        return InvoiceLiteSerializer(qs, many=True).data  # type: ignore

    # ---------- contractor/homeowner & snapshots ----------
    def get_contractor_business(self, obj):
        c = getattr(obj, "contractor", None)
        if not c:
            return None
        return {
            "id": getattr(c, "id", None),
            "business_name": getattr(c, "business_name", "") or getattr(c, "name", ""),
            "full_name": getattr(c, "full_name", ""),
            "email": getattr(c, "email", ""),
            "phone": getattr(c, "phone", ""),
            "stripe_account_id": getattr(c, "stripe_account_id", ""),
        }

    def get_reviewed_at(self, obj):
        return getattr(obj, "reviewed_at", None)

    def get_warranty_text(self, obj):
        # Prefer snapshot if present; gracefully handle older fields
        return getattr(obj, "warranty_text_snapshot", None) or getattr(obj, "warranty_text", None)


class AgreementSignSerializer(serializers.Serializer):
    """
    Payload for POST /sign/ or role-specific signature endpoints.
    """
    signer_name = serializers.CharField(max_length=200)
    signer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])
    agree_tos = serializers.BooleanField()
    agree_privacy = serializers.BooleanField()
    signature_text = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs.get("agree_tos") or not attrs.get("agree_privacy"):
            raise serializers.ValidationError(
                "You must accept Terms of Service and Privacy Policy to sign."
            )
        return attrs


class AgreementPreviewSerializer(serializers.Serializer):
    """
    Allows the UI to request a preview PDF with either default or custom warranty text.
    """
    warranty_type = serializers.ChoiceField(choices=["default", "custom"], default="default")
    warranty_text = serializers.CharField(required=False, allow_blank=True, default="")


class AgreementReviewedSerializer(serializers.Serializer):
    """
    Records that a party has reviewed the agreement prior to signing.
    """
    reviewer_role = serializers.ChoiceField(choices=["homeowner", "contractor"])
