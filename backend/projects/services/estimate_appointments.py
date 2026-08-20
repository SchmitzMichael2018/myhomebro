from __future__ import annotations

from datetime import timedelta, timezone as datetime_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from projects.models_contractor_discovery import (
    OpportunityEstimateAppointment,
    OpportunityEstimateAppointmentEvent,
    EstimateAppointmentReservation,
)
from projects.models_proposals import Proposal, ProposalActivity


class EstimateAppointmentError(Exception):
    def __init__(self, detail: str, *, status_code: int = 409, field: str | None = None):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.field = field

    def response_data(self):
        return {self.field: [self.detail]} if self.field else {"detail": self.detail}


ACTIVE_BLOCKING_STATUSES = {
    OpportunityEstimateAppointment.STATUS_REQUESTED,
    OpportunityEstimateAppointment.STATUS_PROPOSED,
    OpportunityEstimateAppointment.STATUS_SCHEDULED,
    OpportunityEstimateAppointment.STATUS_CONFIRMED,
}
TERMINAL_STATUSES = {
    OpportunityEstimateAppointment.STATUS_DECLINED,
    OpportunityEstimateAppointment.STATUS_CANCELLED,
    OpportunityEstimateAppointment.STATUS_COMPLETED,
    OpportunityEstimateAppointment.STATUS_NO_SHOW,
}
LEGAL_TRANSITIONS = {
    OpportunityEstimateAppointment.STATUS_REQUESTED: {
        OpportunityEstimateAppointment.STATUS_CONFIRMED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
        OpportunityEstimateAppointment.STATUS_DECLINED,
        OpportunityEstimateAppointment.STATUS_CANCELLED,
    },
    OpportunityEstimateAppointment.STATUS_PROPOSED: {
        OpportunityEstimateAppointment.STATUS_CONFIRMED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
        OpportunityEstimateAppointment.STATUS_DECLINED,
        OpportunityEstimateAppointment.STATUS_CANCELLED,
    },
    OpportunityEstimateAppointment.STATUS_SCHEDULED: {
        OpportunityEstimateAppointment.STATUS_SCHEDULED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
        OpportunityEstimateAppointment.STATUS_CANCELLED,
        OpportunityEstimateAppointment.STATUS_COMPLETED,
        OpportunityEstimateAppointment.STATUS_NO_SHOW,
    },
    OpportunityEstimateAppointment.STATUS_CONFIRMED: {
        OpportunityEstimateAppointment.STATUS_CONFIRMED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
        OpportunityEstimateAppointment.STATUS_CANCELLED,
        OpportunityEstimateAppointment.STATUS_COMPLETED,
        OpportunityEstimateAppointment.STATUS_NO_SHOW,
    },
}


def appointment_end(appointment):
    return appointment.scheduled_start + timedelta(minutes=appointment.duration_minutes)


def hold_expiration(now=None):
    return (now or timezone.now()) + timedelta(hours=settings.ESTIMATE_APPOINTMENT_HOLD_HOURS)


def is_hold_expired(appointment, now=None):
    return (
        appointment.status in {appointment.STATUS_REQUESTED, appointment.STATUS_PROPOSED}
        and (appointment.hold_expires_at is None or appointment.hold_expires_at <= (now or timezone.now()))
    )


def _validate_slot_alignment(scheduled_start, duration_minutes):
    increment = settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES
    if scheduled_start.second or scheduled_start.microsecond or scheduled_start.minute % increment:
        raise EstimateAppointmentError(f"Appointment times must align to {increment}-minute increments.", status_code=400)
    if duration_minutes < increment or duration_minutes % increment:
        raise EstimateAppointmentError(f"Appointment duration must use {increment}-minute increments.", status_code=400)


def validate_future_start(scheduled_start, *, timezone_name, now=None):
    """Validate an aware appointment instant against authoritative server time."""
    try:
        ZoneInfo(timezone_name or "America/Chicago")
    except ZoneInfoNotFoundError as exc:
        raise EstimateAppointmentError("Choose a valid appointment time zone.", status_code=400, field="timezone") from exc
    if scheduled_start is None or timezone.is_naive(scheduled_start):
        raise EstimateAppointmentError("Choose a future appointment date and time.", status_code=400, field="scheduled_start")
    earliest = (now or timezone.now()) + timedelta(minutes=settings.ESTIMATE_APPOINTMENT_MIN_LEAD_MINUTES)
    if scheduled_start <= earliest:
        raise EstimateAppointmentError("Choose a future appointment date and time.", status_code=400, field="scheduled_start")


