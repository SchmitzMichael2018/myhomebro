from __future__ import annotations

from projects.models import Notification


def _actor_display_name(user, fallback_email: str = "") -> str:
    if user is not None:
        name = getattr(user, "get_full_name", lambda: "")() or ""
        if name:
            return name
        email = (getattr(user, "email", "") or "").strip()
        if email:
            return email
    return fallback_email or "Subcontractor"


def create_subcontractor_activity_notification(*, milestone, actor_user, event_type: str) -> Notification | None:
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None) if agreement is not None else None
    contractor = getattr(project, "contractor", None) if project is not None else None
    if contractor is None:
        return None

    actor_email = (getattr(actor_user, "email", "") or "").strip()
    actor_name = _actor_display_name(actor_user, actor_email)
    milestone_title = getattr(milestone, "title", "") or f"Milestone #{getattr(milestone, 'id', '')}"
    project_title = getattr(project, "title", "") or f"Agreement #{getattr(agreement, 'id', '')}"

    if event_type == Notification.EVENT_SUBCONTRACTOR_COMMENT:
        title = "Subcontractor added a comment"
        message = f"{actor_name} added a comment on {milestone_title} in {project_title}."
    elif event_type == Notification.EVENT_SUBCONTRACTOR_FILE:
        title = "Subcontractor uploaded a file"
        message = f"{actor_name} uploaded a file to {milestone_title} in {project_title}."
    elif event_type == Notification.EVENT_SUBCONTRACTOR_REVIEW:
        title = "Subcontractor requested review"
        message = f"{actor_name} flagged {milestone_title} as ready for review in {project_title}."
    else:
        return None

    return Notification.objects.create(
        contractor=contractor,
        event_type=event_type,
        agreement=agreement,
        milestone=milestone,
        actor_user=actor_user,
        actor_display_name=actor_name,
        actor_email=actor_email,
        title=title,
        message=message,
    )
