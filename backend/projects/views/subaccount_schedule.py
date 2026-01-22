# backend/projects/views/subaccount_schedule.py
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from projects.models import ContractorSubAccount, EmployeeWorkSchedule, EmployeeScheduleException
from projects.utils.accounts import get_contractor_for_user


def _require_owner(request):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied("Contractor owner required.")
    return contractor


def _get_sub_or_404(contractor, subaccount_id):
    try:
        return ContractorSubAccount.objects.select_related("user").get(
            id=subaccount_id,
            parent_contractor=contractor,
        )
    except ContractorSubAccount.DoesNotExist:
        return None


def _schedule_payload(schedule: EmployeeWorkSchedule):
    return {
        "timezone": schedule.timezone,
        "work_sun": schedule.work_sun,
        "work_mon": schedule.work_mon,
        "work_tue": schedule.work_tue,
        "work_wed": schedule.work_wed,
        "work_thu": schedule.work_thu,
        "work_fri": schedule.work_fri,
        "work_sat": schedule.work_sat,
        "start_time": schedule.start_time.isoformat() if schedule.start_time else None,
        "end_time": schedule.end_time.isoformat() if schedule.end_time else None,
    }


def _exceptions_payload(sub: ContractorSubAccount):
    qs = EmployeeScheduleException.objects.filter(subaccount=sub).order_by("-date")[:180]
    return [
        {
            "id": x.id,
            "date": x.date.isoformat(),
            "is_working": bool(x.is_working),
            "note": x.note,
        }
        for x in qs
    ]


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def subaccount_schedule(request, subaccount_id: int):
    """
    GET  /api/projects/subaccounts/<id>/schedule/
    PUT  /api/projects/subaccounts/<id>/schedule/
    """
    contractor = _require_owner(request)
    sub = _get_sub_or_404(contractor, subaccount_id)
    if not sub:
        return Response({"detail": "Employee not found."}, status=404)

    schedule, _ = EmployeeWorkSchedule.objects.get_or_create(subaccount=sub)

    if request.method == "GET":
        return Response(
            {
                "subaccount_id": sub.id,
                "display_name": sub.display_name,
                "email": getattr(sub.user, "email", None),
                "role": sub.role,
                "schedule": _schedule_payload(schedule),
                "exceptions": _exceptions_payload(sub),
            }
        )

    # PUT (update schedule)
    data = request.data or {}

    schedule.timezone = data.get("timezone", schedule.timezone) or schedule.timezone

    for f in ["work_sun", "work_mon", "work_tue", "work_wed", "work_thu", "work_fri", "work_sat"]:
        if f in data:
            setattr(schedule, f, bool(data.get(f)))

    # Optional time window (HH:MM[:SS])
    for tf in ["start_time", "end_time"]:
        if tf in data:
            val = data.get(tf)
            if not val:
                setattr(schedule, tf, None)
            else:
                # Let Django parse "HH:MM" or "HH:MM:SS"
                setattr(schedule, tf, val)

    schedule.save()

    return Response(
        {
            "subaccount_id": sub.id,
            "schedule": _schedule_payload(schedule),
            "exceptions": _exceptions_payload(sub),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_schedule_exception(request, subaccount_id: int):
    """
    POST /api/projects/subaccounts/<id>/schedule/exceptions/
    { "date": "YYYY-MM-DD", "is_working": true/false, "note": "..." }
    """
    contractor = _require_owner(request)
    sub = _get_sub_or_404(contractor, subaccount_id)
    if not sub:
        return Response({"detail": "Employee not found."}, status=404)

    date = (request.data.get("date") or "").strip()
    if not date:
        return Response({"detail": "date is required (YYYY-MM-DD)."}, status=400)

    is_working = bool(request.data.get("is_working"))
    note = (request.data.get("note") or "").strip()

    obj, _ = EmployeeScheduleException.objects.update_or_create(
        subaccount=sub,
        date=date,
        defaults={"is_working": is_working, "note": note},
    )

    return Response(
        {"id": obj.id, "date": obj.date.isoformat(), "is_working": obj.is_working, "note": obj.note},
        status=201,
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_schedule_exception(request, subaccount_id: int, exception_id: int):
    """
    DELETE /api/projects/subaccounts/<id>/schedule/exceptions/<exception_id>/
    """
    contractor = _require_owner(request)
    sub = _get_sub_or_404(contractor, subaccount_id)
    if not sub:
        return Response({"detail": "Employee not found."}, status=404)

    EmployeeScheduleException.objects.filter(id=exception_id, subaccount=sub).delete()
    return Response({"deleted": True})
