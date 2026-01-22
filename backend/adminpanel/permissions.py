from rest_framework.permissions import BasePermission


class IsAdminUserRole(BasePermission):
    """
    Admin gate for the custom MyHomeBro app.
    We try multiple ways to detect admin:
      - user.is_superuser
      - user.is_staff
      - user.role in {"admin", "platform_admin"}
      - user.user_type/type in {"admin"}
    """

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False

        if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
            return True

        role = getattr(user, "role", None) or getattr(user, "user_role", None)
        if role in {"admin", "platform_admin"}:
            return True

        user_type = getattr(user, "type", None) or getattr(user, "user_type", None)
        if user_type in {"admin"}:
            return True

        return False
