# backend/projects/services/agreements/permissions.py
from __future__ import annotations

from django.utils.timezone import now
from rest_framework.exceptions import PermissionDenied

from projects.models import Agreement


def _is_staff(user) -> bool:
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


def contractor_user_for_agreement(ag: Agreement):
    return getattr(getattr(ag, "contractor", None), "user", None)


def _both_parties_signed(ag: Agreement) -> bool:
    """
    Strict meaning: BOTH parties actually signed in-platform.
    This is what you want for retention policies and for blocking unsign-after-both-signed.
    Waivers should NOT count as "signed" here.
    """
    return bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))


def _both_signed_at(ag: Agreement):
    """
    Latest timestamp among the two signature timestamps, only when both are present.
    """
    ch = getattr(ag, "signed_at_contractor", None) or getattr(ag, "contractor_signed_at", None)
    hh = getattr(ag, "signed_at_homeowner", None) or getattr(ag, "homeowner_signed_at", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return None


def require_staff_or_contractor_owner(user, ag: Agreement, *, message: str) -> None:
    """Raises PermissionDenied unless user is staff/superuser or the agreement's contractor user."""
    if _is_staff(user):
        return
    if user and getattr(user, "is_authenticated", False) and user == contractor_user_for_agreement(ag):
        return
    raise PermissionDenied(message)


def require_delete_allowed(user, ag: Agreement, *, retention_years: int = 3) -> None:
    """
    Deletion rules:
    - staff/superuser always allowed
    - otherwise only the assigned contractor user
    - if BOTH parties signed, enforce retention policy
    """
    require_staff_or_contractor_owner(
        user,
        ag,
        message="Only the assigned contractor (or staff) can delete this agreement.",
    )

    if _both_parties_signed(ag):
        signed_at = _both_signed_at(ag)
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
    """
    Your rule:
    - Contractor can unsign ONLY if the customer has NOT signed yet.
    (Even if customer signature is waived, customer hasn't signed, so unsign is allowed.)
    """
    require_staff_or_contractor_owner(
        user,
        ag,
        message="Only the assigned contractor (or staff) can unsign as contractor.",
    )

    if bool(getattr(ag, "signed_by_homeowner", False)):
        raise PermissionDenied("Cannot unsign after the customer has signed.")