from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.core import signing
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Contractor, ContractorEstimateAvailabilityWindow
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorOpportunity,
    OpportunityEstimateAppointment,
)
from projects.services.estimate_appointments import (
    ACTIVE_BLOCKING_STATUSES, EstimateAppointmentError, hold_expiration, reserve_appointment,
)


def _safe_text(value) -> str:
    return "" if value is None else str(value).strip()


APPOINTMENT_AUTH_SALT = "projects.estimate-appointment-request.v1"


def appointment_request_token(opportunity: ContractorOpportunity) -> str:
    return signing.TimestampSigner(salt=APPOINTMENT_AUTH_SALT).sign_object({
        "opportunity_id": opportunity.id,
        "intake_id": opportunity.intake_request_id,
        "contractor_id": getattr(opportunity.directory_entry, "claimed_by_contractor_id", None),
    })


def resolve_appointment_request_token(token: str, opportunity_id):
    try:
        payload = signing.TimestampSigner(salt=APPOINTMENT_AUTH_SALT).unsign_object(
            token,
            max_age=getattr(settings, "ESTIMATE_APPOINTMENT_AUTH_MAX_AGE", 172800),
        )
    except (signing.BadSignature, signing.SignatureExpired, TypeError, ValueError):
        return None
    if str(payload.get("opportunity_id")) != str(opportunity_id):
        return None
    opportunity = ContractorOpportunity.objects.select_related(
        "directory_entry__claimed_by_contractor", "intake_request"
    ).filter(
        pk=payload.get("opportunity_id"),
        intake_request_id=payload.get("intake_id"),
        directory_entry__claimed_by_contractor_id=payload.get("contractor_id"),
        selected_by_homeowner=True,
    ).first()
    return opportunity


def _resolve_contractor_from_request(request):
    contractor_id = request.query_params.get("contractor_id") or request.data.get("contractor_id")
    directory_entry_id = request.query_params.get("directory_entry_id") or request.data.get("directory_entry_id")
    if contractor_id:
        contractor = Contractor.objects.filter(pk=contractor_id).first()
        if contractor:
            return contractor, None
    if directory_entry_id:
        entry = ContractorDirectoryEntry.objects.filter(pk=directory_entry_id).select_related("claimed_by_contractor").first()
        contractor = getattr(entry, "claimed_by_contractor", None)
        if contractor:
            return contractor, None
    return None, Response({"detail": "Contractor availability was not found."}, status=status.HTTP_404_NOT_FOUND)


def _parse_range(request):
    today = timezone.localdate()
    start = parse_date(_safe_text(request.query_params.get("start_date") or request.data.get("start_date"))) or today
    end = parse_date(_safe_text(request.query_params.get("end_date") or request.data.get("end_date"))) or (start + timedelta(days=14))
    if end < start:
        end = start
    if (end - start).days > 45:
        end = start + timedelta(days=45)
    return start, end


def _window_zone(window):
    try:
        return ZoneInfo(window.timezone or "America/Chicago")
    except ZoneInfoNotFoundError:
        return ZoneInfo("America/Chicago")


def _slot_payload(window, slot_start):
    slot_end = slot_start + timedelta(minutes=window.duration_minutes)
    hour = slot_start.strftime("%I").lstrip("0") or "12"
    time_label = f"{hour}:{slot_start.strftime('%M')} {slot_start.strftime('%p')}"
    return {
        "slot_id": f"{window.id}:{slot_start.isoformat()}",
        "window_id": window.id,
        "contractor_id": window.contractor_id,
        "appointment_type": window.appointment_type,
        "appointment_type_label": window.get_appointment_type_display(),
        "date": slot_start.date().isoformat(),
        "scheduled_start": slot_start.isoformat(),
        "scheduled_end": slot_end.isoformat(),
        "time": time_label,
        "duration_minutes": window.duration_minutes,
        "timezone": window.timezone,
        "notes": window.notes,
    }


