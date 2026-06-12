from __future__ import annotations

import logging

from django.db.models import Q

from projects.models import Notification
from projects.services.recipient_validation import contractor_has_valid_account_email
from projects.utils.accounts import get_contractor_for_user

logger = logging.getLogger(__name__)


ACTION_NEEDED_CATEGORIES = {
    Notification.EVENT_QUOTE_REQUEST_RECEIVED,
    Notification.EVENT_MILESTONE_PENDING_APPROVAL,
    Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
    Notification.EVENT_REIMBURSEMENT_HELD,
    Notification.EVENT_DISPUTE_OPENED,
    Notification.EVENT_DISPUTE_UPDATED,
    Notification.EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED,
}


ACTION_LABELS = {
    Notification.EVENT_QUOTE_REQUEST_RECEIVED: "Review Quote",
    Notification.EVENT_AGREEMENT_SIGNED: "Open Agreement",
    Notification.EVENT_ESCROW_FUNDED: "Open Agreement",
    Notification.EVENT_INVOICE_APPROVED: "View Invoice",
    Notification.EVENT_MILESTONE_PENDING_APPROVAL: "Review Work",
    Notification.EVENT_PAYMENT_RELEASED: "View Payment",
    Notification.EVENT_BID_AWARDED: "Open Agreement",
    Notification.EVENT_BID_NOT_SELECTED: "View Bids",
    Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED: "Review Opportunity",
    Notification.EVENT_MARKETPLACE_VERIFICATION_APPROVED: "View Bids",
    Notification.EVENT_MARKETPLACE_VERIFICATION_REJECTED: "View Bids",
    Notification.EVENT_MARKETPLACE_VERIFICATION_SUSPENDED: "View Bids",
    Notification.EVENT_REIMBURSEMENT_APPROVED: "Open Agreement",
    Notification.EVENT_REIMBURSEMENT_DENIED: "Open Agreement",
    Notification.EVENT_REIMBURSEMENT_RELEASED: "Open Agreement",
    Notification.EVENT_REIMBURSEMENT_HELD: "Open Agreement",
    Notification.EVENT_DISPUTE_OPENED: "Open Dispute",
    Notification.EVENT_DISPUTE_UPDATED: "Open Dispute",
    Notification.EVENT_DISPUTE_RESOLVED: "Open Dispute",
    Notification.EVENT_DRAW_APPROVED: "Open Draw",
    Notification.EVENT_DRAW_CHANGES_REQUESTED: "Open Draw",
    Notification.EVENT_DRAW_PAID: "Open Draw",
    Notification.EVENT_DRAW_RELEASED: "Open Draw",
    Notification.EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED: "Open Agreement",
    Notification.EVENT_MAINTENANCE_WORK_ORDER_COMPLETED: "Open Agreement",
    Notification.EVENT_MAINTENANCE_CONTRACT_CANCELLED: "Open Agreement",
}


ACTION_URLS = {
    Notification.EVENT_QUOTE_REQUEST_RECEIVED: "/app/bids",
    Notification.EVENT_AGREEMENT_SIGNED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/agreements",
    Notification.EVENT_ESCROW_FUNDED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/agreements",
    Notification.EVENT_INVOICE_APPROVED: lambda notification: f"/app/invoices/{notification.invoice_id}" if notification.invoice_id else "/app/invoices",
    Notification.EVENT_MILESTONE_PENDING_APPROVAL: "/app/reviewer/queue",
    Notification.EVENT_PAYMENT_RELEASED: lambda notification: f"/app/invoices/{notification.invoice_id}" if notification.invoice_id else "/app/invoices",
    Notification.EVENT_BID_AWARDED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/bids",
    Notification.EVENT_BID_NOT_SELECTED: "/app/bids",
    Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED: "/app/bids",
    Notification.EVENT_MARKETPLACE_VERIFICATION_APPROVED: "/app/bids",
    Notification.EVENT_MARKETPLACE_VERIFICATION_REJECTED: "/app/bids",
    Notification.EVENT_MARKETPLACE_VERIFICATION_SUSPENDED: "/app/bids",
    Notification.EVENT_DRAW_APPROVED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/dashboard",
    Notification.EVENT_DRAW_CHANGES_REQUESTED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/dashboard",
    Notification.EVENT_DRAW_PAID: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/dashboard",
    Notification.EVENT_DRAW_RELEASED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/dashboard",
    Notification.EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED: lambda notification: f"/app/agreements/{notification.agreement_id}/wizard?step=2" if notification.agreement_id else "/app/agreements",
    Notification.EVENT_MAINTENANCE_WORK_ORDER_COMPLETED: lambda notification: f"/app/agreements/{notification.agreement_id}/wizard?step=2" if notification.agreement_id else "/app/agreements",
    Notification.EVENT_MAINTENANCE_CONTRACT_CANCELLED: lambda notification: f"/app/agreements/{notification.agreement_id}" if notification.agreement_id else "/app/agreements",
}


