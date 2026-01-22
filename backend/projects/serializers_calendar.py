# backend/projects/serializers_calendar.py
# v2026-01-07 — Canonical calendar serializer aligned to Milestone model fields (NO status)
from __future__ import annotations

from datetime import timedelta
from django.utils import timezone
from rest_framework import serializers

from projects.models import Milestone


class CalendarMilestoneSerializer(serializers.ModelSerializer):
    # Agreement basics
    agreement_id = serializers.IntegerField(source="agreement.id", read_only=True)
    agreement_number = serializers.SerializerMethodField()
    project_title = serializers.SerializerMethodField()
    homeowner_name = serializers.SerializerMethodField()

    # Escrow truth from Agreement
    escrow_funded = serializers.SerializerMethodField()

    # Invoice truth
    invoice_id = serializers.SerializerMethodField()
    invoice_number = serializers.SerializerMethodField()
    invoice_status = serializers.SerializerMethodField()
    escrow_released = serializers.SerializerMethodField()

    # Derived status for UI
    calendar_status = serializers.SerializerMethodField()

    # Calendar rendering helpers
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
            "order",
            "duration",
            "start_date",
            "completion_date",
            "completed_at",
            "completed",
            "is_invoiced",
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

    # -------------------------
    # Agreement / homeowner
    # -------------------------
    def get_agreement_number(self, obj):
        ag = getattr(obj, "agreement", None)
        if not ag:
            return ""
        return getattr(ag, "agreement_number", None) or getattr(ag, "id", "") or ""

    def get_project_title(self, obj):
        ag = getattr(obj, "agreement", None)
        if not ag:
            return ""
        if getattr(ag, "project_title", None):
            return ag.project_title
        if getattr(ag, "title", None):
            return ag.title
        proj = getattr(ag, "project", None)
        if proj and getattr(proj, "title", None):
            return proj.title
        return ""

    def get_homeowner_name(self, obj):
        ag = getattr(obj, "agreement", None)
        if not ag:
            return ""
        homeowner = (
            getattr(ag, "homeowner", None)
            or getattr(ag, "customer", None)
            or getattr(ag, "client", None)
        )
        if not homeowner:
            return ""
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
        ag = getattr(obj, "agreement", None)
        if not ag:
            return False
        if hasattr(ag, "escrow_funded"):
            return bool(getattr(ag, "escrow_funded"))
        if hasattr(ag, "escrow_funded_at"):
            return bool(getattr(ag, "escrow_funded_at"))
        return False

    # -------------------------
    # Invoice helpers
    # -------------------------
    def _get_invoice(self, obj):
        return getattr(obj, "invoice", None)

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

    # -------------------------
    # Calendar status derivation (NO milestone.status)
    # -------------------------
    def get_calendar_status(self, obj):
        inv = self._get_invoice(obj)
        if inv:
            s = getattr(inv, "status", None)
            if s:
                return str(s).lower()

        if getattr(obj, "completed_at", None) or bool(getattr(obj, "completed", False)):
            # completed but invoice not necessarily paid
            return "complete"

        # If invoiced but not paid/approved, show "invoiced"
        if bool(getattr(obj, "is_invoiced", False)):
            return "invoiced"

        # Overdue heuristic: start_date passed and not completed
        sd = getattr(obj, "start_date", None)
        if sd:
            try:
                if sd < timezone.localdate():
                    return "overdue"
            except Exception:
                pass

        return "scheduled"

    # -------------------------
    # Calendar start/end/title
    # -------------------------
    def get_start(self, obj):
        d = getattr(obj, "start_date", None)
        return d.isoformat() if d else None

    def get_end(self, obj):
        cd = getattr(obj, "completion_date", None)
        if cd:
            return cd.isoformat()

        sd = getattr(obj, "start_date", None)
        dur = getattr(obj, "duration", None)
        if sd and dur:
            try:
                return (sd + timedelta(days=max(int(dur), 1))).isoformat()
            except Exception:
                return sd.isoformat()

        return sd.isoformat() if sd else None

    def get_title(self, obj):
        ag = getattr(obj, "agreement", None)
        prefix = ""
        if ag and getattr(ag, "id", None):
            prefix = f"Agreement #{ag.id} – "
        return f"{prefix}{getattr(obj, 'title', '')}".strip()


# ✅ Backwards compatible alias for older imports
CalendarMilestoneSerializer = CalendarMilestoneSerializer

__all__ = ["CalendarMilestoneSerializer", "CalendarMilestoneSerializer"]
