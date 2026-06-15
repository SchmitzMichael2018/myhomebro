from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models_customer_portal import CustomerNotificationCleanupPreference, NotificationRule, SmartNotification, SmartNotificationEvent


INFORMATIONAL_EVENT_DAYS = {
    SmartNotificationEvent.CUSTOMER_REQUEST_SUBMITTED: 30,
    SmartNotificationEvent.PROPERTY_PROFILE_UPDATED: 30,
    SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED: 30,
}

MAINTENANCE_EVENT_DAYS = {
    SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER: 60,
}

COMPLETED_WORK_EVENT_DAYS = {
    SmartNotificationEvent.MAINTENANCE_WORK_ORDER_COMPLETED: 90,
}

ACTION_REQUIRED_EVENTS = {
    SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE,
    SmartNotificationEvent.ESCROW_NEEDS_FUNDING,
    SmartNotificationEvent.MILESTONE_NEEDS_APPROVAL,
    SmartNotificationEvent.REIMBURSEMENT_SUBMITTED,
    SmartNotificationEvent.REIMBURSEMENT_HELD,
    SmartNotificationEvent.DISPUTE_OPENED,
    SmartNotificationEvent.DISPUTE_UPDATED,
    SmartNotificationEvent.CUSTOMER_BID_RECEIVED,
    SmartNotificationEvent.REQUEST_MARKETPLACE_READY,
}

FINANCIAL_OR_AGREEMENT_EVENTS = {
    SmartNotificationEvent.AGREEMENT_SIGNED,
    SmartNotificationEvent.ESCROW_FUNDED,
    SmartNotificationEvent.PAYMENT_RECEIVED,
    SmartNotificationEvent.REIMBURSEMENT_APPROVED,
    SmartNotificationEvent.REIMBURSEMENT_DENIED,
    SmartNotificationEvent.REIMBURSEMENT_RELEASED,
    SmartNotificationEvent.BID_AWARDED,
}

SAFE_ARCHIVE_DAYS = {
    **INFORMATIONAL_EVENT_DAYS,
    **MAINTENANCE_EVENT_DAYS,
    **COMPLETED_WORK_EVENT_DAYS,
}

MAINTENANCE_RESOLVED_VALUES = {"resolved", "completed", "dismissed", "current", "ignored"}


@dataclass
class NotificationAutoArchiveReport:
    scanned: int = 0
    eligible: int = 0
    archived: int = 0
    skipped: int = 0
    dry_run: bool = False
    details: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "scanned": self.scanned,
            "eligible": self.eligible,
            "archived": self.archived,
            "skipped": self.skipped,
            "dry_run": self.dry_run,
            "details": self.details,
        }


def cleanup_preferences_for_email(email: str, *, homeowner=None, now=None) -> CustomerNotificationCleanupPreference:
    normalized = str(email or "").strip().lower()
    defaults = {}
    if homeowner is not None:
        defaults["homeowner"] = homeowner
    preference, _created = CustomerNotificationCleanupPreference.objects.get_or_create(
        customer_email=normalized,
        defaults=defaults,
    )
    if homeowner is not None and preference.homeowner_id is None:
        preference.homeowner = homeowner
        preference.save(update_fields=["homeowner", "updated_at"])
    if preference.next_auto_archive_run_at is None:
        preference.next_auto_archive_run_at = next_cleanup_run_at(preference, now=now)
        preference.save(update_fields=["next_auto_archive_run_at", "updated_at"])
    return preference


def next_cleanup_run_at(preference: CustomerNotificationCleanupPreference, *, now=None):
    now = now or timezone.now()
    frequency = preference.auto_archive_frequency or CustomerNotificationCleanupPreference.FREQUENCY_DAILY
    if frequency == CustomerNotificationCleanupPreference.FREQUENCY_WEEKLY:
        return now + timedelta(days=7)
    if frequency == CustomerNotificationCleanupPreference.FREQUENCY_MONTHLY:
        return now + timedelta(days=30)
    return now + timedelta(days=1)


def cleanup_preferences_payload(preference: CustomerNotificationCleanupPreference) -> dict:
    return {
        "auto_archive_enabled": bool(preference.auto_archive_enabled),
        "auto_archive_frequency": preference.auto_archive_frequency or CustomerNotificationCleanupPreference.FREQUENCY_DAILY,
        "auto_archive_read_after_days": preference.auto_archive_read_after_days or 30,
        "auto_archive_maintenance_after_days": preference.auto_archive_maintenance_after_days or 60,
        "auto_archive_completed_work_after_days": preference.auto_archive_completed_work_after_days or 90,
        "last_auto_archive_run_at": preference.last_auto_archive_run_at.isoformat() if preference.last_auto_archive_run_at else "",
        "next_auto_archive_run_at": preference.next_auto_archive_run_at.isoformat() if preference.next_auto_archive_run_at else "",
    }


def thresholds_from_preference(preference: CustomerNotificationCleanupPreference | None) -> dict[str, int]:
    if preference is None:
        return dict(SAFE_ARCHIVE_DAYS)
    thresholds = dict(SAFE_ARCHIVE_DAYS)
    for event_type in INFORMATIONAL_EVENT_DAYS:
        thresholds[event_type] = int(preference.auto_archive_read_after_days or INFORMATIONAL_EVENT_DAYS[event_type])
    for event_type in MAINTENANCE_EVENT_DAYS:
        thresholds[event_type] = int(preference.auto_archive_maintenance_after_days or MAINTENANCE_EVENT_DAYS[event_type])
    for event_type in COMPLETED_WORK_EVENT_DAYS:
        thresholds[event_type] = int(preference.auto_archive_completed_work_after_days or COMPLETED_WORK_EVENT_DAYS[event_type])
    return thresholds