def generate_estimate_slots(contractor, start_date: date, end_date: date):
    windows = list(
        ContractorEstimateAvailabilityWindow.objects.filter(contractor=contractor, is_active=True).order_by(
            "weekday", "start_time", "id"
        )
    )
    slots = []
    cursor = start_date
    now = timezone.now()
    earliest = now + timedelta(minutes=settings.ESTIMATE_APPOINTMENT_MIN_LEAD_MINUTES)
    while cursor <= end_date:
        weekday = cursor.weekday()
        for window in windows:
            if (
                window.weekday != weekday
                or window.duration_minutes < settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES
                or window.duration_minutes % settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES
                or window.start_time.minute % settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES
            ):
                continue
            zone = _window_zone(window)
            slot_start = datetime.combine(cursor, window.start_time, tzinfo=zone)
            window_end = datetime.combine(cursor, window.end_time, tzinfo=zone)
            while slot_start + timedelta(minutes=window.duration_minutes) <= window_end:
                if slot_start > earliest:
                    slots.append(_slot_payload(window, slot_start))
                slot_start += timedelta(minutes=window.duration_minutes)
        cursor += timedelta(days=1)
    occupied = list(OpportunityEstimateAppointment.objects.filter(
        contractor=contractor,
        status__in=ACTIVE_BLOCKING_STATUSES,
        scheduled_start__lt=datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.get_current_timezone()),
    ).exclude(
        status__in=[OpportunityEstimateAppointment.STATUS_REQUESTED, OpportunityEstimateAppointment.STATUS_PROPOSED],
        hold_expires_at__lte=now,
    ).exclude(
        status__in=[OpportunityEstimateAppointment.STATUS_REQUESTED, OpportunityEstimateAppointment.STATUS_PROPOSED],
        hold_expires_at__isnull=True,
    ))
    return [slot for slot in slots if not any(
        row.scheduled_start < parse_datetime(slot["scheduled_end"])
        and row.scheduled_start + timedelta(minutes=row.duration_minutes) > parse_datetime(slot["scheduled_start"])
        for row in occupied
    )]


def _serialize_appointment(appointment):
    return {
        "id": appointment.id,
        "status": appointment.status,
        "requested_by": appointment.requested_by,
        "appointment_type": appointment.appointment_type,
        "appointment_type_label": appointment.get_appointment_type_display(),
        "scheduled_start": appointment.scheduled_start.isoformat() if appointment.scheduled_start else "",
        "duration_minutes": appointment.duration_minutes,
        "timezone": appointment.timezone,
        "customer_message": appointment.customer_message,
        "notes": appointment.notes,
        "hold_expires_at": appointment.hold_expires_at.isoformat() if appointment.hold_expires_at else "",
    }


class PublicEstimateAvailabilityView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        contractor, error = _resolve_contractor_from_request(request)
        if error:
            return error
        start, end = _parse_range(request)
        slots = generate_estimate_slots(contractor, start, end)
        return Response(
            {
                "contractor_id": contractor.id,
                "contractor_name": contractor.business_name or "Selected contractor",
                "scheduling_increment_minutes": settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES,
                "minimum_lead_minutes": settings.ESTIMATE_APPOINTMENT_MIN_LEAD_MINUTES,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "slots": slots,
                "results": slots,
                "has_availability": bool(slots),
                "message": "" if slots else "No estimate availability has been published yet.",
            }
        )


class PublicEstimateAppointmentRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_estimate_appointment"

    def post(self, request):
        opportunity_id = request.data.get("opportunity_id") or request.data.get("source_id")
        token = _safe_text(request.data.get("authorization_token") or request.data.get("source_intake_token") or request.data.get("token"))
        opportunity = resolve_appointment_request_token(token, opportunity_id)
        if opportunity is None or not token:
            return Response({"detail": "Appointment request authorization is invalid."}, status=status.HTTP_404_NOT_FOUND)
        result, response_status = create_customer_estimate_request_for_opportunity(opportunity, request.data)
        return Response(result, status=response_status)


