from __future__ import annotations

from html import escape
import logging
from typing import Iterable

from django.conf import settings
from django.utils import timezone

from projects.models import ExpenseRequest, Notification, PublicContractorLead
from projects.models_customer_portal import NotificationRule, SmartNotificationEvent
from projects.services.customer_notification_preferences import (
    notification_category_enabled,
    notification_channel_enabled,
    notification_preferences_for_email,
)
from projects.services.invites_delivery import send_postmark_email
from projects.services.notification_center import create_notification
from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms
from projects.services.smart_notifications import create_smart_notification


logger = logging.getLogger(__name__)


def _safe_text(value) -> str:
    return str(value or "").strip()


def _agreement_title(agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "title", ""))
        or f"Agreement #{getattr(agreement, 'id', '')}"
    )


def _agreement_customer_email(agreement) -> str:
    homeowner = getattr(agreement, "homeowner", None)
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project is not None else None
    return (
        _safe_text(getattr(homeowner, "email", ""))
        or _safe_text(getattr(project_homeowner, "email", ""))
        or _safe_text(getattr(agreement, "homeowner_email", ""))
    ).lower()


def _reimbursement_title(expense: ExpenseRequest) -> str:
    return (
        _safe_text(getattr(expense, "title", ""))
        or _safe_text(getattr(expense, "description", ""))
        or f"Reimbursement #{getattr(expense, 'id', '')}"
    )


def _lead_request_title(lead: PublicContractorLead) -> str:
    analysis = getattr(lead, "ai_analysis", None) or {}
    return (
        _safe_text(analysis.get("project_title"))
        or _safe_text(analysis.get("project_scope_summary"))
        or _safe_text(getattr(lead, "project_type", ""))
        or _safe_text(getattr(lead, "project_description", ""))
        or f"Request #{getattr(lead, 'id', '')}"
    )


def notify_marketplace_request_routed(*, intake, leads: Iterable[PublicContractorLead]) -> None:
    leads = list(leads or [])
    request_title = (
        _safe_text(getattr(intake, "ai_project_title", ""))
        or _safe_text(getattr(intake, "ai_project_type", ""))
        or _safe_text(getattr(intake, "accomplishment_text", ""))
        or f"Request #{getattr(intake, 'id', '')}"
    )
    customer_email = _safe_text(getattr(intake, "customer_email", "")).lower()
    if customer_email and leads:
        create_smart_notification(
            event_type=SmartNotificationEvent.MARKETPLACE_REQUEST_ROUTED,
            recipient_email=customer_email,
            homeowner=getattr(intake, "homeowner", None),
            customer_request=None,
            action_url="/portal",
            context={
                "request_title": request_title,
                "contractor_count": len(leads),
                "dedupe_key": f"marketplace_request_routed:intake:{getattr(intake, 'id', '')}",
            },
        )

    for lead in leads:
        contractor = getattr(lead, "contractor", None)
        if contractor is None:
            continue
        create_notification(
            contractor=contractor,
            user=getattr(contractor, "user", None),
            category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
            title="New marketplace opportunity",
            body=f"{request_title} is ready for bid review.",
            link="/app/bids",
            public_lead=lead,
            actor_display_name=_safe_text(getattr(intake, "customer_name", "")) or "Customer",
            actor_email=customer_email,
        )


def notify_customer_bid_received(*, lead: PublicContractorLead) -> None:
    customer_email = _safe_text(getattr(lead, "email", "")).lower()
    if not customer_email:
        return
    contractor = getattr(lead, "contractor", None)
    create_smart_notification(
        event_type=SmartNotificationEvent.CUSTOMER_BID_RECEIVED,
        recipient_email=customer_email,
        contractor=contractor,
        action_url="/portal",
        context={
            "request_title": _lead_request_title(lead),
            "contractor_name": _safe_text(getattr(contractor, "business_name", "")) or _safe_text(getattr(contractor, "name", "")) or "A contractor",
            "dedupe_key": f"customer_bid_received:lead:{getattr(lead, 'id', '')}",
        },
    )


