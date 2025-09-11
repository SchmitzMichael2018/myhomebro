# projects/serializers_calendar.py
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from rest_framework import serializers

from projects.models import Milestone


def _first_truthy(*values):
    for v in values:
        if v not in (None, ""):
            return v
    return None


def _to_iso(value: Optional[date | datetime]) -> Optional[str]:
    """
    Return ISO string suitable for FullCalendar/ICS.
    - If a date: YYYY-MM-DD (all-day)
    - If a datetime: ISO 8601 (keep tz if present)
    """
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


class MilestoneCalendarSerializer(serializers.ModelSerializer):
    """
    Calendar-facing serializer for milestones.
    Produces: id, title, start, end, customer_name
    """
    title = serializers.SerializerMethodField()
    start = serializers.SerializerMethodField()
    end = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = Milestone
        fields = ("id", "title", "start", "end", "customer_name")

    # ---- title -------------------------------------------------------------
    def get_title(self, obj: Milestone) -> str:
        return _first_truthy(getattr(obj, "title", None),
                             getattr(obj, "name", None),
                             f"Milestone #{obj.id}")

    # ---- start/end ---------------------------------------------------------
    def get_start(self, obj: Milestone) -> Optional[str]:
        start = _first_truthy(
            getattr(obj, "start_date", None),
            getattr(obj, "start", None),
            getattr(obj, "due_date", None),
            getattr(obj, "end_date", None),
            getattr(obj, "end", None),
        )
        return _to_iso(start)

    def get_end(self, obj: Milestone) -> Optional[str]:
        end = _first_truthy(
            getattr(obj, "end_date", None),
            getattr(obj, "end", None),
            getattr(obj, "due_date", None),
            getattr(obj, "start_date", None),
            getattr(obj, "start", None),
        )
        return _to_iso(end)

    # ---- customer_name -----------------------------------------------------
    def get_customer_name(self, obj: Milestone) -> Optional[str]:
        a = getattr(obj, "agreement", None)
        if not a:
            return None

        for attr in ("customer_name", "client_name", "homeowner_name"):
            val = getattr(a, attr, None)
            if val:
                return str(val)

        cust = getattr(a, "customer", None)
        if cust is not None:
            for attr in ("name", "full_name", "display_name"):
                val = getattr(cust, attr, None)
                if val:
                    return str(val)

        return None
