# backend/projects/utils/accounts.py
# v2025-11-16 — Helper utilities for contractor vs sub-account resolution

from __future__ import annotations

from typing import Optional

from django.contrib.auth import get_user_model

from projects.models import Contractor, ContractorSubAccount

User = get_user_model()


def get_subaccount_for_user(user: User) -> Optional[ContractorSubAccount]:
    """
    If the given user is a ContractorSubAccount user, return that object.
    Otherwise return None.
    """
    if not user or not user.is_authenticated:
        return None

    try:
        return ContractorSubAccount.objects.select_related("parent_contractor").get(user=user)
    except ContractorSubAccount.DoesNotExist:
        return None


def get_contractor_for_user(user: User) -> Optional[Contractor]:
    """
    Returns the Contractor that should be considered "current" for this user.

    - If user is a primary Contractor, returns that Contractor.
    - If user is a ContractorSubAccount, returns the parent_contractor.
    - Otherwise returns None.
    """
    if not user or not user.is_authenticated:
        return None

    # Primary Contractor?
    try:
        contractor = Contractor.objects.get(user=user)
        return contractor
    except Contractor.DoesNotExist:
        pass

    # Sub-account?
    sub = get_subaccount_for_user(user)
    if sub is not None:
        return sub.parent_contractor

    return None