def parse_appointment_start(value, *, timezone_name):
    try:
        zone = ZoneInfo(timezone_name or "America/Chicago")
    except ZoneInfoNotFoundError as exc:
        raise EstimateAppointmentError("Choose a valid appointment time zone.", status_code=400, field="timezone") from exc
    parsed = parse_datetime(str(value or "").strip())
    if parsed is None:
        raise EstimateAppointmentError("Choose a future appointment date and time.", status_code=400, field="scheduled_start")
    if timezone.is_naive(parsed):
        first = parsed.replace(tzinfo=zone, fold=0)
        second = parsed.replace(tzinfo=zone, fold=1)
        if first.utcoffset() != second.utcoffset():
            raise EstimateAppointmentError("That local time is ambiguous in the selected time zone. Choose another time.", status_code=400, field="scheduled_start")
        round_trip = first.astimezone(datetime_timezone.utc).astimezone(zone).replace(tzinfo=None)
        if round_trip != parsed:
            raise EstimateAppointmentError("That local time does not exist in the selected time zone. Choose another time.", status_code=400, field="scheduled_start")
        parsed = first
    return parsed.astimezone(datetime_timezone.utc)


def reservation_segments(scheduled_start, duration_minutes):
    _validate_slot_alignment(scheduled_start, duration_minutes)
    increment = settings.ESTIMATE_APPOINTMENT_SLOT_MINUTES
    return [scheduled_start + timedelta(minutes=offset) for offset in range(0, duration_minutes, increment)]


