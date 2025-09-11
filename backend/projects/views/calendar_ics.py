# backend/backend/projects/views/calendar_ics.py
"""
Dependency-free ICS feed for Milestones only.

Routes that usually import these:
  - get_or_create_ics_url: returns a simple URL for the feed
  - ics_feed: returns 'text/calendar' with VEVENTs for milestones

This version avoids the 'icalendar' third-party lib entirely.
"""

from __future__ import annotations

from datetime import datetime, date, timedelta, timezone
from typing import Iterable, Any, Optional

from django.http import HttpResponse, JsonResponse, Http404
from django.views import View
from django.utils.encoding import iri_to_uri

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

# Reuse your resilient serializer logic to pick start/end/title/customer
from ..serializers_calendar import MilestoneCalendarSerializer

try:
    from ..models import Milestone
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore


# ---------------------------- helpers ----------------------------

def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ics_escape(text: str) -> str:
    """
    Escape special characters for ICS text values.
    """
    return (
        text.replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace(",", "\\,")
            .replace(";", "\\;")
    )


def _fmt_dt(dt: datetime) -> str:
    """Format timezone-aware datetime to UTC in RFC5545."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _fmt_date(d: date) -> str:
    """Format date to YYYYMMDD."""
    return d.strftime("%Y%m%d")


def _parse_iso_to_types(iso_str: Optional[str]) -> tuple[Optional[date], Optional[datetime]]:
    """
    Given an ISO string from the serializer, decide whether it's a date or datetime.
    Returns (date_value, datetime_value); only one will be not-None.
    """
    if not iso_str:
        return None, None
    # Heuristic: date-only is like 'YYYY-MM-DD'; datetime has 'T'
    if "T" not in iso_str:
        try:
            d = date.fromisoformat(iso_str)
            return d, None
        except Exception:
            return None, None
    try:
        dt = datetime.fromisoformat(iso_str)
        # If naive, assume UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return None, dt
    except Exception:
        return None, None


def _iter_milestones_for_user(user) -> Iterable[Any]:
    if Milestone is None:
        return []
    qs = Milestone.objects.all().order_by("id")
    contractor = getattr(user, "contractor", None)
    if contractor and hasattr(Milestone, "agreement"):
        try:
            qs = qs.filter(agreement__contractor=contractor)
        except Exception:
            pass
    return qs


# --------------------------- views ---------------------------

class GetOrCreateICSUrl(APIView):
    """
    Simple helper that returns the absolute URL to the ICS feed.
    In a future enhancement you can mint a per-user token and include it here.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        base = request.build_absolute_uri("/")[:-1]  # drop trailing slash
        url = f"{base}/api/projects/calendar.ics"
        return JsonResponse({"url": iri_to_uri(url)})


get_or_create_ics_url = GetOrCreateICSUrl.as_view()


class ICSFeedView(APIView):
    """
    Returns a 'text/calendar' feed with VEVENTs for milestones only.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Serialize milestones using your existing serializer
        milestones = _iter_milestones_for_user(request.user)
        data = MilestoneCalendarSerializer(milestones, many=True).data

        # Build ICS
        now = _now_utc()
        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//MyHomeBro//Milestone Calendar//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
        ]

        for item in data:
            mid = item.get("id")
            title = item.get("title") or f"Milestone #{mid}"
            customer = item.get("customer_name") or ""
            start_iso = item.get("start")
            end_iso = item.get("end")

            start_date, start_dt = _parse_iso_to_types(start_iso)
            end_date, end_dt = _parse_iso_to_types(end_iso)

            uid = f"milestone-{mid}@myhomebro"
            summary = title
            description = f"Customer: {customer}" if customer else ""

            lines.append("BEGIN:VEVENT")
            lines.append(f"UID:{_ics_escape(uid)}")
            lines.append(f"DTSTAMP:{_fmt_dt(now)}")
            lines.append(f"SUMMARY:{_ics_escape(summary)}")
            if description:
                lines.append(f"DESCRIPTION:{_ics_escape(description)}")

            if start_dt:
                lines.append(f"DTSTART:{_fmt_dt(start_dt)}")
                if end_dt:
                    lines.append(f"DTEND:{_fmt_dt(end_dt)}")
            elif start_date:
                # All-day event
                lines.append(f"DTSTART;VALUE=DATE:{_fmt_date(start_date)}")
                # Per RFC5545, all-day DTEND is exclusive; if no end, use +1 day
                if end_date and end_date >= start_date:
                    exclusive = end_date + timedelta(days=1)
                else:
                    exclusive = start_date + timedelta(days=1)
                lines.append(f"DTEND;VALUE=DATE:{_fmt_date(exclusive)}")

            lines.append("END:VEVENT")

        lines.append("END:VCALENDAR")
        ics = "\r\n".join(lines) + "\r\n"

        return HttpResponse(ics, content_type="text/calendar; charset=utf-8")


ics_feed = ICSFeedView.as_view()
