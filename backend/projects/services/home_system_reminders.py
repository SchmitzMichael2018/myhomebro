from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

from projects.models_customer_portal import NotificationLog, NotificationRule, PropertyHomeSystem, SmartNotificationEvent
from projects.services.customer_notification_preferences import (
    notification_category_enabled,
    notification_channel_enabled,
    notification_preferences_for_email,
)
from projects.services.invites_delivery import send_postmark_email
from projects.services.sms_service import get_sms_status_payload
from projects.services.sms_service import send_compliant_sms
from projects.services.smart_notifications import create_smart_notification
from projects.services.home_system_subtypes import (
    SUBTYPE_AIR_CONDITIONER,
    SUBTYPE_AIR_HANDLER,
    SUBTYPE_DISHWASHER,
    SUBTYPE_DRYER,
    SUBTYPE_FREEZER,
    SUBTYPE_FURNACE,
    SUBTYPE_HEAT_PUMP,
    SUBTYPE_MICROWAVE,
    SUBTYPE_OVEN,
    SUBTYPE_POOL_FILTER,
    SUBTYPE_POOL_PUMP,
    SUBTYPE_RANGE,
    SUBTYPE_REFRIGERATOR,
    SUBTYPE_SPA,
    SUBTYPE_SUMP_PUMP,
    SUBTYPE_WASHER,
    SUBTYPE_WATER_HEATER,
    SUBTYPE_WATER_SOFTENER,
    infer_home_system_subtype,
)


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

SUBTYPE_SERVICE_INTERVAL_MONTHS = {
    SUBTYPE_REFRIGERATOR: 6,
    SUBTYPE_DRYER: 12,
    SUBTYPE_WASHER: 12,
    SUBTYPE_DISHWASHER: 12,
    SUBTYPE_OVEN: 12,
    SUBTYPE_RANGE: 12,
    SUBTYPE_MICROWAVE: 12,
    SUBTYPE_FREEZER: 12,
    SUBTYPE_WATER_SOFTENER: 1,
    SUBTYPE_SUMP_PUMP: 12,
    SUBTYPE_WATER_HEATER: 12,
    SUBTYPE_FURNACE: 6,
    SUBTYPE_AIR_CONDITIONER: 6,
    SUBTYPE_HEAT_PUMP: 6,
    SUBTYPE_AIR_HANDLER: 6,
    SUBTYPE_POOL_FILTER: 1,
    SUBTYPE_POOL_PUMP: 3,
    SUBTYPE_SPA: 1,
}

STATUS_OVERDUE = "overdue"
STATUS_DUE_SOON = "due_soon"
STATUS_WARRANTY_EXPIRING = "warranty_expiring"
STATUS_WARRANTY_EXPIRED = "warranty_expired"
STATUS_LIFESPAN_ATTENTION = "lifespan_attention"
STATUS_CURRENT = "current"
STATUS_UNKNOWN = "unknown"
ACTIONABLE_STATUSES = {
    STATUS_OVERDUE,
    STATUS_DUE_SOON,
    STATUS_WARRANTY_EXPIRING,
    STATUS_WARRANTY_EXPIRED,
    STATUS_LIFESPAN_ATTENTION,
}


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


@dataclass
class HomeSystemReminderDispatchResult:
    scanned: int = 0
    eligible: int = 0
    sent: int = 0
    skipped: int = 0
    errors: int = 0
    dry_run: bool = False
    details: list[dict] | None = None

    def as_dict(self) -> dict:
        return {
            "scanned": self.scanned,
            "eligible": self.eligible,
            "sent": self.sent,
            "skipped": self.skipped,
            "errors": self.errors,
            "dry_run": self.dry_run,
            "details": self.details or [],
        }


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
    subtype = infer_home_system_subtype(system)
    interval = SUBTYPE_SERVICE_INTERVAL_MONTHS.get(subtype, DEFAULT_SERVICE_INTERVAL_MONTHS.get(system.system_type, 12))
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
    if reminder.maintenance_status not in ACTIONABLE_STATUSES:
        return False
    if system.dismissed_until and system.dismissed_until > now:
        return False
    if system.resolved_at and system.updated_at and system.resolved_at >= system.updated_at - timedelta(seconds=2):
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


