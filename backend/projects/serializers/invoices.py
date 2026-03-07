from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from rest_framework import serializers

from ..models import Invoice, Milestone, MilestoneComment, MilestoneFile


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
    # Context helpers
    # ─────────────────────────────
    homeowner_name = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()

    # ✅ NEW (preferred): customer naming for UI consistency
    customer_name = serializers.SerializerMethodField()
    customer_email = serializers.SerializerMethodField()

    project_title = serializers.SerializerMethodField()
    agreement_id = serializers.SerializerMethodField()

    # ✅ agreement payment mode (escrow vs direct)
    agreement_payment_mode = serializers.SerializerMethodField()

    # ─────────────────────────────
    # Milestone context (snapshot-first)
    # ─────────────────────────────
    milestone_id = serializers.SerializerMethodField()

    # ✅ NEW: per-agreement milestone numbering (1..N)
    milestone_order = serializers.SerializerMethodField()
    milestone_label = serializers.SerializerMethodField()

    milestone_title = serializers.SerializerMethodField()
    milestone_description = serializers.SerializerMethodField()
    milestone_completion_notes = serializers.SerializerMethodField()
    milestone_attachments = serializers.SerializerMethodField()

    # ─────────────────────────────
    # Escrow / payout audit
    # ─────────────────────────────
    escrow_released = serializers.BooleanField(read_only=True)
    escrow_released_at = serializers.DateTimeField(read_only=True)
    stripe_transfer_id = serializers.CharField(read_only=True)

    platform_fee_cents = serializers.IntegerField(read_only=True, required=False)
    payout_cents = serializers.IntegerField(read_only=True, required=False)

    platform_fee = serializers.SerializerMethodField()
    payout_amount = serializers.SerializerMethodField()

    # UI-friendly status
    display_status = serializers.SerializerMethodField()

    # DIRECT PAY fields (read-only)
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

            # DIRECT PAY timestamps/link
            "direct_pay_paid_at",
            "direct_pay_checkout_url",

            # relations
            "agreement",
            "agreement_id",

            # agreement payment mode
            "agreement_payment_mode",

            # stripe / payout
            "stripe_transfer_id",

            # computed context (legacy + new)
            "homeowner_name",
            "homeowner_email",
            "customer_name",
            "customer_email",
            "project_title",

            # milestone snapshot/context
            "milestone_id",
            "milestone_order",
            "milestone_label",
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

        # DIRECT PAY paid = paid
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
    # ✅ Option A: Agreement is source of truth for Customer
    # ─────────────────────────────
    def _agreement_customer(self, obj):
        """
        Canonical customer resolver:
        1) agreement.homeowner (current truth)
        2) fallback: agreement.project.homeowner (legacy)
        """
        agreement = getattr(obj, "agreement", None)
        if not agreement:
            return None

        # Preferred: agreement.homeowner (your canonical "customer" on agreement)
        customer = getattr(agreement, "homeowner", None) or getattr(agreement, "customer", None)
        if customer:
            return customer

        # Fallback: legacy project-based homeowner
        project = getattr(agreement, "project", None)
        return getattr(project, "homeowner", None) if project else None

    def _customer_name(self, customer) -> str | None:
        if not customer:
            return None
        return (
            getattr(customer, "full_name", None)
            or getattr(customer, "name", None)
            or getattr(customer, "email", None)
            or "Customer"
        )

    def _customer_email(self, customer) -> str | None:
        if not customer:
            return None
        return getattr(customer, "email", None)

    # Legacy fields (keep for frontend compatibility)
    def get_homeowner_name(self, obj):
        c = self._agreement_customer(obj)
        return self._customer_name(c)

    def get_homeowner_email(self, obj):
        c = self._agreement_customer(obj)
        return self._customer_email(c)

    # Preferred fields (new)
    def get_customer_name(self, obj):
        c = self._agreement_customer(obj)
        return self._customer_name(c)

    def get_customer_email(self, obj):
        c = self._agreement_customer(obj)
        return self._customer_email(c)

    def get_project_title(self, obj):
        agreement = getattr(obj, "agreement", None)
        project = getattr(agreement, "project", None) if agreement else None
        return getattr(project, "title", None) if project else None

    # -----------------------------
    # Milestone wiring (snapshot-first)
    # -----------------------------
    def _source_milestone(self, obj):
        return getattr(obj, "source_milestone", None)

    def _snapshot_milestone_id(self, obj):
        snap = getattr(obj, "milestone_id_snapshot", None)
        return int(snap) if snap else None

    def get_milestone_id(self, obj):
        snap = self._snapshot_milestone_id(obj)
        if snap:
            return snap
        m = self._source_milestone(obj)
        return getattr(m, "id", None) if m else None

    def _resolve_milestone_obj_best_effort(self, obj):
        """
        Try to resolve a Milestone instance, even when invoice uses snapshots.
        """
        m = self._source_milestone(obj)
        if m:
            return m

        snap_id = self._snapshot_milestone_id(obj)
        if snap_id:
            try:
                return Milestone.objects.filter(id=snap_id).first()
            except Exception:
                return None

        return None

    def get_milestone_order(self, obj):
        """
        Per-agreement milestone index (1..N).
        Uses milestone.order when available.
        """
        m = self._resolve_milestone_obj_best_effort(obj)
        if not m:
            return None

        order = getattr(m, "order", None)
        if order is None:
            # some schemas use sequence/index
            order = getattr(m, "sequence", None) or getattr(m, "index", None)
        return order

    def get_milestone_label(self, obj):
        """
        UI-friendly label: "Milestone #1" (or fallback to ID if order unknown).
        """
        order = self.get_milestone_order(obj)
        if order is not None:
            return f"Milestone #{order}"
        mid = self.get_milestone_id(obj)
        return f"Milestone #{mid}" if mid else "Milestone"

    def get_milestone_title(self, obj):
        snap = (getattr(obj, "milestone_title_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._resolve_milestone_obj_best_effort(obj)
        if not m:
            return None
        return getattr(m, "title", None) or getattr(m, "name", None)

    def get_milestone_description(self, obj):
        snap = (getattr(obj, "milestone_description_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._resolve_milestone_obj_best_effort(obj)
        return getattr(m, "description", None) if m else None

    def get_milestone_completion_notes(self, obj):
        snap = (getattr(obj, "milestone_completion_notes", "") or "").strip()
        if snap:
            return snap

        m = self._resolve_milestone_obj_best_effort(obj)
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

        m = self._resolve_milestone_obj_best_effort(obj)
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
            out.append(
                {
                    "id": f.id,
                    "name": getattr(f.file, "name", "") or f"file_{f.id}",
                    "url": url,
                    "uploaded_at": (
                        f.uploaded_at.isoformat() if getattr(f, "uploaded_at", None) else None
                    ),
                }
            )
        return out