def conflicting_appointments(*, contractor, scheduled_start, duration_minutes, exclude_id=None):
    scheduled_end = scheduled_start + timedelta(minutes=duration_minutes)
    qs = OpportunityEstimateAppointment.objects.filter(
        contractor=contractor,
        status__in=ACTIVE_BLOCKING_STATUSES,
        scheduled_start__lt=scheduled_end,
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    now = timezone.now()
    qs = qs.exclude(
        status__in=[OpportunityEstimateAppointment.STATUS_REQUESTED, OpportunityEstimateAppointment.STATUS_PROPOSED],
        hold_expires_at__lte=now,
    ).exclude(
        status__in=[OpportunityEstimateAppointment.STATUS_REQUESTED, OpportunityEstimateAppointment.STATUS_PROPOSED],
        hold_expires_at__isnull=True,
    )
    # Portable overlap check: candidates start before our end; duration determines their end.
    return [row for row in qs if appointment_end(row) > scheduled_start]


def ensure_slot_available(*, contractor, scheduled_start, duration_minutes, exclude_id=None):
    _validate_slot_alignment(scheduled_start, duration_minutes)
    if conflicting_appointments(
        contractor=contractor,
        scheduled_start=scheduled_start,
        duration_minutes=duration_minutes,
        exclude_id=exclude_id,
    ):
        raise EstimateAppointmentError("That appointment time is no longer available.")


def reserve_appointment(appointment, *, replace=False):
    """Persist database-unique segments; legacy overlap validation remains authoritative too."""
    validate_future_start(appointment.scheduled_start, timezone_name=appointment.timezone)
    ensure_slot_available(
        contractor=appointment.contractor,
        scheduled_start=appointment.scheduled_start,
        duration_minutes=appointment.duration_minutes,
        exclude_id=appointment.id,
    )
    segments = reservation_segments(appointment.scheduled_start, appointment.duration_minutes)
    # Derived expiration is authoritative; cleanup is opportunistic and not required
    # from a background worker before the slot may be reused.
    EstimateAppointmentReservation.objects.filter(
        appointment__status__in=[
            OpportunityEstimateAppointment.STATUS_REQUESTED,
            OpportunityEstimateAppointment.STATUS_PROPOSED,
        ],
    ).filter(
        Q(appointment__hold_expires_at__lte=timezone.now())
        | Q(appointment__hold_expires_at__isnull=True)
    ).delete()
    if replace:
        appointment.reservations.all().delete()
    try:
        with transaction.atomic():
            EstimateAppointmentReservation.objects.bulk_create([
                EstimateAppointmentReservation(
                    contractor=appointment.contractor,
                    appointment=appointment,
                    segment_start=segment,
                ) for segment in segments
            ])
    except (IntegrityError, OperationalError) as exc:
        raise EstimateAppointmentError("That appointment time is no longer available.") from exc


def _local_when(appointment):
    try:
        zone = ZoneInfo(appointment.timezone or "America/Chicago")
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("America/Chicago")
    local_start = appointment.scheduled_start.astimezone(zone)
    return f"{local_start.strftime('%b')} {local_start.day}, {local_start.year} at {local_start.strftime('%I:%M %p').lstrip('0')} {local_start.tzname() or ''}".strip()


def customer_message_for(appointment, *, event="scheduled"):
    type_label = appointment.get_appointment_type_display().lower()
    location = f" at {appointment.service_location}" if appointment.service_location and appointment.appointment_type == appointment.TYPE_IN_PERSON else ""
    prefixes = {
        "proposed": "A new time was proposed for",
        "rescheduled": "This reschedules",
        "cancelled": "This cancels",
        "confirmed": "This confirms",
        "scheduled": "This confirms",
    }
    return (
        f"Hi {appointment.customer_name or 'there'}, {prefixes.get(event, 'Update for')} our {type_label} "
        f"for {appointment.opportunity_title or 'your project'} on {_local_when(appointment)}{location}."
    )


def available_actions(appointment):
    if is_hold_expired(appointment):
        return ["propose", "decline", "cancel"]
    status = appointment.status
    if status == appointment.STATUS_REQUESTED:
        return ["confirm", "propose", "decline", "cancel"]
    if status == appointment.STATUS_PROPOSED:
        return ["reschedule", "cancel"]
    if status in {appointment.STATUS_SCHEDULED, appointment.STATUS_CONFIRMED}:
        return ["reschedule", "cancel", "complete", "no_show"]
    return []


@transaction.atomic
def transition_appointment(*, contractor, appointment_id, action, actor, reason="", scheduled_start=None, duration_minutes=None, appointment_type=None, timezone_name=None, notes=None, actor_kind="contractor"):
    appointment = OpportunityEstimateAppointment.objects.select_for_update().filter(
        contractor=contractor, pk=appointment_id
    ).first()
    if appointment is None:
        raise EstimateAppointmentError("Estimate appointment not found.", status_code=404)

    if action == "confirm":
        validate_future_start(appointment.scheduled_start, timezone_name=appointment.timezone)
    expired_hold = is_hold_expired(appointment)
    if expired_hold and action == "confirm":
        raise EstimateAppointmentError("This request expired. Propose a new time before confirming it.")

    action_targets = {
        "confirm": appointment.STATUS_CONFIRMED,
        "propose": appointment.STATUS_PROPOSED,
        "reschedule": appointment.STATUS_PROPOSED,
        "decline": appointment.STATUS_DECLINED,
        "cancel": appointment.STATUS_CANCELLED,
        "complete": appointment.STATUS_COMPLETED,
        "no_show": appointment.STATUS_NO_SHOW,
    }
    target = action_targets.get(action)
    if target is None or target not in LEGAL_TRANSITIONS.get(appointment.status, set()):
        raise EstimateAppointmentError("That appointment action is not available in its current state.")
    if action in {"decline", "cancel"} and not str(reason or "").strip():
        raise EstimateAppointmentError("A reason is required.", status_code=400)
    if action in {"propose", "reschedule"}:
        if scheduled_start is None:
            raise EstimateAppointmentError("Choose a new appointment time.", status_code=400)
        duration_minutes = int(duration_minutes or appointment.duration_minutes)
        _validate_slot_alignment(scheduled_start, duration_minutes)
        validate_future_start(scheduled_start, timezone_name=timezone_name or appointment.timezone)

    before = {
        "status": appointment.status,
        "scheduled_start": appointment.scheduled_start.isoformat(),
        "proposed_start": appointment.proposed_start.isoformat() if appointment.proposed_start else "",
    }
    previous_status = appointment.status
    if action in {"propose", "reschedule"}:
        if appointment.original_scheduled_start is None:
            appointment.original_scheduled_start = appointment.scheduled_start
        appointment.scheduled_start = scheduled_start
        appointment.duration_minutes = duration_minutes
        appointment.proposed_start = scheduled_start if action == "propose" else None
        if appointment_type in dict(appointment.TYPE_CHOICES):
            appointment.appointment_type = appointment_type
        if timezone_name:
            appointment.timezone = str(timezone_name)[:64]
        if notes is not None:
            appointment.notes = str(notes)
    appointment.status = target
    now = timezone.now()
    if target == appointment.STATUS_CONFIRMED:
        appointment.confirmed_at = appointment.confirmed_at or now
        appointment.hold_expires_at = None
    elif target == appointment.STATUS_PROPOSED:
        appointment.hold_expires_at = hold_expiration(now)
        appointment.confirmed_at = None
    elif target == appointment.STATUS_DECLINED:
        appointment.declined_at = now
        appointment.decline_reason = str(reason or "").strip()
    appointment.customer_message = customer_message_for(
        appointment,
        event="rescheduled" if action == "reschedule" else action,
    )
    appointment.save()
    if target in TERMINAL_STATUSES:
        appointment.reservations.all().delete()
    elif action in {"propose", "reschedule"}:
        reserve_appointment(appointment, replace=True)
    OpportunityEstimateAppointmentEvent.objects.create(
        appointment=appointment,
        event_type=action,
        from_status=previous_status,
        to_status=target,
        reason=str(reason or "").strip(),
        before_values=before,
        after_values={
            "status": appointment.status,
            "scheduled_start": appointment.scheduled_start.isoformat(),
            "proposed_start": appointment.proposed_start.isoformat() if appointment.proposed_start else "",
        },
        actor_kind=actor_kind,
        actor=actor,
    )
    from projects.services.estimate_appointment_notifications import suppress_future_deliveries, suppress_obsolete_deliveries
    if target in TERMINAL_STATUSES:
        suppress_future_deliveries(appointment)
    elif action in {"propose", "reschedule"}:
        suppress_obsolete_deliveries(appointment)
    return appointment


@transaction.atomic
def attach_appointment(*, contractor, proposal_id, appointment_id, actor):
    proposal = Proposal.objects.select_for_update().filter(contractor=contractor, pk=proposal_id).first()
    if proposal is None:
        raise EstimateAppointmentError("Estimate not found.", status_code=404)
    if proposal.status in {Proposal.STATUS_CANCELLED, Proposal.STATUS_CONVERTED, Proposal.STATUS_ACCEPTED} or proposal.converted_agreement_id:
        raise EstimateAppointmentError("Appointments cannot be changed for this Estimate.")
    if proposal.estimate_appointment_id:
        if proposal.estimate_appointment_id == int(appointment_id):
            return proposal
        raise EstimateAppointmentError("This Estimate already has a linked appointment.")
    appointment = OpportunityEstimateAppointment.objects.select_for_update().filter(contractor=contractor, pk=appointment_id).first()
    if appointment is None:
        raise EstimateAppointmentError("Estimate appointment not found.", status_code=404)
    if appointment.status in TERMINAL_STATUSES:
        raise EstimateAppointmentError("A terminal appointment cannot be linked.")
    compatible = (
        (proposal.source_type == Proposal.SOURCE_LEAD and appointment.public_lead_id == proposal.source_id)
        or (proposal.source_type == Proposal.SOURCE_INTAKE and appointment.project_intake_id == proposal.source_id)
        or (proposal.source_type in {Proposal.SOURCE_OPPORTUNITY, Proposal.SOURCE_PROPERTY_WORK_ORDER} and appointment.contractor_opportunity_id == proposal.source_id)
        or (proposal.source_type == Proposal.SOURCE_DASHBOARD and appointment.direct_proposal_id == proposal.id)
    )
    if not compatible:
        raise EstimateAppointmentError("Estimate appointment not found.", status_code=404)
    linked_elsewhere = appointment.proposals.exclude(pk=proposal.pk).exists()
    if linked_elsewhere or (appointment.direct_proposal_id and appointment.direct_proposal_id != proposal.id):
        raise EstimateAppointmentError("This appointment is already owned by another Estimate.")
    proposal.estimate_appointment = appointment
    proposal.appointment_disposition = Proposal.APPOINTMENT_PLANNED
    proposal.save(update_fields=["estimate_appointment", "appointment_disposition", "updated_at"])
    ProposalActivity.objects.create(
        proposal=proposal,
        event_type=ProposalActivity.EVENT_APPOINTMENT_LINKED,
        message="Estimate appointment linked",
        actor=actor,
        metadata={"appointment_id": appointment.id, "status": appointment.status},
    )
    return proposal
