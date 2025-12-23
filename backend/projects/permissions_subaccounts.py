# backend/projects/permissions_subaccounts.py
# v2025-11-16 — Permissions for contractor + sub-account access

from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS

from projects.models import ContractorSubAccount
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


class IsContractorOrSubAccount(BasePermission):
    """
    Allows access only to authenticated users that are either:
    - A primary Contractor, or
    - A ContractorSubAccount belonging to a Contractor.
    """

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False

        contractor = get_contractor_for_user(user)
        return contractor is not None


class CanEditMilestones(BasePermission):
    """
    For use with milestone endpoints.

    - SAFE_METHODS (GET, HEAD, OPTIONS): allowed for contractor and any sub-account.
    - WRITE methods (POST, PUT, PATCH, DELETE): allowed for:
        - Primary Contractor (full control)
        - Sub-account with role == employee_milestones
    - Sub-accounts with employee_readonly are blocked from write actions.
    """

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False

        # Must at least resolve to a contractor to be in the project.
        contractor = get_contractor_for_user(user)
        if contractor is None:
            return False

        if request.method in SAFE_METHODS:
            return True

        # For writes, check if sub-account role allows milestone editing.
        sub = get_subaccount_for_user(user)
        if sub is None:
            # Primary contractor → full write access.
            return True

        return sub.role == ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES
