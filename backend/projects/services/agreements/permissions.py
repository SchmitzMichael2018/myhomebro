# backend/projects/services/agreements/permissions.py
from __future__ import annotations

from typing import Optional

from django.utils.timezone import now
from rest_framework.exceptions import PermissionDenied

from projects.models import Agreement
from projects.services.agreements.editability import is_fully_signed, fully_signed_at


def _is_staff(user) -> bool:
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


def contractor_user_for_agreement(ag: Agreement):
    return getattr(getattr(ag, "contractor", None), "user", None)


def require_staff_or_contractor_owner(user, ag: Agreement, *, message: str) -> None:
    """Raises PermissionDenied unless user is staff/superuser or the agreement's contractor user."""
    if _is_staff(user):
        return
    if user and user.is_authenticated and user == contractor_user_for_agreement(ag):
        return
    raise PermissionDenied(message)


def require_delete_allowed(user, ag: Agreement, *, retention_years: int = 3) -> None:
    """Deletion rules:
    - staff/superuser always allowed
    - otherwise only the assigned contractor user
    - if fully signed, enforce retention policy
    """
    require_staff_or_contractor_owner(
        user,
        ag,
        message="Only the assigned contractor (or staff) can delete this agreement.",
    )

    if is_fully_signed(ag):
        signed_at = fully_signed_at(ag)
        if not signed_at:
            raise PermissionDenied(f"Deletion blocked by retention policy ({retention_years} years).")
        if (now() - signed_at).days < (retention_years * 365):
            raise PermissionDenied(f"Deletion blocked by retention policy ({retention_years} years).")


def require_contractor_sign_allowed(user, ag: Agreement) -> None:
    require_staff_or_contractor_owner(
        user,
        ag,
        message="Only the assigned contractor (or staff) can sign as contractor.",
    )


def require_contractor_unsign_allowed(user, ag: Agreement) -> None:
    require_staff_or_contractor_owner(
        user,
        ag,
        message="Only the assigned contractor (or staff) can unsign as contractor.",
    )
    if is_fully_signed(ag):
        raise PermissionDenied("Cannot unsign after both parties have signed.")
