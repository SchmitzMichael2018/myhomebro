from __future__ import annotations

from decimal import Decimal

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Milestone
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorMilestoneAgreement,
    SubcontractorMilestoneAgreementStatus,
    SubcontractorInvitationStatus,
)
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.subcontractor_milestone_agreements import (
    accept_subcontractor_milestone_agreement,
    decline_subcontractor_milestone_agreement,
    get_latest_subcontractor_milestone_agreement,
    serialize_subcontractor_milestone_agreement,
    upsert_subcontractor_milestone_agreement,
)
from projects.views.subcontractor_work import _assigned_milestone_queryset


def _get_owned_milestone(*, user, milestone_id: int) -> Milestone:
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionError("Only contractors can manage subcontractor milestone agreements.")
    milestone = get_object_or_404(
        Milestone.objects.select_related(
            "agreement",
            "agreement__project",
            "agreement__project__contractor",
            "assigned_subcontractor_invitation",
            "assigned_subcontractor_invitation__accepted_by_user",
        ),
        pk=milestone_id,
        agreement__project__contractor=contractor,
    )
    return milestone


def _get_assigned_milestone(*, user, milestone_id: int) -> Milestone:
    milestone = _assigned_milestone_queryset(user).filter(id=milestone_id).first()
    if milestone is None:
        raise PermissionError("Not found.")
    return milestone


def _extract_term_value(request, milestone: Milestone, current_agreement: SubcontractorMilestoneAgreement | None = None):
    current_pay = None
    if current_agreement is not None:
        current_pay = current_agreement.agreed_pay
    elif getattr(milestone, "subcontractor_payout_amount_cents", None) is not None:
        try:
            current_pay = Decimal(str(getattr(milestone, "subcontractor_payout_amount_cents"))) / Decimal("100")
        except Exception:
            current_pay = None
    if current_pay is None:
        try:
            current_pay = Decimal(str(getattr(milestone, "amount", 0) or 0))
        except Exception:
            current_pay = Decimal("0.00")

    payload = request.data or {}
    agreed_pay = payload.get("agreed_pay", current_pay)
    payment_release_mode = payload.get(
        "payment_release_mode",
        getattr(current_agreement, "payment_release_mode", None) or "manual_release",
    )
    override_reason = payload.get("override_reason", getattr(current_agreement, "override_reason", "") or "")
    def _coerce_bool(value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}

    send_agreement = _coerce_bool(payload.get("send_agreement", True), True)
    mark_pending = _coerce_bool(payload.get("mark_pending", False), False)
    return agreed_pay, payment_release_mode, override_reason, send_agreement, mark_pending


class MilestoneSubcontractorAgreementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, milestone_id: int):
        try:
            milestone = _get_owned_milestone(user=request.user, milestone_id=milestone_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        agreement = get_latest_subcontractor_milestone_agreement(
            milestone,
            getattr(milestone, "assigned_subcontractor_invitation", None),
        )
        return Response(
            {
                "milestone_id": milestone.id,
                "agreement": serialize_subcontractor_milestone_agreement(
                    agreement,
                    contractor_view=True,
                ),
            }
        )

    def patch(self, request, milestone_id: int):
        try:
            milestone = _get_owned_milestone(user=request.user, milestone_id=milestone_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
        if invitation is None:
            return Response({"detail": "Assign a subcontractor before creating an agreement."}, status=status.HTTP_400_BAD_REQUEST)
        if invitation.status != SubcontractorInvitationStatus.ACCEPTED:
            return Response({"detail": "Only accepted subcontractors can receive milestone agreements."}, status=status.HTTP_400_BAD_REQUEST)

        current_agreement = get_latest_subcontractor_milestone_agreement(milestone, invitation)
        agreed_pay, payment_release_mode, override_reason, send_agreement, mark_pending = _extract_term_value(
            request,
            milestone,
            current_agreement=current_agreement,
        )
        try:
            obj = upsert_subcontractor_milestone_agreement(
                contractor=getattr(getattr(milestone, "agreement", None), "contractor", None),
                agreement=getattr(milestone, "agreement", None),
                milestone=milestone,
                invitation=invitation,
                agreed_pay=agreed_pay,
                payment_release_mode=payment_release_mode,
                override_reason=override_reason,
                send_agreement=send_agreement,
                mark_pending=mark_pending,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "milestone_id": milestone.id,
                "agreement": serialize_subcontractor_milestone_agreement(
                    obj,
                    contractor_view=True,
                ),
            },
            status=status.HTTP_200_OK if current_agreement else status.HTTP_201_CREATED,
        )


class SubcontractorMilestoneAgreementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, milestone_id: int):
        try:
            milestone = _get_assigned_milestone(user=request.user, milestone_id=milestone_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
        agreement = get_latest_subcontractor_milestone_agreement(milestone, invitation)
        if agreement is None:
            return Response(
                {
                    "milestone_id": milestone.id,
                    "agreement": None,
                },
                status=status.HTTP_200_OK,
            )
        if getattr(invitation, "accepted_by_user_id", None) != getattr(request.user, "id", None):
            return Response({"detail": "You can only view your own milestone agreement."}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            {
                "milestone_id": milestone.id,
                "agreement": serialize_subcontractor_milestone_agreement(
                    agreement,
                    subcontractor_view=True,
                ),
            }
        )


class SubcontractorMilestoneAgreementAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, milestone_id: int):
        try:
            milestone = _get_assigned_milestone(user=request.user, milestone_id=milestone_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
        if invitation is None or getattr(invitation, "accepted_by_user_id", None) != getattr(request.user, "id", None):
            return Response({"detail": "You can only accept your own milestone agreement."}, status=status.HTTP_403_FORBIDDEN)

        agreement = get_latest_subcontractor_milestone_agreement(milestone, invitation)
        if agreement is None:
            return Response({"detail": "No subcontractor agreement has been prepared yet."}, status=status.HTTP_400_BAD_REQUEST)
        if agreement.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.ACCEPTED:
            return Response(
                {
                    "milestone_id": milestone.id,
                    "agreement": serialize_subcontractor_milestone_agreement(
                        agreement,
                        subcontractor_view=True,
                    ),
                },
                status=status.HTTP_200_OK,
            )

        agreement = accept_subcontractor_milestone_agreement(agreement_obj=agreement, user=request.user)
        return Response(
            {
                "milestone_id": milestone.id,
                "agreement": serialize_subcontractor_milestone_agreement(
                    agreement,
                    subcontractor_view=True,
                ),
            },
            status=status.HTTP_200_OK,
        )


class SubcontractorMilestoneAgreementDeclineView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, milestone_id: int):
        try:
            milestone = _get_assigned_milestone(user=request.user, milestone_id=milestone_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
        if invitation is None or getattr(invitation, "accepted_by_user_id", None) != getattr(request.user, "id", None):
            return Response({"detail": "You can only decline your own milestone agreement."}, status=status.HTTP_403_FORBIDDEN)

        agreement = get_latest_subcontractor_milestone_agreement(milestone, invitation)
        if agreement is None:
            return Response({"detail": "No subcontractor agreement has been prepared yet."}, status=status.HTTP_400_BAD_REQUEST)

        agreement = decline_subcontractor_milestone_agreement(agreement_obj=agreement, user=request.user)
        return Response(
            {
                "milestone_id": milestone.id,
                "agreement": serialize_subcontractor_milestone_agreement(
                    agreement,
                    subcontractor_view=True,
                ),
            },
            status=status.HTTP_200_OK,
        )
