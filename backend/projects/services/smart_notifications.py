from __future__ import annotations

from dataclasses import dataclass

from projects.models_customer_portal import NotificationLog, NotificationRule, SmartNotification, SmartNotificationEvent


@dataclass(frozen=True)
class SmartNotificationTemplate:
    title: str
    message: str


DEFAULT_TEMPLATES = {
    SmartNotificationEvent.CUSTOMER_REQUEST_SUBMITTED: SmartNotificationTemplate(
        title="Request submitted",
        message="{request_title} was saved in your customer workspace.",
    ),
    SmartNotificationEvent.PROPERTY_PROFILE_UPDATED: SmartNotificationTemplate(
        title="Property profile updated",
        message="Your property profile was updated.",
    ),
    SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE: SmartNotificationTemplate(
        title="Agreement needs signature",
        message="{project_title} is waiting for a customer signature.",
    ),
    SmartNotificationEvent.ESCROW_NEEDS_FUNDING: SmartNotificationTemplate(
        title="Escrow needs funding",
        message="{project_title} is ready for escrow funding.",
    ),
    SmartNotificationEvent.MILESTONE_NEEDS_APPROVAL: SmartNotificationTemplate(
        title="Milestone needs approval",
        message="{milestone_title} is ready for review.",
    ),
    SmartNotificationEvent.PAYMENT_RECEIVED: SmartNotificationTemplate(
        title="Payment received",
        message="A payment was received for {project_title}.",
    ),
    SmartNotificationEvent.REQUEST_MARKETPLACE_READY: SmartNotificationTemplate(
        title="Request ready for marketplace",
        message="{request_title} is ready for marketplace routing.",
    ),
}


class _SafeFormatDict(dict):
    def __missing__(self, key):
        return ""


def _render(template: str, context: dict | None) -> str:
    return str(template or "").format_map(_SafeFormatDict(context or {})).strip()


def _default_rule(event_type: str, *, channel: str = NotificationRule.CHANNEL_IN_APP, audience: str = NotificationRule.AUDIENCE_CUSTOMER):
    template = DEFAULT_TEMPLATES.get(event_type) or SmartNotificationTemplate(
        title=str(event_type or "notification").replace("_", " ").title(),
        message="A customer workspace notification was created.",
    )
    rule, _created = NotificationRule.objects.get_or_create(
        event_type=event_type,
        channel=channel,
        audience=audience,
        defaults={
            "name": template.title,
            "title_template": template.title,
            "message_template": template.message,
        },
    )
    return rule


def create_smart_notification(
    *,
    event_type: str,
    recipient_email: str,
    context: dict | None = None,
    channel: str = NotificationRule.CHANNEL_IN_APP,
    audience: str = NotificationRule.AUDIENCE_CUSTOMER,
    action_url: str = "",
    homeowner=None,
    contractor=None,
    project=None,
    agreement=None,
    milestone=None,
    invoice=None,
    draw_request=None,
    customer_request=None,
    property_profile=None,
) -> SmartNotification | None:
    normalized_email = str(recipient_email or "").strip().lower()
    rule = _default_rule(event_type, channel=channel, audience=audience)
    log_metadata = {
        "context": context or {},
        "audience": audience,
        "action_url": action_url,
    }

    if not normalized_email or not rule.is_active:
        NotificationLog.objects.create(
            notification_rule=rule,
            event_type=event_type,
            channel=channel,
            status=NotificationLog.STATUS_SKIPPED,
            recipient_email=normalized_email,
            message="Missing recipient email." if not normalized_email else "Notification rule is inactive.",
            metadata=log_metadata,
        )
        return None

    title = _render(rule.title_template, context)
    message = _render(rule.message_template, context)
    notification = SmartNotification.objects.create(
        event_type=event_type,
        channel=channel,
        recipient_email=normalized_email,
        homeowner=homeowner,
        contractor=contractor,
        project=project,
        agreement=agreement,
        milestone=milestone,
        invoice=invoice,
        draw_request=draw_request,
        customer_request=customer_request,
        property_profile=property_profile,
        title=title,
        message=message,
        action_url=action_url,
        metadata=context or {},
    )
    NotificationLog.objects.create(
        smart_notification=notification,
        notification_rule=rule,
        event_type=event_type,
        channel=channel,
        status=NotificationLog.STATUS_CREATED,
        recipient_email=normalized_email,
        message=message,
        metadata=log_metadata,
    )
    return notification