def _reminder_anchor(system: PropertyHomeSystem, reminder: HomeSystemReminder) -> str:
    if reminder.next_recommended_service_date:
        return reminder.next_recommended_service_date.isoformat()
    if system.warranty_expiration_date:
        return system.warranty_expiration_date.isoformat()
    if system.install_date and system.expected_lifespan_years:
        return _add_months(system.install_date, int(system.expected_lifespan_years) * 12).isoformat()
    return "unknown"


def _frequency_window(system: PropertyHomeSystem, now) -> str:
    if system.reminder_frequency == PropertyHomeSystem.REMINDER_FREQUENCY_WEEKLY:
        year, week, _weekday = now.date().isocalendar()
        return f"{year}-W{week}"
    if system.reminder_frequency == PropertyHomeSystem.REMINDER_FREQUENCY_MONTHLY:
        return now.strftime("%Y-%m")
    return "once"


def _reminder_category(reminder: HomeSystemReminder) -> str:
    if reminder.maintenance_status == STATUS_DUE_SOON:
        return "maintenance_due_soon"
    if reminder.maintenance_status == STATUS_OVERDUE:
        return "maintenance_overdue"
    if reminder.maintenance_status in {STATUS_WARRANTY_EXPIRING, STATUS_WARRANTY_EXPIRED}:
        return "warranty_expiration"
    return "lifecycle_events"


def _portal_base_url() -> str:
    return (
        str(getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "") or "").strip()
        or str(getattr(settings, "FRONTEND_URL", "") or "").strip()
        or str(getattr(settings, "SITE_URL", "") or "").strip()
        or "https://www.myhomebro.com"
    ).rstrip("/")


def _reminder_action_url(system: PropertyHomeSystem) -> str:
    return f"#reminder:{system.id}"


def _reminder_portal_link(system: PropertyHomeSystem) -> str:
    return f"{_portal_base_url()}/portal#reminder:{system.id}"


def _system_supplies(system: PropertyHomeSystem, preference=None) -> list[dict]:
    if preference is not None and not notification_category_enabled(preference, "recommended_supplies"):
        return []
    from projects.services.customer_portal_supplies import build_home_system_supply_recommendations

    return build_home_system_supply_recommendations([system])


def _supply_lines(supplies: list[dict]) -> list[str]:
    lines = []
    for recommendation in supplies[:5]:
        title = recommendation.get("title") or recommendation.get("supply_name") or "Recommended supply"
        interval = recommendation.get("suggested_interval") or ""
        lines.append(f"- {title}{f' ({interval})' if interval else ''}")
    return lines


def _supply_html(supplies: list[dict]) -> str:
    if not supplies:
        return ""
    items = []
    for recommendation in supplies[:5]:
        title = recommendation.get("title") or recommendation.get("supply_name") or "Recommended supply"
        provider_links = recommendation.get("provider_links") or []
        links = " ".join(
            f"<a href='{link.get('url', '')}'>{link.get('label') or link.get('provider')}</a>"
            for link in provider_links
            if link.get("url")
        )
        items.append(f"<li><strong>{title}</strong>{f'<br />Shop: {links}' if links else ''}</li>")
    return "<h3>Recommended Supplies</h3><ul>" + "".join(items) + "</ul>"


def _send_reminder_email(system: PropertyHomeSystem, reminder: HomeSystemReminder, supplies: list[dict]) -> tuple[bool, str]:
    profile = system.property_profile
    recipient = str(profile.customer_email or "").strip().lower()
    if not recipient:
        return False, "Customer email missing."
    label = _system_label(system)
    subject = f"MyHomeBro reminder: {label} needs attention"
    supply_lines = _supply_lines(supplies)
    text_body = "\n".join(
        [
            f"{label}",
            "",
            reminder.reminder_reason,
            reminder.recommended_action,
            "",
            *(
                ["Recommended Supplies:", *supply_lines, ""]
                if supply_lines
                else []
            ),
            f"View reminder: {_reminder_portal_link(system)}",
        ]
    )
    html_body = (
        "<div style='font-family:Arial,sans-serif'>"
        f"<h2>{label}</h2>"
        f"<p>{reminder.reminder_reason}</p>"
        f"<p>{reminder.recommended_action}</p>"
        f"{_supply_html(supplies)}"
        f"<p><a href='{_reminder_portal_link(system)}'>View reminder</a></p>"
        "</div>"
    )
    return send_postmark_email(to_email=recipient, subject=subject, text_body=text_body, html_body=html_body)