def _resolve_actor_fields(actor_user=None, actor_display_name: str = "", actor_email: str = "") -> tuple[str, str]:
    display_name = str(actor_display_name or "").strip()
    email = str(actor_email or "").strip()
    if actor_user is not None:
        if not display_name:
            display_name = (getattr(actor_user, "get_full_name", lambda: "")() or "").strip()
        if not display_name:
            display_name = (getattr(actor_user, "email", "") or "").strip()
        if not email:
            email = (getattr(actor_user, "email", "") or "").strip()
    return display_name, email


def create_notification(
    *,
    contractor=None,
    user=None,
    category: str,
    title: str,
    body: str = "",
    link: str = "",
    agreement=None,
    milestone=None,
    invoice=None,
    draw_request=None,
    public_lead=None,
    actor_user=None,
    actor_display_name: str = "",
    actor_email: str = "",
):
    category = str(category or "").strip() or Notification.EVENT_BID_AWARDED

    if contractor is None and user is not None:
        contractor = get_contractor_for_user(user)
    if user is None and contractor is not None:
        user = getattr(contractor, "user", None)

    if contractor is None:
        return None, False
    if not contractor_has_valid_account_email(contractor):
        logger.warning("Skipped contractor notification for contractor_id=%s: invalid or missing account email.", getattr(contractor, "id", None))
        return None, False

    actor_display_name, actor_email = _resolve_actor_fields(actor_user, actor_display_name, actor_email)
    link = str(link or "").strip()
    body = str(body or "").strip()
    title = str(title or "").strip() or "Notification"

    lookup = {
        "contractor": contractor,
        "category": category,
        "agreement": agreement,
        "milestone": milestone,
        "invoice": invoice,
        "draw_request": draw_request,
        "public_lead": public_lead,
    }
    if user is not None:
        lookup["user"] = user
    if link:
        lookup["link"] = link

    defaults = {
        "event_type": category,
        "title": title,
        "message": body,
        "link": link,
        "actor_user": actor_user,
        "actor_display_name": actor_display_name,
        "actor_email": actor_email,
    }

    notification, created = Notification.objects.get_or_create(defaults=defaults, **lookup)
    if not created:
        update_fields = []
        for field_name, value in (
            ("user", user),
            ("contractor", contractor),
            ("category", category),
            ("event_type", category),
            ("title", title),
            ("message", body),
            ("link", link),
            ("agreement", agreement),
            ("milestone", milestone),
            ("invoice", invoice),
            ("draw_request", draw_request),
            ("public_lead", public_lead),
            ("actor_user", actor_user),
            ("actor_display_name", actor_display_name),
            ("actor_email", actor_email),
        ):
            if value is not None and getattr(notification, field_name, None) != value:
                setattr(notification, field_name, value)
                update_fields.append(field_name)
        if update_fields:
            notification.save(update_fields=list(dict.fromkeys(update_fields)))

    return notification, created


def get_notification_queryset_for_user(user):
    contractor = get_contractor_for_user(user) if user is not None else None
    qs = Notification.objects.select_related(
        "user",
        "contractor",
        "agreement",
        "agreement__project",
        "milestone",
        "milestone__agreement",
        "milestone__agreement__project",
        "invoice",
        "invoice__agreement",
        "invoice__agreement__project",
        "draw_request",
        "draw_request__agreement",
        "draw_request__agreement__project",
        "public_lead",
    )
    if user is None:
        return qs.none(), contractor

    q = Q(user=user)
    if contractor is not None:
        q |= Q(contractor=contractor)
    return qs.filter(q).distinct(), contractor


def notification_action_label(notification) -> str:
    category = str(getattr(notification, "category", "") or getattr(notification, "event_type", "") or "").strip()
    if category in ACTION_LABELS:
        return ACTION_LABELS[category]
    if getattr(notification, "agreement_id", None):
        return "Open Agreement"
    if getattr(notification, "invoice_id", None):
        return "View Invoice"
    if getattr(notification, "draw_request_id", None):
        return "Open Draw"
    return "View Details"


def notification_action_url(notification) -> str:
    category = str(getattr(notification, "category", "") or getattr(notification, "event_type", "") or "").strip()
    action = ACTION_URLS.get(category)
    if callable(action):
        return action(notification)
    if isinstance(action, str):
        return action
    if getattr(notification, "link", ""):
        return getattr(notification, "link", "")
    if getattr(notification, "agreement_id", None):
        return f"/app/agreements/{notification.agreement_id}"
    if getattr(notification, "invoice_id", None):
        return f"/app/invoices/{notification.invoice_id}"
    if getattr(notification, "draw_request_id", None):
        return "/app/dashboard"
    if getattr(notification, "public_lead_id", None):
        return "/app/bids"
    return ""


def is_action_needed(notification) -> bool:
    category = str(getattr(notification, "category", "") or getattr(notification, "event_type", "") or "").strip()
    return category in ACTION_NEEDED_CATEGORIES
