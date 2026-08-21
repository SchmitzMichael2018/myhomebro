from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import timedelta, timezone as datetime_timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core import signing
from django.core.mail import EmailMessage
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from core.public_app_urls import build_public_app_url

from projects.models_contractor_discovery import (
    EstimateAppointmentDelivery,
    OpportunityEstimateAppointment,
    OpportunityEstimateAppointmentEvent,
)
from projects.services.estimate_appointments import appointment_end, is_hold_expired, transition_appointment
from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms


TOKEN_SALT = "projects.estimate-appointment-confirmation.v1"
PUBLIC_ERROR = "This appointment link is invalid or no longer available."


def schedule_version(appointment) -> str:
    raw = "|".join([
        str(appointment.pk), appointment.scheduled_start.isoformat(), str(appointment.duration_minutes),
        appointment.timezone or "", appointment.customer_email.lower().strip(),
        normalize_phone_to_e164(appointment.customer_phone) or "",
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def confirmation_token(appointment) -> str:
    return signing.dumps({
        "appointment_id": appointment.pk,
        "contractor_id": appointment.contractor_id,
        "schedule_version": schedule_version(appointment),
        "context": "customer_confirmation",
    }, salt=TOKEN_SALT, compress=True)


def resolve_confirmation_token(token: str, *, lock=False):
    try:
        payload = signing.loads(
            str(token or ""), salt=TOKEN_SALT,
            max_age=getattr(settings, "ESTIMATE_APPOINTMENT_CONFIRMATION_MAX_AGE", 604800),
        )
    except (signing.BadSignature, signing.SignatureExpired, TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("context") != "customer_confirmation":
        return None
    qs = OpportunityEstimateAppointment.objects.select_related("contractor")
    if lock:
        qs = qs.select_for_update()
    appointment = qs.filter(pk=payload.get("appointment_id"), contractor_id=payload.get("contractor_id")).first()
    if appointment is None or payload.get("schedule_version") != schedule_version(appointment):
        return None
    return appointment


def public_confirmation_url(appointment) -> str:
    return build_public_app_url(f"/appointment-confirmation/{confirmation_token(appointment)}")


def _zone(appointment):
    try:
        return ZoneInfo(appointment.timezone or "America/Chicago")
    except ZoneInfoNotFoundError:
        return ZoneInfo("America/Chicago")


def appointment_payload(appointment, *, include_token=False):
    local = appointment.scheduled_start.astimezone(_zone(appointment))
    result = {
        "id": appointment.id,
        "status": appointment.status,
        "display_status": "Awaiting customer confirmation" if appointment.status == appointment.STATUS_PROPOSED else appointment.get_status_display(),
        "scheduled_start": appointment.scheduled_start.isoformat(),
        "scheduled_end": appointment_end(appointment).isoformat(),
        "local_date": local.date().isoformat(),
        "local_time": local.strftime("%I:%M %p").lstrip("0"),
        "timezone": appointment.timezone,
        "timezone_label": f"{local.tzname() or appointment.timezone} ({appointment.timezone})",
        "appointment_type": appointment.appointment_type,
        "appointment_type_label": appointment.get_appointment_type_display(),
        "contractor_name": appointment.contractor.business_name or "Your contractor",
        "location": appointment.service_location,
        "confirmed": appointment.status == appointment.STATUS_CONFIRMED,
        "calendar_export_note": "Calendar export is one-way. Future MyHomeBro changes do not update an event you already imported.",
    }
    if include_token:
        token = confirmation_token(appointment)
        result["google_calendar_url"] = google_calendar_url(appointment)
        result["ics_url"] = build_public_app_url(
            f"/api/projects/public/estimate-appointments/{token}/calendar.ics"
        )
    return result


def _message(appointment, *, awaiting=False, reminder=False):
    local = appointment.scheduled_start.astimezone(_zone(appointment))
    when = local.strftime("%A, %B %d at %I:%M %p").replace(" at 0", " at ")
    prefix = "Reminder:" if reminder else "Please confirm" if awaiting else "Confirmed:"
    location = f" Location: {appointment.service_location}." if appointment.service_location else ""
    link = f" Manage appointment: {public_confirmation_url(appointment)}"
    return (
        f"MyHomeBro — {prefix} your {appointment.get_appointment_type_display().lower()} with "
        f"{appointment.contractor.business_name or 'your contractor'} on {when} "
        f"{local.tzname() or appointment.timezone}.{location}{link}"
    )


def suppress_obsolete_deliveries(appointment):
    version = schedule_version(appointment)
    now = timezone.now()
    return appointment.deliveries.filter(status__in=["pending", "failed", "processing"]).exclude(
        schedule_version=version
    ).update(status="suppressed", suppressed_at=now, error_code="schedule_superseded")


def suppress_future_deliveries(appointment, *, reason="appointment_terminal"):
    return appointment.deliveries.filter(status__in=["pending", "failed", "processing"]).update(
        status="suppressed", suppressed_at=timezone.now(), error_code=reason
    )


def _delivery(appointment, *, kind, offset, channel, recipient, scheduled_for):
    return EstimateAppointmentDelivery.objects.get_or_create(
        appointment=appointment, schedule_version=schedule_version(appointment), kind=kind,
        offset_minutes=offset, channel=channel, recipient=recipient,
        defaults={"scheduled_for": scheduled_for},
    )[0]


def prepare_confirmed_reminders(appointment, *, now=None):
    if appointment.status != appointment.STATUS_CONFIRMED:
        return []
    now = now or timezone.now()
    rows = []
    offsets = getattr(settings, "ESTIMATE_APPOINTMENT_REMINDER_OFFSETS_MINUTES", [1440, 120])
    recipients = []
    if appointment.customer_email:
        recipients.append(("email", appointment.customer_email.strip().lower()))
    phone = normalize_phone_to_e164(appointment.customer_phone)
    if phone:
        recipients.append(("sms", phone))
    for offset in offsets:
        due = appointment.scheduled_start - timedelta(minutes=int(offset))
        if due <= now:
            continue
        for channel, recipient in recipients:
            rows.append(_delivery(appointment, kind="reminder", offset=int(offset), channel=channel, recipient=recipient, scheduled_for=due))
    return rows


def _send_delivery(row):
    appointment = row.appointment
    now = timezone.now()
    if row.schedule_version != schedule_version(appointment) or appointment.status in {
        appointment.STATUS_CANCELLED, appointment.STATUS_DECLINED, appointment.STATUS_COMPLETED, appointment.STATUS_NO_SHOW,
    } or is_hold_expired(appointment):
        row.status, row.suppressed_at, row.error_code = "suppressed", now, "appointment_ineligible"
        row.save(update_fields=["status", "suppressed_at", "error_code", "updated_at"])
        return "suppressed"
    awaiting = row.kind == "confirmation" and appointment.status == appointment.STATUS_PROPOSED
    if row.kind == "reminder" and appointment.status != appointment.STATUS_CONFIRMED:
        row.status, row.suppressed_at, row.error_code = "suppressed", now, "not_confirmed"
        row.save(update_fields=["status", "suppressed_at", "error_code", "updated_at"])
        return "suppressed"
    row.status, row.attempted_at = "processing", now
    row.save(update_fields=["status", "attempted_at", "updated_at"])
    body = _message(appointment, awaiting=awaiting, reminder=row.kind == "reminder")
    try:
        if row.channel == "email":
            EmailMessage(
                subject="Confirm your Estimate appointment" if awaiting else "Estimate appointment reminder",
                body=body, from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None), to=[row.recipient],
            ).send(fail_silently=False)
            provider_reference = "django-email"
        else:
            result = send_compliant_sms(
                row.recipient, body, related_object=appointment, category="customer_care",
                dedupe_key=f"estimate_appointment:{row.id}:{row.schedule_version}",
            )
            if not result.get("ok"):
                row.status = "suppressed" if result.get("blocked") else "failed"
                row.error_code = result.get("reason_code") or "sms_failed"
                row.error_detail = result.get("detail", "")[:500]
                if row.status == "suppressed":
                    row.suppressed_at = now
                row.save(update_fields=["status", "error_code", "error_detail", "suppressed_at", "updated_at"])
                return row.status
            provider_reference = result.get("twilio_sid", "")
        row.status, row.sent_at, row.provider_reference = "sent", now, provider_reference
        row.error_code = row.error_detail = ""
        row.save(update_fields=["status", "sent_at", "provider_reference", "error_code", "error_detail", "updated_at"])
        return "sent"
    except Exception as exc:
        row.status, row.error_code, row.error_detail = "failed", "provider_error", str(exc)[:500]
        row.save(update_fields=["status", "error_code", "error_detail", "updated_at"])
        return "failed"


def send_confirmation_notice(appointment, *, force=False, now=None):
    if appointment.status != appointment.STATUS_PROPOSED or is_hold_expired(appointment):
        raise ValueError("Only an active appointment awaiting customer confirmation can be sent.")
    now = now or timezone.now()
    cooldown = timedelta(minutes=getattr(settings, "ESTIMATE_APPOINTMENT_CONFIRMATION_RESEND_COOLDOWN_MINUTES", 5))
    last = appointment.deliveries.filter(kind="confirmation", attempted_at__isnull=False).order_by("-attempted_at").first()
    if not force and last and last.attempted_at > now - cooldown:
        raise ValueError("A confirmation was sent recently. Please wait before resending.")
    last_attempt = appointment.deliveries.filter(kind="confirmation").aggregate(value=Max("offset_minutes"))["value"]
    attempt_number = 0 if last_attempt is None else int(last_attempt) + 1
    recipients = []
    if appointment.customer_email:
        recipients.append(("email", appointment.customer_email.strip().lower()))
    phone = normalize_phone_to_e164(appointment.customer_phone)
    if phone:
        recipients.append(("sms", phone))
    results = []
    for channel, recipient in recipients:
        row = _delivery(appointment, kind="confirmation", offset=attempt_number, channel=channel, recipient=recipient, scheduled_for=now)
        results.append(_send_delivery(row))
    return results


def send_confirmed_notice(appointment, *, now=None):
    if appointment.status != appointment.STATUS_CONFIRMED:
        return []
    now = now or timezone.now()
    recipients = []
    if appointment.customer_email:
        recipients.append(("email", appointment.customer_email.strip().lower()))
    phone = normalize_phone_to_e164(appointment.customer_phone)
    if phone:
        recipients.append(("sms", phone))
    results = []
    for channel, recipient in recipients:
        row = _delivery(appointment, kind="confirmation", offset=0, channel=channel, recipient=recipient, scheduled_for=now)
        results.append("sent" if row.status == "sent" else _send_delivery(row))
    prepare_confirmed_reminders(appointment, now=now)
    return results


@transaction.atomic
def public_customer_action(token, action, *, reason=""):
    appointment = resolve_confirmation_token(token, lock=True)
    if appointment is None:
        raise ValueError(PUBLIC_ERROR)
    if action == "confirm":
        if appointment.status == appointment.STATUS_CONFIRMED:
            return appointment
        if appointment.status != appointment.STATUS_PROPOSED or is_hold_expired(appointment):
            raise ValueError(PUBLIC_ERROR)
        appointment = transition_appointment(
            contractor=appointment.contractor, appointment_id=appointment.id, action="confirm",
            actor=None, actor_kind="customer",
        )
        prepare_confirmed_reminders(appointment)
        transaction.on_commit(
            lambda appointment_id=appointment.id: send_confirmed_notice(
                OpportunityEstimateAppointment.objects.get(pk=appointment_id)
            ),
            robust=True,
        )
        return appointment
    if action == "decline":
        if appointment.status == appointment.STATUS_DECLINED:
            return appointment
        if appointment.status != appointment.STATUS_PROPOSED:
            raise ValueError(PUBLIC_ERROR)
        appointment = transition_appointment(
            contractor=appointment.contractor, appointment_id=appointment.id, action="decline",
            actor=None, actor_kind="customer", reason=reason or "Declined by customer",
        )
        suppress_future_deliveries(appointment, reason="customer_declined")
        return appointment
    if action == "request_another_time":
        if appointment.status != appointment.STATUS_PROPOSED or is_hold_expired(appointment):
            raise ValueError(PUBLIC_ERROR)
        if not appointment.events.filter(event_type="request_another_time", after_values__schedule_version=schedule_version(appointment)).exists():
            OpportunityEstimateAppointmentEvent.objects.create(
                appointment=appointment, event_type="request_another_time", from_status=appointment.status,
                to_status=appointment.status, reason=reason[:1000], actor_kind="customer", actor=None,
                before_values={"scheduled_start": appointment.scheduled_start.isoformat()},
                after_values={"schedule_version": schedule_version(appointment), "contractor_review_required": True},
            )
        return appointment
    raise ValueError(PUBLIC_ERROR)


def google_calendar_url(appointment):
    start = appointment.scheduled_start.astimezone(datetime_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    end = appointment_end(appointment).astimezone(datetime_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    description = (
        f"MyHomeBro Estimate appointment with {appointment.contractor.business_name or 'your contractor'}. "
        f"Manage appointment: {public_confirmation_url(appointment)}"
    )
    return "https://calendar.google.com/calendar/render?" + urlencode({
        "action": "TEMPLATE", "text": "Estimate appointment", "dates": f"{start}/{end}",
        "ctz": appointment.timezone, "location": appointment.service_location, "details": description,
    })


def contractor_export_payload(appointment):
    if appointment.status != appointment.STATUS_CONFIRMED:
        return {}
    return {
        "google_calendar_url": google_calendar_url(appointment),
        "ics_url": build_public_app_url(f"/api/projects/estimate-appointments/{appointment.id}/calendar.ics"),
        "calendar_export_note": "Calendar export is one-way. Future MyHomeBro changes do not update an event you already imported.",
    }


def _ics_escape(value):
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def appointment_ics(appointment):
    start = appointment.scheduled_start.astimezone(datetime_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    end = appointment_end(appointment).astimezone(datetime_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stamp = timezone.now().astimezone(datetime_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    uid = f"estimate-appointment-{appointment.id}@myhomebro.com"
    description = (
        f"MyHomeBro Estimate appointment with {appointment.contractor.business_name or 'your contractor'}. "
        f"Manage appointment: {public_confirmation_url(appointment)}"
    )
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyHomeBro//Estimate Appointment//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}",
        f"DTSTART:{start}", f"DTEND:{end}", "STATUS:CONFIRMED", "SUMMARY:Estimate appointment",
        f"DESCRIPTION:{_ics_escape(description)}", f"LOCATION:{_ics_escape(appointment.service_location)}",
        "END:VEVENT", "END:VCALENDAR", "",
    ]
    return "\r\n".join(lines)


@dataclass
class DispatchCounts:
    eligible: int = 0
    sent: int = 0
    skipped: int = 0
    failed: int = 0
    suppressed: int = 0


def dispatch_due_reminders(*, dry_run=False, batch_size=100, now=None):
    now = now or timezone.now()
    counts = DispatchCounts()
    # Lazy backfill keeps deployment safe: existing future confirmed appointments
    # receive only still-future reminders, without sending during migration.
    if not dry_run:
        confirmed = OpportunityEstimateAppointment.objects.filter(
            status=OpportunityEstimateAppointment.STATUS_CONFIRMED,
            scheduled_start__gt=now,
        ).order_by("scheduled_start", "id")[: batch_size * 2]
        for appointment in confirmed:
            prepare_confirmed_reminders(appointment, now=now)
    ids = list(EstimateAppointmentDelivery.objects.filter(
        kind="reminder", status__in=["pending", "failed"], scheduled_for__lte=now,
    ).order_by("scheduled_for", "id").values_list("id", flat=True)[:batch_size])
    counts.eligible = len(ids)
    for delivery_id in ids:
        if dry_run:
            counts.skipped += 1
            continue
        try:
            with transaction.atomic():
                row = EstimateAppointmentDelivery.objects.select_for_update().select_related(
                    "appointment", "appointment__contractor"
                ).get(pk=delivery_id)
                if row.status not in {"pending", "failed"}:
                    counts.skipped += 1
                    continue
                outcome = _send_delivery(row)
            setattr(counts, outcome, getattr(counts, outcome) + 1)
        except Exception:
            counts.failed += 1
    return counts