def _metadata_value(notification: SmartNotification, key: str) -> str:
    metadata = notification.metadata if isinstance(notification.metadata, dict) else {}
    return str(metadata.get(key) or "").strip().lower()


def notification_has_pending_action(notification: SmartNotification) -> bool:
    metadata = notification.metadata if isinstance(notification.metadata, dict) else {}
    if metadata.get("pending_action") is True or metadata.get("action_required") is True:
        return True
    status = str(metadata.get("action_status") or metadata.get("lifecycle_status") or "").strip().lower()
    return status in {"pending", "open", "needs_attention", "awaiting_customer", "awaiting_response"}


def notification_is_pinned(notification: SmartNotification) -> bool:
    metadata = notification.metadata if isinstance(notification.metadata, dict) else {}
    return bool(metadata.get("pinned") or metadata.get("is_pinned"))


def _maintenance_notification_is_safe(notification: SmartNotification) -> bool:
    status = _metadata_value(notification, "maintenance_status")
    if status in {"overdue", "due_soon", "warranty_expiring", "warranty_expired", "lifespan_attention"}:
        return False
    resolved = _metadata_value(notification, "resolved_at") or _metadata_value(notification, "dismissed_until")
    return bool(resolved or status in MAINTENANCE_RESOLVED_VALUES)


def auto_archive_reason(notification: SmartNotification, *, now=None, days_override: int | None = None, thresholds: dict[str, int] | None = None) -> str:
    now = now or timezone.now()
    if notification.status != SmartNotification.STATUS_READ:
        return ""
    if notification.archived_at or notification.status == SmartNotification.STATUS_DISMISSED:
        return ""
    if notification_has_pending_action(notification) or notification_is_pinned(notification):
        return ""

    event_type = str(notification.event_type or "")
    if event_type in ACTION_REQUIRED_EVENTS:
        return ""
    if event_type in FINANCIAL_OR_AGREEMENT_EVENTS:
        return ""
    thresholds = thresholds or SAFE_ARCHIVE_DAYS
    if event_type not in thresholds:
        return ""
    if event_type == SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER and not _maintenance_notification_is_safe(notification):
        return ""

    days = int(days_override if days_override is not None else thresholds[event_type])
    archive_after = notification.read_at or notification.created_at
    if not archive_after or archive_after > now - timedelta(days=days):
        return ""
    return f"auto_archive_read_{event_type}_{days}_days"


def auto_archive_customer_notifications(
    *,
    now=None,
    dry_run: bool = False,
    limit: int | None = None,
    customer_email: str = "",
    days: int | None = None,
    preference: CustomerNotificationCleanupPreference | None = None,
) -> NotificationAutoArchiveReport:
    now = now or timezone.now()
    report = NotificationAutoArchiveReport(dry_run=dry_run)
    queryset = (
        SmartNotification.objects.filter(
            channel=NotificationRule.CHANNEL_IN_APP,
            status=SmartNotification.STATUS_READ,
            archived_at__isnull=True,
        )
        .order_by("created_at", "id")
    )
    if customer_email:
        queryset = queryset.filter(recipient_email__iexact=customer_email.strip().lower())
    if limit:
        queryset = queryset[: int(limit)]

    thresholds = thresholds_from_preference(preference)
    for notification in queryset:
        report.scanned += 1
        reason = auto_archive_reason(notification, now=now, days_override=days, thresholds=thresholds)
        if not reason:
            report.skipped += 1
            continue
        report.eligible += 1
        report.details.append({"id": notification.id, "event_type": notification.event_type, "reason": reason})
        if dry_run:
            continue
        with transaction.atomic():
            notification.status = SmartNotification.STATUS_DISMISSED
            notification.archived_at = now
            notification.auto_archived_at = now
            notification.archive_reason = reason
            notification.save(update_fields=["status", "archived_at", "auto_archived_at", "archive_reason"])
        report.archived += 1
    return report


def run_due_customer_notification_cleanup(
    *,
    now=None,
    dry_run: bool = False,
    limit: int | None = None,
    customer_email: str = "",
    days: int | None = None,
    due_only: bool = False,
    force: bool = False,
) -> NotificationAutoArchiveReport:
    now = now or timezone.now()
    combined = NotificationAutoArchiveReport(dry_run=dry_run)
    preferences = CustomerNotificationCleanupPreference.objects.filter(auto_archive_enabled=True).order_by("customer_email")
    if customer_email:
        preferences = preferences.filter(customer_email__iexact=customer_email.strip().lower())
    if due_only and not force:
        preferences = preferences.filter(Q(next_auto_archive_run_at__isnull=True) | Q(next_auto_archive_run_at__lte=now))
    if limit:
        preferences = preferences[: int(limit)]

    for preference in preferences:
        result = auto_archive_customer_notifications(
            now=now,
            dry_run=dry_run,
            customer_email=preference.customer_email,
            days=days,
            preference=preference,
        )
        combined.scanned += result.scanned
        combined.eligible += result.eligible
        combined.archived += result.archived
        combined.skipped += result.skipped
        combined.details.extend(result.details)
        if not dry_run:
            preference.last_auto_archive_run_at = now
            preference.next_auto_archive_run_at = next_cleanup_run_at(preference, now=now)
            preference.save(update_fields=["last_auto_archive_run_at", "next_auto_archive_run_at", "updated_at"])
    return combined
