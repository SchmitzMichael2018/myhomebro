# backend/projects/views/assignments_conflicts.py
from __future__ import annotations

from datetime import timedelta

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from projects.models import Agreement, ContractorSubAccount, AgreementAssignment, EmployeeWorkSchedule, EmployeeScheduleException
from projects.utils.accounts import get_contractor_for_user


def _ranges_overlap(a_start, a_end, b_start, b_end) -> bool:
    if not a_start or not a_end or not b_start or not b_end:
        return False
    return a_start <= b_end and b_start <= a_end


def _is_supervisor(sub: ContractorSubAccount) -> bool:
    return (sub.role or "").strip().lower() == "employee_supervisor"


def _weekday_allowed(schedule: EmployeeWorkSchedule, weekday: int) -> bool:
    # Python weekday: Mon=0..Sun=6
    # We store Sun..Sat
    if weekday == 6:
        return bool(schedule.work_sun)
    if weekday == 0:
        return bool(schedule.work_mon)
    if weekday == 1:
        return bool(schedule.work_tue)
    if weekday == 2:
        return bool(schedule.work_wed)
    if weekday == 3:
        return bool(schedule.work_thu)
    if weekday == 4:
        return bool(schedule.work_fri)
    if weekday == 5:
        return bool(schedule.work_sat)
    return False


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def check_assignment_conflicts(request):
    """
    POST /api/projects/assignments/check-conflicts/

    Body:
      {
        "subaccount_id": 123,
        "agreement_id": 456
      }

    Response includes:
      - overlap conflicts (blocking for non-supervisors)
      - schedule warnings (Sun-Sat work schedule + exceptions)
    """
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied("Contractor owner required.")

    subaccount_id = request.data.get("subaccount_id")
    agreement_id = request.data.get("agreement_id")
    if not subaccount_id or not agreement_id:
        return Response({"detail": "subaccount_id and agreement_id required"}, status=400)

    try:
        sub = ContractorSubAccount.objects.select_related("user").get(
            id=subaccount_id,
            parent_contractor=contractor,
            is_active=True,
        )
    except ContractorSubAccount.DoesNotExist:
        return Response({"detail": "Employee not found."}, status=404)

    try:
        target = Agreement.objects.select_related("project").get(id=agreement_id, contractor=contractor)
    except Agreement.DoesNotExist:
        return Response({"detail": "Agreement not found."}, status=404)

    t_start = getattr(target, "start", None)
    t_end = getattr(target, "end", None)

    # -----------------------------
    # Overlap conflicts (agreement-level)
    # -----------------------------
    conflicts = []
    if t_start and t_end:
        assigned_agreement_ids = AgreementAssignment.objects.filter(subaccount=sub).values_list("agreement_id", flat=True)
        other_agreements = Agreement.objects.filter(
            id__in=assigned_agreement_ids,
            contractor=contractor,
        ).exclude(id=target.id)

        for ag in other_agreements:
            a_start = getattr(ag, "start", None)
            a_end = getattr(ag, "end", None)
            if not a_start or not a_end:
                continue
            if _ranges_overlap(t_start, t_end, a_start, a_end):
                conflicts.append(
                    {
                        "agreement_id": ag.id,
                        "title": getattr(getattr(ag, "project", None), "title", None) or getattr(ag, "title", None) or f"Agreement #{ag.id}",
                        "start": a_start,
                        "end": a_end,
                    }
                )

    supervisor = _is_supervisor(sub)

    # Block overlaps for non-supervisors
    overlap_ok = True
    overlap_message = "No overlap conflicts detected."
    if conflicts and supervisor:
        overlap_ok = True
        overlap_message = "Supervisor role allows overlap, but conflicts were detected."
    elif conflicts and not supervisor:
        overlap_ok = False
        overlap_message = "Employee already assigned to overlapping agreement(s)."

    # -----------------------------
    # Schedule warnings (Sun–Sat weekly schedule + exceptions)
    # -----------------------------
    schedule_warning = False
    schedule_issues = []

    # If agreement dates missing, cannot evaluate schedule
    if not t_start or not t_end:
        schedule_warning = True
        schedule_issues.append(
            {"date": None, "reason": "Agreement has no start/end dates; schedule check skipped."}
        )
    else:
        schedule, _ = EmployeeWorkSchedule.objects.get_or_create(subaccount=sub)

        exc = {
            e.date: e
            for e in EmployeeScheduleException.objects.filter(subaccount=sub, date__gte=t_start, date__lte=t_end)
        }

        d = t_start
        limit = 366  # safety cap
        i = 0
        while d <= t_end and i < limit:
            i += 1

            if d in exc:
                # explicit override
                if not exc[d].is_working:
                    schedule_warning = True
                    schedule_issues.append({"date": d, "reason": "Day off (exception)", "note": exc[d].note})
            else:
                if not _weekday_allowed(schedule, d.weekday()):
                    schedule_warning = True
                    schedule_issues.append({"date": d, "reason": "Not scheduled to work (weekly schedule)"})

            d = d + timedelta(days=1)

    # We do NOT block on schedule mismatch yet; we warn.
    schedule_ok = True
    schedule_message = "Schedule OK." if not schedule_warning else "Employee schedule mismatch detected."

    # -----------------------------
    # Final response
    # -----------------------------
    ok = overlap_ok  # schedule does not block yet

    return Response(
        {
            "ok": ok,
            "is_supervisor": supervisor,
            "conflicts": conflicts,
            "message": overlap_message if not schedule_warning else f"{overlap_message} {schedule_message}",
            "schedule_warning": schedule_warning,
            "schedule_ok": schedule_ok,
            "schedule_issues": schedule_issues[:50],  # cap payload
        }
    )
