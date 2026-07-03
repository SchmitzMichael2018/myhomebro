from __future__ import annotations

from datetime import timedelta

from projects.models import Agreement, AgreementAssignment, Contractor, ContractorSubAccount, EmployeeScheduleException, EmployeeWorkSchedule


def ranges_overlap(a_start, a_end, b_start, b_end) -> bool:
    if not a_start or not a_end or not b_start or not b_end:
        return False
    return a_start <= b_end and b_start <= a_end


def is_supervisor(subaccount: ContractorSubAccount) -> bool:
    return (subaccount.role or "").strip().lower() == ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR


def _weekday_allowed(schedule: EmployeeWorkSchedule, weekday: int) -> bool:
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


def evaluate_assignment_conflicts(
    *,
    contractor: Contractor,
    subaccount: ContractorSubAccount,
    agreement: Agreement,
    create_missing_schedule: bool = True,
) -> dict:
    t_start = getattr(agreement, "start", None)
    t_end = getattr(agreement, "end", None)

    conflicts = []
    if t_start and t_end:
        assigned_agreement_ids = AgreementAssignment.objects.filter(subaccount=subaccount).values_list("agreement_id", flat=True)
        other_agreements = Agreement.objects.filter(
            id__in=assigned_agreement_ids,
            contractor=contractor,
        ).exclude(id=agreement.id)

        for other in other_agreements:
            a_start = getattr(other, "start", None)
            a_end = getattr(other, "end", None)
            if not a_start or not a_end:
                continue
            if ranges_overlap(t_start, t_end, a_start, a_end):
                conflicts.append(
                    {
                        "agreement_id": other.id,
                        "title": getattr(getattr(other, "project", None), "title", None) or getattr(other, "title", None) or f"Agreement #{other.id}",
                        "start": a_start,
                        "end": a_end,
                    }
                )

    supervisor = is_supervisor(subaccount)
    overlap_ok = True
    overlap_message = "No overlap conflicts detected."
    if conflicts and supervisor:
        overlap_ok = True
        overlap_message = "Supervisor role allows overlap, but conflicts were detected."
    elif conflicts and not supervisor:
        overlap_ok = False
        overlap_message = "Employee already assigned to overlapping agreement(s)."

    schedule_warning = False
    schedule_issues = []
    if not t_start or not t_end:
        schedule_warning = True
        schedule_issues.append({"date": None, "reason": "Agreement has no start/end dates; schedule check skipped."})
    else:
        if create_missing_schedule:
            schedule, _ = EmployeeWorkSchedule.objects.get_or_create(subaccount=subaccount)
        else:
            schedule = EmployeeWorkSchedule.objects.filter(subaccount=subaccount).first()
        if schedule is None:
            schedule_warning = True
            schedule_issues.append({"date": None, "reason": "No work schedule found; schedule check skipped."})
            return {
                "ok": overlap_ok,
                "is_supervisor": supervisor,
                "conflicts": conflicts,
                "message": f"{overlap_message} Employee schedule mismatch detected.",
                "schedule_warning": schedule_warning,
                "schedule_ok": True,
                "schedule_issues": schedule_issues[:50],
            }
        exceptions = {
            item.date: item
            for item in EmployeeScheduleException.objects.filter(subaccount=subaccount, date__gte=t_start, date__lte=t_end)
        }

        cursor = t_start
        limit = 366
        i = 0
        while cursor <= t_end and i < limit:
            i += 1
            if cursor in exceptions:
                if not exceptions[cursor].is_working:
                    schedule_warning = True
                    schedule_issues.append({"date": cursor, "reason": "Day off (exception)", "note": exceptions[cursor].note})
            elif not _weekday_allowed(schedule, cursor.weekday()):
                schedule_warning = True
                schedule_issues.append({"date": cursor, "reason": "Not scheduled to work (weekly schedule)"})
            cursor = cursor + timedelta(days=1)

    schedule_ok = True
    schedule_message = "Schedule OK." if not schedule_warning else "Employee schedule mismatch detected."
    ok = overlap_ok

    return {
        "ok": ok,
        "is_supervisor": supervisor,
        "conflicts": conflicts,
        "message": overlap_message if not schedule_warning else f"{overlap_message} {schedule_message}",
        "schedule_warning": schedule_warning,
        "schedule_ok": schedule_ok,
        "schedule_issues": schedule_issues[:50],
    }
