from __future__ import annotations

from projects.models_customer_portal import (
    CustomerNotificationPreference,
    default_customer_notification_categories,
    default_customer_notification_channels,
)


NOTIFICATION_PREFERENCE_GROUPS = {
    "Projects": [
        "project_request_updates",
        "contractor_responses",
        "agreement_updates",
        "milestone_updates",
        "invoice_payment_updates",
    ],
    "Maintenance": [
        "maintenance_due_soon",
        "maintenance_overdue",
        "maintenance_completed",
        "tenant_maintenance_requests",
        "work_order_updates",
    ],
    "Property": [
        "warranty_expiration",
        "lifecycle_events",
        "document_updates",
    ],
    "Supplies": [
        "recommended_supplies",
        "seasonal_supplies",
    ],
}


def normalize_notification_categories(value: dict | None = None) -> dict:
    defaults = default_customer_notification_categories()
    provided = value if isinstance(value, dict) else {}
    return {key: bool(provided.get(key, default)) for key, default in defaults.items()}


def normalize_notification_channels(value: dict | None = None) -> dict:
    defaults = default_customer_notification_channels()
    provided = value if isinstance(value, dict) else {}
    return {key: bool(provided.get(key, default)) for key, default in defaults.items()}


def notification_preferences_for_email(email: str, *, homeowner=None) -> CustomerNotificationPreference:
    normalized = str(email or "").strip().lower()
    preference, created = CustomerNotificationPreference.objects.get_or_create(
        customer_email=normalized,
        defaults={"homeowner": homeowner},
    )
    changed = False
    if homeowner is not None and preference.homeowner_id != getattr(homeowner, "id", None):
        preference.homeowner = homeowner
        changed = True
    categories = normalize_notification_categories(preference.category_preferences)
    channels = normalize_notification_channels(preference.channel_preferences)
    if categories != preference.category_preferences:
        preference.category_preferences = categories
        changed = True
    if channels != preference.channel_preferences:
        preference.channel_preferences = channels
        changed = True
    if changed and not created:
        preference.save(update_fields=["homeowner", "category_preferences", "channel_preferences", "updated_at"])
    return preference


def notification_preferences_payload(preference: CustomerNotificationPreference) -> dict:
    return {
        "categories": normalize_notification_categories(preference.category_preferences),
        "channels": normalize_notification_channels(preference.channel_preferences),
        "frequency": preference.frequency or CustomerNotificationPreference.FREQUENCY_IMMEDIATE,
        "groups": NOTIFICATION_PREFERENCE_GROUPS,
        "frequency_options": [
            {"value": value, "label": label}
            for value, label in CustomerNotificationPreference.FREQUENCY_CHOICES
        ],
    }


def notification_category_enabled(preference: CustomerNotificationPreference, category: str) -> bool:
    if preference.frequency == CustomerNotificationPreference.FREQUENCY_OFF:
        return False
    return bool(normalize_notification_categories(preference.category_preferences).get(category, True))


def notification_channel_enabled(preference: CustomerNotificationPreference, channel_key: str) -> bool:
    if preference.frequency == CustomerNotificationPreference.FREQUENCY_OFF:
        return False
    return bool(normalize_notification_channels(preference.channel_preferences).get(channel_key, False))
