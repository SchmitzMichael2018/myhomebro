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
    incidentals_reserve = serializers.SerializerMethodField()
    reserve_impact = serializers.SerializerMethodField()
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
            "funding_source",
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
            "incidentals_reserve",
            "reserve_impact",
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
            "incidentals_reserve",
            "reserve_impact",
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

    def validate_amount(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        funding_source = attrs.get("funding_source")
        request_kind = attrs.get("request_kind")
        agreement = attrs.get("agreement")
        if self.instance is not None:
            funding_source = funding_source or getattr(self.instance, "funding_source", "")
            request_kind = request_kind or getattr(self.instance, "request_kind", "")
            agreement = agreement or getattr(self.instance, "agreement", None)

        if funding_source == ExpenseRequest.FundingSource.INCIDENTALS_RESERVE:
            attrs["request_kind"] = ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT
            if agreement is None:
                raise serializers.ValidationError({"agreement": "Agreement is required for Incidentals Reserve expenses."})
            if getattr(agreement, "payment_mode", "escrow") == "direct":
                raise serializers.ValidationError({"funding_source": "Incidentals Reserve can only be used on escrow agreements."})
            try:
                from projects.services.escrow_reimbursements import incidentals_reserve_summary, money

                reserve = incidentals_reserve_summary(agreement, exclude_expense_id=getattr(self.instance, "id", None))
                if money(reserve.get("original")) <= 0:
                    raise serializers.ValidationError({"funding_source": "Incidentals Reserve has not been configured for this agreement."})
                amount = attrs.get("amount", getattr(self.instance, "amount", 0) if self.instance else 0)
                if money(amount) > money(reserve.get("remaining")):
                    raise serializers.ValidationError({"amount": "Amount exceeds remaining Incidentals Reserve."})
            except serializers.ValidationError:
                raise
            except Exception:
                pass
        elif request_kind == ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT:
            attrs.setdefault("funding_source", ExpenseRequest.FundingSource.REIMBURSEMENT)

        return attrs

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

    def get_incidentals_reserve(self, obj):
        if not getattr(obj, "agreement_id", None):
            return None
        try:
            from projects.services.escrow_reimbursements import incidentals_reserve_summary, serialize_incidentals_reserve

            return serialize_incidentals_reserve(incidentals_reserve_summary(obj.agreement, exclude_expense_id=obj.id))
        except Exception:
            return None

    def get_reserve_impact(self, obj):
        if getattr(obj, "funding_source", "") != ExpenseRequest.FundingSource.INCIDENTALS_RESERVE:
            return None
        try:
            from projects.services.escrow_reimbursements import incidentals_reserve_summary, money

            reserve = incidentals_reserve_summary(obj.agreement, exclude_expense_id=obj.id)
            amount = money(getattr(obj, "amount", 0))
            status = str(getattr(obj, "status", "") or "").lower()
            pending_statuses = {
                ExpenseRequest.Status.DRAFT,
                ExpenseRequest.Status.SUBMITTED,
                ExpenseRequest.Status.CONTRACTOR_SIGNED,
                ExpenseRequest.Status.SENT_TO_HOMEOWNER,
                ExpenseRequest.Status.HELD,
            }
            spent_statuses = {
                ExpenseRequest.Status.APPROVED,
                ExpenseRequest.Status.PENDING_RELEASE,
                ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
                ExpenseRequest.Status.RELEASED,
                ExpenseRequest.Status.PAID,
            }
            pending_delta = amount if status in pending_statuses else money(0)
            spent_delta = amount if status in spent_statuses or getattr(obj, "released_at", None) else money(0)
            remaining_after_approval = money(reserve.get("remaining")) - amount
            if remaining_after_approval < 0:
                remaining_after_approval = money(0)
            return {
                "pending_delta": f"{pending_delta:.2f}",
                "spent_delta": f"{spent_delta:.2f}",
                "remaining_after_approval": f"{remaining_after_approval:.2f}",
            }
        except Exception:
            return None