def _send_reminder_sms(system: PropertyHomeSystem, reminder: HomeSystemReminder, supplies: list[dict], *, now=None) -> dict:
    profile = system.property_profile
    phone = str(getattr(profile.homeowner, "phone_number", "") or "").strip()
    label = _system_label(system)
    supply_note = "\n\nRecommended supplies available." if supplies else ""
    body = f"MyHomeBro: {label} maintenance needs attention.\n{supply_note}\n\nView:\n{_reminder_portal_link(system)}"
    return send_compliant_sms(
        phone,
        body,
        related_object=profile.homeowner,
        category="customer_care",
        dedupe_key=f"home-system-reminder-sms:{system.id}:{_frequency_window(system, now or timezone.now())}",
    )


def _log_reminder_delivery(*, system: PropertyHomeSystem, reminder: HomeSystemReminder, channel: str, ok: bool, message: str, notification=None):
    NotificationLog.objects.create(
        smart_notification=notification,
        event_type=SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER,
        channel=channel,
        status=NotificationLog.STATUS_CREATED if ok else NotificationLog.STATUS_FAILED,
        recipient_email=str(system.property_profile.customer_email or "").strip().lower(),
        message=message or "",
        metadata={
            "system_id": system.id,
            "maintenance_status": reminder.maintenance_status,
            "property_profile_id": system.property_profile_id,
        },
    )


def _enabled_channels(system: PropertyHomeSystem, reminder: HomeSystemReminder) -> tuple[list[str], list[str], object | None]:
    channels: list[str] = []
    skipped: list[str] = []
    profile = system.property_profile
    email = str(profile.customer_email or "").strip()
    preference = notification_preferences_for_email(email, homeowner=profile.homeowner) if email else None
    category = _reminder_category(reminder)
    if preference is None or not notification_category_enabled(preference, category):
        return [], ["category_disabled"], preference
    if notification_channel_enabled(preference, "in_app_enabled"):
        channels.append(NotificationRule.CHANNEL_IN_APP)
    if system.email_reminders_enabled and email and notification_channel_enabled(preference, "email_enabled"):
        channels.append(NotificationRule.CHANNEL_EMAIL)
    elif system.email_reminders_enabled and notification_channel_enabled(preference, "email_enabled"):
        skipped.append("email_missing")

    if system.sms_reminders_enabled and notification_channel_enabled(preference, "sms_enabled"):
        sms_status = get_sms_status_payload(homeowner=profile.homeowner)
        if not sms_status.get("sms_enabled"):
            skipped.append("sms_consent_missing")
        else:
            channels.append(NotificationRule.CHANNEL_SMS)
    return channels, skipped, preference


def _deliver_home_system_reminder(
    system: PropertyHomeSystem,
    reminder: HomeSystemReminder,
    *,
    channels: list[str],
    preference,
    now,
) -> list[object]:
    profile = system.property_profile
    email = str(profile.customer_email or "").strip().lower()
    supplies = _system_supplies(system, preference)
    deliveries: list[object] = []
    delivered_channels: list[str] = []

    for channel in channels:
        notification = None
        delivered = False
        channel_message = ""
        if channel == NotificationRule.CHANNEL_IN_APP:
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
                    "property_name": profile.display_name or profile.address_line1 or "your property",
                    "dedupe_key": (
                        "home-system-reminder:"
                        f"{system.id}:{reminder.maintenance_status}:{_reminder_anchor(system, reminder)}:"
                        f"{channel}:{_frequency_window(system, now)}"
                    ),
                },
                channel=NotificationRule.CHANNEL_IN_APP,
                action_url=_reminder_action_url(system),
            )
            delivered = bool(notification)
            channel_message = "In-app notification created." if delivered else "Duplicate in-app notification skipped."
            if notification:
                notification.metadata = {
                    **(notification.metadata or {}),
                    "home_system_id": system.id,
                    "reminder_status": reminder.maintenance_status,
                    "supply_count": len(supplies),
                }
                notification.save(update_fields=["metadata"])
        elif channel == NotificationRule.CHANNEL_EMAIL:
            ok, message = _send_reminder_email(system, reminder, supplies)
            delivered = ok
            channel_message = message
            _log_reminder_delivery(system=system, reminder=reminder, channel=NotificationRule.CHANNEL_EMAIL, ok=ok, message=message)
        elif channel == NotificationRule.CHANNEL_SMS:
            result = _send_reminder_sms(system, reminder, supplies, now=now)
            delivered = bool(result.get("ok"))
            channel_message = result.get("detail") or result.get("reason_code") or ""
            _log_reminder_delivery(system=system, reminder=reminder, channel=NotificationRule.CHANNEL_SMS, ok=delivered, message=channel_message)

        if delivered:
            delivered_channels.append(channel)
            deliveries.append(notification or {"channel": channel, "message": channel_message})

    if delivered_channels:
        system.last_notified_at = now
        system.next_notification_at = _next_notification_at(system, now)
        system.reminder_sent_at = now
        system.reminder_channel = ",".join(delivered_channels)
        system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_SENT
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
    return deliveries


