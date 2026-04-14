from __future__ import annotations

from django.conf import settings

from core.notifications import send_notification
from projects.models import Notification


def _contractor_draw_link(draw) -> str:
    agreement_id = getattr(draw, "agreement_id", None)
    base = str(getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if not agreement_id:
        return f"{base}/app/dashboard" if base else "/app/dashboard"
    path = f"/app/agreements/{agreement_id}"
    return f"{base}{path}" if base else path


def _actor_identity(draw) -> tuple[str, str]:
    agreement = getattr(draw, "agreement", None)
    homeowner = getattr(agreement, "homeowner", None) if agreement else None
    email = str(getattr(homeowner, "email", "") or "").strip()
    name = (
        getattr(homeowner, "full_name", None)
        or getattr(homeowner, "name", None)
        or email
        or "Project owner"
    )
    return str(name).strip(), email


def _project_title(draw) -> str:
    agreement = getattr(draw, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None
    return getattr(project, "title", "") or getattr(agreement, "title", "") or f"Agreement #{getattr(draw, 'agreement_id', '')}"


def _build_event_copy(draw, event_type: str) -> tuple[str, str, str]:
    draw_label = f"Draw {getattr(draw, 'draw_number', '')}: {getattr(draw, 'title', '')}".strip(": ")
    project_title = _project_title(draw)
    if event_type == Notification.EVENT_DRAW_APPROVED:
        return (
            "Draw approved",
            f"{draw_label} was approved for {project_title}. Payment can continue from MyHomeBro.",
            "Draw approved",
        )
    if event_type == Notification.EVENT_DRAW_CHANGES_REQUESTED:
        return (
            "Changes requested on draw",
            f"The owner requested changes for {draw_label} in {project_title}. Review the note and update the request.",
            "Changes requested",
        )
    if event_type == Notification.EVENT_DRAW_PAID:
        return (
            "Draw paid",
            f"Payment completed for {draw_label} in {project_title}. Money received is now reflected in MyHomeBro.",
            "Payment completed",
        )
    raise ValueError(f"Unsupported draw notification event: {event_type}")


def create_draw_lifecycle_notification(draw, *, event_type: str) -> Notification | None:
    agreement = getattr(draw, "agreement", None)
    contractor = getattr(agreement, "contractor", None) if agreement else None
    if contractor is None:
        return None

    actor_name, actor_email = _actor_identity(draw)
    title, message, email_subject = _build_event_copy(draw, event_type)
    notification = Notification.objects.create(
        contractor=contractor,
        event_type=event_type,
        agreement=agreement,
        draw_request=draw,
        actor_user=None,
        actor_display_name=actor_name,
        actor_email=actor_email,
        title=title,
        message=message,
    )

    try:
        send_notification(
            recipient=contractor,
            subject=f"MyHomeBro: {email_subject}",
            template_prefix="emails/draw_lifecycle_notification",
            context={
                "contractor": contractor,
                "agreement": agreement,
                "draw": draw,
                "notification": notification,
                "project_title": _project_title(draw),
                "draw_label": f"Draw {getattr(draw, 'draw_number', '')}: {getattr(draw, 'title', '')}".strip(": "),
                "message": message,
                "link": _contractor_draw_link(draw),
                "site_name": "MyHomeBro",
                "sms_text": message,
            },
        )
    except Exception:
        pass

    return notification
