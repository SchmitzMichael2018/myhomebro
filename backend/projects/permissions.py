# backend/projects/permissions.py
from rest_framework.permissions import BasePermission, SAFE_METHODS

class IsAuthenticatedAndAgreementParty(BasePermission):
    """
    Allows access only to authenticated users who are either:
      - The contractor's user for the agreement, or
      - The homeowner's user for the agreement.
    Works with a ViewSet where self.get_object() returns an Agreement-like object
    with .contractor and .homeowner that each link to a .user (Django auth User).
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        # Must be authenticated at all
        if not request.user or not request.user.is_authenticated:
            self.message = "Authentication required."
            return False
        return True

    def has_object_permission(self, request, view, obj):
        # Staff/superuser always allowed
        u = request.user
        if getattr(u, "is_staff", False) or getattr(u, "is_superuser", False):
            return True

        # Try to resolve contractor->user and homeowner->user
        contractor_user = None
        homeowner_user = None

        contractor = getattr(obj, "contractor", None)
        if contractor is not None:
            contractor_user = getattr(contractor, "user", None)

        homeowner = getattr(obj, "homeowner", None)
        if homeowner is not None:
            homeowner_user = getattr(homeowner, "user", None)

        return (contractor_user == u) or (homeowner_user == u)
