from rest_framework import serializers
from projects.models import Milestone


class CalendarMilestoneSerializer(serializers.ModelSerializer):
    agreement_id = serializers.IntegerField(source="agreement.id", read_only=True)
    agreement_number = serializers.CharField(source="agreement.agreement_number", read_only=True, default="")
    project_title = serializers.CharField(source="agreement.project_title", read_only=True, default="")

    homeowner_name = serializers.SerializerMethodField()

    # Agreement escrow truth
    escrow_funded = serializers.SerializerMethodField()

    # Invoice truth (if milestone has invoice)
    invoice_id = serializers.SerializerMethodField()
    invoice_number = serializers.SerializerMethodField()
    invoice_status = serializers.SerializerMethodField()
    escrow_released = serializers.SerializerMethodField()

    # What the calendar should show as status (derived)
    calendar_status = serializers.SerializerMethodField()

    # For calendar rendering
    start = serializers.SerializerMethodField()
    end = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()

    class Meta:
        model = Milestone
        fields = [
            "id",
            "agreement_id",
            "agreement_number",
            "project_title",
            "title",
            "description",
            "amount",
            "duration_days",
            "due_date",
            "scheduled_date",
            "completed_at",
            "status",
            "homeowner_name",
            "escrow_funded",
            "invoice_id",
            "invoice_number",
            "invoice_status",
            "escrow_released",
            "calendar_status",
            "start",
            "end",
        ]

    def get_homeowner_name(self, obj):
        # Adjust these based on your actual homeowner/user model fields
        agreement = getattr(obj, "agreement", None)
        if not agreement:
            return ""
        homeowner = getattr(agreement, "homeowner", None)
        if not homeowner:
            return ""
        # Try common patterns
        full = getattr(homeowner, "full_name", None)
        if full:
            return full
        first = getattr(homeowner, "first_name", "") or ""
        last = getattr(homeowner, "last_name", "") or ""
        name = (first + " " + last).strip()
        if name:
            return name
        return getattr(homeowner, "email", "") or ""

    def get_escrow_funded(self, obj):
        agreement = getattr(obj, "agreement", None)
        if not agreement:
            return False
        # Support either escrow_funded or escrow_funded_at patterns
        if hasattr(agreement, "escrow_funded"):
            return bool(getattr(agreement, "escrow_funded"))
        if hasattr(agreement, "escrow_funded_at"):
            return bool(getattr(agreement, "escrow_funded_at"))
        return False

    def _get_invoice(self, obj):
        # Supports either obj.invoice FK or reverse relation
        inv = getattr(obj, "invoice", None)
        if inv:
            return inv
        inv_id = getattr(obj, "invoice_id", None)
        if inv_id:
            return getattr(obj, "invoice", None)
        return None

    def get_invoice_id(self, obj):
        inv = self._get_invoice(obj)
        return getattr(inv, "id", None) if inv else None

    def get_invoice_number(self, obj):
        inv = self._get_invoice(obj)
        return getattr(inv, "invoice_number", "") if inv else ""

    def get_invoice_status(self, obj):
        inv = self._get_invoice(obj)
        return getattr(inv, "status", None) if inv else None

    def get_escrow_released(self, obj):
        inv = self._get_invoice(obj)
        return bool(getattr(inv, "escrow_released", False)) if inv else False

    def get_calendar_status(self, obj):
        """
        Calendar should reflect reality:

        - If invoice exists and is paid -> "paid"
        - If invoice exists and approved -> "approved"
        - If invoice exists and disputed -> "disputed"
        - If milestone completed but no invoice -> "completed_not_invoiced"
        - Else if due_date past and not completed -> "overdue"
        - Else -> "scheduled"
        """
        inv = self._get_invoice(obj)
        if inv:
            inv_status = getattr(inv, "status", None)
            if inv_status:
                return inv_status  # typically "paid", "approved", "disputed", etc.

        # No invoice — infer from milestone completion
        if getattr(obj, "completed_at", None):
            return "completed_not_invoiced"

        # Overdue check
        due = getattr(obj, "due_date", None) or getattr(obj, "scheduled_date", None)
        if due:
            from django.utils import timezone

            today = timezone.localdate()
            try:
                if due < today:
                    return "overdue"
            except Exception:
                pass

        return getattr(obj, "status", None) or "scheduled"

    def get_start(self, obj):
        # Prefer scheduled_date, fallback to due_date
        d = getattr(obj, "scheduled_date", None) or getattr(obj, "due_date", None)
        return d.isoformat() if d else None

    def get_end(self, obj):
        # End can be start + duration_days (if you want multi-day blocks)
        d = getattr(obj, "scheduled_date", None) or getattr(obj, "due_date", None)
        if not d:
            return None

        duration = getattr(obj, "duration_days", None) or 1
        try:
            from datetime import timedelta

            end_date = d + timedelta(days=max(int(duration), 1))
            return end_date.isoformat()
        except Exception:
            return d.isoformat()

    def get_title(self, obj):
        # What shows inside the calendar block
        agreement = getattr(obj, "agreement", None)
        prefix = ""
        if agreement:
            num = getattr(agreement, "id", None)
            if num:
                prefix = f"Agreement #{num} – "
        return f"{prefix}{getattr(obj, 'title', '')}".strip()
