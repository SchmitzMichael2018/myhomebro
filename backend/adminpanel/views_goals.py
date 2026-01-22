from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from .permissions import IsAdminUserRole
from .models import AdminGoal
from .services.goals_metrics import compute_goals_snapshot, snapshot_to_api_dict


class AdminGoals(APIView):
    """
    Admin Goals (CEO dashboard for salary tracking).

    Primary truth:
      - Rolling 12 months platform fees collected from receipts (platform_fee_cents)

    This matches how your AdminOverview already treats receipts as the
    financial source of truth. :contentReference[oaicite:3]{index=3}
    """
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        # Ensure goal exists
        goal = AdminGoal.get_or_create_default_owner_salary_goal()

        # Allow admin override via query param (optional)
        # Example: /api/admin/goals/?target_cents=35000000
        override = request.query_params.get("target_cents")
        target_cents = goal.target_cents
        if override:
            try:
                target_cents = int(override)
            except Exception:
                target_cents = goal.target_cents

        snap = compute_goals_snapshot(
            goal_key=goal.key,
            goal_target_cents=target_cents,
        )

        payload = snapshot_to_api_dict(snap)

        # Also return the saved goal record so UI can show it
        payload["goal"]["saved_target_cents"] = goal.target_cents
        payload["goal"]["saved_target"] = f"{goal.target_cents / 100:.2f}"
        payload["goal"]["is_enabled"] = goal.is_enabled

        return Response(payload, status=status.HTTP_200_OK)