def create_home_system_reminder_notification(system: PropertyHomeSystem, *, now=None, channel=NotificationRule.CHANNEL_IN_APP):
    now = now or timezone.now()
    reminder = build_home_system_reminder(system, today=timezone.localdate())
    if not reminder_should_notify(system, reminder, now=now):
        return None
    profile = system.property_profile
    email = str(profile.customer_email or "").strip().lower()
    if not email:
        return None
    preference = notification_preferences_for_email(email, homeowner=profile.homeowner)
    if not notification_category_enabled(preference, _reminder_category(reminder)):
        return None
    channel_preference_key = {
        NotificationRule.CHANNEL_IN_APP: "in_app_enabled",
        NotificationRule.CHANNEL_EMAIL: "email_enabled",
        NotificationRule.CHANNEL_SMS: "sms_enabled",
    }.get(channel)
    if not channel_preference_key or not notification_channel_enabled(preference, channel_preference_key):
        return None
    deliveries = _deliver_home_system_reminder(system, reminder, channels=[channel], preference=preference, now=now)
    return deliveries[0] if deliveries else None


def dispatch_home_system_reminders(
    *,
    dry_run: bool = False,
    channel: str | None = None,
    limit: int | None = None,
    property_id: int | None = None,
    customer_email: str = "",
    now=None,
) -> HomeSystemReminderDispatchResult:
    now = now or timezone.now()
    result = HomeSystemReminderDispatchResult(dry_run=dry_run, details=[])
    queryset = (
        PropertyHomeSystem.objects.select_related("property_profile", "property_profile__homeowner")
        .filter(is_archived=False, reminders_enabled=True)
        .order_by("id")
    )
    if property_id:
        queryset = queryset.filter(property_profile_id=property_id)
    if customer_email:
        queryset = queryset.filter(property_profile__customer_email__iexact=customer_email.strip().lower())
    if limit:
        queryset = queryset[: int(limit)]

    for system in queryset:
        result.scanned += 1
        try:
            reminder = build_home_system_reminder(system, today=timezone.localdate())
            if not reminder_should_notify(system, reminder, now=now):
                result.skipped += 1
                result.details.append({"system_id": system.id, "status": reminder.maintenance_status, "result": "skipped", "reason": "not_eligible"})
                continue
            channels, skipped_reasons, _preference = _enabled_channels(system, reminder)
            if channel:
                channels = [row for row in channels if row == channel or (channel == "email" and row == NotificationRule.CHANNEL_EMAIL) or (channel == "sms" and row == NotificationRule.CHANNEL_SMS)]
            if not channels:
                result.skipped += 1
                system.reminder_generated_at = now
                system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_SKIPPED
                system.reminder_channel = channel or ",".join(skipped_reasons)
                if not dry_run:
                    system.save(update_fields=["reminder_generated_at", "reminder_delivery_status", "reminder_channel", "updated_at"])
                result.details.append({"system_id": system.id, "status": reminder.maintenance_status, "result": "skipped", "reason": ",".join(skipped_reasons) or "no_enabled_channel"})
                continue

            result.eligible += 1
            if dry_run:
                result.details.append({"system_id": system.id, "status": reminder.maintenance_status, "result": "dry_run", "channels": channels})
                continue

            preference = _enabled_channels(system, reminder)[2]
            deliveries = _deliver_home_system_reminder(system, reminder, channels=channels, preference=preference, now=now)
            if deliveries:
                result.sent += 1
                result.details.append({"system_id": system.id, "status": reminder.maintenance_status, "result": "sent", "channels": channels})
            else:
                result.skipped += 1
                result.details.append({"system_id": system.id, "status": reminder.maintenance_status, "result": "skipped", "reason": "duplicate_or_frequency"})
        except Exception as exc:
            result.errors += 1
            result.details.append({"system_id": getattr(system, "id", None), "result": "error", "error": str(exc)})
    return result
