from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from django.utils import timezone

from projects.models_customer_portal import NotificationRule, PropertyHomeSystem, SmartNotificationEvent
from projects.services.smart_notifications import create_smart_notification


DEFAULT_SERVICE_INTERVAL_MONTHS = {
    PropertyHomeSystem.SYSTEM_HVAC: 6,
    PropertyHomeSystem.SYSTEM_ROOF: 12,
    PropertyHomeSystem.SYSTEM_WATER_HEATER: 12,
    PropertyHomeSystem.SYSTEM_ELECTRICAL: 48,
    PropertyHomeSystem.SYSTEM_PLUMBING: 12,
    PropertyHomeSystem.SYSTEM_APPLIANCE: 12,
    PropertyHomeSystem.SYSTEM_WINDOWS_DOORS: 24,
    PropertyHomeSystem.SYSTEM_FOUNDATION: 12,
    PropertyHomeSystem.SYSTEM_EXTERIOR_SIDING: 6,
    PropertyHomeSystem.SYSTEM_SEPTIC_SEWER: 36,
    PropertyHomeSystem.SYSTEM_SOLAR: 12,
    PropertyHomeSystem.SYSTEM_POOL_SPA: 1,
    PropertyHomeSystem.SYSTEM_OTHER: 12,
}

STATUS_OVERDUE = "overdue"
STATUS_DUE_SOON = "due_soon"
STATUS_WARRANTY_EXPIRING = "warranty_expiring"
STATUS_WARRANTY_EXPIRED = "warranty_expired"
STATUS_LIFESPAN_ATTENTION = "lifespan_attention"
STATUS_CURRENT = "current"
STATUS_UNKNOWN = "unknown"


@dataclass(frozen=True)
class HomeSystemReminder:
    maintenance_status: str
    priority: str
    next_recommended_service_date: date | None
    days_until_due: int | None
    reminder_reason: str
    recommended_action: str
    service_interval_months: int | None
    reminder_source: str = "rule_based"


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def _system_label(system: PropertyHomeSystem) -> str:
    try:
        return system.display_name
    except Exception:
        return system.get_system_type_display() or "Home system"


def build_home_system_reminder(system: PropertyHomeSystem, *, today: date | None = None) -> HomeSystemReminder:
    today = today or timezone.localdate()
    interval = DEFAULT_SERVICE_INTERVAL_MONTHS.get(system.system_type, 12)
    label = _system_label(system)
    next_service = _add_months(system.last_service_date, interval) if system.last_service_date else None
    days_until_due = (next_service - today).days if next_service else None

    warranty_date = system.warranty_expiration_date
    if warranty_date:
        warranty_days = (warranty_date - today).days
        if warranty_days < 0:
            return HomeSystemReminder(
                maintenance_status=STATUS_WARRANTY_EXPIRED,
                priority="high",
                next_recommended_service_date=next_service,
                days_until_due=days_until_due,
                reminder_reason=f"{label} warranty expired on {warranty_date.isoformat()}.",
                recommended_action="Review warranty records or create a service request if help is needed.",
                service_interval_months=interval,
            )
        if warranty_days <= 90:
            return HomeSystemReminder(
                maintenance_status=STATUS_WARRANTY_EXPIRING,
                priority="medium",
                next_recommended_service_date=next_service,
                days_until_due=days_until_due,
                reminder_reason=f"{label} warranty expires in {warranty_days} days.",
                recommended_action="Review coverage and upload any missing warranty documents.",
                service_interval_months=interval,
            )

    if next_service:
        if days_until_due is not None and days_until_due < 0:
            return HomeSystemReminder(
                maintenance_status=STATUS_OVERDUE,
                priority="high",
                next_recommended_service_date=next_service,
                days_until_due=days_until_due,
                reminder_reason=f"{label} service is overdue based on a {interval}-month maintenance interval.",
                recommended_action="Mark it serviced if completed, or create a service request.",
                service_interval_months=interval,
            )
        lead_days = max(int(system.reminder_lead_days or 0), 0)
        if days_until_due is not None and days_until_due <= lead_days:
            return HomeSystemReminder(
                maintenance_status=STATUS_DUE_SOON,
                priority="medium",
                next_recommended_service_date=next_service,
                days_until_due=days_until_due,
                reminder_reason=f"{label} service is due within {lead_days} days.",
                recommended_action="Plan service or create a request before it becomes overdue.",
                service_interval_months=interval,
            )

    if system.install_date and system.expected_lifespan_years:
        lifespan_date = _add_months(system.install_date, int(system.expected_lifespan_years) * 12)
        lifespan_days = (lifespan_date - today).days
        if lifespan_days <= 365:
            return HomeSystemReminder(
                maintenance_status=STATUS_LIFESPAN_ATTENTION,
                priority="medium" if lifespan_days >= 0 else "high",
                next_recommended_service_date=next_service,
                days_until_due=days_until_due,
                reminder_reason=f"{label} is approaching its expected service life window.",
                recommended_action="Review condition, service history, and replacement planning.",
                service_interval_months=interval,
            )

    if next_service:
        return HomeSystemReminder(
            maintenance_status=STATUS_CURRENT,
            priority="low",
            next_recommended_service_date=next_service,
            days_until_due=days_until_due,
            reminder_reason=f"{label} maintenance appears current from the last recorded service date.",
            recommended_action="Keep records updated after the next service.",
            service_interval_months=interval,
        )

    return HomeSystemReminder(
        maintenance_status=STATUS_UNKNOWN,
        priority="low",
        next_recommended_service_date=None,
        days_until_due=None,
        reminder_reason=f"No service date is recorded for {label}.",
        recommended_action="Add a last service date or create a service request.",
        service_interval_months=interval,
    )


