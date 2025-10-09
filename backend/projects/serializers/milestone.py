# backend/projects/serializers/milestone.py
from __future__ import annotations

from django.db.models import Q
from rest_framework import serializers

from projects.models import Milestone, Agreement


class MilestoneSerializer(serializers.ModelSerializer):
    """
    Enriched milestone serializer + safe overlap validation (no 'due_date' lookups).

    Adds (read helpers):
      - agreement_id, project_title
      - homeowner_name, homeowner_email
      - due_date (read-only convenience: completion_date or scheduled_date or start_date)
      - is_overdue (bool)

    Validates:
      - Blocks date overlaps within same agreement unless allow_overlap=true.
      - Accepts incoming 'end_date' from clients and maps it to 'completion_date'.
    """

    agreement_id    = serializers.SerializerMethodField()
    project_title   = serializers.SerializerMethodField()
    homeowner_name  = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    due_date        = serializers.SerializerMethodField()
    is_overdue      = serializers.SerializerMethodField()

    # Write-only escape hatch for scheduling conflicts
    allow_overlap   = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model  = Milestone
        fields = "__all__"

    # ------------------------ helpers (read) ------------------------ #
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
        ag = self._get_agreement(obj)
        snap = (getattr(ag, "project_title_snapshot", "") or "").strip() if ag else ""
        if snap:
            return snap
        return ""

    def _resolve_homeowner(self, obj: Milestone):
        ag = self._get_agreement(obj)
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
        # Convenience accessor used by UI; not persisted as a field.
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
            completed = bool(getattr(obj, "completed", False))
            # handle both date and datetime
            return (not completed) and ((hasattr(due, "date") and due.date() < today) or (due < today))
        except Exception:
            return False

    # ------------------------ validation ------------------------ #
    def validate(self, attrs):
        """
        Map incoming 'end_date' → 'completion_date' and run an overlap check using only
        'start_date' and 'completion_date' (no reference to a non-existent 'due_date').
        """
        allow_overlap = attrs.get("allow_overlap", False)

        # Accept 'end_date' from clients and store as completion_date
        if "end_date" in getattr(self, "initial_data", {}):
            incoming_end = self.initial_data.get("end_date")
            # only set if not already explicitly provided as completion_date
            if "completion_date" not in attrs:
                attrs["completion_date"] = incoming_end

        # Resolve agreement for partial updates
        agreement = attrs.get("agreement") or getattr(self.instance, "agreement", None)

        # Resolve start/end for validation on partial updates
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end   = attrs.get("completion_date", getattr(self.instance, "completion_date", None))

        # Normalize empty strings
        start = start or None
        end   = end or None

        # Basic range sanity
        if start and end and start > end:
            raise serializers.ValidationError({
                "completion_date": "Completion date must be on or after the start date."
            })

        # Skip if insufficient context or override requested
        if not (agreement and start and end) or allow_overlap:
            return attrs

        # Overlap check in same agreement (ignore self on update)
        qs = Milestone.objects.filter(agreement=agreement)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)

        # Intervals [s1,e1] & [s2,e2] overlap if s1 <= e2 and s2 <= e1
        conflict = qs.filter(
            Q(start_date__lte=end) & Q(completion_date__gte=start)
        ).exists()

        if conflict:
            raise serializers.ValidationError({
                "non_field_errors": (
                    "This milestone overlaps an existing milestone in the same agreement. "
                    "Resubmit with allow_overlap=true to override."
                )
            })

        return attrs

    # Always include computed fields for the client
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["agreement_id"]    = self.get_agreement_id(instance)
        data["project_title"]   = self.get_project_title(instance)
        data["homeowner_name"]  = self.get_homeowner_name(instance)
        data["homeowner_email"] = self.get_homeowner_email(instance)
        data["due_date"]        = self.get_due_date(instance)   # read-only convenience
        data["is_overdue"]      = self.get_is_overdue(instance)
        # Mirror end_date for UIs that still read it
        data["end_date"]        = data.get("completion_date")
        return data
