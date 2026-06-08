from __future__ import annotations

from typing import Iterable

from projects.models import ExpenseRequest, Notification, PublicContractorLead
from projects.models_customer_portal import SmartNotificationEvent
from projects.services.notification_center import create_notification
from projects.services.smart_notifications import create_smart_notification


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


def notify_reimbursement_submitted(*, expense: ExpenseRequest) -> None:
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
            "dedupe_key": f"reimbursement_submitted:{getattr(expense, 'id', '')}",
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


def notify_dispute_event(*, dispute, event_type: str, actor_user=None) -> None:
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
            context={
                "project_title": project_title,
                "dedupe_key": f"{event_type}:dispute:{getattr(dispute, 'id', '')}:{getattr(dispute, 'updated_at', '')}",
            },
        )
