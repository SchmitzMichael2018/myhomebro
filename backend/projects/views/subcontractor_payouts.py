from __future__ import annotations

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Milestone
from projects.serializers.milestone import MilestoneSerializer
from projects.services.milestone_payout_execution import (
    execute_milestone_payout,
    reset_failed_milestone_payout,
)
from projects.services.subcontractor_payout_accounts import (
    create_subcontractor_manage_link,
    create_subcontractor_onboarding_link,
    is_eligible_subcontractor_user,
    payout_account_status_payload,
    stripe_connect_enabled,
)
from projects.utils.accounts import get_contractor_for_user


def _subcontractor_required(user):
    return is_eligible_subcontractor_user(user)


class SubcontractorPayoutAccountStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not _subcontractor_required(request.user):
            return Response({"detail": "Only subcontractors can access payout onboarding."}, status=status.HTTP_403_FORBIDDEN)
        if not stripe_connect_enabled():
            return Response({"detail": "Stripe disabled", "onboarding_status": "disabled"}, status=status.HTTP_200_OK)
        return Response(payout_account_status_payload(request.user), status=status.HTTP_200_OK)


class SubcontractorPayoutAccountStartView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _subcontractor_required(request.user):
            return Response({"detail": "Only subcontractors can start payout onboarding."}, status=status.HTTP_403_FORBIDDEN)
        if not stripe_connect_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = create_subcontractor_onboarding_link(request.user)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(payload, status=status.HTTP_200_OK)


class SubcontractorPayoutAccountManageView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _subcontractor_required(request.user):
            return Response({"detail": "Only subcontractors can manage payout onboarding."}, status=status.HTTP_403_FORBIDDEN)
        if not stripe_connect_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = create_subcontractor_manage_link(request.user)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(payload, status=status.HTTP_200_OK)


class ExecuteMilestonePayoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, milestone_id: int):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can execute subcontractor payouts."}, status=status.HTTP_403_FORBIDDEN)

        try:
            milestone = Milestone.objects.select_related(
                "agreement",
                "agreement__project",
                "payout_record",
            ).get(
                id=milestone_id,
                agreement__project__contractor=contractor,
            )
        except Milestone.DoesNotExist:
            return Response({"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)

        payout = getattr(milestone, "payout_record", None)
        if payout is None:
            return Response({"detail": "No subcontractor payout exists for this milestone."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            execute_milestone_payout(payout.id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        milestone.refresh_from_db()
        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)


class RetryMilestonePayoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, milestone_id: int):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can retry subcontractor payouts."}, status=status.HTTP_403_FORBIDDEN)

        try:
            milestone = Milestone.objects.select_related(
                "agreement",
                "agreement__project",
                "payout_record",
            ).get(
                id=milestone_id,
                agreement__project__contractor=contractor,
            )
        except Milestone.DoesNotExist:
            return Response({"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)

        payout = getattr(milestone, "payout_record", None)
        if payout is None:
            return Response({"detail": "No subcontractor payout exists for this milestone."}, status=status.HTTP_400_BAD_REQUEST)

        if payout.status != "failed":
            return Response({"detail": "Only failed payouts can be retried."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            execute_milestone_payout(payout.id, allow_failed_retry=True)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        milestone.refresh_from_db()
        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)


class ResetMilestonePayoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, milestone_id: int):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractor owners can reset subcontractor payouts."}, status=status.HTTP_403_FORBIDDEN)

        try:
            milestone = Milestone.objects.select_related(
                "agreement",
                "agreement__project",
                "payout_record",
            ).get(
                id=milestone_id,
                agreement__project__contractor=contractor,
            )
        except Milestone.DoesNotExist:
            return Response({"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)

        payout = getattr(milestone, "payout_record", None)
        if payout is None:
            return Response({"detail": "No subcontractor payout exists for this milestone."}, status=status.HTTP_400_BAD_REQUEST)

        if payout.status != "failed":
            return Response({"detail": "Only failed payouts can be reset."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            reset_failed_milestone_payout(payout.id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        milestone.refresh_from_db()
        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)
