from __future__ import annotations

from django.utils import timezone

from projects.models_project_activity import ProjectActivityEvent


def create_project_activity_event(
    *,
    agreement,
    event_type: str,
    object_type: str,
    object_id,
    title: str,
    body: str = "",
    actor=None,
    recipient=None,
    actor_role: str = "",
    recipient_role: str = "",
    milestone=None,
    delivered: bool = False,
    responded: bool = False,
    resolved: bool = False,
    metadata: dict | None = None,
) -> ProjectActivityEvent | None:
    if agreement is None or not getattr(agreement, "id", None):
        return None
    now = timezone.now()
    return ProjectActivityEvent.objects.create(
        agreement=agreement,
        milestone=milestone,
        actor=actor if getattr(actor, "is_authenticated", True) else None,
        recipient=recipient if getattr(recipient, "is_authenticated", True) else None,
        actor_role=actor_role or "",
        recipient_role=recipient_role or "",
        object_type=object_type,
        object_id=str(object_id or ""),
        event_type=event_type,
        title=title or "",
        body=body or "",
        delivered_at=now if delivered else None,
        responded_at=now if responded else None,
        resolved_at=now if resolved else None,
        metadata=metadata or {},
    )


def mark_activity_viewed(*, object_type: str, object_id, viewer=None, viewer_role: str = "") -> int:
    qs = ProjectActivityEvent.objects.filter(object_type=object_type, object_id=str(object_id or ""), viewed_at__isnull=True)
    if viewer_role:
        qs = qs.filter(recipient_role=viewer_role)
    now = timezone.now()
    return qs.update(viewed_at=now)


def serialize_project_activity_events(agreement, *, object_type: str | None = None, object_id=None, limit: int = 20) -> list[dict]:
    if agreement is None or not getattr(agreement, "id", None):
        return []
    qs = ProjectActivityEvent.objects.filter(agreement=agreement)
    if object_type:
        qs = qs.filter(object_type=object_type)
    if object_id is not None:
        qs = qs.filter(object_id=str(object_id))
    rows = qs.order_by("-created_at", "-id")[:limit]
    return [
        {
            "id": row.id,
            "event_type": row.event_type,
            "event_label": row.get_event_type_display(),
            "title": row.title,
            "body": row.body,
            "actor_role": row.actor_role,
            "recipient_role": row.recipient_role,
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "delivered_at": row.delivered_at.isoformat() if row.delivered_at else "",
            "viewed_at": row.viewed_at.isoformat() if row.viewed_at else "",
            "responded_at": row.responded_at.isoformat() if row.responded_at else "",
            "resolved_at": row.resolved_at.isoformat() if row.resolved_at else "",
            "metadata": row.metadata or {},
        }
        for row in rows
    ]
