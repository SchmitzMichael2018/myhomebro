def _norm(s):
    return (s or "").strip().lower()


SIGNED_STATUSES = {
    "signed",
    "funded",
    "active",
    "in_progress",
    "inprogress",
}

COMPLETED_STATUSES = {
    "completed",
    "complete",
    "closed",
    "done",
    "archived_completed",
}


def is_completed_agreement(agreement) -> bool:
    s = _norm(getattr(agreement, "status", ""))
    return s in COMPLETED_STATUSES


def is_signed_or_locked_agreement(agreement) -> bool:
    """
    Agreement is considered 'locked' if signed/funded/active/etc.
    """
    s = _norm(getattr(agreement, "status", ""))
    # if it's completed, it's also locked
    if s in COMPLETED_STATUSES:
        return True
    return s in SIGNED_STATUSES


def can_edit_milestones_under_agreement(agreement, *, allow_amendment: bool) -> bool:
    """
    If agreement is completed -> never.
    If signed/locked -> only if allow_amendment True.
    If draft -> yes.
    """
    if is_completed_agreement(agreement):
        return False
    if is_signed_or_locked_agreement(agreement):
        return bool(allow_amendment)
    return True