def reminder_should_notify(system: PropertyHomeSystem, reminder: HomeSystemReminder, *, now=None) -> bool:
    now = now or timezone.now()
    if not system.reminders_enabled or system.is_archived:
        return False
    if reminder.maintenance_status not in {STATUS_OVERDUE, STATUS_DUE_SOON, STATUS_WARRANTY_EXPIRING, STATUS_WARRANTY_EXPIRED, STATUS_LIFESPAN_ATTENTION}:
        return False
    if system.dismissed_until and system.dismissed_until > now:
        return False
    if system.next_notification_at and system.next_notification_at > now:
        return False
    if system.last_notified_at and system.reminder_frequency == PropertyHomeSystem.REMINDER_FREQUENCY_ONCE:
        return False
    return True


def _next_notification_at(system: PropertyHomeSystem, now):
    if system.reminder_frequency == PropertyHomeSystem.REMINDER_FREQUENCY_WEEKLY:
        return now + timedelta(days=7)
    if system.reminder_frequency == PropertyHomeSystem.REMINDER_FREQUENCY_MONTHLY:
        return now + timedelta(days=30)
    return None


def create_home_system_reminder_notification(system: PropertyHomeSystem, *, now=None):
    now = now or timezone.now()
    reminder = build_home_system_reminder(system, today=timezone.localdate())
    if not reminder_should_notify(system, reminder, now=now):
        return None
    profile = system.property_profile
    email = str(profile.customer_email or "").strip().lower()
    if not email:
        return None
    notification = create_smart_notification(
        event_type=SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER,
        recipient_email=email,
        homeowner=profile.homeowner,
        property_profile=profile,
        context={
            "system_name": _system_label(system),
            "maintenance_status": reminder.maintenance_status,
            "reminder_reason": reminder.reminder_reason,
            "recommended_action": reminder.recommended_action,
            "dedupe_key": f"home-system-reminder:{system.id}:{reminder.maintenance_status}",
        },
        action_url="/portal#property",
    )
    if notification:
        system.last_notified_at = now
        system.next_notification_at = _next_notification_at(system, now)
        system.reminder_sent_at = now
        system.reminder_channel = NotificationRule.CHANNEL_IN_APP
        system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_SENT
    else:
        system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_SKIPPED
    system.reminder_generated_at = now
    system.save(
        update_fields=[
            "last_notified_at",
            "next_notification_at",
            "reminder_sent_at",
            "reminder_channel",
            "reminder_delivery_status",
            "reminder_generated_at",
            "updated_at",
        ]
    )
    return notification
