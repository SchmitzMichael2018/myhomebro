from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from rest_framework import serializers
from ..models import Invoice, MilestoneComment, MilestoneFile


def cents_to_dollars(cents: int) -> str:
    try:
        d = (Decimal(int(cents)) / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return f"{d:.2f}"
    except Exception:
        return "0.00"


class InvoiceSerializer(serializers.ModelSerializer):
    # ─────────────────────────────
    # Context helpers (existing)
    # ─────────────────────────────
    homeowner_name = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    project_title = serializers.SerializerMethodField()
    agreement_id = serializers.SerializerMethodField()

    # ✅ NEW: agreement payment mode (escrow vs direct)
    agreement_payment_mode = serializers.SerializerMethodField()

    # ─────────────────────────────
    # Milestone context (existing)
    # ─────────────────────────────
    milestone_id = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    milestone_description = serializers.SerializerMethodField()
    milestone_completion_notes = serializers.SerializerMethodField()
    milestone_attachments = serializers.SerializerMethodField()

    # ─────────────────────────────
    # ✅ NEW: escrow / payout audit (existing)
    # ─────────────────────────────
    escrow_released = serializers.BooleanField(read_only=True)
    escrow_released_at = serializers.DateTimeField(read_only=True)
    stripe_transfer_id = serializers.CharField(read_only=True)

    platform_fee_cents = serializers.IntegerField(read_only=True, required=False)
    payout_cents = serializers.IntegerField(read_only=True, required=False)

    platform_fee = serializers.SerializerMethodField()
    payout_amount = serializers.SerializerMethodField()

    # ✅ NEW: UI-friendly status
    display_status = serializers.SerializerMethodField()

    # ✅ NEW: DIRECT PAY fields (read-only)
    direct_pay_checkout_url = serializers.CharField(read_only=True)
    direct_pay_paid_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            # identity
            "id",
            "invoice_number",

            # status
            "status",
            "display_status",

            # money
            "amount",
            "platform_fee_cents",
            "payout_cents",
            "platform_fee",
            "payout_amount",

            # timestamps
            "created_at",
            "approved_at",
            "escrow_released",
            "escrow_released_at",

            # ✅ DIRECT PAY timestamps/link
            "direct_pay_paid_at",
            "direct_pay_checkout_url",

            # relations
            "agreement",
            "agreement_id",

            # ✅ agreement payment mode
            "agreement_payment_mode",

            # stripe / payout
            "stripe_transfer_id",

            # computed context
            "homeowner_name",
            "homeowner_email",
            "project_title",

            # milestone snapshot/context
            "milestone_id",
            "milestone_title",
            "milestone_description",
            "milestone_completion_notes",
            "milestone_attachments",

            # email tracking
            "email_sent_at",
            "email_message_id",
            "last_email_error",
        ]

    # ─────────────────────────────
    # Status logic
    # ─────────────────────────────
    def get_display_status(self, obj: Invoice) -> str:
        # Escrow released = paid, regardless of enum value
        if getattr(obj, "escrow_released", False):
            return "Paid"

        # ✅ DIRECT PAY paid = paid
        if getattr(obj, "direct_pay_paid_at", None):
            return "Paid"

        raw = str(getattr(obj, "status", "") or "")
        return raw.replace("_", " ").strip().title() if raw else "—"

    # ─────────────────────────────
    # Fee helpers
    # ─────────────────────────────
    def get_platform_fee(self, obj: Invoice) -> str:
        cents = getattr(obj, "platform_fee_cents", 0) or 0
        return cents_to_dollars(cents)

    def get_payout_amount(self, obj: Invoice) -> str:
        cents = getattr(obj, "payout_cents", 0) or 0
        return cents_to_dollars(cents)

    # ─────────────────────────────
    # Agreement helpers
    # ─────────────────────────────
    def get_agreement_id(self, obj):
        return getattr(obj.agreement, "id", None)

    def get_agreement_payment_mode(self, obj):
        agreement = getattr(obj, "agreement", None)
        # Will be "escrow" or "direct"
        return getattr(agreement, "payment_mode", None) if agreement else None

    # ─────────────────────────────
    # Existing helper methods
    # ─────────────────────────────
    def get_homeowner_name(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        homeowner = getattr(project, "homeowner", None) if project else None
        if homeowner:
            return (
                getattr(homeowner, "full_name", None)
                or getattr(homeowner, "name", None)
                or "Homeowner"
            )
        return None

    def get_homeowner_email(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        homeowner = getattr(project, "homeowner", None) if project else None
        return getattr(homeowner, "email", None) if homeowner else None

    def get_project_title(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        return getattr(project, "title", None) if project else None

    # -----------------------------
    # Milestone wiring (snapshot-first)
    # -----------------------------
    def _source_milestone(self, obj):
        return getattr(obj, "source_milestone", None)

    def get_milestone_id(self, obj):
        snap = getattr(obj, "milestone_id_snapshot", None)
        if snap:
            return snap
        m = self._source_milestone(obj)
        return getattr(m, "id", None) if m else None

    def get_milestone_title(self, obj):
        snap = (getattr(obj, "milestone_title_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._source_milestone(obj)
        if not m:
            return None
        return getattr(m, "title", None) or getattr(m, "name", None)

    def get_milestone_description(self, obj):
        snap = (getattr(obj, "milestone_description_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._source_milestone(obj)
        return getattr(m, "description", None) if m else None

    def get_milestone_completion_notes(self, obj):
        snap = (getattr(obj, "milestone_completion_notes", "") or "").strip()
        if snap:
            return snap

        m = self._source_milestone(obj)
        if not m:
            return ""
        qs = MilestoneComment.objects.filter(milestone=m).order_by("created_at")
        lines = []
        for c in qs:
            content = (getattr(c, "content", "") or "").strip()
            if content:
                lines.append(f"- {content}")
        return "\n".join(lines).strip()

    def get_milestone_attachments(self, obj):
        snap = getattr(obj, "milestone_attachments_snapshot", None)
        if isinstance(snap, list) and snap:
            return snap

        m = self._source_milestone(obj)
        if not m:
            return []
        request = self.context.get("request")
        qs = MilestoneFile.objects.filter(milestone=m).order_by("-uploaded_at")
        out = []
        for f in qs:
            if not getattr(f, "file", None):
                continue
            try:
                url = request.build_absolute_uri(f.file.url) if request else f.file.url
            except Exception:
                url = f.file.url
            out.append({
                "id": f.id,
                "name": getattr(f.file, "name", "") or f"file_{f.id}",
                "url": url,
                "uploaded_at": (
                    f.uploaded_at.isoformat() if getattr(f, "uploaded_at", None) else None
                ),
            })
        return out
