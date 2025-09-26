from __future__ import annotations

from django.db.models import Sum
from rest_framework import serializers

from projects.models import Milestone, Agreement


class MilestoneSerializer(serializers.ModelSerializer):
    """
    Enriched milestone serializer for list/detail views.

    Adds:
      - agreement_id
      - project_title
      - homeowner_name, homeowner_email
      - due_date           (completion_date or scheduled_date or start_date)
      - is_overdue         (bool)
    """

    agreement_id    = serializers.SerializerMethodField()
    project_title   = serializers.SerializerMethodField()
    homeowner_name  = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    due_date        = serializers.SerializerMethodField()
    is_overdue      = serializers.SerializerMethodField()

    class Meta:
        model  = Milestone
        fields = "__all__"

    # ------------------------ helpers ------------------------ #
    def _get_agreement(self, obj: Milestone) -> Agreement | None:
        try:
            return getattr(obj, "agreement", None)
        except Exception:
            return None

    def _get_project(self, obj: Milestone):
        ag = self._get_agreement(obj)
        try:
            return getattr(ag, "project", None)
        except Exception:
            return None

    def get_agreement_id(self, obj: Milestone):
        ag = self._get_agreement(obj)
        return getattr(ag, "id", None)

    def get_project_title(self, obj: Milestone) -> str:
        p = self._get_project(obj)
        if p:
            for attr in ("title", "name"):
                val = (getattr(p, attr, "") or "").strip()
                if val:
                    return val
            pid = getattr(p, "id", None)
            if pid:
                return f"Project #{pid}"
        # fall back to agreement snapshot/title if any
        ag = self._get_agreement(obj)
        snap = (getattr(ag, "project_title_snapshot", "") or "").strip() if ag else ""
        if snap:
            return snap
        return ""

    def _resolve_homeowner(self, obj: Milestone):
        ag = self._get_agreement(obj)
        # Agreement.homeowner or Project.homeowner
        h = getattr(ag, "homeowner", None) if ag else None
        if h:
            return h
        p = self._get_project(obj)
        if p:
            return getattr(p, "homeowner", None)
        return None

    def get_homeowner_name(self, obj: Milestone) -> str:
        h = self._resolve_homeowner(obj)
        if h:
            for attr in ("full_name", "name"):
                v = (getattr(h, attr, "") or "").strip()
                if v:
                    return v
        ag = self._get_agreement(obj)
        # snapshots on Agreement for resiliency
        for attr in ("homeowner_name_snapshot", "homeowner_full_name", "homeowner_name"):
            v = (getattr(ag, attr, "") or "").strip() if ag else ""
            if v:
                return v
        return ""

    def get_homeowner_email(self, obj: Milestone) -> str:
        h = self._resolve_homeowner(obj)
        if h:
            v = (getattr(h, "email", "") or "").strip()
            if v:
                return v
        ag = self._get_agreement(obj)
        v = (getattr(ag, "homeowner_email_snapshot", "") or "").strip() if ag else ""
        if v:
            return v
        return ""

    def get_due_date(self, obj: Milestone):
        # unified "due" for list sorting/display
        return (
            getattr(obj, "completion_date", None)
            or getattr(obj, "scheduled_date", None)
            or getattr(obj, "start_date", None)
        )

    def get_is_overdue(self, obj: Milestone) -> bool:
        try:
            due = self.get_due_date(obj)
            if not due:
                return False
            from django.utils.timezone import now
            today = now().date()
            # Consider overdue when not completed and due date has passed
            completed = bool(getattr(obj, "completed", False))
            return (not completed) and (hasattr(due, "date") and due.date() < today or due < today)
        except Exception:
            return False

    # Always include our computed fields
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["agreement_id"]   = self.get_agreement_id(instance)
        data["project_title"]  = self.get_project_title(instance)
        data["homeowner_name"] = self.get_homeowner_name(instance)
        data["homeowner_email"]= self.get_homeowner_email(instance)
        data["due_date"]       = self.get_due_date(instance)
        data["is_overdue"]     = self.get_is_overdue(instance)
        return data
