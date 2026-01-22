# backend/projects/views/assignment_calendar.py
# v2026-01-07 — Assignment calendar: include agreement/milestone numbers (no "M<id>" fallback)

from __future__ import annotations

from datetime import date, timedelta

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from projects.models import (
    Agreement,
    Milestone,
    ContractorSubAccount,
    AgreementAssignment,
    MilestoneAssignment,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


def _to_iso(d: date | None) -> str | None:
    if not d:
        return None
    try:
        return d.isoformat()
    except Exception:
        return str(d)


def _event(title: str, start: date | None, end: date | None, event_id: str, props: dict):
    """
    FullCalendar expects end to be exclusive for all-day ranges.
    We'll convert inclusive end -> exclusive by adding 1 day when end exists.
    """
    start_iso = _to_iso(start)
    end_iso = _to_iso(end + timedelta(days=1)) if end else None

    return {
        "id": event_id,
        "title": title,
        "start": start_iso,
        "end": end_iso,
        "allDay": True,
        "extendedProps": props,
    }


def _fallback_milestone_number_within_agreement(agreement_id: int, milestone_id: int) -> int | None:
    """
    If milestone.order is null, compute a stable milestone number within the agreement:
      sort by (order ASC NULLS LAST, id ASC)
      return 1-based index of the milestone.
    """
    try:
        ids = list(
            Milestone.objects.filter(agreement_id=agreement_id)
            .order_by("order", "id")
            .values_list("id", flat=True)
        )
        if milestone_id in ids:
            return ids.index(milestone_id) + 1
    except Exception:
        pass
    return None


class AssignmentCalendarView(APIView):
    """
    GET /api/projects/assignments/calendar/

    Contractor owner:
      - sees all assignment events (agreement + milestone overrides) for their contractor.
      - can filter with ?subaccount_id=<id>

    Employee (subaccount):
      - sees ONLY their own assignment events automatically.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = get_contractor_for_user(request.user)
        subaccount = get_subaccount_for_user(request.user)

        if subaccount is not None:
            target_sub_id = subaccount.id
            if contractor is None:
                raise PermissionDenied("Employee not linked to a contractor.")
        else:
            if contractor is None:
                raise PermissionDenied("Contractor owner required.")
            target_sub_id = request.query_params.get("subaccount_id")
            target_sub_id = int(target_sub_id) if target_sub_id else None

        if target_sub_id is not None:
            try:
                target_sub = ContractorSubAccount.objects.select_related("user").get(
                    id=target_sub_id,
                    parent_contractor=contractor,
                )
            except ContractorSubAccount.DoesNotExist:
                return Response({"detail": "Employee not found for this contractor."}, status=404)
            subaccounts = [target_sub]
        else:
            subaccounts = list(
                ContractorSubAccount.objects.filter(parent_contractor=contractor, is_active=True)
                .select_related("user")
                .order_by("id")
            )

        sub_by_id = {s.id: s for s in subaccounts}

        events = []

        # 1) AgreementAssignment events
        aa_qs = (
            AgreementAssignment.objects.filter(subaccount_id__in=sub_by_id.keys())
            .select_related("agreement", "agreement__project", "subaccount", "subaccount__user")
            .order_by("agreement_id")
        )

        for aa in aa_qs:
            ag = aa.agreement
            sub = aa.subaccount

            proj_title = ag.project.title if getattr(ag, "project", None) else f"Agreement #{ag.id}"
            emp_name = sub.display_name or "Employee"
            emp_email = getattr(getattr(sub, "user", None), "email", None) or "—"

            agreement_number = getattr(ag, "agreement_number", None) or ag.id

            events.append(
                _event(
                    title=f"{emp_name} — {proj_title}",
                    start=getattr(ag, "start", None),
                    end=getattr(ag, "end", None),
                    event_id=f"AA-{ag.id}-{sub.id}",
                    props={
                        "type": "agreement_assignment",
                        "agreement_id": ag.id,
                        "agreement_number": agreement_number,
                        "project_title": proj_title,
                        "subaccount_id": sub.id,
                        "employee_name": emp_name,
                        "employee_email": emp_email,
                        "employee_role": sub.role,
                    },
                )
            )

        # 2) MilestoneAssignment override events
        ma_qs = (
            MilestoneAssignment.objects.filter(subaccount_id__in=sub_by_id.keys())
            .select_related(
                "milestone",
                "milestone__agreement",
                "milestone__agreement__project",
                "subaccount",
                "subaccount__user",
            )
            .order_by("milestone_id")
        )

        for ma in ma_qs:
            m = ma.milestone
            ag = m.agreement
            sub = ma.subaccount

            proj_title = ag.project.title if getattr(ag, "project", None) else f"Agreement #{ag.id}"
            emp_name = sub.display_name or "Employee"
            emp_email = getattr(getattr(sub, "user", None), "email", None) or "—"

            agreement_number = getattr(ag, "agreement_number", None) or ag.id

            milestone_order = getattr(m, "order", None)
            if milestone_order is None:
                milestone_order = _fallback_milestone_number_within_agreement(ag.id, m.id)

            start = getattr(m, "start_date", None) or getattr(ag, "start", None)
            end = getattr(m, "completion_date", None) or getattr(ag, "end", None)

            prefix = f"A#{agreement_number}"
            if milestone_order is not None:
                prefix = f"{prefix} • M{milestone_order}"
            title = f"{prefix} — {m.title}"

            events.append(
                _event(
                    title=title,
                    start=start,
                    end=end,
                    event_id=f"MA-{m.id}-{sub.id}",
                    props={
                        "type": "milestone_override",
                        "agreement_id": ag.id,
                        "agreement_number": agreement_number,
                        "project_title": proj_title,
                        "milestone_id": m.id,
                        "milestone_order": milestone_order,  # ✅ now never becomes "id" in UI
                        "milestone_title": m.title,
                        "subaccount_id": sub.id,
                        "employee_name": emp_name,
                        "employee_email": emp_email,
                        "employee_role": sub.role,
                    },
                )
            )

        return Response({"events": events})