def notify_contractor_verification_status(*, contractor, action: str, actor_user=None, reason: str = "") -> None:
    action = _safe_text(action).lower()
    mapping = {
        "verify": (
            Notification.EVENT_MARKETPLACE_VERIFICATION_APPROVED,
            "Marketplace verification approved",
            "Your MyHomeBro marketplace verification was approved.",
        ),
        "reject": (
            Notification.EVENT_MARKETPLACE_VERIFICATION_REJECTED,
            "Marketplace verification rejected",
            f"Your MyHomeBro marketplace verification was rejected. {_safe_text(reason)}".strip(),
        ),
        "suspend": (
            Notification.EVENT_MARKETPLACE_VERIFICATION_SUSPENDED,
            "Marketplace access suspended",
            f"Your MyHomeBro marketplace access was suspended. {_safe_text(reason)}".strip(),
        ),
    }
    if contractor is None or action not in mapping:
        return
    category, title, body = mapping[action]
    create_notification(
        contractor=contractor,
        user=getattr(contractor, "user", None),
        category=category,
        title=title,
        body=body,
        link="/app/bids",
        actor_user=actor_user,
    )


def notify_reimbursement_submitted(*, expense: ExpenseRequest, is_resend: bool = False) -> None:
    agreement = getattr(expense, "agreement", None)
    customer_email = _agreement_customer_email(agreement) if agreement is not None else ""
    if not customer_email:
        return
    create_smart_notification(
        event_type=SmartNotificationEvent.REIMBURSEMENT_SUBMITTED,
        recipient_email=customer_email,
        homeowner=getattr(agreement, "homeowner", None),
        contractor=getattr(agreement, "contractor", None),
        project=getattr(agreement, "project", None),
        agreement=agreement,
        property_profile=None,
        action_url="/portal",
        context={
            "project_title": _agreement_title(agreement),
            "reimbursement_title": _reimbursement_title(expense),
            "dedupe_key": (
                f"reimbursement_submitted:{getattr(expense, 'id', '')}:resend:{timezone.now().isoformat()}"
                if is_resend
                else f"reimbursement_submitted:{getattr(expense, 'id', '')}"
            ),
        },
    )


def notify_reimbursement_contractor_update(*, expense: ExpenseRequest, event_type: str, actor_user=None, reason: str = "") -> None:
    agreement = getattr(expense, "agreement", None)
    contractor = getattr(agreement, "contractor", None) if agreement is not None else None
    if contractor is None:
        return
    copy = {
        Notification.EVENT_REIMBURSEMENT_APPROVED: (
            "Reimbursement approved",
            f"{_reimbursement_title(expense)} was approved and queued for escrow release.",
        ),
        Notification.EVENT_REIMBURSEMENT_DENIED: (
            "Reimbursement denied",
            f"{_reimbursement_title(expense)} was denied. {_safe_text(reason)}".strip(),
        ),
        Notification.EVENT_REIMBURSEMENT_RELEASED: (
            "Reimbursement released",
            f"{_reimbursement_title(expense)} was released from escrow.",
        ),
        Notification.EVENT_REIMBURSEMENT_HELD: (
            "Reimbursement on hold",
            f"{_reimbursement_title(expense)} was placed on hold. {_safe_text(reason)}".strip(),
        ),
    }
    if event_type not in copy:
        return
    title, body = copy[event_type]
    create_notification(
        contractor=contractor,
        user=getattr(contractor, "user", None),
        category=event_type,
        title=title,
        body=body,
        link=f"/app/agreements/{getattr(agreement, 'id', '')}?reimbursement={getattr(expense, 'id', '')}" if agreement is not None else "/app/dashboard",
        agreement=agreement,
        actor_user=actor_user,
    )


