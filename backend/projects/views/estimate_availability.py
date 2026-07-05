from __future__ import annotations

from django.utils.dateparse import parse_time
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Contractor, ContractorEstimateAvailabilityWindow
from projects.models_contractor_discovery import OpportunityEstimateAppointment
from projects.utils.accounts import get_contractor_for_user


def _serialize_window(window: ContractorEstimateAvailabilityWindow) -> dict:
    return {
        "id": window.id,
        "weekday": window.weekday,
        "weekday_label": window.get_weekday_display(),
        "start_time": window.start_time.strftime("%H:%M"),
        "end_time": window.end_time.strftime("%H:%M"),
        "timezone": window.timezone,
        "appointment_type": window.appointment_type,
        "appointment_type_label": window.get_appointment_type_display(),
        "duration_minutes": window.duration_minutes,
        "notes": window.notes,
        "is_active": window.is_active,
        "created_at": window.created_at.isoformat() if window.created_at else None,
        "updated_at": window.updated_at.isoformat() if window.updated_at else None,
    }


def _contractor_allows_availability(contractor: Contractor | None) -> bool:
    if contractor is None:
        return False
    return contractor.marketplace_verification_status != Contractor.MARKETPLACE_SUSPENDED


def _get_primary_contractor_or_response(request):
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        return None, Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
    if contractor.user_id != request.user.id:
        return None, Response({"detail": "Only the contractor account can manage estimate availability."}, status=status.HTTP_403_FORBIDDEN)
    return contractor, None


def _parse_bool(value, default=False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_payload(data, instance: ContractorEstimateAvailabilityWindow | None = None) -> tuple[dict, dict]:
    errors: dict[str, list[str]] = {}

    def add_error(field: str, message: str) -> None:
        errors.setdefault(field, []).append(message)

    existing = instance
    values = {
        "weekday": getattr(existing, "weekday", None),
        "start_time": getattr(existing, "start_time", None),
        "end_time": getattr(existing, "end_time", None),
        "timezone": getattr(existing, "timezone", "America/Chicago"),
        "appointment_type": getattr(existing, "appointment_type", OpportunityEstimateAppointment.TYPE_IN_PERSON),
        "duration_minutes": getattr(existing, "duration_minutes", 60),
        "notes": getattr(existing, "notes", ""),
        "is_active": getattr(existing, "is_active", True),
    }

    if "weekday" in data or existing is None:
        try:
            weekday = int(data.get("weekday"))
            if weekday < 0 or weekday > 6:
                raise ValueError
            values["weekday"] = weekday
        except (TypeError, ValueError):
            add_error("weekday", "Choose a valid weekday.")

    for field in ("start_time", "end_time"):
        if field in data or existing is None:
            parsed = parse_time(str(data.get(field) or ""))
            if parsed is None:
                add_error(field, "Enter a valid time.")
            else:
                values[field] = parsed.replace(second=0, microsecond=0)

    if "timezone" in data:
        timezone = str(data.get("timezone") or "").strip()
        if not timezone:
            add_error("timezone", "Timezone is required.")
        else:
            values["timezone"] = timezone[:64]

    if "appointment_type" in data or existing is None:
        appointment_type = str(data.get("appointment_type") or "").strip()
        valid_types = {choice[0] for choice in OpportunityEstimateAppointment.TYPE_CHOICES}
        if appointment_type not in valid_types:
            add_error("appointment_type", "Choose a valid appointment type.")
        else:
            values["appointment_type"] = appointment_type

    if "duration_minutes" in data or existing is None:
        try:
            duration = int(data.get("duration_minutes"))
            if duration < 15 or duration > 480:
                raise ValueError
            values["duration_minutes"] = duration
        except (TypeError, ValueError):
            add_error("duration_minutes", "Duration must be between 15 and 480 minutes.")

    if "notes" in data:
        values["notes"] = str(data.get("notes") or "").strip()

    if "is_active" in data:
        values["is_active"] = _parse_bool(data.get("is_active"), values["is_active"])

    start_time = values.get("start_time")
    end_time = values.get("end_time")
    if start_time and end_time and end_time <= start_time:
        add_error("end_time", "End time must be after start time.")

    return values, errors


def _validate_overlap(contractor: Contractor, values: dict, instance: ContractorEstimateAvailabilityWindow | None = None) -> dict:
    if not values.get("is_active"):
        return {}
    start_time = values.get("start_time")
    end_time = values.get("end_time")
    weekday = values.get("weekday")
    if start_time is None or end_time is None or weekday is None:
        return {}

    qs = ContractorEstimateAvailabilityWindow.objects.filter(
        contractor=contractor,
        weekday=weekday,
        is_active=True,
        start_time__lt=end_time,
        end_time__gt=start_time,
    )
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        return {
            "non_field_errors": [
                "This window overlaps an existing active estimate availability window."
            ]
        }
    return {}


class EstimateAvailabilityWindowListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor, error_response = _get_primary_contractor_or_response(request)
        if error_response is not None:
            return error_response

        windows = ContractorEstimateAvailabilityWindow.objects.filter(contractor=contractor).order_by(
            "weekday", "start_time", "id"
        )
        results = [_serialize_window(window) for window in windows]
        warning = "" if results else "No estimate availability has been configured."
        return Response({"results": results, "warning": warning})

    def post(self, request):
        contractor, error_response = _get_primary_contractor_or_response(request)
        if error_response is not None:
            return error_response
        if not _contractor_allows_availability(contractor):
            return Response(
                {"detail": "Inactive contractors cannot publish estimate availability."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        values, errors = _parse_payload(request.data)
        errors.update(_validate_overlap(contractor, values))
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        window = ContractorEstimateAvailabilityWindow.objects.create(contractor=contractor, **values)
        return Response(_serialize_window(window), status=status.HTTP_201_CREATED)


class EstimateAvailabilityWindowDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_window(self, request, window_id):
        contractor, error_response = _get_primary_contractor_or_response(request)
        if error_response is not None:
            return None, error_response
        try:
            return ContractorEstimateAvailabilityWindow.objects.get(contractor=contractor, pk=window_id), None
        except ContractorEstimateAvailabilityWindow.DoesNotExist:
            return None, Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, window_id):
        return self._update(request, window_id)

    def put(self, request, window_id):
        return self._update(request, window_id)

    def _update(self, request, window_id):
        window, error_response = self._get_window(request, window_id)
        if error_response is not None:
            return error_response
        if not _contractor_allows_availability(window.contractor):
            return Response(
                {"detail": "Inactive contractors cannot publish estimate availability."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        values, errors = _parse_payload(request.data, instance=window)
        errors.update(_validate_overlap(window.contractor, values, instance=window))
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        for field, value in values.items():
            setattr(window, field, value)
        window.save(update_fields=[*values.keys(), "updated_at"])
        return Response(_serialize_window(window))

    def delete(self, request, window_id):
        window, error_response = self._get_window(request, window_id)
        if error_response is not None:
            return error_response
        window.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