def create_customer_estimate_request_for_opportunity(opportunity: ContractorOpportunity, data: dict) -> tuple[dict, int]:
    opportunity = ContractorOpportunity.objects.select_related("directory_entry__claimed_by_contractor").get(pk=opportunity.pk)
    contractor = getattr(opportunity.directory_entry, "claimed_by_contractor", None)
    if contractor is None:
        return {"detail": "Contractor availability was not found."}, status.HTTP_404_NOT_FOUND

    preference = _safe_text(data.get("preference") or "slot")
    notes = _safe_text(data.get("customer_notes") or data.get("notes"))
    if preference in {"flexible", "contact_later"}:
        opportunity.estimate_preference = preference
        opportunity.estimate_preference_notes = notes
        opportunity.save(update_fields=["estimate_preference", "estimate_preference_notes", "updated_at"])
        return {
            "preference": preference,
            "message": "Your requested estimate appointment is awaiting contractor confirmation."
            if preference == "flexible"
            else "The contractor can contact you to schedule an estimate.",
        }, status.HTTP_201_CREATED

    if not (_safe_text(opportunity.homeowner_email) or _safe_text(opportunity.homeowner_phone)):
        return {"contact": ["Email or phone is required before requesting an appointment."]}, status.HTTP_400_BAD_REQUEST

    scheduled_start_raw = _safe_text(data.get("scheduled_start"))
    scheduled_start = parse_datetime(scheduled_start_raw) if scheduled_start_raw else None
    if scheduled_start is None:
        return {"scheduled_start": ["Choose an estimate time."]}, status.HTTP_400_BAD_REQUEST
    if timezone.is_naive(scheduled_start):
        scheduled_start = timezone.make_aware(scheduled_start, timezone.get_current_timezone())

    start_date = scheduled_start.date()
    matching_slot = None
    for slot in generate_estimate_slots(contractor, start_date, start_date):
        slot_start = parse_datetime(slot["scheduled_start"])
        if slot_start and slot_start == scheduled_start and slot["appointment_type"] == _safe_text(data.get("appointment_type")):
            matching_slot = slot
            break
    if matching_slot is None:
        return {"detail": "That appointment is no longer available."}, status.HTTP_409_CONFLICT

    service_location = ", ".join(
        part
        for part in [
            _safe_text(opportunity.project_address),
            _safe_text(opportunity.project_city),
            _safe_text(opportunity.project_state),
            _safe_text(opportunity.project_zip),
        ]
        if part
    )
    try:
        with transaction.atomic():
            if OpportunityEstimateAppointment.objects.filter(
                contractor=contractor,
                contractor_opportunity=opportunity,
                status__in=[
                    OpportunityEstimateAppointment.STATUS_REQUESTED,
                    OpportunityEstimateAppointment.STATUS_PROPOSED,
                    OpportunityEstimateAppointment.STATUS_SCHEDULED,
                    OpportunityEstimateAppointment.STATUS_CONFIRMED,
                ],
            ).exists():
                raise EstimateAppointmentError("This opportunity already has an active estimate appointment.", status_code=409)
            appointment = OpportunityEstimateAppointment.objects.create(
                contractor=contractor,
                source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
                contractor_opportunity=opportunity,
                opportunity_title=_safe_text(opportunity.project_title),
                opportunity_reference=f"Marketplace #{opportunity.id}",
                customer_name=_safe_text(opportunity.homeowner_name),
                customer_email=_safe_text(opportunity.homeowner_email),
                customer_phone=_safe_text(opportunity.homeowner_phone),
                service_location=service_location,
                appointment_type=matching_slot["appointment_type"],
                scheduled_start=scheduled_start,
                duration_minutes=int(matching_slot["duration_minutes"]),
                notes=notes,
                status=OpportunityEstimateAppointment.STATUS_REQUESTED,
                requested_by=OpportunityEstimateAppointment.REQUESTED_BY_CUSTOMER,
                timezone=matching_slot["timezone"] or "America/Chicago",
                customer_message="Your requested estimate appointment is awaiting contractor confirmation.",
                hold_expires_at=hold_expiration(),
            )
            reserve_appointment(appointment)
    except EstimateAppointmentError as exc:
        return exc.response_data(), exc.status_code
    opportunity.estimate_preference = ContractorOpportunity.ESTIMATE_PREFERENCE_SLOT
    opportunity.estimate_preference_notes = notes
    opportunity.save(update_fields=["estimate_preference", "estimate_preference_notes", "updated_at"])
    return {
        "appointment": _serialize_appointment(appointment),
        "message": "Your requested estimate appointment is awaiting contractor confirmation.",
    }, status.HTTP_201_CREATED
