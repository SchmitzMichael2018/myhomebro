# backend/projects/services/dispute_inapp.py
from __future__ import annotations

from typing import Optional
from django.utils import timezone


def try_create_inapp_notification(user, title: str, message: str, kind: str = "dispute") -> bool:
    """
    Best-effort in-app notification.
    If your Notification model exists, we create a row.
    If not, this is a no-op and returns False.
    """
    if not user:
        return False

    try:
        # Adjust import if your Notification model lives elsewhere
        from projects.models.notifications import Notification  # type: ignore
    except Exception:
        try:
            from projects.models import Notification  # type: ignore
        except Exception:
            return False

    try:
        Notification.objects.create(
            user=user,
            title=title,
            message=message,
            kind=kind,
            created_at=timezone.now(),
        )
        return True
    except Exception:
        return False
