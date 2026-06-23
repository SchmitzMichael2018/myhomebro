from __future__ import annotations

import logging
from dataclasses import dataclass

from projects.models_customer_portal import NotificationLog, NotificationRule, SmartNotification, SmartNotificationEvent
from projects.services.recipient_validation import normalize_valid_email

logger = logging.getLogger(__name__)


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
    SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED: SmartNotificationTemplate(
        title="Request routed to contractors",
        message="{request_title} was routed to eligible contractors in your area.",
    ),
    SmartNotificationEvent.CUSTOMER_BID_RECEIVED: SmartNotificationTemplate(
        title="New bid received",
        message="{contractor_name} submitted a bid for {request_title}.",
    ),
    SmartNotificationEvent.BID_AWARDED: SmartNotificationTemplate(
        title="Contractor selected",
        message="{contractor_name} was selected for {project_title}.",
    ),
    SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE: SmartNotificationTemplate(
        title="Agreement needs signature",
        message="{project_title} is waiting for a customer signature.",
    ),
    SmartNotificationEvent.AGREEMENT_SIGNED: SmartNotificationTemplate(
        title="Agreement signed",
        message="{project_title} is fully signed.",
    ),
    SmartNotificationEvent.ESCROW_NEEDS_FUNDING: SmartNotificationTemplate(
        title="Escrow needs funding",
        message="{project_title} is ready for escrow funding.",
    ),
    SmartNotificationEvent.ESCROW_FUNDED: SmartNotificationTemplate(
        title="Escrow funded",
        message="Escrow funding was received for {project_title}.",
    ),
    SmartNotificationEvent.MILESTONE_NEEDS_APPROVAL: SmartNotificationTemplate(
        title="Milestone needs approval",
        message="{milestone_title} is ready for review.",
    ),
    SmartNotificationEvent.PAYMENT_RECEIVED: SmartNotificationTemplate(
        title="Payment received",
        message="A payment was received for {project_title}.",
    ),
    SmartNotificationEvent.REIMBURSEMENT_SUBMITTED: SmartNotificationTemplate(
        title="Reimbursement needs review",
        message="{reimbursement_title} is ready for your review.",
    ),
    SmartNotificationEvent.REIMBURSEMENT_APPROVED: SmartNotificationTemplate(
        title="Reimbursement approved",
        message="{reimbursement_title} was approved.",
    ),
    SmartNotificationEvent.REIMBURSEMENT_DENIED: SmartNotificationTemplate(
        title="Reimbursement denied",
        message="{reimbursement_title} was denied.",
    ),
    SmartNotificationEvent.REIMBURSEMENT_RELEASED: SmartNotificationTemplate(
        title="Reimbursement released",
        message="{reimbursement_title} was released from escrow.",
    ),
    SmartNotificationEvent.REIMBURSEMENT_HELD: SmartNotificationTemplate(
        title="Reimbursement on hold",
        message="{reimbursement_title} was placed on hold.",
    ),
    SmartNotificationEvent.DISPUTE_OPENED: SmartNotificationTemplate(
        title="Dispute opened",
        message="A dispute was opened for {project_title}.",
    ),
    SmartNotificationEvent.DISPUTE_UPDATED: SmartNotificationTemplate(
        title="Dispute updated",
        message="A dispute was updated for {project_title}.",
    ),
    SmartNotificationEvent.DISPUTE_RESOLVED: SmartNotificationTemplate(
        title="Dispute resolved",
        message="A dispute was resolved for {project_title}.",
    ),
    SmartNotificationEvent.REQUEST_MARKETPLACE_READY: SmartNotificationTemplate(
        title="Request ready for marketplace",
        message="{request_title} is ready for marketplace routing.",
    ),
    SmartNotificationEvent.MAINTENANCE_WORK_ORDER_SCHEDULED: SmartNotificationTemplate(
        title="Maintenance visit scheduled",
        message="{work_order_title} is scheduled for {project_title}.",
    ),
    SmartNotificationEvent.MAINTENANCE_WORK_ORDER_COMPLETED: SmartNotificationTemplate(
        title="Maintenance visit completed",
        message="{work_order_title} was completed for {project_title}.",
    ),
    SmartNotificationEvent.MAINTENANCE_CONTRACT_CANCELLED: SmartNotificationTemplate(
        title="Maintenance contract cancelled",
        message="{project_title} maintenance service was cancelled.",
    ),
    SmartNotificationEvent.HOME_SYSTEM_MAINTENANCE_REMINDER: SmartNotificationTemplate(
        title="{system_name} needs attention",
        message="{reminder_reason} {recommended_action}",
    ),
    SmartNotificationEvent.TENANT_MAINTENANCE_REQUEST_SUBMITTED: SmartNotificationTemplate(
        title="New tenant maintenance request",
        message="{request_reference} was submitted for {property_name}.",
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
    raw_email = str(recipient_email or "").strip().lower()
    normalized_email = normalize_valid_email(raw_email)
    rule = _default_rule(event_type, channel=channel, audience=audience)
    dedupe_key = str((context or {}).get("dedupe_key") or "").strip()
    log_metadata = {
        "context": context or {},
        "audience": audience,
        "action_url": action_url,
    }

    if not normalized_email or not rule.is_active:
        if not normalized_email:
            logger.warning("Skipped smart notification for event_type=%s: invalid or missing recipient email.", event_type)
        NotificationLog.objects.create(
            notification_rule=rule,
            event_type=event_type,
            channel=channel,
            status=NotificationLog.STATUS_SKIPPED,
            recipient_email=normalized_email,
            message=(
                "Invalid or missing recipient email."
                if not normalized_email
                else "Notification rule is inactive."
            ),
            metadata=log_metadata,
        )
        return None

    if dedupe_key:
        existing = (
            SmartNotification.objects.filter(
                event_type=event_type,
                channel=channel,
                recipient_email__iexact=normalized_email,
                metadata__dedupe_key=dedupe_key,
            )
            .order_by("-created_at", "-id")
            .first()
        )
        if existing:
            NotificationLog.objects.create(
                smart_notification=existing,
                notification_rule=rule,
                event_type=event_type,
                channel=channel,
                status=NotificationLog.STATUS_SKIPPED,
                recipient_email=normalized_email,
                message="Duplicate notification suppressed.",
                metadata=log_metadata,
            )
            return existing

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