def notify_dispute_event(*, dispute, event_type: str, actor_user=None, customer_message: str = "") -> None:
    agreement = getattr(dispute, "agreement", None)
    contractor = getattr(agreement, "contractor", None) if agreement is not None else None
    project_title = _agreement_title(agreement) if agreement is not None else "this project"
    contractor_copy = {
        Notification.EVENT_DISPUTE_OPENED: ("Dispute opened", f"A dispute was opened for {project_title}."),
        Notification.EVENT_DISPUTE_UPDATED: ("Dispute updated", f"A dispute was updated for {project_title}."),
        Notification.EVENT_DISPUTE_RESOLVED: ("Dispute resolved", f"A dispute was resolved for {project_title}."),
    }
    if contractor is not None and event_type in contractor_copy:
        title, body = contractor_copy[event_type]
        create_notification(
            contractor=contractor,
            user=getattr(contractor, "user", None),
            category=event_type,
            title=title,
            body=body,
            link=f"/app/disputes/{getattr(dispute, 'id', '')}",
            agreement=agreement,
            milestone=getattr(dispute, "milestone", None),
            actor_user=actor_user,
        )

    customer_email = _agreement_customer_email(agreement) if agreement is not None else ""
    smart_event = {
        Notification.EVENT_DISPUTE_OPENED: SmartNotificationEvent.DISPUTE_OPENED,
        Notification.EVENT_DISPUTE_UPDATED: SmartNotificationEvent.DISPUTE_UPDATED,
        Notification.EVENT_DISPUTE_RESOLVED: SmartNotificationEvent.DISPUTE_RESOLVED,
    }.get(event_type)
    customer_context = {
        "project_title": project_title,
        "dedupe_key": f"{event_type}:dispute:{getattr(dispute, 'id', '')}:{getattr(dispute, 'updated_at', '')}",
    }
    if customer_email and smart_event:
        create_smart_notification(
            event_type=smart_event,
            recipient_email=customer_email,
            homeowner=getattr(agreement, "homeowner", None),
            contractor=contractor,
            project=getattr(agreement, "project", None),
            agreement=agreement,
            milestone=getattr(dispute, "milestone", None),
            action_url="/portal",
            context=customer_context,
        )

    message_text = _safe_text(customer_message)
    if not (customer_email and message_text and smart_event == SmartNotificationEvent.DISPUTE_UPDATED):
        return

    project = getattr(agreement, "project", None)
    homeowner = getattr(agreement, "homeowner", None) or getattr(project, "homeowner", None)
    preferences = notification_preferences_for_email(customer_email, homeowner=homeowner)
    if not notification_category_enabled(preferences, "contractor_responses"):
        return

    dispute_id = getattr(dispute, "id", "")
    public_token = _safe_text(getattr(dispute, "public_token", ""))
    action_url = f"/disputes/{dispute_id}?token={public_token}" if dispute_id and public_token else "/portal"
    base_url = _safe_text(
        getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "")
        or getattr(settings, "FRONTEND_URL", "")
        or getattr(settings, "SITE_URL", "")
        or "https://www.myhomebro.com"
    ).rstrip("/")
    portal_url = f"{base_url}{action_url}"
    channel_context = {**customer_context, "contractor_message": message_text}

    if notification_channel_enabled(preferences, "email_enabled"):
        create_smart_notification(
            event_type=smart_event,
            recipient_email=customer_email,
            context={**channel_context, "dedupe_key": f"{customer_context['dedupe_key']}:email"},
            channel=NotificationRule.CHANNEL_EMAIL,
            homeowner=homeowner,
            contractor=contractor,
            project=getattr(agreement, "project", None),
            agreement=agreement,
            milestone=getattr(dispute, "milestone", None),
            action_url=action_url,
        )
        try:
            send_postmark_email(
                to_email=customer_email,
                subject=f"Message from your contractor: {project_title}",
                text_body=f"Your contractor sent a message about {project_title}:\n\n{message_text}\n\nView and respond: {portal_url}",
                html_body=(
                    f"<p>Your contractor sent a message about <strong>{escape(project_title)}</strong>:</p>"
                    f"<p>{escape(message_text)}</p><p><a href=\"{escape(portal_url, quote=True)}\">View and respond in MyHomeBro</a></p>"
                ),
            )
        except Exception:
            logger.exception("Failed to email customer for dispute %s contractor message.", getattr(dispute, "id", None))

    if notification_channel_enabled(preferences, "sms_enabled"):
        phone = normalize_phone_to_e164(getattr(homeowner, "phone_number", ""))
        if phone:
            sms_dedupe_key = f"{customer_context['dedupe_key']}:sms"
            result = send_compliant_sms(
                phone,
                f"MyHomeBro: Your contractor sent a message about {project_title}. View and respond: {portal_url}",
                related_object=agreement,
                category="customer_care",
                dedupe_key=sms_dedupe_key,
            )
            if result.get("ok"):
                create_smart_notification(
                    event_type=smart_event,
                    recipient_email=customer_email,
                    context={**channel_context, "dedupe_key": sms_dedupe_key, "phone_number": phone},
                    channel=NotificationRule.CHANNEL_SMS,
                    homeowner=homeowner,
                    contractor=contractor,
                    project=getattr(agreement, "project", None),
                    agreement=agreement,
                    milestone=getattr(dispute, "milestone", None),
                    action_url=action_url,
                )
