from __future__ import annotations

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Milestone, MilestonePayoutExecutionMode
from projects.models_subcontractor import SubcontractorMilestoneAgreement
from projects.serializers.milestone import MilestoneSerializer
from projects.services.subcontractor_payout_orchestration import (
    release_subcontractor_payment,
    serialize_subcontractor_payout_orchestration,
)
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
            execute_milestone_payout(
                payout.id,
                execution_mode=MilestonePayoutExecutionMode.MANUAL,
            )
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
            execute_milestone_payout(
                payout.id,
                allow_failed_retry=True,
                execution_mode=MilestonePayoutExecutionMode.MANUAL,
            )
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


class ReleaseSubcontractorPaymentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, agreement_id: int):
        contractor = get_contractor_for_user(request.user)
        agreement = None

        try:
            agreement = (
                SubcontractorMilestoneAgreement.objects.select_related(
                    "contractor",
                    "agreement",
                    "agreement__project",
                    "milestone",
                    "milestone__agreement",
                    "milestone__agreement__project",
                    "subcontractor_invitation",
                    "subcontractor_invitation__accepted_by_user",
                    "milestone__payout_record",
                )
                .get(pk=agreement_id)
            )
        except SubcontractorMilestoneAgreement.DoesNotExist:
            return Response({"detail": "Subcontractor agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        if contractor is None and not request.user.is_staff:
            return Response({"detail": "Only contractors can release subcontractor payments."}, status=status.HTTP_403_FORBIDDEN)

        owner = getattr(agreement, "contractor", None)
        if contractor is not None and owner is not None and contractor.id != owner.id and not request.user.is_staff:
            return Response({"detail": "Only the owning contractor can release this subcontractor payment."}, status=status.HTTP_403_FORBIDDEN)

        try:
            payload = release_subcontractor_payment(
                agreement,
                actor_user=request.user,
                allow_staff_override=bool(request.user.is_staff),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        milestone = getattr(agreement, "milestone", None)
        if milestone is not None:
            milestone.refresh_from_db()
        return Response(
            {
                "agreement": serialize_subcontractor_payout_orchestration(
                    agreement,
                    contractor_view=True,
                ),
                "milestone": MilestoneSerializer(milestone, context={"request": request}).data if milestone is not None else None,
                "detail": "Subcontractor payment processed.",
                "result": payload,
            },
            status=status.HTTP_200_OK,
        )
